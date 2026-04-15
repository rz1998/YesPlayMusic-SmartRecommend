/**
 * Shared recommendation cache module
 * Prevents circular dependency between events.js and recommend.js
 */

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 100; // Maximum number of users to cache
const recommendationCache = new Map();

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

module.exports = {
  getCachedRecommendations,
  setCachedRecommendations,
  invalidateCache,
  clearAllCache,
};
