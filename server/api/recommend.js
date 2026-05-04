const express = require('express');
const router = express.Router();
const db = require('../models/db');
const cache = require('../models/cache');

// Debug endpoint - shows user preference vectors for debugging
// WARNING: exposes sensitive preference data - only enabled in development
router.get('/debug', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res
      .status(403)
      .json({ error: 'Debug endpoint disabled in production' });
  }
  const { userId } = req.query;
  if (!userId || typeof userId !== 'string' || userId.length > 128) {
    return res.status(400).json({ error: 'Invalid userId' });
  }
  const likedSongIds = db.getUserLikedSongs(userId, 1000);
  const likedSongs = db.getSongs(likedSongIds);
  const skippedSongIds = db.getUserSkippedSongs(userId, 100);
  const skippedSongs = db.getSongs(skippedSongIds);
  const likeVector = computePreferenceVector(likedSongs, 'like');
  const skipVector = computePreferenceVector(skippedSongs, 'skip');

  res.json({
    likedSongIds,
    skippedSongIds,
    likedSongs: likedSongs.map(s => ({
      id: s.songId,
      name: s.name,
      artist: s.artistName,
    })),
    skippedSongs: skippedSongs.map(s => ({
      id: s.songId,
      name: s.name,
      artist: s.artistName,
    })),
    likeVector,
    skipVector,
  });
});

