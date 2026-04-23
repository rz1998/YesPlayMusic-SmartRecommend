const express = require('express');
const router = express.Router();
const db = require('../models/db');
const cache = require('../models/cache');

// Debug endpoint - shows user preference vectors for debugging
router.get('/debug', (req, res) => {
  const { userId } = req.query;
  const likedSongIds = db.getUserLikedSongs(userId, 1000);
  const likedSongs = db.getSongs(likedSongIds);
  const skippedSongIds = db.getUserSkippedSongs(userId, 100);
  const skippedSongs = db.getSongs(skippedSongIds);
  const likeVector = computePreferenceVector(likedSongs, 'like');
  const skipVector = computePreferenceVector(skippedSongs, 'skip');
  
  res.json({
    likedSongIds,
    skippedSongIds,
    likedSongs: likedSongs.map(s => ({id: s.songId, name: s.name, artist: s.artistName})),
    skippedSongs: skippedSongs.map(s => ({id: s.songId, name: s.name, artist: s.artistName})),
    likeVector,
    skipVector
  });
});

// Get personalized recommendations
router.get('/', (req, res) => {
  const { userId, limit = 20, excludePlayed = true, refresh } = req.query;
  
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
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
    
    // 3. Calculate user preference vector
    const likeVector = computePreferenceVector(likedSongs, 'like');
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
    
    // Filter out played songs if needed
    const filteredCandidates = excludePlayed === 'true' || excludePlayed === true
      ? candidates.filter(s => !likedSongIds.includes(String(s.songId)))
      : candidates;
    
    // 5. Score candidates
    const scoredCandidates = filteredCandidates
      .filter(song => !skippedSongIds.includes(song.songId))
      .map(song => {
        const songVec = extractFeatures(song);
        const likeScore = computePreferenceScore(likeVector, songVec, false);
        const skipScore = computePreferenceScore(skipVector, songVec, true);
        
        // Final score = like_score - α * skip_score
        const DISLIKE_WEIGHT = 1.5;  // 排斥权重：跳过某类歌曲后，更强烈避免推荐同类
        const finalScore = likeScore - DISLIKE_WEIGHT * skipScore;
        
        return {
          id: song.songId,
          name: song.name || song.songName,
          artist: song.artistName,
          album: song.albumName,
          duration: song.duration,
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
      const fallbackCandidates = db.getAllSongs(50)
        .filter(s =>
          !likedSongIds.includes(String(s.songId)) &&
          !skippedSongIds.includes(String(s.songId))
        );
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
      console.log(`⚠️ No candidates from DB, returning ${finalRecommendations.length} fallback songs`);
    }

    const result = {
      recommendations: finalRecommendations,
      meta: {
        userId,
        totalCandidates: candidates.length,
        likedCount: likedSongIds.length,
        skippedCount: skippedSongIds.length,
        cached: false,
      },
    };
    
    // Cache the full results
    cache.setCachedRecommendations(userId, result);
    console.log(`💾 Cached recommendations for user: ${userId}`);
    
    // Return limited results
    res.json({
      recommendations: finalRecommendations.slice(0, parseInt(limit)),
      meta: result.meta,
    });
    
  } catch (error) {
    console.error('Recommendation error:', error);
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
    mood: song.mood || 'neutral',           // 情绪: happy, sad, energetic, calm, romantic
    language: song.language || 'unknown',   // 语言: 中文, 英文, 日文, 韩文
    decade: song.decade || getDecade(song.publishTime),  // 年代: 80s, 90s, 00s, 10s, 20s
    energy: song.energy || 0.5,             // 能量值: 0-1
    danceability: song.danceability || 0.5, // 可舞性: 0-1
    tags: song.tags || [],                  // 标签数组
  };
}

function getDecade(publishTime) {
  if (!publishTime) return 'unknown';
  const year = new Date(publishTime * 1000).getFullYear();
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
    count: 0,
  };
  
  songs.forEach(song => {
    // Calculate dynamic weight for skip events based on listen duration
    let weight;
    if (eventType === 'skip') {
      // 基于收听时长计算惩罚权重：听得越多，惩罚越轻；听得越少，惩罚越重
      if (song.listenDuration && song.songDuration && song.songDuration > 0) {
        const listenRatio = Math.min(1, song.listenDuration / song.songDuration);
        weight = -1 * (1 - listenRatio);  // 0% 收听 = -1.0, 90% 收听 = -0.1
      } else {
        weight = -1;  // 兜底：无法确定时长时使用完整惩罚
      }
    } else {
      weight = baseWeights[eventType] || 1;
    }
    
    const artistKey = song.artistId || song.artistName || '';
    if (artistKey) {
      vector.artistFreq[artistKey] = (vector.artistFreq[artistKey] || 0) + weight;
    }
    if (song.genre) {
      vector.genreFreq[song.genre] = (vector.genreFreq[song.genre] || 0) + weight;
    }
    if (song.mood) {
      vector.moodFreq[song.mood] = (vector.moodFreq[song.mood] || 0) + weight;
    }
    if (song.language) {
      vector.langFreq[song.language] = (vector.langFreq[song.language] || 0) + weight;
    }
    if (song.decade) {
      vector.decadeFreq[song.decade] = (vector.decadeFreq[song.decade] || 0) + weight;
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
    vector.count += Math.abs(weight);
  });
  
  if (vector.count > 0) {
    vector.avgBpm = vector.totalBpm / vector.count;
    vector.avgDuration = vector.totalDuration / vector.count;
    vector.avgEnergy = vector.totalEnergy / vector.count;
  }
  
  return vector;
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
  if (!isSkip && vec.avgEnergy && songVec.energy !== undefined && vec.count > 0) {
    const energyDiff = Math.abs(vec.avgEnergy - songVec.energy);
    const energySim = Math.max(0, 1 - energyDiff * 2);
    score += energySim * 0.05;
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
  if (vec1.avgBpm && vec2.bpm) {
    const bpmDiff = Math.abs(vec1.avgBpm - vec2.bpm);
    const bpmSim = Math.max(0, 1 - bpmDiff / 50);
    score += bpmSim * 0.3;
    weights += 0.3;
  }
  
  // Duration similarity
  if (vec1.avgDuration && vec2.duration) {
    const durDiff = Math.abs(vec1.avgDuration - vec2.duration);
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

module.exports = router;
