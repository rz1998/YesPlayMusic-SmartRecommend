/**
 * Shared recommendation cache module
 * Prevents circular dependency between events.js and recommend.js
 */

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 100; // Maximum number of users to cache
const recommendationCache = new Map();
// In-flight computation locks to prevent cache stampede: Map<userId, Promise>
const pendingComputations = new Map();

function enforceCacheLimit() {
  if (recommendationCache.size >= MAX_CACHE_SIZE) {
    // Remove oldest entry (first inserted)
    const firstKey = recommendationCache.keys().next().value;
    recommendationCache.delete(firstKey);
    console.log(`🗑️ Cache limit reached, evicted user: ${firstKey}`);
  }
}

function getCachedRecommendations(userId) {
  const cached = recommendationCache.get(userId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }
  return null;
}

/**
 * Get or create a pending computation lock.
 * If another request is already computing for this user, return its promise.
 * Callers should await the returned promise then call `releaseLock(userId)`.
 */
function acquireLock(userId) {
  if (pendingComputations.has(userId)) {
    return pendingComputations.get(userId); // reuse in-flight promise
  }
  // Placeholder that callers replace with their actual promise
  let release;
  const p = new Promise(resolve => { release = resolve; });
  pendingComputations.set(userId, p);
  return { promise: p, release: () => { pendingComputations.delete(userId); release(); } };
}

function setCachedRecommendations(userId, data) {
  enforceCacheLimit();
  recommendationCache.set(userId, { data, timestamp: Date.now() });
}

function invalidateCache(userId) {
  if (userId) {
    recommendationCache.delete(userId);
    console.log(`🗑️ Cache invalidated for user: ${userId}`);
  }
}

function clearAllCache() {
  recommendationCache.clear();
  console.log('🗑️ All recommendation cache cleared');
}

// ── Cache stampede protection ──────────────────────────────────────────

/**
 * Check if a computation is already in-flight for this user
 */
function isComputing(userId) {
  return pendingComputations.has(userId);
}

/**
 * Wait for an in-flight computation to complete.
 * Returns a promise that resolves when the computation is done.
 */
function waitForComputation(userId) {
  const p = pendingComputations.get(userId);
  return p || Promise.resolve();
}

/**
 * Register an in-flight computation. Call clearComputing() when done.
 * @param {string} userId
 * @param {Promise} promise - The computation promise
 */
function setComputing(userId, promise) {
  pendingComputations.set(userId, promise);
  // Automatically clear when promise settles (resolve or reject)
  promise.finally(() => pendingComputations.delete(userId));
}

/**
 * Manually clear a computing lock (use when computation fails/throws)
 */
function clearComputing(userId) {
  pendingComputations.delete(userId);
}

module.exports = {
  getCachedRecommendations,
  setCachedRecommendations,
  invalidateCache,
  clearAllCache,
  isComputing,
  waitForComputation,
  setComputing,
  clearComputing,
};