// Get personalized recommendations
router.get('/', async (req, res) => {
  const { userId, limit = 20, excludePlayed = true, refresh } = req.query;

  if (!userId || typeof userId !== 'string' || userId.length > 128) {
    return res.status(400).json({ error: 'Invalid userId' });
  }

  // Check cache first (skip cache if refresh=true)
  if (refresh !== 'true') {
    const cached = cache.getCachedRecommendations(userId);
    if (cached) {
      console.log(`📦 Cache hit for user: ${userId}`);
      // Apply limit to cached results
      const limited = cached.recommendations.slice(0, parseInt(limit));
      return res.json({
        recommendations: limited,
        meta: { ...cached.meta, cached: true },
      });
    }
  }

  // Cache stampede protection: if another request is already computing for this user,
  // wait for it instead of also computing (which would overload the DB)
  if (cache.isComputing(userId)) {
    console.log(
      `⏳ Request queued for user: ${userId} (cache stampede protection)`
    );
    await cache.waitForComputation(userId);
    // After waiting, the result should be cached — return it
    const cached = cache.getCachedRecommendations(userId);
    if (cached) {
      const limited = cached.recommendations.slice(0, parseInt(limit));
      return res.json({
        recommendations: limited,
        meta: { ...cached.meta, cached: true, waited: true },
      });
    }
    // If still no cache (shouldn't happen normally), fall through to compute
  }

  // Wrap computation in a promise so concurrent requests wait for the same result
  const computationPromise = (async () => {
    try {
      // 1. Get liked songs (use higher limit to ensure complete exclusion)
      const likedSongIds = db.getUserLikedSongs(userId, 1000);
      const likedSongs = db.getSongs(likedSongIds);

      // 2. Get skipped songs with details (including listen duration)
      const skippedSongDetails = db.getUserSkippedSongsWithDetails(userId, 100);
      const skippedSongsMap = {};
      skippedSongDetails.forEach(d => {
        skippedSongsMap[d.songId] = d;
      });
      const skippedSongIds = skippedSongDetails.map(d => d.songId);

      // 3. Get played songs (completed=1, 完整播放，计入偏好+排除)
      const playedSongIds = db.getUserPlayedSongs(userId, 500);
      const playedSongs = db.getSongs(playedSongIds);

      // 3b. Get partial plays (completed=0, 30%-70%收听，计入偏好但不排除)
      const partialPlayedSongIds = db.getPartialPlayedSongs(userId, 500);
      const partialPlayedSongs = db.getSongs(partialPlayedSongIds);

      // 4. Calculate user preference vector
      // 权重: like=3, play(完整/部分)=1
      // 部分播放（30%-70%）计入正向偏好，但不从候选池排除（用户没听完还想听）
      const likedVector =
        likedSongs.length > 0
          ? computePreferenceVector(likedSongs, 'like')
          : null;
      const playedVector =
        playedSongs.length > 0
          ? computePreferenceVector(playedSongs, 'play')
          : null;
      const partialPlayVector =
        partialPlayedSongs.length > 0
          ? computePreferenceVector(partialPlayedSongs, 'play')
          : null;
      // 合并: like + 完整play + 部分play
      const likeVector = mergePreferenceVectors(
        mergePreferenceVectors(likedVector, playedVector),
        partialPlayVector
      );
      const skippedSongs = db.getSongs(skippedSongIds);
      // Build events array with duration info for dynamic skip weight
      const skipEvents = skippedSongDetails.map(d => {
        const song = skippedSongs.find(s => s.songId === d.songId);
        return {
          songId: d.songId,
          listenDuration: d.listenDuration,
          songDuration: d.songDuration,
          ...song,
        };
      });
      const skipVector = computePreferenceVector(skipEvents, 'skip');

      // 4. Get candidate songs
      const candidates = db.getAllSongs(5000);

      // Build exclusion set: songs that should not appear in recommendations
      // 排除列表 = 已喜欢歌曲 + 已跳过歌曲 + 已播放歌曲（用户已接触过的内容）
      const excludeSet = new Set([
        ...likedSongIds.map(id => String(id)),
        ...skippedSongIds.map(id => String(id)),
        ...playedSongIds.map(id => String(id)),
      ]);

      // Filter out already-interacted songs if needed
      const filteredCandidates =
        excludePlayed === 'true' || excludePlayed === true
          ? candidates.filter(s => !excludeSet.has(String(s.songId)))
          : candidates;

      // 5. Score candidates（filteredCandidates 已通过 excludeSet 排除了 skipped）
      const scoredCandidates = filteredCandidates
        .map(song => {
          const songVec = extractFeatures(song);
          const likeScore = computePreferenceScore(likeVector, songVec, false);
          const skipScore = computePreferenceScore(skipVector, songVec, true);

          // Final score = like_score - α * skip_score
          const DISLIKE_WEIGHT = 1.5; // 排斥权重：跳过某类歌曲后，更强烈避免推荐同类
          const finalScore = likeScore - DISLIKE_WEIGHT * skipScore;

          return {
            id: song.songId,
            name: song.name || song.songName,
            artist: song.artistName,
            album: song.albumName,
            duration: song.duration,
            picUrl: song.picUrl,
            genre: song.genre,
            mood: song.mood,
            language: song.language,
            energy: song.energy,
            score: finalScore,
            likeScore,
            skipScore,
          };
        })
        .sort((a, b) => b.score - a.score);

      // 如果候选池为空或推荐结果为空，但用户有喜欢歌曲 → 返回最近同步的歌曲作为降级
      let finalRecommendations = scoredCandidates.slice(0, parseInt(limit));
      if (finalRecommendations.length === 0 && likedSongIds.length > 0) {
        // 降级：用最近同步的歌曲（排除已喜欢/已跳过）
        const fallbackCandidates = db.getAllSongs(50).filter(s => {
          const sid = String(s.songId);
          return (
            !likedSongIds.includes(sid) &&
            !skippedSongIds.includes(sid) &&
            !playedSongIds.includes(sid)
          );
        });
        finalRecommendations = fallbackCandidates.map(song => ({
          id: song.songId,
          name: song.name || song.songName,
          artist: song.artistName,
          album: song.albumName,
          duration: song.duration,
          genre: song.genre,
          mood: song.mood,
          language: song.language,
          energy: song.energy,
          score: 0,
          likeScore: 0,
          skipScore: 0,
          _fallback: true,
        }));
        console.log(
          `⚠️ No candidates from DB, returning ${finalRecommendations.length} fallback songs`
        );
      }

      const result = {
        recommendations: finalRecommendations,
        meta: {
          userId,
          totalCandidates: candidates.length,
          likedCount: likedSongIds.length,
          playedCount: playedSongIds.length,
          skippedCount: skippedSongIds.length,
          cached: false,
          fallback:
            finalRecommendations.length > 0 && scoredCandidates.length === 0,
          // §10 效果评估指标
          metrics: computeMetrics(userId, finalRecommendations),
        },
      };

      // Cache the full results
      cache.setCachedRecommendations(userId, result);
      console.log(`💾 Cached recommendations for user: ${userId}`);

      // Return limited results
      return {
        recommendations: finalRecommendations.slice(0, parseInt(limit)),
        meta: result.meta,
      };
    } catch (error) {
      console.error('Recommendation error:', error);
      throw error; // re-throw so finally below handles it
    }
  })(); // end async IIFE

  // Register and wait for computation (auto-clears lock on settle via finally)
  cache.setComputing(userId, computationPromise);
  let response;
  try {
    response = await computationPromise;
    res.json(response);
  } catch (error) {
    cache.clearComputing(userId); // ensure lock is cleared on error
    res.status(500).json({ error: 'Failed to generate recommendations' });
  }
});

