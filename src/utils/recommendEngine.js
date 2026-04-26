/**
 * 客户端推荐引擎
 * 使用 localStorage 存储用户行为数据
 * 基于用户偏好进行简单推荐
 */

const STORAGE_KEY = 'smartRecommendData';

// 默认推荐配置
const DEFAULT_CONFIG = {
  minPlaysForRecommendation: 5, // 至少需要播放5首歌才生成推荐
  recommendCount: 30, // 推荐数量
  artistWeight: 2.0, // 歌手权重
  initialDataWeight: 0.7, // 初始喜欢歌曲的权重
};

/**
 * 获取推荐数据
 */
export function getRecommendData() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    console.error('Failed to get recommend data:', e);
    return null;
  }
}

/**
 * 初始化推荐数据（从喜欢的歌曲）
 */
export function initializeFromLikedSongs(likedSongs) {
  if (!likedSongs || likedSongs.length === 0) return null;

  const data = {
    version: 1,
    initialized: true,
    initTime: Date.now(),
    plays: {}, // { songId: { count, duration, completed, lastPlay } }
    likes: new Set(likedSongs.map(s => s.id)),
    skips: new Set(),
    artists: {}, // { artistId: { name, playCount, liked } }
    tags: {}, // { tag: count }
  };

  // 统计歌手偏好
  likedSongs.forEach(song => {
    if (song.ar) {
      song.ar.forEach(artist => {
        if (!data.artists[artist.id]) {
          data.artists[artist.id] = {
            name: artist.name,
            playCount: 0,
            liked: true,
          };
        }
      });
    }
  });

  return data;
}

/**
 * 记录播放
 */
export function recordPlay(song, duration = 0, completed = false) {
  const data = getRecommendData() || {
    plays: {},
    likes: new Set(),
    skips: new Set(),
    artists: {},
    initialized: false,
  };

  if (!data.plays[song.id]) {
    data.plays[song.id] = {
      count: 0,
      duration: 0,
      completed: false,
      lastPlay: 0,
    };
  }

  data.plays[song.id].count++;
  data.plays[song.id].duration += duration;
  data.plays[song.id].completed = data.plays[song.id].completed || completed;
  data.plays[song.id].lastPlay = Date.now();

  // 更新歌手统计
  if (song.ar) {
    song.ar.forEach(artist => {
      if (!data.artists[artist.id]) {
        data.artists[artist.id] = {
          name: artist.name,
          playCount: 0,
          liked: data.likes.has(song.id),
        };
      }
      data.artists[artist.id].playCount++;
    });
  }

  saveData(data);
}

/**
 * 记录喜欢
 */
export function recordLike(songId) {
  const data = getRecommendData() || {
    plays: {},
    likes: new Set(),
    skips: new Set(),
    artists: {},
    initialized: false,
  };
  data.likes.add(songId);

  // 更新歌手喜欢状态
  const song = getSongById(songId);
  if (song && song.ar) {
    song.ar.forEach(artist => {
      if (data.artists[artist.id]) {
        data.artists[artist.id].liked = true;
      }
    });
  }

  saveData(data);
}

/**
 * 记录跳过
 */
export function recordSkip(songId) {
  const data = getRecommendData() || {
    plays: {},
    likes: new Set(),
    skips: new Set(),
    artists: {},
    initialized: false,
  };
  data.skips.add(songId);
  saveData(data);
}

/**
 * 获取用户统计
 */
export function getProfile() {
  const data = getRecommendData();
  if (!data) {
    return {
      statistics: {
        totalPlays: 0,
        totalLikes: 0,
        skipRate: '0%',
      },
    };
  }

  const totalPlays = Object.values(data.plays).reduce(
    (sum, p) => sum + p.count,
    0
  );
  const totalLikes = data.likes ? data.likes.size : 0;
  const totalSkips = data.skips ? data.skips.size : 0;
  const skipRate =
    totalPlays > 0 ? Math.round((totalSkips / totalPlays) * 100) + '%' : '0%';

  return {
    statistics: {
      totalPlays,
      totalLikes,
      skipRate,
    },
  };
}

/**
 * 生成推荐（基于歌手偏好）
 */
export function generateRecommendations(allSongs, count = 30) {
  const data = getRecommendData();

  // 如果没有数据，返回空
  if (!data || !data.initialized) {
    return [];
  }

  // 过滤并评分歌曲（filter+map 合并为一次遍历，避免 playInfo 闭包问题）
  const scoredSongs = allSongs
    .map(song => {
      // 排除已跳过的
      if (data.skips.has(song.id)) return { song, score: -1 };

      const playInfo = data.plays[song.id];
      // 排除已播放太多次的（避免重复）
      if (playInfo && playInfo.count >= 10) return { song, score: -1 };

      let score = 0;

      // 歌手匹配
      if (song.ar) {
        song.ar.forEach(artist => {
          if (data.artists[artist.id]) {
            const artistInfo = data.artists[artist.id];
            score += artistInfo.playCount * DEFAULT_CONFIG.artistWeight;
            if (artistInfo.liked) score += 50;
          }
        });
      }

      // 已喜欢的歌曲加权
      if (data.likes.has(song.id)) {
        score += 30;
      }

      // 已播放过的减少权重
      if (playInfo) {
        score -= playInfo.count * 5;
      }

      return { song, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map(item => item.song);

  return scoredSongs;
}

// 辅助函数：从缓存获取歌曲信息
const songCache = new Map();
const SONG_CACHE_MAX_SIZE = 2000;

export function cacheSong(song) {
  // Prevent unbounded growth: evict oldest entries when cache is full
  if (songCache.size >= SONG_CACHE_MAX_SIZE) {
    const oldestKey = songCache.keys().next().value;
    songCache.delete(oldestKey);
  }
  songCache.set(song.id, song);
}

function getSongById(songId) {
  return songCache.get(songId);
}

function saveData(data) {
  try {
    // 转换 Set 为 Array 以便存储
    const toSave = {
      ...data,
      likes: Array.from(data.likes || []),
      skips: Array.from(data.skips || []),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch (e) {
    console.error('Failed to save recommend data:', e);
  }
}

// 初始化时恢复 Set
export function restoreData() {
  const data = getRecommendData();
  if (data) {
    if (data.likes && Array.isArray(data.likes)) {
      data.likes = new Set(data.likes);
    }
    if (data.skips && Array.isArray(data.skips)) {
      data.skips = new Set(data.skips);
    }
  }
  return data;
}
