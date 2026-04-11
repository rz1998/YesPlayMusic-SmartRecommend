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

    <div v-else-if="!initialized" class="empty initializing">
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
import { getPlaylistDetail } from '@/api/playlist';

const STORAGE_KEY = 'smartRecommendData';

export default {
  name: 'SmartRecommend',
  components: { TrackList },
  data() {
    return {
      show: false,
      loading: true,
      recommendations: [],
      profile: null,
      initialized: false,
    };
  },
  computed: {
    ...mapState(['user', 'player', 'liked']),
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

      // 检查本地存储的推荐数据
      const localData = this.getLocalData();

      if (!localData || !localData.initialized) {
        // 初始化推荐数据
        this.initializeRecommendations();
      } else {
        // 生成推荐
        this.generateRecommendations();
      }
    },
    initializeRecommendations() {
      // 获取用户喜欢的歌曲作为初始数据
      const likedSongs = this.liked?.songs || [];
      
      if (likedSongs.length === 0) {
        // 尝试从API获取喜欢的歌曲
        this.fetchLikedSongsFromAPI();
        return;
      }

      // 使用喜欢的歌曲初始化推荐数据
      const data = this.buildInitialData(likedSongs);
      this.saveLocalData(data);
      this.initialized = true;
      this.generateRecommendations();
    },
    fetchLikedSongsFromAPI() {
      const likedPlaylistId = this.$store.state.data?.likedSongPlaylistID;
      if (!likedPlaylistId) {
        this.initialized = false;
        this.show = true;
        this.loading = false;
        NProgress.done();
        return;
      }

      getPlaylistDetail(likedPlaylistId, true)
        .then(result => {
          if (result.playlist && result.playlist.tracks) {
            const songs = result.playlist.tracks;
            const data = this.buildInitialData(songs);
            this.saveLocalData(data);
            this.initialized = true;
            this.generateRecommendations();
          } else {
            this.initialized = false;
            this.show = true;
          }
        })
        .catch(err => {
          console.error('Failed to fetch liked songs:', err);
          this.initialized = false;
          this.show = true;
        })
        .finally(() => {
          this.loading = false;
          NProgress.done();
        });
    },
    buildInitialData(songs) {
      // 统计歌手偏好
      const artistCounts = {};
      const artistLiked = {};
      
      songs.forEach(song => {
        if (song.ar) {
          song.ar.forEach(artist => {
            if (!artistCounts[artist.id]) {
              artistCounts[artist.id] = { name: artist.name, count: 0 };
              artistLiked[artist.id] = true;
            }
            artistCounts[artist.id].count++;
          });
        }
      });

      return {
        version: 1,
        initialized: true,
        initTime: Date.now(),
        songs: songs.map(s => s.id),  // 喜欢的歌曲ID列表
        artists: artistCounts,
        artistLiked: artistLiked,
        plays: {},
        likes: new Set(songs.map(s => s.id)),
        skips: new Set(),
      };
    },
    generateRecommendations() {
      // 获取所有可用歌曲
      const allSongs = this.getAllAvailableSongs();
      const localData = this.getLocalData();
      
      if (!localData) {
        this.initialized = false;
        this.show = true;
        this.loading = false;
        NProgress.done();
        return;
      }

      // 过滤并评分
      const likedSongIds = new Set(localData.songs || []);
      const scoredSongs = allSongs
        .filter(song => !likedSongIds.has(song.id))  // 排除已喜欢的
        .filter(song => !localData.skips?.has(song.id))  // 排除跳过的
        .map(song => {
          let score = 0;
          
          // 歌手匹配
          if (song.ar) {
            song.ar.forEach(artist => {
              if (localData.artists?.[artist.id]) {
                score += localData.artists[artist.id].count * 2;
                if (localData.artistLiked?.[artist.id]) {
                  score += 30;
                }
              }
            });
          }
          
          // 播放过的降低权重
          if (localData.plays?.[song.id]) {
            score -= localData.plays[song.id] * 3;
          }
          
          return { song, score };
        })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 30)
        .map(item => item.song);

      this.recommendations = scoredSongs;
      this.profile = this.getProfile(localData);
      this.show = true;
      this.loading = false;
      NProgress.done();
    },
    getAllAvailableSongs() {
      const songs = new Map();
      
      // 添加喜欢的歌曲
      const likedSongs = this.liked?.songs || [];
      likedSongs.forEach(song => {
        if (!songs.has(song.id)) {
          songs.set(song.id, song);
        }
      });
      
      return Array.from(songs.values());
    },
    getLocalData() {
      try {
        const data = localStorage.getItem(STORAGE_KEY);
        if (data) {
          const parsed = JSON.parse(data);
          // 恢复 Set
          if (parsed.likes && Array.isArray(parsed.likes)) {
            parsed.likes = new Set(parsed.likes);
          }
          if (parsed.skips && Array.isArray(parsed.skips)) {
            parsed.skips = new Set(parsed.skips);
          }
          return parsed;
        }
      } catch (e) {
        console.error('Failed to load local data:', e);
      }
      return null;
    },
    saveLocalData(data) {
      try {
        // 转换 Set 为 Array
        const toSave = {
          ...data,
          likes: data.likes ? Array.from(data.likes) : [],
          skips: data.skips ? Array.from(data.skips) : [],
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
      } catch (e) {
        console.error('Failed to save local data:', e);
      }
    },
    getProfile(data) {
      if (!data) {
        return { statistics: { totalPlays: 0, totalLikes: 0, skipRate: '0%' } };
      }
      
      const totalPlays = Object.values(data.plays || {}).reduce((sum, p) => sum + (p.count || 0), 0);
      const totalLikes = data.likes?.size || (data.songs?.length || 0);
      const totalSkips = data.skips?.size || 0;
      const skipRate = totalPlays > 0 ? Math.round((totalSkips / totalPlays) * 100) + '%' : '0%';
      
      return {
        statistics: { totalPlays, totalLikes, skipRate }
      };
    },
    recordPlay(song) {
      const data = this.getLocalData();
      if (!data) return;
      
      if (!data.plays) data.plays = {};
      if (!data.plays[song.id]) {
        data.plays[song.id] = { count: 0, lastPlay: 0 };
      }
      data.plays[song.id].count++;
      data.plays[song.id].lastPlay = Date.now();
      
      this.saveLocalData(data);
      this.profile = this.getProfile(data);
    },
    recordLike(songId) {
      const data = this.getLocalData();
      if (!data) return;
      
      if (!data.likes) data.likes = new Set();
      data.likes.add(songId);
      
      // 更新歌手喜欢状态
      // ... 可以扩展
      this.saveLocalData(data);
      this.profile = this.getProfile(data);
    },
    recordSkip(songId) {
      const data = this.getLocalData();
      if (!data) return;
      
      if (!data.skips) data.skips = new Set();
      data.skips.add(songId);
      this.saveLocalData(data);
      this.profile = this.getProfile(data);
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
        opacity: 0.67;
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
      border: 3px solid rgba(var(--color-primary-rgb), 0.3);
      border-radius: 50%;
      border-top-color: var(--color-primary);
      animation: spin 1s ease-in-out infinite;
    }

    p {
      margin-top: 16px;
      color: var(--color-text);
      opacity: 0.67;
    }
  }

  .empty {
    text-align: center;
    padding: 80px 0;

    p {
      font-size: 18px;
      color: var(--color-text);
      opacity: 0.67;
      margin-bottom: 8px;
    }

    .hint {
      font-size: 14px;
      opacity: 0.5;
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