// Helper: Extract features from song
function extractFeatures(song) {
  return {
    artistId: song.artistId || song.artistName || '',
    albumId: song.albumId || 0,
    duration: song.duration || 0,
    bpm: song.bpm || 0,
    genre: song.genre || 'unknown',
    publishTime: song.publishTime || 0,
    // 扩展维度
    mood: song.mood || null, // 情绪: null 时跳过该维度（spec §8.1）
    language: song.language || null, // 语言: null 时跳过该维度
    decade: song.decade || getDecade(song.publishTime) || '00s', // 年代: 80s, 90s, 00s, 10s, 20s（spec §8.1）
    energy: song.energy ?? null, // 能量值: null 时跳过该维度（spec §8.1）
    danceability: song.danceability ?? null, // 可舞性: null 时跳过该维度（spec §8.1）
    tags: song.tags || [], // 标签数组
  };
}

function getDecade(publishTime) {
  if (!publishTime) return '00s'; // spec §8.1: decade 默认 00s
  // 兼容两种格式：年份数字 或 秒级时间戳
  // 年份 < 10000（如 2024），时间戳秒 > 10000（如 486864000 = 1985年）
  let year;
  if (publishTime < 10000) {
    year = publishTime; // 已经是年份数字
  } else {
    year = new Date(publishTime * 1000).getFullYear();
  }
  if (year < 1990) return '80s';
  if (year < 2000) return '90s';
  if (year < 2010) return '00s';
  if (year < 2020) return '10s';
  return '20s';
}

