<template>
  <div v-show="show" class="smart-recommend">
    <div class="header">
      <div class="title">🧠 智能推荐</div>
      <div class="subtitle">根据你的喜好定制 · 越用越懂你</div>
    </div>

    <div class="stats" v-if="profile">
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

    <div v-else class="empty">
      <p>📊 还没有足够的数据</p>
      <p class="hint">多播放一些歌曲，我会变得更懂你</p>
    </div>
  </div>
</template>

<script>
import { mapState } from 'vuex';
import NProgress from 'nprogress';
import TrackList from '@/components/TrackList.vue';
import { 
  getRecommendations, 
  getUserProfile,
  recordPlay 
} from '@/api/recommend';

export default {
  name: 'SmartRecommend',
  components: { TrackList },
  data() {
    return {
      show: false,
      loading: true,
      recommendations: [],
      profile: null,
    };
  },
  computed: {
    ...mapState(['user', 'player']),
    userId() {
      return this.user?.userId || 'anonymous';
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
    loadRecommendations() {
      this.loading = true;
      NProgress.start();

      Promise.all([
        getRecommendations(this.userId, 30),
        getUserProfile(this.userId),
      ])
        .then(([recResult, profileResult]) => {
          if (recResult.recommendations) {
            this.recommendations = recResult.recommendations;
          }
          if (profileResult.userId) {
            this.profile = profileResult;
          }
          this.show = true;
        })
        .catch(err => {
          console.error('Failed to load recommendations:', err);
        })
        .finally(() => {
          this.loading = false;
          NProgress.done();
        });
    },
    // Called when a track is played
    onTrackPlay(track, duration) {
      recordPlay(this.userId, track.id, duration)
        .catch(err => console.error('Failed to record play:', err));
    },
  },
};
</script>

<style lang="scss" scoped>
.smart-recommend {
  padding: 32px;

  .header {
    text-align: center;
    margin-bottom: 48px;

    .title {
      font-size: 48px;
      font-weight: 700;
      margin-bottom: 12px;
    }

    .subtitle {
      font-size: 16px;
      color: var(--color-text);
      opacity: 0.7;
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
        opacity: 0.7;
      }

      &.warning .stat-value {
        color: #ff6b6b;
      }
    }
  }

  .loading, .empty {
    text-align: center;
    padding: 64px;
    color: var(--color-text);

    .spinner {
      width: 48px;
      height: 48px;
      border: 4px solid var(--color-primary);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 24px;
    }

    .hint {
      font-size: 14px;
      opacity: 0.7;
      margin-top: 8px;
    }
  }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
