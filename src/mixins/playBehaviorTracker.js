/**
 * Play Behavior Tracker Mixin
 *
 * Automatically tracks user play behavior:
 * - Records play events when songs are played
 * - Detects skips (song changed before completion)
 * - Records likes/unlikes
 * - Offline event queue with retry mechanism
 *
 * Usage:
 *   import playBehaviorTracker from '@/mixins/playBehaviorTracker';
 *   mixins: [playBehaviorTracker]
 *
 * Components using this mixin should call:
 *   this.onPlay(song)   - when a song starts playing
 *   this.onSkip(song)   - when a song is skipped
 *   this.onLike(song, liked) - when like button is toggled
 */

import { mapState } from 'vuex';
import {
  recordPlay,
  recordSkip,
  recordLike,
  recordUnlike,
} from '@/api/recommend';

const EVENT_QUEUE_KEY = 'ypm_event_queue';
const MAX_QUEUE_SIZE = 100;
const RETRY_INTERVAL_MS = 5000;

export default {
  data() {
    return {
      skipThreshold: 30, // Consider skip if played < 30 seconds
      // Listen duration tracking
      listenStartTime: 0,
      listenDuration: 0,
      isPlaying: false,
      // Offline event queue
      eventQueue: [],
      _retryTimer: null,
    };
  },
  created() {
    // Load queued events from localStorage
    this._loadEventQueue();
    // Start retry loop
    this._startRetryLoop();
    // Listen for online/offline events
    window.addEventListener('online', this._onNetworkOnline);
    window.addEventListener('offline', this._onNetworkOffline);
  },
  computed: {
    ...mapState(['player']),
    userId() {
      return this.$store.state?.user?.userId || 'anonymous';
    },
  },
  watch: {
    // Watch for song changes
    'player.currentTrack': {
      handler(newTrack, oldTrack) {
        if (!newTrack || !newTrack.id) return;

        // Detect song change by comparing oldTrack.id vs newTrack.id directly
        if (oldTrack && oldTrack.id && oldTrack.id !== newTrack.id) {
          this.handleTrackChange(newTrack, oldTrack, 'songChange');
        }
      },
      immediate: false,
    },
    // Watch playing state to track listen duration
    'player.playing': {
      handler(isPlaying) {
        if (isPlaying) {
          this.startListenTimer();
        } else {
          this.pauseListenTimer();
        }
      },
    },
  },
  beforeUnmount() {
    this.stopListenTimer();
    this._stopRetryLoop();
    window.removeEventListener('online', this._onNetworkOnline);
    window.removeEventListener('offline', this._onNetworkOffline);
  },
  methods: {
    handleTrackChange(newTrack, oldTrack, trigger = 'unknown') {
      if (!oldTrack || !oldTrack.id) return;

      // Finalize listen duration
      this.finalizeListenDuration();

      const playedDuration = this.listenDuration;
      const songDuration = oldTrack.duration
        ? Math.floor(oldTrack.duration / 1000)
        : 0; // convert ms to sec

      // Detect if it was a skip based on listen ratio
      // Skip if: played less than 30% of song AND didn't like the track
      const SKIP_RATIO_THRESHOLD = 0.3; // 30% listen threshold for skip detection
      const listenRatio = songDuration > 0 ? playedDuration / songDuration : 0;
      const isSkip =
        listenRatio < SKIP_RATIO_THRESHOLD && !this.isLikedTrack(oldTrack.id);

      if (isSkip) {
        // Record skip with listen duration info for dynamic skip penalty calculation
        this.onSkip(oldTrack, playedDuration, songDuration);
      } else if (trigger === 'songChange') {
        // Only record play on manual song change (skip or next/prev).
        // On natural song end, Player.js _scrobble already handles the play record,
        // so we skip here to avoid double-recording.
        if (playedDuration > this.skipThreshold) {
          const completed =
            songDuration > 0 && playedDuration >= songDuration * 0.7;
          // completed=true 时 duration 应传歌曲总时长（spec §1.2 & §5），而非实际收听时长
          const duration = completed ? songDuration : playedDuration;
          this.recordPlay(oldTrack.id, duration, completed);
        }
      }
      // trigger === 'naturalEnd' → skip, let Player.js _scrobble handle it
    },

    // Start listening timer
    startListenTimer() {
      if (this._listenInterval) return;
      this.listenStartTime = Date.now();
      this._listenInterval = setInterval(() => {
        if (this.isPlaying) {
          this.listenDuration = Math.floor(
            (Date.now() - this.listenStartTime) / 1000
          );
        }
      }, 1000);
    },

    // Pause listening timer
    pauseListenTimer() {
      if (this._listenInterval) {
        clearInterval(this._listenInterval);
        this._listenInterval = null;
      }
    },

    // Stop and finalize timer
    stopListenTimer() {
      this.pauseListenTimer();
      this.listenDuration = 0;
    },

    // ─────────────────────────────────────────────────────────────
    // Offline Event Queue (§9.4 离线补偿机制)
    // ─────────────────────────────────────────────────────────────

    /**
     * Load event queue from localStorage
     */
    _loadEventQueue() {
      try {
        const stored = localStorage.getItem(EVENT_QUEUE_KEY);
        if (stored) {
          this.eventQueue = JSON.parse(stored);
        }
      } catch (e) {
        console.warn('Failed to load event queue:', e);
        this.eventQueue = [];
      }
    },

    /**
     * Persist event queue to localStorage
     */
    _saveEventQueue() {
      try {
        localStorage.setItem(EVENT_QUEUE_KEY, JSON.stringify(this.eventQueue));
      } catch (e) {
        console.warn('Failed to save event queue:', e);
      }
    },

    /**
     * Add event to queue (FIFO)
     * @param {Object} event - { type: 'play'|'skip'|'like'|'unlike', ...params }
     */
    _enqueueEvent(event) {
      this.eventQueue.push({ ...event, timestamp: Date.now() });
      // Keep queue size limited
      if (this.eventQueue.length > MAX_QUEUE_SIZE) {
        this.eventQueue = this.eventQueue.slice(-MAX_QUEUE_SIZE);
      }
      this._saveEventQueue();
    },

    /**
     * Flush all queued events to server
     */
    async _flushEventQueue() {
      if (this.eventQueue.length === 0) return;

      const queue = [...this.eventQueue];
      let successCount = 0;

      for (const event of queue) {
        try {
          switch (event.type) {
            case 'play':
              await recordPlay(
                event.userId,
                event.songId,
                event.duration,
                event.completed
              );
              break;
            case 'skip':
              await recordSkip(
                event.userId,
                event.songId,
                event.skipTime,
                event.songDuration
              );
              break;
            case 'like':
              await recordLike(event.userId, event.songId);
              break;
            case 'unlike':
              await recordUnlike(event.userId, event.songId);
              break;
          }
          // Remove from queue on success
          this.eventQueue = this.eventQueue.filter(
            e => e.timestamp !== event.timestamp
          );
          successCount++;
        } catch (e) {
          // Network error - stop flushing, keep events in queue
          console.warn('Event flush failed, keeping in queue:', e);
          break;
        }
      }

      if (successCount > 0) {
        this._saveEventQueue();
        console.log(`✅ Flushed ${successCount} events from queue`);
      }
    },

    /**
     * Start retry loop for queued events
     */
    _startRetryLoop() {
      if (this._retryTimer) return;
      this._retryTimer = setInterval(() => {
        if (navigator.onLine && this.eventQueue.length > 0) {
          this._flushEventQueue();
        }
      }, RETRY_INTERVAL_MS);
    },

    /**
     * Stop retry loop
     */
    _stopRetryLoop() {
      if (this._retryTimer) {
        clearInterval(this._retryTimer);
        this._retryTimer = null;
      }
    },

    /**
     * Network came back online
     */
    _onNetworkOnline() {
      console.log('🌐 Network online, flushing event queue...');
      this._flushEventQueue();
    },

    /**
     * Network went offline
     */
    _onNetworkOffline() {
      console.log('📴 Network offline, events will be queued');
    },

    /**
     * Try to send event, queue on failure
     */
    _sendEvent(event) {
      const apiCall = () => {
        switch (event.type) {
          case 'play':
            return recordPlay(
              event.userId,
              event.songId,
              event.duration,
              event.completed
            );
          case 'skip':
            return recordSkip(
              event.userId,
              event.songId,
              event.skipTime,
              event.songDuration
            );
          case 'like':
            return recordLike(event.userId, event.songId);
          case 'unlike':
            return recordUnlike(event.userId, event.songId);
        }
      };

      apiCall().catch(() => {
        // Network error - add to queue
        this._enqueueEvent(event);
      });
    },

    // Finalize current listen duration before recording
    finalizeListenDuration() {
      if (this.listenStartTime > 0) {
        this.listenDuration = Math.floor(
          (Date.now() - this.listenStartTime) / 1000
        );
        this.listenStartTime = Date.now(); // reset for next song
      }
    },

    /**
     * Called when a song starts playing
     * @param {Object} song - The song object
     */
    onPlay(song) {
      if (!song || !song.id) return;
      this.isPlaying = true;
      this.listenDuration = 0;
      this.listenStartTime = Date.now();
      this.startListenTimer();

      this._sendEvent({
        type: 'play',
        userId: this.userId,
        songId: song.id,
        duration: 0,
        completed: false,
      });
    },

    /**
     * Called when a song is skipped
     * @param {Object} song - The song object
     * @param {number} listenDuration - How long the user listened before skipping (seconds)
     * @param {number} songDuration - Total duration of the song (seconds)
     */
    onSkip(song, listenDuration, songDuration) {
      if (!song || !song.id) return;
      this.isPlaying = false;
      this.finalizeListenDuration();
      this.pauseListenTimer();

      const duration =
        songDuration || (song.duration ? Math.floor(song.duration / 1000) : 0);
      const actualListenDuration = listenDuration || this.listenDuration;

      // Record skip with listen duration info for dynamic skip penalty calculation on server
      this._sendEvent({
        type: 'skip',
        userId: this.userId,
        songId: song.id,
        skipTime: Math.floor(actualListenDuration),
        songDuration: Math.floor(duration),
      });

      // Reset for next song
      this.listenDuration = 0;
    },

    /**
     * Called when like button is toggled
     * @param {Object} song - The song object
     * @param {boolean} liked - Whether the song is now liked
     */
    onLike(song, liked) {
      if (!song || !song.id) return;

      if (liked) {
        this._sendEvent({
          type: 'like',
          userId: this.userId,
          songId: song.id,
        });
      } else {
        this._sendEvent({
          type: 'unlike',
          userId: this.userId,
          songId: song.id,
        });
      }
    },

    recordPlay(songId, duration, completed = false) {
      if (!this.userId || !songId) return;

      this._sendEvent({
        type: 'play',
        userId: this.userId,
        songId,
        duration: Math.floor(duration),
        completed,
      });
    },

    recordSkip(songId, skipTime, songDuration) {
      if (!this.userId || !songId) return;

      this._sendEvent({
        type: 'skip',
        userId: this.userId,
        songId,
        skipTime: Math.floor(skipTime),
        songDuration: Math.floor(songDuration || 0),
      });
    },

    isLikedTrack(songId) {
      // Check if track is in liked list from Vuex
      const likedSongs = this.$store.state?.liked?.songs || [];
      return likedSongs.some(s => s.id === songId);
    },
  },
};