// Helper: Compute preference vector from song list or events array
// events: array of { songId, listenDuration, songDuration, ...songData } for skip events
// songs: array of song objects for like/play events
function computePreferenceVector(songs, eventType) {
  if (!songs || songs.length === 0) return null;

  const baseWeights = { play: 1, like: 3, skip: -1 };

  const vector = {
    artistFreq: {},
    genreFreq: {},
    moodFreq: {},
    langFreq: {},
    decadeFreq: {},
    totalBpm: 0,
    totalDuration: 0,
    totalEnergy: 0,
    totalDanceability: 0,
    count: 0,
  };

  songs.forEach(song => {
    // Calculate dynamic weight for skip events based on listen duration
    let weight;
    if (eventType === 'skip') {
      // 基于收听时长计算惩罚权重：听得越多，惩罚越轻；听得越少，惩罚越重
      if (song.listenDuration && song.songDuration && song.songDuration > 0) {
        const listenRatio = Math.min(
          1,
          song.listenDuration / song.songDuration
        );
        weight = -1 * (1 - listenRatio); // 0% 收听 = -1.0, 90% 收听 = -0.1
      } else {
        weight = -1; // 兜底：无法确定时长或时长为0时使用完整惩罚
      }
    } else {
      weight = baseWeights[eventType] || 1;
    }

    const artistKey = song.artistId || song.artistName || '';
    if (artistKey) {
      vector.artistFreq[artistKey] =
        (vector.artistFreq[artistKey] || 0) + weight;
    }
    if (song.genre) {
      vector.genreFreq[song.genre] =
        (vector.genreFreq[song.genre] || 0) + weight;
    }
    if (song.mood) {
      vector.moodFreq[song.mood] = (vector.moodFreq[song.mood] || 0) + weight;
    }
    if (song.language) {
      vector.langFreq[song.language] =
        (vector.langFreq[song.language] || 0) + weight;
    }
    if (song.decade) {
      vector.decadeFreq[song.decade] =
        (vector.decadeFreq[song.decade] || 0) + weight;
    }
    if (song.bpm) {
      vector.totalBpm += song.bpm * Math.abs(weight);
    }
    if (song.duration) {
      vector.totalDuration += song.duration * Math.abs(weight);
    }
    if (song.energy !== undefined) {
      vector.totalEnergy += song.energy * Math.abs(weight);
    }
    if (song.danceability !== undefined) {
      vector.totalDanceability += song.danceability * Math.abs(weight);
    }
    vector.count += Math.abs(weight);
  });

  if (vector.count > 0) {
    vector.avgBpm = vector.totalBpm / vector.count;
    vector.avgDuration = vector.totalDuration / vector.count;
    vector.avgEnergy = vector.totalEnergy / vector.count;
    vector.avgDanceability = vector.totalDanceability / vector.count;
  }

  return vector;
}

// Merge two preference vectors by adding their frequency maps
// v1: like vector (weight=3), v2: play vector (weight=1)
function mergePreferenceVectors(v1, v2) {
  if (!v1 && !v2) return null;
  if (!v1) return v2;
  if (!v2) return v1;

  // 辅助：合并频次 map（累加值）
  function mergeFreqMap(m1, m2) {
    const result = { ...m1 };
    for (const [k, v] of Object.entries(m2)) {
      result[k] = (result[k] || 0) + v;
    }
    return result;
  }

  const merged = {
    artistFreq: mergeFreqMap(v1.artistFreq, v2.artistFreq),
    genreFreq: mergeFreqMap(v1.genreFreq, v2.genreFreq),
    moodFreq: mergeFreqMap(v1.moodFreq, v2.moodFreq),
    langFreq: mergeFreqMap(v1.langFreq, v2.langFreq),
    decadeFreq: mergeFreqMap(v1.decadeFreq, v2.decadeFreq),
    totalBpm: v1.totalBpm + v2.totalBpm,
    totalDuration: v1.totalDuration + v2.totalDuration,
    totalEnergy: v1.totalEnergy + v2.totalEnergy,
    totalDanceability: v1.totalDanceability + v2.totalDanceability,
    count: v1.count + v2.count,
  };

  // 重新计算平均值
  if (merged.count > 0) {
    merged.avgBpm = merged.totalBpm / merged.count;
    merged.avgDuration = merged.totalDuration / merged.count;
    merged.avgEnergy = merged.totalEnergy / merged.count;
    merged.avgDanceability = merged.totalDanceability / merged.count;
  } else {
    merged.avgBpm = 0;
    merged.avgDuration = 0;
    merged.avgEnergy = 0;
    merged.avgDanceability = 0;
  }

  return merged;
}

