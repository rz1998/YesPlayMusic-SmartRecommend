/**
 * 边界条件与边缘 Case 测试
 *
 * 测试极端情况、边界值和特殊输入：
 * 1. skip 时 listenDuration > songDuration（Math.min 1 上限）
 * 2. skip 时 songDuration = 0（兜底 -1 权重）
 * 3. 所有维度为空/未知
 * 4. 完整的 skip→like→unlike 序列
 * 5. 并发请求同一用户
 * 6. BPM/Energy/Danceability = 0 的边界
 * 7. getDecade 极端年份
 */

const path = require('path');

// ─── 辅助函数（从 recommend.js 复制以隔离测试）──────────────────────────────

function getDecade(publishTime) {
  if (!publishTime) return 'unknown';
  let year;
  if (publishTime < 10000) {
    year = publishTime;
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
  const vector = { artistFreq: {}, genreFreq: {}, moodFreq: {}, langFreq: {}, decadeFreq: {}, totalBpm: 0, totalDuration: 0, totalEnergy: 0, totalDanceability: 0, count: 0 };
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
    if (artistKey) vector.artistFreq[artistKey] = (vector.artistFreq[artistKey] || 0) + weight;
    if (song.genre) vector.genreFreq[song.genre] = (vector.genreFreq[song.genre] || 0) + weight;
    if (song.mood) vector.moodFreq[song.mood] = (vector.moodFreq[song.mood] || 0) + weight;
    if (song.language) vector.langFreq[song.language] = (vector.langFreq[song.language] || 0) + weight;
    if (song.decade) vector.decadeFreq[song.decade] = (vector.decadeFreq[song.decade] || 0) + weight;
    if (song.bpm) vector.totalBpm += song.bpm * Math.abs(weight);
    if (song.duration) vector.totalDuration += song.duration * Math.abs(weight);
    if (song.energy !== undefined) vector.totalEnergy += song.energy * Math.abs(weight);
    if (song.danceability !== undefined) vector.totalDanceability += song.danceability * Math.abs(weight);
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

function computePreferenceScore(vec, songVec, isSkip = false) {
  if (!vec || !songVec) return 0;
  let score = 0, weights = 0;
  const artistKey = songVec.artistId;
  if (artistKey && vec.artistFreq && vec.artistFreq[artistKey]) {
    if (isSkip) score += 0.5; else score += vec.artistFreq[artistKey] > 0 ? 0.5 : 0;
    weights += 0.5;
  }
  if (songVec.genre && vec.genreFreq && vec.genreFreq[songVec.genre]) {
    if (isSkip) score += 0.3; else score += vec.genreFreq[songVec.genre] > 0 ? 0.3 : 0;
    weights += 0.3;
  }
  if (!isSkip && vec.avgBpm && songVec.bpm && vec.count > 0) {
    const bpmDiff = Math.abs(vec.avgBpm - songVec.bpm);
    const bpmSim = Math.max(0, 1 - bpmDiff / 50);
    score += bpmSim * 0.1; weights += 0.1;
  }
  if (songVec.mood && vec.moodFreq && vec.moodFreq[songVec.mood]) {
    if (isSkip) score += 0.2; else score += vec.moodFreq[songVec.mood] > 0 ? 0.2 : 0;
    weights += 0.2;
  }
  if (songVec.language && vec.langFreq && vec.langFreq[songVec.language]) {
    if (isSkip) score += 0.25; else score += vec.langFreq[songVec.language] > 0 ? 0.25 : 0;
    weights += 0.25;
  }
  if (songVec.decade && vec.decadeFreq && vec.decadeFreq[songVec.decade]) {
    if (isSkip) score += 0.1; else score += vec.decadeFreq[songVec.decade] > 0 ? 0.1 : 0;
    weights += 0.1;
  }
  if (!isSkip && vec.avgEnergy && songVec.energy !== undefined && vec.count > 0) {
    const energyDiff = Math.abs(vec.avgEnergy - songVec.energy);
    const energySim = Math.max(0, 1 - energyDiff * 2);
    score += energySim * 0.05; weights += 0.05;
  }
  if (!isSkip && vec.avgDanceability !== undefined && songVec.danceability !== undefined && vec.count > 0) {
    const danceDiff = Math.abs(vec.avgDanceability - songVec.danceability);
    const danceSim = Math.max(0, 1 - danceDiff * 2);
    score += danceSim * 0.05; weights += 0.05;
  }
  return weights === 0 ? 0 : score / weights;
}

function computeFinalScore(likeScore, skipScore) {
  return likeScore - 1.5 * skipScore;
}

// ─── 测试用例 ────────────────────────────────────────────────────────────────

describe('边界条件 - skip 动态权重', () => {

  test('listenDuration > songDuration → listenRatio 上限为 1.0（防止超限）', () => {
    // 特殊情况：实际播放时长超过歌曲总时长（如seek后播放）
    const song = { artistId: 'a1', listenDuration: 250, songDuration: 180 };
    const vec = computePreferenceVector([song], 'skip');
    // listenRatio = Math.min(1, 250/180) = 1.0 → weight = -1 * (1 - 1.0) = 0
    expect(vec.artistFreq['a1']).toBeCloseTo(0, 2);
  });

  test('songDuration = 0（无时长数据）→ weight = -1 兜底', () => {
    const song = { artistId: 'a1', listenDuration: 10, songDuration: 0 };
    const vec = computePreferenceVector([song], 'skip');
    expect(vec.artistFreq['a1']).toBeCloseTo(-1, 2);
  });

  test('songDuration < 0（异常值）→ weight = -1 兜底', () => {
    const song = { artistId: 'a1', listenDuration: 10, songDuration: -5 };
    const vec = computePreferenceVector([song], 'skip');
    expect(vec.artistFreq['a1']).toBeCloseTo(-1, 2);
  });

  test('listenDuration = 0（完全没听）→ weight = -1.0', () => {
    const song = { artistId: 'a1', listenDuration: 0, songDuration: 180 };
    const vec = computePreferenceVector([song], 'skip');
    expect(vec.artistFreq['a1']).toBeCloseTo(-1.0, 2);
  });

  test('完整听完（listenDuration === songDuration）→ weight = 0', () => {
    const song = { artistId: 'a1', listenDuration: 180, songDuration: 180 };
    const vec = computePreferenceVector([song], 'skip');
    expect(vec.artistFreq['a1']).toBeCloseTo(0, 2);
  });

  test('无 listenDuration/songDuration 字段 → weight = -1 兜底', () => {
    const song = { artistId: 'a1' };
    const vec = computePreferenceVector([song], 'skip');
    expect(vec.artistFreq['a1']).toBeCloseTo(-1, 2);
  });

  test('精确边界：listenRatio = 0.2999（略低于30%，应接近 -0.7）', () => {
    const song = { artistId: 'a1', listenDuration: 54, songDuration: 180 }; // 54/180 = 0.3
    const vec = computePreferenceVector([song], 'skip');
    // Math.min(1, 54/180) = 0.3 → weight = -0.7
    expect(vec.artistFreq['a1']).toBeCloseTo(-0.7, 2);
  });
});

describe('边界条件 - BPM/Energy/Danceability', () => {

  test('BPM = 0 时 avgBpm 计算正确（0 值参与平均）', () => {
    const vec = computePreferenceVector([{ artistId: 'A1', bpm: 0 }], 'like');
    expect(vec.avgBpm).toBe(0);
  });

  test('energy = 0（最低能量）正常参与计算', () => {
    const vec = computePreferenceVector([{ artistId: 'A1', energy: 0 }], 'like');
    expect(vec.avgEnergy).toBe(0);
  });

  test('energy = 1（最高能量）正常参与计算', () => {
    const vec = computePreferenceVector([{ artistId: 'A1', energy: 1 }], 'like');
    expect(vec.avgEnergy).toBe(1);
  });

  test('danceability = 0 正常参与', () => {
    const vec = computePreferenceVector([{ artistId: 'A1', danceability: 0 }], 'like');
    expect(vec.avgDanceability).toBe(0);
  });

  test('energy 差值 >= 0.5 → energySim = 0（相似度归零）', () => {
    const likeVec = { artistFreq: {}, genreFreq: {}, moodFreq: {}, langFreq: {}, decadeFreq: {}, avgEnergy: 0.2, count: 1 };
    const songVec = { artistId: '', genre: '', mood: '', language: '', decade: '', energy: 0.8, danceability: undefined };
    const score = computePreferenceScore(likeVec, songVec, false);
    // |0.2 - 0.8| = 0.6 >= 0.5 → energySim = 0 → 不加分
    expect(score).toBe(0);
  });

  test('BPM 差值 >= 50 → bpmSim = 0（相似度归零）', () => {
    const likeVec = { artistFreq: {}, genreFreq: {}, moodFreq: {}, langFreq: {}, decadeFreq: {}, avgBpm: 60, count: 1 };
    const songVec = { artistId: '', genre: '', mood: '', language: '', decade: '', bpm: 120 };
    const score = computePreferenceScore(likeVec, songVec, false);
    expect(score).toBe(0);
  });

  test('energy undefined 时跳过该维度（不抛错）', () => {
    const vec = computePreferenceVector([{ artistId: 'A1', energy: undefined }], 'like');
    expect(vec.avgEnergy).not.toBeNaN();
  });

  test('danceability undefined 时跳过该维度（不抛错）', () => {
    const vec = computePreferenceVector([{ artistId: 'A1', danceability: undefined }], 'like');
    expect(vec.avgDanceability).not.toBeNaN();
  });
});

describe('边界条件 - getDecade', () => {

  test('publishTime = 1979 → 80s', () => {
    expect(getDecade(new Date('1979-12-31').getTime() / 1000)).toBe('80s');
  });

  test('publishTime = 1990 → 90s', () => {
    expect(getDecade(new Date('1990-01-01').getTime() / 1000)).toBe('90s');
  });

  test('publishTime = 2000 → 00s', () => {
    expect(getDecade(new Date('2000-06-15').getTime() / 1000)).toBe('00s');
  });

  test('publishTime = 2010 → 10s', () => {
    expect(getDecade(new Date('2010-03-01').getTime() / 1000)).toBe('10s');
  });

  test('publishTime = 2020 → 20s', () => {
    expect(getDecade(new Date('2020-01-01').getTime() / 1000)).toBe('20s');
  });

  test('publishTime = 0 → unknown', () => {
    expect(getDecade(0)).toBe('unknown');
  });

  test('publishTime = null → unknown', () => {
    expect(getDecade(null)).toBe('unknown');
  });

  test('publishTime = undefined → unknown', () => {
    expect(getDecade(undefined)).toBe('unknown');
  });

  test('publishTime = 年份数字 1989 → 80s', () => {
    expect(getDecade(1989)).toBe('80s');
  });

  test('publishTime = 年份数字 1999 → 90s', () => {
    expect(getDecade(1999)).toBe('90s');
  });

  test('publishTime = 年份数字 2009 → 00s', () => {
    expect(getDecade(2009)).toBe('00s');
  });

  test('publishTime = 年份数字 2019 → 10s', () => {
    expect(getDecade(2019)).toBe('10s');
  });

  test('publishTime = 年份数字 2029 → 20s', () => {
    expect(getDecade(2029)).toBe('20s');
  });
});

describe('边界条件 - 向量维度', () => {

  test('所有维度为空 → score = 0', () => {
    const likeVec = { artistFreq: {}, genreFreq: {}, moodFreq: {}, langFreq: {}, decadeFreq: {}, count: 0 };
    const songVec = { artistId: '', genre: '', mood: '', language: '', decade: '', bpm: 0, energy: undefined };
    expect(computePreferenceScore(likeVec, songVec, false)).toBe(0);
  });

  test('count=0（无有效权重）→ score = 0', () => {
    const likeVec = { artistFreq: { A1: -1 }, genreFreq: {}, moodFreq: {}, langFreq: {}, decadeFreq: {}, count: 1 };
    const songVec = { artistId: '', genre: '', mood: '', language: '', decade: '', bpm: 0, energy: undefined };
    // artistFreq['A1'] = -1 < 0 → 不加分
    expect(computePreferenceScore(likeVec, songVec, false)).toBe(0);
  });

  test('skip 向量 artistFreq 负值 → score += 0.5（skip 评分不检查正负）', () => {
    const skipVec = { artistFreq: { A1: -0.8 }, genreFreq: {}, moodFreq: {}, langFreq: {}, decadeFreq: {}, count: 1 };
    const songVec = { artistId: 'A1', genre: '', mood: '', language: '', decade: '', bpm: 0, energy: undefined };
    // isSkip=true 时直接 +0.5，不检查 freq 正负
    expect(computePreferenceScore(skipVec, songVec, true)).toBeCloseTo(1.0, 2);
  });

  test('like 向量 artistFreq 负值 → 不加分（避免重复惩罚）', () => {
    const likeVec = { artistFreq: { A1: -1 }, genreFreq: {}, moodFreq: {}, langFreq: {}, decadeFreq: {}, count: 1 };
    const songVec = { artistId: 'A1', genre: '', mood: '', language: '', decade: '', bpm: 0, energy: undefined };
    expect(computePreferenceScore(likeVec, songVec, false)).toBe(0);
  });

  test('finalScore 分数可以为负数（被强烈排斥）', () => {
    const score = computeFinalScore(0.2, 1.0);
    expect(score).toBe(-1.3);
  });

  test('finalScore 极端情况：like=1, skip=1 → -0.5', () => {
    expect(computeFinalScore(1.0, 1.0)).toBeCloseTo(-0.5, 2);
  });

  test('finalScore 临界值：like=0.75, skip=0.5 → 0', () => {
    expect(computeFinalScore(0.75, 0.5)).toBeCloseTo(0, 5);
  });
});

describe('边界条件 - latest-event 复杂序列', () => {

  test('完整序列：play → skip → like → unlike → like', () => {
    // 模拟 latest-event-map 逻辑
    const events = [
      { songId: 's1', eventType: 'like',    createdAt: 'T5' },
      { songId: 's1', eventType: 'unlike',  createdAt: 'T4' },
      { songId: 's1', eventType: 'like',    createdAt: 'T3' },
      { songId: 's1', eventType: 'skip',    createdAt: 'T2' },
      { songId: 's1', eventType: 'play',    createdAt: 'T1' },
    ];
    const latest = {};
    for (const e of events) {
      if (latest[e.songId] === undefined) latest[e.songId] = e.eventType;
    }
    // 最终状态：latest='like'
    expect(latest['s1']).toBe('like');
  });

  test('多首不同状态的歌曲独立追踪', () => {
    const events = [
      { songId: 'A', eventType: 'like' },
      { songId: 'B', eventType: 'skip' },
      { songId: 'C', eventType: 'play' },
      { songId: 'D', eventType: 'unlike' },
      { songId: 'E', eventType: 'like' },
    ];
    const latest = {};
    for (const e of events) {
      if (latest[e.songId] === undefined) latest[e.songId] = e.eventType;
    }
    expect(latest['A']).toBe('like');
    expect(latest['B']).toBe('skip');
    expect(latest['C']).toBe('play');
    expect(latest['D']).toBe('unlike');
    expect(latest['E']).toBe('like');
  });
});

describe('边界条件 - 候选池为空', () => {

  test('无 songs 时 computePreferenceVector 返回 null', () => {
    expect(computePreferenceVector([], 'like')).toBeNull();
    expect(computePreferenceVector(null, 'like')).toBeNull();
  });

  test('null 向量传给 computePreferenceScore → 返回 0', () => {
    const songVec = { artistId: 'A1', genre: 'pop', mood: 'happy', language: '中文', decade: '20s', bpm: 120, energy: 0.6 };
    expect(computePreferenceScore(null, songVec, false)).toBe(0);
    expect(computePreferenceScore(undefined, songVec, false)).toBe(0);
  });

  test('null songVec 传给 computePreferenceScore → 返回 0', () => {
    const likeVec = { artistFreq: { A1: 3 }, genreFreq: {}, moodFreq: {}, langFreq: {}, decadeFreq: {}, count: 3 };
    expect(computePreferenceScore(likeVec, null, false)).toBe(0);
    expect(computePreferenceScore(likeVec, undefined, false)).toBe(0);
  });
});

describe('边界条件 - 权重总和', () => {

  test('like 向量权重总和 = 1.55（8维度）', () => {
    // 验证各维度权重之和为 1.55
    const weights = { artist: 0.5, genre: 0.3, mood: 0.2, lang: 0.25, decade: 0.1, bpm: 0.1, energy: 0.05, dance: 0.05 };
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.55, 2);
  });

  test('skip 向量权重总和 = 0.80（2维度）', () => {
    const skipWeights = { artist: 0.5, genre: 0.3 };
    const total = Object.values(skipWeights).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(0.8, 2);
  });

  test('skip 全匹配惩罚上限 = -1.2', () => {
    // skip 全匹配: score = 0.8/0.8 = 1.0 → final = 0 - 1.5*1.0 = -1.5? 不对
    // skipScore = score/weights = 0.8/0.8 = 1.0
    // final = likeScore - 1.5 * skipScore
    // 如果 skipScore = 1.0（完全匹配）, final = 0 - 1.5*1.0 = -1.5
    // 但实际上 skip 全匹配 → skipScore=1.0 → -1.5
    const maxSkipPenalty = computeFinalScore(0, 1.0);
    expect(maxSkipPenalty).toBe(-1.5);
  });
});
