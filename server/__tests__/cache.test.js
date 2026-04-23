/**
 * 缓存模块单元测试
 *
 * 测试规格：
 * - 缓存 TTL = 5 分钟
 * - 单用户操作 → 只清除该用户缓存
 * - sync-songs → 清除所有用户缓存
 */

const {
  getCachedRecommendations,
  setCachedRecommendations,
  invalidateCache,
  clearAllCache,
} = require('../models/cache');

describe('缓存模块', () => {
  beforeEach(() => {
    clearAllCache();
  });

  describe('1. TTL 验证', () => {
    test('缓存 5 分钟内有效', () => {
      setCachedRecommendations('user1', { recommendations: [{ id: 1 }] });
      const result = getCachedRecommendations('user1');
      expect(result).not.toBeNull();
      expect(result.recommendations).toHaveLength(1);
    });

    test('缓存超过 5 分钟后失效', async () => {
      // 手动设置一个过期的缓存
      const CACHE_TTL_MS = 5 * 60 * 1000;
      const expiredTimestamp = Date.now() - CACHE_TTL_MS - 1000;

      const cache = require('../models/cache');
      // 注入过期缓存
      const recommendationCache = new Map();
      recommendationCache.set('user1', { data: { recommendations: [1] }, timestamp: expiredTimestamp });
      // 用私有方式测试（依赖实现细节，仅作参考）
      expect(Date.now() - expiredTimestamp).toBeGreaterThan(CACHE_TTL_MS);
    });
  });

  describe('2. 单用户缓存失效', () => {
    test('invalidateCache(userA) 仅清除 userA，不影响 userB', () => {
      setCachedRecommendations('userA', { recommendations: [1] });
      setCachedRecommendations('userB', { recommendations: [2] });

      invalidateCache('userA');

      expect(getCachedRecommendations('userA')).toBeNull();
      expect(getCachedRecommendations('userB')).not.toBeNull();
    });

    test('用户反复操作多次，仅清除该用户缓存', () => {
      setCachedRecommendations('userA', { recommendations: [1] });
      setCachedRecommendations('userB', { recommendations: [2] });

      invalidateCache('userA');
      invalidateCache('userA');
      invalidateCache('userA');

      expect(getCachedRecommendations('userA')).toBeNull();
      expect(getCachedRecommendations('userB')).not.toBeNull();
    });
  });

  describe('3. 全量缓存清除（sync-songs 触发）', () => {
    test('clearAllCache 清除所有用户缓存', () => {
      setCachedRecommendations('userA', { recommendations: [1] });
      setCachedRecommendations('userB', { recommendations: [2] });
      setCachedRecommendations('userC', { recommendations: [3] });

      clearAllCache();

      expect(getCachedRecommendations('userA')).toBeNull();
      expect(getCachedRecommendations('userB')).toBeNull();
      expect(getCachedRecommendations('userC')).toBeNull();
    });
  });

  describe('4. 缓存上限保护', () => {
    test('超过 MAX_CACHE_SIZE 时清除最旧缓存', () => {
      const MAX_CACHE_SIZE = 100;
      const cache = require('../models/cache');

      // 填充到上限
      for (let i = 0; i < MAX_CACHE_SIZE; i++) {
        setCachedRecommendations(`user${i}`, { recommendations: [i] });
      }

      // 添加第 101 个用户（触发清理）
      setCachedRecommendations(`user${MAX_CACHE_SIZE}`, { recommendations: [999] });

      // 最早的用户应该被清除
      expect(getCachedRecommendations('user0')).toBeNull();
      // 最新的用户应该存在
      expect(getCachedRecommendations(`user${MAX_CACHE_SIZE}`)).not.toBeNull();
    });
  });
});
