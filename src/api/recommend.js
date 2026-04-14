/**
 * Smart Recommendation API
 *
 * 与网易云API区分开：
 * - 事件追踪记录播放/跳过/喜欢行为
 * - 推荐算法基于用户个人偏好
 */

const RECOMMENDER_HOST =
  process.env.VUE_APP_RECOMMENDER_HOST || 'http://localhost:3001';

/**
 * Record a play event
 * @param {string} userId - User ID
 * @param {number} songId - Song ID
 * @param {number} duration - Play duration in seconds
 * @param {boolean} completed - Whether played to completion
 */
export function recordPlay(userId, songId, duration, completed = false) {
  return fetch(`${RECOMMENDER_HOST}/api/event/play`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, songId, duration, completed }),
  }).then(r => r.json());
}

/**
 * Record a skip event
 * @param {string} userId - User ID
 * @param {number} songId - Song ID
 * @param {number} skipTime - Time when skipped (seconds)
 * @param {number} songDuration - Total duration of the song (seconds)
 */
export function recordSkip(userId, songId, skipTime, songDuration) {
  return fetch(`${RECOMMENDER_HOST}/api/event/skip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, songId, skipTime, songDuration }),
  }).then(r => r.json());
}

/**
 * Record a like event (toggle)
 * @param {string} userId - User ID
 * @param {number} songId - Song ID
 */
export function recordLike(userId, songId) {
  return fetch(`${RECOMMENDER_HOST}/api/event/like`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, songId }),
  }).then(r => r.json());
}

/**
 * Get personalized recommendations
 * @param {string} userId - User ID
 * @param {number} limit - Number of recommendations
 * @param {boolean} excludePlayed - Exclude already played songs
 */
export function getRecommendations(userId, limit = 20, excludePlayed = true, refresh = false) {
  const refreshParam = refresh ? '&refresh=true' : '';
  return fetch(
    `${RECOMMENDER_HOST}/api/recommend?userId=${userId}&limit=${limit}&excludePlayed=${excludePlayed}${refreshParam}`
  ).then(r => r.json());
}

/**
 * Get user preference profile
 * @param {string} userId - User ID
 */
export function getUserProfile(userId) {
  return fetch(`${RECOMMENDER_HOST}/api/user/profile/${userId}`).then(r =>
    r.json()
  );
}

/**
 * Record an unlike event
 * @param {string} userId - User ID
 * @param {number} songId - Song ID
 */
export function recordUnlike(userId, songId) {
  return fetch(`${RECOMMENDER_HOST}/api/event/unlike`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, songId }),
  }).then(r => r.json());
}

/**
 * Get similar songs
 * @param {number} songId - Song ID
 * @param {number} limit - Number of similar songs
 */
export function getSimilarSongs(songId, limit = 10) {
  return fetch(
    `${RECOMMENDER_HOST}/api/recommend/similar/${songId}?limit=${limit}`
  ).then(r => r.json());
}

/**
 * Sync song data to recommender
 * @param {Array} songs - Array of song objects
 */
export function syncSongs(songs) {
  return fetch(`${RECOMMENDER_HOST}/api/user/sync-songs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songs }),
  }).then(r => r.json());
}
