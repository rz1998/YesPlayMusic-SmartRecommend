<template>
  <div v-show="show" class="smart-recommend">
    <div class="header">
      <div class="title">🧠 智能推荐</div>
      <div class="subtitle">根据你的喜好定制 · 越用越懂你</div>
      <button class="refresh-btn" @click="refreshRecommendations" :disabled="loading">
        🔄 刷新推荐
      </button>
    </div>

    <div v-if="profile" class="stats">
      <div class="stat-item">
        <span class="stat-value">{{ profile.statistics.totalPlays }}</span>
        <span class="stat-label">播放</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">{{ profile.statistics.totalLikes }}</span>
        <span class="stat-label">喜欢</span>
      </div>
      <div class="stat-item warning">
        <span class="stat-value">{{ profile.statistics.skipRate }}</span>
        <span class="stat-label">跳过率</span>
      </div>
    </div>

    <TrackList
      v-if="recommendations.length > 0"
      :tracks="recommendations"
      type="playlist"
      dbclick-track-func="smartRecommend"
    />

    <div v-else-if="loading" class="loading">
      <div class="spinner"></div>
      <p>正在分析你的喜好...</p>
    </div>

    <div v-else-if="!hasEnoughData" class="empty initializing">
      <div class="init-icon">🎵</div>
      <p>正在从你喜欢的歌曲中学习...</p>
      <p class="hint">这将帮助我了解你的音乐偏好</p>
    </div>

    <div v-else class="empty">
      <p>📊 播放更多歌曲来让我更懂你</p>
      <p class="hint">推荐基于你喜欢的歌手和歌曲</p>
    </div>
  </div>
</template>

<script>
import { mapState } from 'vuex';
import NProgress from 'nprogress';
import TrackList from '@/components/TrackList.vue';
import { getRecommendations, syncSongs } from '@/api/recommend';
import { getTrackDetail } from '@/api/playlist';

export default {
  name: 'SmartRecommend',
  components: { TrackList },
  data() {
    return {
      show: false,
      loading: true,
      recommendations: [],
      profile: null,
      hasEnoughData: false,
    };
  },
  computed: {
    ...mapState(['user', 'player', 'liked']),
    userId() {
      return this.user?.userId || 'anonymous';
    },
    likedSongsCount() {
      return this.liked?.songs?.length || 0;
    },
  },
  created() {
    this.loadRecommendations();
    this.$parent.$refs.main.scrollTo(0, 0);
  },
  activated() {
    this.$parent.$refs.main.scrollTo(0, 0);
  },
  methods: {
    async loadRecommendations() {
      this.loading = true;
      NProgress.start();

      // 获取用户喜欢的歌曲数量（用于判断是否需要初始化）
      const likedCount = this.likedSongsCount;
      let needsRefresh = false;

      // 如果有喜欢的歌曲，先同步到后端
      if (likedCount > 0) {
        try {
          // 获取喜欢的歌曲ID列表（最多500首）
          const likedSongIds = this.liked.songs.slice(0, 500);

          // 分批获取歌曲详情（每批100首）
          const batchSize = 100;
          for (let i = 0; i < likedSongIds.length; i += batchSize) {
            const batchIds = likedSongIds.slice(i, i + batchSize);
            const idsStr = batchIds.join(',');

            try {
              const detail = await getTrackDetail(idsStr);
              if (detail.songs && detail.songs.length > 0) {
                // 转换为后端格式并同步
                const songsToSync = detail.songs.map(s => ({
                  id: s.id,
                  name: s.name,
                  artistId: s.ar?.[0]?.id,
                  artistName: s.ar?.map(a => a.name).join(','),
                  albumId: s.al?.id,
                  albumName: s.al?.name,
                  duration: s.dt,
                }));
                const result = await syncSongs(songsToSync, this.userId);
                // 标记需要刷新推荐（同步成功）
                if (result.success) {
                  needsRefresh = true;
                }
              }
            } catch (e) {
              console.warn('Failed to sync batch:', i, e);
            }
          }
          console.log('✅ Liked songs synced to backend');
        } catch (e) {
          console.warn('Failed to sync liked songs:', e);
        }
      }

      // 如果同步了歌曲，强制刷新推荐（绕过缓存）
      getRecommendations(this.userId, 30, true, needsRefresh)
        .then(result => {
          if (result.code === 200 || result.code === 0) {
            // 解析推荐结果
            this.recommendations = result.recommendations || [];
            this.profile = result.profile || null;
            // 有推荐数据或已有播放记录即为有足够数据
            this.hasEnoughData =
              this.recommendations.length > 0 ||
              this.profile?.statistics?.totalPlays > 0;
          } else {
            // API 返回错误，尝试显示已有喜欢歌曲数
            this.hasEnoughData = likedCount > 0;
          }
        })
        .catch(err => {
          console.error('Failed to load recommendations:', err);
          this.hasEnoughData = likedCount > 0;
        })
        .finally(() => {
          this.show = true;
          this.loading = false;
          NProgress.done();
        });
    },
    refreshRecommendations() {
      // Force refresh bypassing cache
      this.loading = true;
      NProgress.start();
      getRecommendations(this.userId, 30, true, true) // excludePlayed=true, refresh=true
        .then(result => {
          if (result.code === 200 || result.code === 0) {
            this.recommendations = result.recommendations || [];
            this.hasEnoughData = this.recommendations.length > 0;
          }
        })
        .catch(err => {
          console.error('Failed to refresh recommendations:', err);
        })
        .finally(() => {
          this.loading = false;
          NProgress.done();
        });
    },
  },
};
</script>

<style lang="scss" scoped>
.smart-recommend {
  padding: 32px;

  .header {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-bottom: 48px;

    .title {
      font-size: 48px;
      font-weight: 700;
      margin-bottom: 12px;
    }

    .subtitle {
      font-size: 16px;
      color: var(--color-text);
    }

    .refresh-btn {
      margin-top: 16px;
      padding: 8px 16px;
      background: var(--color-primary-bg);
      color: var(--color-primary);
      border: 1px solid var(--color-primary);
      border-radius: 20px;
      cursor: pointer;
      font-size: 14px;
      transition: all 0.2s;

      &:hover:not(:disabled) {
        background: var(--color-primary);
        color: #fff;
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }
  }

  .stats {
    display: flex;
    justify-content: center;
    gap: 48px;
    margin-bottom: 48px;

    .stat-item {
      text-align: center;

      .stat-value {
        display: block;
        font-size: 32px;
        font-weight: 700;
        color: var(--color-primary);
      }

      .stat-label {
        font-size: 14px;
        color: var(--color-text);
      }

      &.warning .stat-value {
        color: var(--color-warning);
      }
    }
  }

  .loading {
    text-align: center;
    padding: 80px 0;

    .spinner {
      display: inline-block;
      width: 48px;
      height: 48px;
      border: 3px solid var(--color-primary-bg);
      border-radius: 50%;
      border-top-color: var(--color-primary);
      animation: spin 1s ease-in-out infinite;
    }

    p {
      margin-top: 16px;
      color: var(--color-text);
    }
  }

  .empty {
    text-align: center;
    padding: 80px 0;

    p {
      font-size: 18px;
      color: var(--color-text);
      margin-bottom: 8px;
    }

    .hint {
      font-size: 14px;
      color: var(--color-text);
    }

    &.initializing {
      .init-icon {
        font-size: 64px;
        margin-bottom: 16px;
      }
    }
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