// Helper: Compute preference match score
// For likeVector: returns positive score if song matches user likes (0-1)
// For skipVector: returns positive score if song matches user dislikes (0-1)
function computePreferenceScore(vec, songVec, isSkip = false) {
  if (!vec || !songVec) return 0;

  let score = 0;
  let weights = 0;

  // Artist match (weight: 0.5)
  const artistKey = songVec.artistId;
  if (artistKey && vec.artistFreq && vec.artistFreq[artistKey]) {
    if (isSkip) {
      score += 0.5;
    } else {
      score += vec.artistFreq[artistKey] > 0 ? 0.5 : 0;
    }
    weights += 0.5;
  }

  // Genre match (weight: 0.3)
  if (songVec.genre && vec.genreFreq && vec.genreFreq[songVec.genre]) {
    if (isSkip) {
      score += 0.3;
    } else {
      score += vec.genreFreq[songVec.genre] > 0 ? 0.3 : 0;
    }
    weights += 0.3;
  }

  // BPM similarity (weight: 0.1, likes only)
  if (!isSkip && vec.avgBpm && songVec.bpm && vec.count > 0) {
    const bpmDiff = Math.abs(vec.avgBpm - songVec.bpm);
    const bpmSim = Math.max(0, 1 - bpmDiff / 50);
    score += bpmSim * 0.1;
    weights += 0.1;
  }

  // Mood match (weight: 0.2)
  if (songVec.mood && vec.moodFreq && vec.moodFreq[songVec.mood]) {
    if (isSkip) {
      score += 0.2;
    } else {
      score += vec.moodFreq[songVec.mood] > 0 ? 0.2 : 0;
    }
    weights += 0.2;
  }

  // Language match (weight: 0.25)
  if (songVec.language && vec.langFreq && vec.langFreq[songVec.language]) {
    if (isSkip) {
      score += 0.25;
    } else {
      score += vec.langFreq[songVec.language] > 0 ? 0.25 : 0;
    }
    weights += 0.25;
  }

  // Decade match (weight: 0.1)
  if (songVec.decade && vec.decadeFreq && vec.decadeFreq[songVec.decade]) {
    if (isSkip) {
      score += 0.1;
    } else {
      score += vec.decadeFreq[songVec.decade] > 0 ? 0.1 : 0;
    }
    weights += 0.1;
  }

  // Energy similarity (weight: 0.05, likes only)
  if (
    !isSkip &&
    vec.avgEnergy &&
    songVec.energy !== undefined &&
    vec.count > 0
  ) {
    const energyDiff = Math.abs(vec.avgEnergy - songVec.energy);
    const energySim = Math.max(0, 1 - energyDiff * 2);
    score += energySim * 0.05;
    weights += 0.05;
  }

  // Danceability similarity (weight: 0.05, likes only)
  if (
    !isSkip &&
    vec.avgDanceability !== undefined &&
    songVec.danceability !== undefined &&
    vec.count > 0
  ) {
    const danceDiff = Math.abs(vec.avgDanceability - songVec.danceability);
    const danceSim = Math.max(0, 1 - danceDiff * 2);
    score += danceSim * 0.05;
    weights += 0.05;
  }

  return weights === 0 ? 0 : score / weights;
}

// Legacy similarity function for similar songs
function computeSimilarity(vec1, vec2) {
  if (!vec1 || !vec2) return 0;

  let score = 0;
  let weights = 0;

  // Artist similarity
  if (vec1.artistId && vec2.artistId) {
    if (vec1.artistId === vec2.artistId) score += 1.0;
    weights += 1.0;
  }

  // Genre similarity
  if (vec1.genre && vec2.genre) {
    if (vec1.genre === vec2.genre) score += 0.8;
    weights += 0.8;
  }

  // BPM similarity
  if (vec1.bpm && vec2.bpm) {
    const bpmDiff = Math.abs(vec1.bpm - vec2.bpm);
    const bpmSim = Math.max(0, 1 - bpmDiff / 50);
    score += bpmSim * 0.3;
    weights += 0.3;
  }

  // Duration similarity
  if (vec1.duration && vec2.duration) {
    const durDiff = Math.abs(vec1.duration - vec2.duration);
    const durSim = Math.max(0, 1 - durDiff / 120);
    score += durSim * 0.2;
    weights += 0.2;
  }

  return weights === 0 ? 0 : score / weights;
}

