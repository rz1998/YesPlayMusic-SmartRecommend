<template>
  <div v-show="show" class="smart-recommend">
    <div class="header">
      <div class="title">🧠 智能推荐</div>
      <div class="subtitle">根据你的喜好定制 · 越用越懂你</div>

      <!-- 操作按钮 -->
      <div v-if="recommendations.length > 0" class="header-actions">
        <button class="play-all-btn" @click="playAll"> ▶ 播放全部 </button>
        <button class="shuffle-btn" @click="shufflePlay"> 🔀 随机播放 </button>
        <button
          class="refresh-btn"
          :disabled="loading"
          @click="refreshRecommendations"
        >
          🔄 刷新
        </button>
      </div>
    </div>

    <!-- 操作提示 -->
    <div v-if="recommendations.length > 0" class="hint-text">
      💡 双击任意歌曲播放 · 播放行为会帮助优化推荐
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

    <div
      v-else-if="!hasEnoughData && likedSongsCount > 0"
      class="empty initializing"
    >
      <div class="init-icon">🎵</div>
      <p v-if="loading">正在从你喜欢的歌曲中学习...</p>
      <p v-else>已同步 {{ likedSongsCount }} 首喜欢歌曲，正在生成推荐...</p>
      <p class="hint">试试点击刷新推荐</p>
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
import { getRecommendations, getUserProfile, syncSongs } from '@/api/recommend';
import { getTrackDetail } from '@/api/track';
import { recommendPlaylist } from '@/api/playlist';
import { getAlbum } from '@/api/album';
import { topSong } from '@/api/track';

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

      // 如果有喜欢的歌曲且数量变化了，才重新同步（避免每次页面加载都重复请求）
      const STORAGE_KEY = 'ypm_liked_sync_count_' + this.userId;
      const lastCount = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
      // 同步条件：首次同步(lastCount=0) 或 数量变化(新增喜欢歌曲)
      if (lastCount === 0 || likedCount !== lastCount) {
        try {
          // 获取喜欢的歌曲ID列表（最多500首）
          const likedSongIds = this.liked.songs.slice(0, 500);

          // 收集所有同步的歌曲（用于后续封面同步）
          const allSyncedSongs = [];

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
                  picUrl: s.al?.picUrl, // 专辑封面（可能为空）
                  // 扩展维度（网易云可能提供部分）
                  bpm: s.bpm || undefined,
                  genre: s.tag?.join(',') || undefined,
                  publishTime: s.publishTime || undefined,
                  mood: s.mood || undefined,
                  language: s.language || undefined,
                  decade: s.decade || undefined,
                  energy: s.energy || undefined,
                  danceability: s.danceability || undefined,
                }));
                allSyncedSongs.push(...songsToSync);
                const result = await syncSongs(songsToSync, this.userId, true);
                if (result.success) {
                  needsRefresh = true;
                }
              }
            } catch (e) {
              console.warn('Failed to sync batch:', i, e);
            }
          }

          // 同步完成后，获取缺失的专辑封面
          if (allSyncedSongs.length > 0) {
            await this.syncAlbumCovers(allSyncedSongs);
          }
          // 记录已同步的数量，避免下次重复同步
          localStorage.setItem(STORAGE_KEY, String(likedCount));
          console.log('✅ Liked songs synced to backend');
        } catch (e) {
          console.warn('Failed to sync liked songs:', e);
        }
      } else if (likedCount === lastCount && lastCount > 0) {
        // 数量没变且已有同步记录，跳过同步，直接请求推荐
        needsRefresh = false;
      }

      // 并行加载推荐结果和用户画像（带错误处理）
      let recResult = null;
      let profileResult = null;

      try {
        recResult = await getRecommendations(
          this.userId,
          30,
          true,
          needsRefresh
        );
      } catch (e) {
        console.warn('Failed to get recommendations:', e);
      }

      try {
        profileResult = await getUserProfile(this.userId);
      } catch (e) {
        console.warn('Failed to get user profile:', e);
      }

      // 解析推荐结果
      if (recResult && recResult.recommendations !== undefined) {
        this.recommendations = (recResult.recommendations || []).map(
          this.transformTrack
        );
        this.hasEnoughData = this.recommendations.length > 0;
      } else {
        this.hasEnoughData = likedCount > 0;
      }

      // 如果推荐为空，尝试加载官方推荐作为兜底 (§9.3)
      if (this.recommendations.length === 0) {
        await this.loadFallbackRecommendations();
      }

      // 解析用户画像（播放/点赞/跳过统计）
      if (profileResult && profileResult.userId) {
        this.profile = profileResult;
      }

      this.show = true;
      this.loading = false;
      NProgress.done();
    },
    async refreshRecommendations() {
      // Force refresh bypassing cache
      this.loading = true;
      NProgress.start();

      // 刷新前重新同步（用户可能新增了喜欢的歌曲）
      let needsRefresh = true;
      if (this.likedSongsCount > 0) {
        try {
          const likedSongIds = this.liked.songs.slice(0, 500);
          const allSyncedSongs = [];
          const batchSize = 100;
          for (let i = 0; i < likedSongIds.length; i += batchSize) {
            const batchIds = likedSongIds.slice(i, i + batchSize);
            const idsStr = batchIds.join(',');
            const detail = await getTrackDetail(idsStr);
            if (detail.songs && detail.songs.length > 0) {
              const songsToSync = detail.songs.map(s => ({
                id: s.id,
                name: s.name,
                artistId: s.ar?.[0]?.id,
                artistName: s.ar?.map(a => a.name).join(','),
                albumId: s.al?.id,
                albumName: s.al?.name,
                duration: s.dt,
                picUrl: s.al?.picUrl,
                bpm: s.bpm || undefined,
                genre: s.tag?.join(',') || undefined,
                publishTime: s.publishTime || undefined,
              }));
              allSyncedSongs.push(...songsToSync);
              await syncSongs(songsToSync, this.userId, true); // recordLikes=true（新歌曲记录like事件）
            }
          }
          // 同步缺失的专辑封面
          if (allSyncedSongs.length > 0) {
            await this.syncAlbumCovers(allSyncedSongs);
          }
        } catch (e) {
          console.warn('Refresh sync failed:', e);
        }
      }

      const [recResult, profileResult] = await Promise.all([
        getRecommendations(this.userId, 30, true, needsRefresh),
        getUserProfile(this.userId),
      ]);

      if (recResult && recResult.recommendations !== undefined) {
        this.recommendations = (recResult.recommendations || []).map(
          this.transformTrack
        );
        this.hasEnoughData = this.recommendations.length > 0;
      }

      // 如果推荐为空，尝试加载官方推荐作为兜底 (§9.3)
      if (this.recommendations.length === 0) {
        await this.loadFallbackRecommendations();
      }

      if (profileResult && profileResult.userId) {
        this.profile = profileResult;
      }

      this.loading = false;
      NProgress.done();
    },

    /**
     * 播放全部推荐
     */
    playAll() {
      if (this.recommendations.length === 0) return;
      const trackIDs = this.recommendations.map(t => t.id || t.songId);
      this.player.replacePlaylist(
        trackIDs,
        '/smart-recommend',
        'url',
        trackIDs[0]
      );
    },

    /**
     * 随机播放推荐
     */
    shufflePlay() {
      if (this.recommendations.length === 0) return;
      const shuffled = [...this.recommendations].sort(
        () => Math.random() - 0.5
      );
      const trackIDs = shuffled.map(t => t.id || t.songId);
      this.player.replacePlaylist(
        trackIDs,
        '/smart-recommend',
        'url',
        trackIDs[0]
      );
    },

    /**
     * §9.3 冷启动兜底 - 加载网易云官方推荐
     * 优先级：1. 推荐歌单 → 2. 热门新歌 → 3. 随机精选
     */
    async loadFallbackRecommendations() {
      try {
        // 优先级1: 网易云推荐歌单
        const res = await recommendPlaylist({ limit: 10 });
        if (res.result && res.result.length > 0) {
          // 取第一个歌单的前20首歌作为兜底推荐
          const playlistId = res.result[0].id;
          const playlistDetail = await this.getPlaylistDetail(playlistId);
          if (playlistDetail && playlistDetail.tracks) {
            this.recommendations = playlistDetail.tracks
              .slice(0, 20)
              .map(t => ({
                id: t.id,
                name: t.name,
                al: {
                  id: t.al?.id || 0,
                  name: t.al?.name || '',
                  picUrl: t.al?.picUrl || '',
                },
                ar: t.ar
                  ? t.ar.map(a => ({ id: a.id || 0, name: a.name }))
                  : [],
                dt: t.dt || t.duration || 0,
              }));
            this.hasEnoughData = true;
            return;
          }
        }
      } catch (e) {
        console.warn('Fallback 1 (personalized) failed:', e);
      }

      try {
        // 优先级2: 热门新歌
        const res = await topSong(0); // 0=全部地区
        if (res.data && res.data.length > 0) {
          this.recommendations = res.data.slice(0, 20).map(t => ({
            id: t.id,
            name: t.name,
            al: {
              id: t.al?.id || 0,
              name: t.al?.name || '',
              picUrl: t.al?.picUrl || '',
            },
            ar: t.ar ? t.ar.map(a => ({ id: a.id || 0, name: a.name })) : [],
            dt: t.dt || t.duration || 0,
          }));
          this.hasEnoughData = true;
          return;
        }
      } catch (e) {
        console.warn('Fallback 2 (topSong) failed:', e);
      }

      // 优先级3: 已有喜欢歌曲时直接使用
      if (this.likedSongsCount > 0) {
        this.recommendations = this.liked.songs.slice(0, 20);
        this.hasEnoughData = true;
      }
    },

    /**
     * 同步专辑封面 - 获取缺失封面的专辑并更新
     */
    async syncAlbumCovers(songs) {
      try {
        // 收集需要获取封面的专辑ID（没有封面的）
        const albumMap = new Map(); // albumId -> { name, picUrl }
        songs.forEach(s => {
          if (s.albumId && !s.picUrl) {
            albumMap.set(s.albumId, { name: s.albumName });
          }
        });

        if (albumMap.size === 0) {
          return; // 全部已有封面
        }

        console.log(`📷 Fetching covers for ${albumMap.size} albums...`);

        // 批量获取专辑详情（每批50个）
        const albumIds = Array.from(albumMap.keys());
        const batchSize = 50;

        for (let i = 0; i < albumIds.length; i += batchSize) {
          const batch = albumIds.slice(i, i + batchSize);
          try {
            // 并行获取多个专辑的详情
            const albumPromises = batch.map(albumId => getAlbum(albumId));
            const albums = await Promise.all(albumPromises);

            albums.forEach(album => {
              if (album && album.id && album.picUrl) {
                // 更新本地歌曲的封面
                const songWithCover = songs.find(s => s.albumId === album.id);
                if (songWithCover) {
                  songWithCover.picUrl = album.picUrl;
                }
              }
            });
          } catch (e) {
            console.warn('Failed to fetch album batch:', e);
          }
        }

        // 如果有封面更新，重新同步到后端
        const songsWithCovers = songs.filter(s => s.picUrl);
        if (songsWithCovers.length > 0) {
          await syncSongs(songsWithCovers, this.userId, false);
          console.log(`✅ Updated ${songsWithCovers.length} song covers`);
        }
      } catch (e) {
        console.warn('Failed to sync album covers:', e);
      }
    },

    /**
     * 获取歌单详情
     */
    async getPlaylistDetail(playlistId) {
      try {
        const res = await fetch(
          `/api/playlist/detail?id=${playlistId}&timestamp=${Date.now()}`
        );
        const data = await res.json();
        return data.playlist || null;
      } catch (e) {
        console.warn('Failed to get playlist detail:', e);
        return null;
      }
    },
    // Transform backend track format to frontend TrackList format
    // Backend: { id, name, artist, album, duration, picUrl, ... }
    // Frontend: { id, name, al: { id, name, picUrl }, ar: [{ id, name }], dt: ms, ... }
    transformTrack(track) {
      return {
        id: track.id,
        name: track.name || `Song ${track.id}`,
        al: {
          id: track.albumId || 0,
          name: track.album || '',
          picUrl: track.picUrl || '',
        },
        ar: track.artist
          ? [{ id: track.artistId || 0, name: track.artist }]
          : [],
        dt: (track.duration || 0) * 1000, // Convert seconds to milliseconds
        ...track, // Preserve original fields
      };
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
    margin-bottom: 24px;

    .title {
      font-size: 48px;
      font-weight: 700;
      margin-bottom: 12px;
      color: var(--color-text);
    }

    .subtitle {
      font-size: 16px;
      color: var(--color-text);
    }

    .header-actions {
      display: flex;
      gap: 12px;
      margin-top: 16px;

      button {
        padding: 8px 20px;
        border-radius: 20px;
        cursor: pointer;
        font-size: 14px;
        transition: all 0.2s;
        border: none;
      }

      .play-all-btn {
        background: var(--color-primary);
        color: #fff;

        &:hover {
          opacity: 0.85;
        }
      }

      .shuffle-btn {
        background: var(--color-primary-bg);
        color: var(--color-primary);
        border: 1px solid var(--color-primary);

        &:hover {
          background: var(--color-primary);
          color: #fff;
        }
      }

      .refresh-btn {
        background: var(--color-primary-bg);
        color: var(--color-text);
        border: 1px solid var(--color-border);

        &:hover:not(:disabled) {
          border-color: var(--color-primary);
          color: var(--color-primary);
        }

        &:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      }
    }
  }

  .hint-text {
    text-align: center;
    font-size: 13px;
    color: var(--color-text);
    opacity: 0.6;
    margin-bottom: 24px;
  }

  .stats {
    display: flex;
    justify-content: center;
    gap: 48px;
    margin-bottom: 32px;

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
