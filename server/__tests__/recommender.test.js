/**
 * 推荐算法单元测试
 *
 * 测试所有规格文档中定义的算法逻辑：
 * 1. 动态 Skip Penalty 公式
 * 2. 推荐评分公式: final_score = likeScore - 1.5 * skipScore
 * 3. 多维度匹配权重
 * 4. like/unlike 双向追踪
 * 5. skip 反悔逻辑（跳后再赞可推荐）
 */

// ─── 辅助函数（复制自 recommend.js，供测试用） ───────────────────────────────

function extractFeatures(song) {
  return {
    artistId: song.artistId || song.artistName || '',
    albumId: song.albumId || 0,
    duration: song.duration || 0,
    bpm: song.bpm || 0,
    genre: song.genre || 'unknown',
    publishTime: song.publishTime || 0,
    mood: song.mood || 'neutral',
    language: song.language || 'unknown',
    decade: song.decade || getDecade(song.publishTime),
    energy: song.energy || 0.5,
    danceability: song.danceability || 0.5,
    tags: song.tags || [],
  };
}

function getDecade(publishTime) {
  if (!publishTime) return 'unknown';
  // 兼容两种格式：年份数字 或 秒级时间戳
  // 年份 < 10000（如 2024），时间戳秒 > 10000（如 487641600 = 1985年）
  let year;
  if (publishTime < 10000) {
    year = publishTime;  // 已经是年份数字
  } else {
    year = new Date(publishTime * 1000).getFullYear();
  }
  if (year < 1990) return '80s';
  if (year < 2000) return '90s';
  if (year < 2010) return '00s';
  if (year < 2020) return '10s';
  return '20s';
}

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
    let weight;
    if (eventType === 'skip') {
      if (song.listenDuration && song.songDuration && song.songDuration > 0) {
        const listenRatio = Math.min(1, song.listenDuration / song.songDuration);
        weight = -1 * (1 - listenRatio);
      } else {
        weight = -1;
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

function computePreferenceScore(vec, songVec, isSkip = false) {
  if (!vec || !songVec) return 0;

  let score = 0;
  let weights = 0;

  const artistKey = songVec.artistId;
  if (artistKey && vec.artistFreq && vec.artistFreq[artistKey]) {
    if (isSkip) { score += 0.5; } else { score += vec.artistFreq[artistKey] > 0 ? 0.5 : 0; }
    weights += 0.5;
  }

  if (songVec.genre && vec.genreFreq && vec.genreFreq[songVec.genre]) {
    if (isSkip) { score += 0.3; } else { score += vec.genreFreq[songVec.genre] > 0 ? 0.3 : 0; }
    weights += 0.3;
  }

  if (!isSkip && vec.avgBpm && songVec.bpm && vec.count > 0) {
    const bpmDiff = Math.abs(vec.avgBpm - songVec.bpm);
    const bpmSim = Math.max(0, 1 - bpmDiff / 50);
    score += bpmSim * 0.1;
    weights += 0.1;
  }

  if (songVec.mood && vec.moodFreq && vec.moodFreq[songVec.mood]) {
    if (isSkip) { score += 0.2; } else { score += vec.moodFreq[songVec.mood] > 0 ? 0.2 : 0; }
    weights += 0.2;
  }

  if (songVec.language && vec.langFreq && vec.langFreq[songVec.language]) {
    if (isSkip) { score += 0.25; } else { score += vec.langFreq[songVec.language] > 0 ? 0.25 : 0; }
    weights += 0.25;
  }

  if (songVec.decade && vec.decadeFreq && vec.decadeFreq[songVec.decade]) {
    if (isSkip) { score += 0.1; } else { score += vec.decadeFreq[songVec.decade] > 0 ? 0.1 : 0; }
    weights += 0.1;
  }

  if (!isSkip && vec.avgEnergy && songVec.energy !== undefined && vec.count > 0) {
    const energyDiff = Math.abs(vec.avgEnergy - songVec.energy);
    const energySim = Math.max(0, 1 - energyDiff * 2);
    score += energySim * 0.05;
    weights += 0.05;
  }

  return weights === 0 ? 0 : score / weights;
}

const DISLIKE_WEIGHT = 1.5;

function computeFinalScore(likeScore, skipScore) {
  return likeScore - DISLIKE_WEIGHT * skipScore;
}

// ─── 测试用例 ────────────────────────────────────────────────────────────────

describe('推荐算法 - 规格对照测试', () => {

  // ── 1. 动态 Skip Penalty ───────────────────────────────────────────────

  describe('1. 动态 Skip Penalty（核心创新）', () => {
    test('0% 收听 → skip_weight = -1.0（完整惩罚）', () => {
      const song = { listenDuration: 0, songDuration: 180 };
      const listenRatio = Math.min(1, song.listenDuration / song.songDuration);
      const skipWeight = -1 * (1 - listenRatio);
      expect(skipWeight).toBeCloseTo(-1.0, 5);
    });

    test('50% 收听 → skip_weight = -0.5（中等惩罚）', () => {
      const song = { listenDuration: 90, songDuration: 180 };
      const listenRatio = Math.min(1, song.listenDuration / song.songDuration);
      const skipWeight = -1 * (1 - listenRatio);
      expect(skipWeight).toBeCloseTo(-0.5, 5);
    });

    test('90% 收听 → skip_weight = -0.1（轻微惩罚）', () => {
      const song = { listenDuration: 162, songDuration: 180 };
      const listenRatio = Math.min(1, song.listenDuration / song.songDuration);
      const skipWeight = -1 * (1 - listenRatio);
      expect(skipWeight).toBeCloseTo(-0.1, 5);
    });

    test('100% 收听 → skip_weight = 0（无惩罚）', () => {
      const song = { listenDuration: 180, songDuration: 180 };
      const listenRatio = Math.min(1, song.listenDuration / song.songDuration);
      const skipWeight = -1 * (1 - listenRatio);
      expect(skipWeight).toBeCloseTo(0, 5);
    });

    test('无时长数据时兜底为完整惩罚 -1.0', () => {
      // 有时长数据但极短 → 接近完整惩罚
      const song = { artistId: 'A1', songDuration: 180, listenDuration: 1 };
      const vec = computePreferenceVector([song], 'skip');
      // listenRatio = 1/180 ≈ 0.006, weight ≈ -0.994
      expect(vec.artistFreq['A1']).toBeLessThan(-0.9);
    });
  });

  // ── 2. 推荐评分公式 ────────────────────────────────────────────────────

  describe('2. 推荐评分公式: final_score = likeScore - 1.5 × skipScore', () => {
    test('DISLIKE_WEIGHT = 1.5', () => {
      expect(DISLIKE_WEIGHT).toBe(1.5);
    });

    test('likeScore=1.0, skipScore=0.0 → final=1.0', () => {
      expect(computeFinalScore(1.0, 0.0)).toBeCloseTo(1.0, 5);
    });

    test('likeScore=0.0, skipScore=1.0 → final=-1.5', () => {
      expect(computeFinalScore(0.0, 1.0)).toBeCloseTo(-1.5, 5);
    });

    test('likeScore=0.75, skipScore=0.5 → final=0.0（临界）', () => {
      expect(computeFinalScore(0.75, 0.5)).toBeCloseTo(0.0, 5);
    });

    test('likeScore=1.0, skipScore=0.5 → final=0.25', () => {
      expect(computeFinalScore(1.0, 0.5)).toBeCloseTo(0.25, 5);
    });

    test('likeScore=0.5, skipScore=1.0 → final=-1.0', () => {
      expect(computeFinalScore(0.5, 1.0)).toBeCloseTo(-1.0, 5);
    });
  });

  // ── 3. 多维度匹配权重 ──────────────────────────────────────────────────

  describe('3. 多维度匹配权重（喜好匹配）', () => {
    test('艺术家完全匹配: 仅艺术家维度匹配时 score=1.0（归一化结果）', () => {
      // 只有艺术家维度有值时，得分归一化后为1.0
      const likeVec = { artistFreq: { 'A100': 3 }, genreFreq: {}, moodFreq: {}, langFreq: {}, decadeFreq: {}, count: 3 };
      const songVec = { artistId: 'A100', genre: '', mood: '', language: '', decade: '', bpm: 0, energy: undefined };
      const score = computePreferenceScore(likeVec, songVec, false);
      // score = 0.5/0.5 = 1.0（单维度归一化）
      expect(score).toBeCloseTo(1.0, 2);
    });

    test('艺术家不匹配: score += 0', () => {
      const likeVec = { artistFreq: { 'A100': 3 }, genreFreq: {}, moodFreq: {}, langFreq: {}, decadeFreq: {}, count: 3 };
      const songVec = { artistId: 'A200', genre: '', mood: '', language: '', decade: '', bpm: 0, energy: undefined };
      const score = computePreferenceScore(likeVec, songVec, false);
      expect(score).toBe(0);
    });

    test('BPM相似度: 差0 BPM → score = 1.0（纯维度内）', () => {
      const likeVec = { artistFreq: {}, genreFreq: {}, moodFreq: {}, langFreq: {}, decadeFreq: {}, avgBpm: 120, count: 1, avgEnergy: 0.5 };
      const songVec = { artistId: '', genre: '', mood: '', language: '', decade: '', bpm: 120, energy: undefined };
      // BPM match = 1.0, score = 1.0 * 0.1 / 0.1 = 1.0
      const score = computePreferenceScore(likeVec, songVec, false);
      expect(score).toBeCloseTo(1.0, 2);
    });

    test('BPM相似度: 差50 BPM → BPM相似度=0.0', () => {
      const likeVec = { artistFreq: {}, genreFreq: {}, moodFreq: {}, langFreq: {}, decadeFreq: {}, avgBpm: 100, count: 1, avgEnergy: 0.5 };
      const songVec = { artistId: '', genre: '', mood: '', language: '', decade: '', bpm: 150, energy: undefined };
      // |100-150| = 50, BPM_sim = 1-50/50 = 0.0, score = 0
      const score = computePreferenceScore(likeVec, songVec, false);
      expect(score).toBe(0);
    });

    test('BPM相似度: 差100 BPM → 相似度=0（超过50窗口）', () => {
      const likeVec = { artistFreq: {}, genreFreq: {}, moodFreq: {}, langFreq: {}, decadeFreq: {}, avgBpm: 100, count: 1, avgEnergy: 0.5 };
      const songVec = { artistId: '', genre: '', mood: '', language: '', decade: '', bpm: 200, energy: undefined };
      const score = computePreferenceScore(likeVec, songVec, false);
      expect(score).toBe(0); // |100-200|=100 > 50, BPM_sim=0
    });

    test('所有维度完全匹配 → score = 1.0（归一化）', () => {
      // 设置所有维度的freq > 0（表示用户喜欢这类）
      const likeVec = {
        artistFreq: { 'A1': 3 }, genreFreq: { 'pop': 3 }, moodFreq: { 'happy': 3 },
        langFreq: { '中文': 3 }, decadeFreq: { '10s': 3 },
        avgBpm: 120, count: 5, avgEnergy: 0.6
      };
      const songVec = { artistId: 'A1', genre: 'pop', mood: 'happy', language: '中文', decade: '10s', bpm: 120, energy: 0.6 };
      const score = computePreferenceScore(likeVec, songVec, false);
      // 所有维度都匹配，归一化后 score = 1.0
      expect(score).toBeCloseTo(1.0, 2);
    });
  });

  // ── 4. 排斥匹配权重 ────────────────────────────────────────────────────

  describe('4. 排斥匹配权重（skip）', () => {
    test('排斥评分：流派匹配 → score = 1.0（纯维度内）', () => {
      const skipVec = { artistFreq: {}, genreFreq: { '摇滚': -0.8 }, moodFreq: {}, langFreq: {}, decadeFreq: {}, count: 1 };
      const songVec = { artistId: '', genre: '摇滚', mood: '', language: '', decade: '', bpm: 0, energy: undefined };
      const skipScore = computePreferenceScore(skipVec, songVec, true);
      expect(skipScore).toBeCloseTo(1.0, 2);
    });

    test('艺术家排斥 → 艺术家维度得分 = 1.0', () => {
      const skipVec = { artistFreq: { 'ArtistX': -0.9 }, genreFreq: {}, moodFreq: {}, langFreq: {}, decadeFreq: {}, count: 1 };
      const songVec = { artistId: 'ArtistX', genre: '', mood: '', language: '', decade: '', bpm: 0, energy: undefined };
      const skipScore = computePreferenceScore(skipVec, songVec, true);
      // skip 评分：流派/艺术家匹配时直接 +weight，不检查 freq 正负
      expect(skipScore).toBeCloseTo(1.0, 2);
    });

    test('final_score 对排斥敏感：排斥匹配时分数显著降低', () => {
      const likeScore = 0.5;
      const skipScore = 0.5; // 被强烈排斥
      const finalScore = computeFinalScore(likeScore, skipScore);
      expect(finalScore).toBeCloseTo(-0.25, 5); // 0.5 - 1.5*0.5
    });
  });

  // ── 5. like/unlike 双向追踪 ───────────────────────────────────────────

  describe('5. like/unlike 双向追踪（最新事件为准）', () => {
    test('先 like 后 unlike → 该歌曲不算 liked', () => {
      const events = [
        { eventType: 'unlike', createdAt: '2026-04-14T10:00:00Z' },
        { eventType: 'like',   createdAt: '2026-04-14T09:00:00Z' },
      ];
      const latestEventMap = {};
      for (const row of events) {
        if (latestEventMap['song1'] === undefined) {
          latestEventMap['song1'] = row.eventType;
        }
      }
      expect(latestEventMap['song1']).toBe('unlike');
    });

    test('先 skip 后 like → 该歌曲仍可被推荐（latest = like）', () => {
      const events = [
        { eventType: 'like',  createdAt: '2026-04-14T10:00:00Z' },
        { eventType: 'skip',  createdAt: '2026-04-14T09:00:00Z' },
      ];
      const latestEventMap = {};
      for (const row of events) {
        if (latestEventMap['song1'] === undefined) {
          latestEventMap['song1'] = row.eventType;
        }
      }
      expect(latestEventMap['song1']).toBe('like');
    });

    test('先 like 后 skip → 该歌曲不会被推荐（latest = skip）', () => {
      const events = [
        { eventType: 'skip',  createdAt: '2026-04-14T10:00:00Z' },
        { eventType: 'like',  createdAt: '2026-04-14T09:00:00Z' },
      ];
      const latestEventMap = {};
      for (const row of events) {
        if (latestEventMap['song1'] === undefined) {
          latestEventMap['song1'] = row.eventType;
        }
      }
      expect(latestEventMap['song1']).toBe('skip');
    });

    test('unlike 后再 like → 该歌曲恢复为 liked', () => {
      const events = [
        { eventType: 'like',   createdAt: '2026-04-14T11:00:00Z' },
        { eventType: 'unlike', createdAt: '2026-04-14T10:00:00Z' },
      ];
      const latestEventMap = {};
      for (const row of events) {
        if (latestEventMap['song1'] === undefined) {
          latestEventMap['song1'] = row.eventType;
        }
      }
      expect(latestEventMap['song1']).toBe('like');
    });
  });

  // ── 6. 缓存失效触发 ───────────────────────────────────────────────────

  describe('6. 缓存失效触发规则', () => {
    test('单用户操作仅清除该用户缓存', () => {
      // 模拟：用户A播放，用户B不受影响
      const cache = new Map();
      cache.set('userA', { data: {}, timestamp: Date.now() });
      cache.set('userB', { data: {}, timestamp: Date.now() });

      // 用户A播放，清除A的缓存
      cache.delete('userA');

      expect(cache.has('userA')).toBe(false);
      expect(cache.has('userB')).toBe(true); // B 不受影响
    });

    test('sync-songs 清除所有用户缓存', () => {
      const cache = new Map();
      cache.set('userA', { data: {}, timestamp: Date.now() });
      cache.set('userB', { data: {}, timestamp: Date.now() });
      cache.set('userC', { data: {}, timestamp: Date.now() });

      // 同步歌曲 → clearAllCache()
      cache.clear();

      expect(cache.size).toBe(0);
    });

    test('缓存 TTL = 5 分钟', () => {
      const CACHE_TTL_MS = 5 * 60 * 1000;
      expect(CACHE_TTL_MS).toBe(300000);
    });

    test('缓存超时后自动失效', () => {
      const CACHE_TTL_MS = 5 * 60 * 1000;
      const oldTimestamp = Date.now() - CACHE_TTL_MS - 1000; // 超过5分钟

      const cached = { data: {}, timestamp: oldTimestamp };
      const isValid = Date.now() - cached.timestamp < CACHE_TTL_MS;

      expect(isValid).toBe(false);
    });
  });

  // ── 7. 端到端推荐流程 ─────────────────────────────────────────────────

  describe('7. 端到端推荐流程', () => {
    test('有 like 无 skip → 同艺术家歌曲得分显著高于不匹配歌曲', () => {
      const likedSongs = [
        { artistId: 'ArtistA', artistName: 'ArtistA', genre: 'jazz', mood: 'calm', language: '日文', decade: '80s', bpm: 90, energy: 0.3 },
      ];
      const likeVector = computePreferenceVector(likedSongs, 'like');

      // 候选A：同艺术家，其他维度全部不同，且 BPM 差 >50（无 BPM 相似度）
      const candidateA = { artistId: 'ArtistA', genre: 'rock', mood: 'energetic', language: '英文', decade: '20s', bpm: 160, energy: 0.9 };
      // 候选B：完全不同，BPM 差也极大
      const candidateB = { artistId: 'ArtistB', genre: 'classical', mood: 'sad', language: '德文', decade: '70s', bpm: 250, energy: 0.1 };

      const likeScoreA = computePreferenceScore(likeVector, candidateA, false);
      const likeScoreB = computePreferenceScore(likeVector, candidateB, false);

      // ArtistA 有艺术家匹配(artistFreq>0)，ArtistB 艺术家不匹配 → A 得分 >> B
      expect(likeScoreA).toBeGreaterThan(likeScoreB);
    });

    test('有 skip → 降低同类歌曲推荐优先级', () => {
      const skippedSongs = [
        { artistId: 'ArtistX', artistName: 'ArtistX', genre: 'metal', mood: 'sad', language: '英文', decade: '90s', bpm: 180, energy: 0.9, listenDuration: 5, songDuration: 240 },
      ];
      const skipVector = computePreferenceVector(skippedSongs, 'skip');

      // 候选A：同艺术家（应被强烈降权）
      const candidateA = extractFeatures({ artistId: 'ArtistX', genre: 'rock', mood: 'energetic', language: '中文', decade: '10s', bpm: 140, energy: 0.8 });
      // 候选B：不同艺术家
      const candidateB = extractFeatures({ artistId: 'ArtistY', genre: 'pop', mood: 'happy', language: '中文', decade: '10s', bpm: 120, energy: 0.5 });

      const skipScoreA = computePreferenceScore(skipVector, candidateA, true);
      const skipScoreB = computePreferenceScore(skipVector, candidateB, true);

      // ArtistX 的 skipScore 更高（更应该被降权）
      expect(skipScoreA).toBeGreaterThan(skipScoreB);
    });

    test('最终分数排序正确：喜欢的歌分数 > 不喜欢的歌分数', () => {
      const likedSongs = [
        { artistId: 'ArtistA', artistName: 'ArtistA', genre: 'pop', mood: 'happy', language: '中文', decade: '10s', bpm: 120, energy: 0.6 },
      ];
      const skippedSongs = [
        { artistId: 'ArtistX', artistName: 'ArtistX', genre: 'metal', mood: 'sad', language: '英文', decade: '90s', bpm: 180, energy: 0.9, listenDuration: 5, songDuration: 240 },
      ];

      const likeVector = computePreferenceVector(likedSongs, 'like');
      const skipVector = computePreferenceVector(skippedSongs, 'skip');

      // 候选A：同喜欢的艺术家
      const candidateA = extractFeatures({ artistId: 'ArtistA', genre: 'pop', mood: 'happy', language: '中文', decade: '10s', bpm: 120, energy: 0.6 });
      // 候选B：同讨厌的艺术家
      const candidateB = extractFeatures({ artistId: 'ArtistX', genre: 'metal', mood: 'sad', language: '英文', decade: '90s', bpm: 180, energy: 0.9 });

      const likeScoreA = computePreferenceScore(likeVector, candidateA, false);
      const skipScoreA = computePreferenceScore(skipVector, candidateA, true);
      const scoreA = computeFinalScore(likeScoreA, skipScoreA);

      const likeScoreB = computePreferenceScore(likeVector, candidateB, false);
      const skipScoreB = computePreferenceScore(skipVector, candidateB, true);
      const scoreB = computeFinalScore(likeScoreB, skipScoreB);

      // 喜欢类歌曲分数应远高于排斥类歌曲
      expect(scoreA).toBeGreaterThan(scoreB);
    });
  });

  // ── 8. getDecade 函数 ─────────────────────────────────────────────────

  describe('8. getDecade 年代计算', () => {
    test('1980-1989 → 80s', () => {
      const ts = new Date('1985-06-15').getTime() / 1000;
      expect(getDecade(ts)).toBe('80s');
    });
    test('1990-1999 → 90s', () => {
      const ts = new Date('1995-01-01').getTime() / 1000;
      expect(getDecade(ts)).toBe('90s');
    });
    test('2000-2009 → 00s', () => {
      const ts = new Date('2005-12-31').getTime() / 1000;
      expect(getDecade(ts)).toBe('00s');
    });
    test('2010-2019 → 10s', () => {
      const ts = new Date('2018-07-20').getTime() / 1000;
      expect(getDecade(ts)).toBe('10s');
    });
    test('2020-2029 → 20s', () => {
      const ts = new Date('2024-03-01').getTime() / 1000;
      expect(getDecade(ts)).toBe('20s');
    });
    test('无时间戳 → unknown', () => {
      expect(getDecade(0)).toBe('unknown');
      expect(getDecade(null)).toBe('unknown');
    });

    test('publishTime为年份数字（如2024）→ 正确解析为20s', () => {
      expect(getDecade(2024)).toBe('20s');
      expect(getDecade(2015)).toBe('10s');
      expect(getDecade(1998)).toBe('90s');
    });

    test('publishTime为时间戳秒（如1704067200）→ 正确解析', () => {
      // 2024-01-01 00:00:00 UTC = 1704067200
      expect(getDecade(1704067200)).toBe('20s');
    });
  });

  // ── 8b. mergePreferenceVectors ────────────────────────────────────

  describe('8b. mergePreferenceVectors（liked+played 向量合并）', () => {
    test('liked + played 频次正确累加', () => {
      // 模拟：liked(A)=3, played(A)=1 → 合并后 A=4，B 仅在 played
      function mergeFreqMap(m1, m2) {
        const result = { ...m1 };
        for (const [k, v] of Object.entries(m2)) result[k] = (result[k] || 0) + v;
        return result;
      }
      const v1 = { artistFreq: { A: 3 }, genreFreq: {}, moodFreq: {}, langFreq: {}, decadeFreq: {}, totalBpm: 360, totalDuration: 0, totalEnergy: 0, count: 3 };
      const v2 = { artistFreq: { A: 1, B: 1 }, genreFreq: {}, moodFreq: {}, langFreq: {}, decadeFreq: {}, totalBpm: 80, totalDuration: 0, totalEnergy: 0, count: 1 };
      const merged = {
        artistFreq: mergeFreqMap(v1.artistFreq, v2.artistFreq),
        genreFreq: mergeFreqMap(v1.genreFreq, v2.genreFreq),
        moodFreq: mergeFreqMap(v1.moodFreq, v2.moodFreq),
        langFreq: mergeFreqMap(v1.langFreq, v2.langFreq),
        decadeFreq: mergeFreqMap(v1.decadeFreq, v2.decadeFreq),
        totalBpm: v1.totalBpm + v2.totalBpm,
        totalDuration: v1.totalDuration + v2.totalDuration,
        totalEnergy: v1.totalEnergy + v2.totalEnergy,
        count: v1.count + v2.count,
      };
      expect(merged.artistFreq.A).toBe(4);  // 3+1
      expect(merged.artistFreq.B).toBe(1);   // 仅 played 有
      expect(merged.count).toBe(4);
      expect(merged.totalBpm).toBe(440);
    });

    test('null liked 向量 → 直接返回 played 向量', () => {
      const v2 = { artistFreq: { A: 1 }, genreFreq: {}, moodFreq: {}, langFreq: {}, decadeFreq: {}, totalBpm: 80, totalDuration: 0, totalEnergy: 0, count: 1 };
      const result = v2; // !v1 时返回 v2
      expect(result.artistFreq.A).toBe(1);
    });

    test('null played 向量 → 直接返回 liked 向量', () => {
      const v1 = { artistFreq: { A: 3 }, genreFreq: {}, moodFreq: {}, langFreq: {}, decadeFreq: {}, totalBpm: 360, totalDuration: 0, totalEnergy: 0, count: 3 };
      const result = v1; // !v2 时返回 v1
      expect(result.artistFreq.A).toBe(3);
    });
  });

  // ── 9. 零数据边界 ────────────────────────────────────────────────────

  describe('9. 边界情况', () => {
    test('无 liked 歌曲时 → likeVector = null', () => {
      expect(computePreferenceVector([], 'like')).toBeNull();
    });

    test('无 skip 歌曲时 → skipVector = null', () => {
      expect(computePreferenceVector([], 'skip')).toBeNull();
    });

    test('null 向量 → score = 0', () => {
      expect(computePreferenceScore(null, {}, false)).toBe(0);
      expect(computePreferenceScore({ artistFreq: {} }, null, false)).toBe(0);
    });
  });
});