// Similar songs endpoint
router.get('/similar/:songId', (req, res) => {
  const { songId } = req.params;
  const { limit = 10 } = req.query;

  const targetSong = db.getSong(songId);
  if (!targetSong) {
    return res.status(404).json({ error: 'Song not found' });
  }

  const allSongs = db.getAllSongs(200);
  const targetVec = extractFeatures(targetSong);

  const similarSongs = allSongs
    .filter(s => s.songId != songId)
    .map(song => ({
      id: song.songId,
      name: song.name || song.songName,
      artist: song.artistName,
      similarity: computeSimilarity(targetVec, extractFeatures(song)),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, parseInt(limit));

  res.json({ similarSongs });
});

// §10 效果评估指标
// 计算指定用户的推荐效果指标
function computeMetrics(userId, recommendations) {
  if (!recommendations || recommendations.length === 0) {
    return {
      precisionK: '0.000',
      recallK: '0.000',
      skipRate: '0.0%',
      likeRate: '0.0%',
      avgListenRatio: '0.00',
      totalRelevant: 0,
      recommendedInRelevant: 0,
      totalRecommendations: 0,
    };
  }

  const K = Math.min(recommendations.length, 10); // Precision@K, K=max 10
  const recommendedIds = recommendations.map(r => String(r.id));

  // 获取用户的相关歌曲集：liked + completed play
  const likedSongIds = new Set(
    db.getUserLikedSongs(userId, 1000).map(id => String(id))
  );
  const playedSongIds = new Set(
    db.getUserPlayedSongs(userId, 500).map(id => String(id))
  );
  const relevantSongIds = new Set([...likedSongIds, ...playedSongIds]);

  // 推荐结果中与 relevant 集合的交集
  const intersection = recommendations.filter(r =>
    relevantSongIds.has(String(r.id))
  );

  // 获取事件统计
  const stats = db.getUserStats(userId);
  const totalPlays = stats.play?.count || 0;
  const totalPlayDuration = stats.play?.totalDuration || 0;

  // 计算推荐歌曲的交互情况：获取这些歌曲的 skip/like 事件
  const recSkipCount = db.getUserEventsForSongs(
    userId,
    recommendedIds,
    'skip'
  ).length;
  const recLikeCount = db.getUserEventsForSongs(
    userId,
    recommendedIds,
    'like'
  ).length;

  // Precision@K = #(recommended ∩ relevant) / K
  const precisionK = K > 0 ? intersection.length / K : 0;

  // Recall@K = #(recommended ∩ relevant) / #relevant
  const recallK =
    relevantSongIds.size > 0 ? intersection.length / relevantSongIds.size : 0;

  // Skip Rate = #skip on recommended / #total_recommended
  const skipRate =
    recommendations.length > 0 ? recSkipCount / recommendations.length : 0;

  // Like Rate = #likes on recommended / #total_recommended
  const likeRate =
    recommendations.length > 0 ? recLikeCount / recommendations.length : 0;

  // Average Listen Ratio
  const avgPlayDurationPerSong =
    totalPlays > 0 ? totalPlayDuration / totalPlays : 0;
  const avgListenRatio = Math.min(1, avgPlayDurationPerSong / 210);

  return {
    precisionK: precisionK.toFixed(3),
    recallK: recallK.toFixed(3),
    skipRate: (skipRate * 100).toFixed(1) + '%',
    likeRate: (likeRate * 100).toFixed(1) + '%',
    avgListenRatio: avgListenRatio.toFixed(2),
    totalRelevant: relevantSongIds.size,
    recommendedInRelevant: intersection.length,
    totalRecommendations: recommendations.length,
  };
}

module.exports = router;
