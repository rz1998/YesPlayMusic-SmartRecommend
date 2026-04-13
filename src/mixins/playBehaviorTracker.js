/**
 * Play Behavior Tracker Mixin
 *
 * Automatically tracks user play behavior:
 * - Records play events when songs are played
 * - Detects skips (song changed before completion)
 * - Records likes/unlikes
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
import { recordPlay, recordSkip, recordLike, recordUnlike } from '@/api/recommend';

export default {
  data() {
    return {
      // Track the previous song to detect skips
      previousTrackId: null,
      previousTrackDuration: 0,
      skipThreshold: 30, // Consider skip if played < 30 seconds
      // Listen duration tracking
      listenStartTime: 0,
      listenDuration: 0,
      isPlaying: false,
    };
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

        // If there was a previous track and it changed
        if (this.previousTrackId && this.previousTrackId !== newTrack.id) {
          this.handleTrackChange(newTrack, oldTrack);
        }

        this.previousTrackId = newTrack.id;
        this.previousTrackDuration = newTrack.duration || 0;
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
  },
  methods: {
    handleTrackChange(newTrack, oldTrack) {
      if (!oldTrack || !oldTrack.id) return;

      // Finalize listen duration
      this.finalizeListenDuration();

      const playedDuration = this.listenDuration;

      // Detect if it was a skip (didn't finish and didn't like)
      const isSkip =
        playedDuration < this.skipThreshold &&
        !this.isLikedTrack(oldTrack.id);

      if (isSkip) {
        this.onSkip(oldTrack);
      } else if (playedDuration > this.skipThreshold) {
        // Record as completed play
        const completed =
          playedDuration >= (this.previousTrackDuration || 0) * 0.8;
        this.recordPlay(oldTrack.id, playedDuration, completed);
      }
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
      this.previousTrackId = song.id;
      this.previousTrackDuration = song.duration || 0;
      this.listenDuration = 0;
      this.listenStartTime = Date.now();
      this.startListenTimer();

      recordPlay(this.userId, song.id, 0, false).catch(err =>
        console.error('Failed to record play:', err)
      );
    },

    /**
     * Called when a song is skipped
     * @param {Object} song - The song object
     */
    onSkip(song) {
      if (!song || !song.id) return;
      this.isPlaying = false;
      this.finalizeListenDuration();
      this.pauseListenTimer();

      const duration = song.duration || 0;
      recordSkip(
        this.userId,
        song.id,
        Math.floor(this.listenDuration),
        Math.floor(duration)
      ).catch(err => console.error('Failed to record skip:', err));

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
        recordLike(this.userId, song.id).catch(err =>
          console.error('Failed to record like:', err)
        );
      } else {
        recordUnlike(this.userId, song.id).catch(err =>
          console.error('Failed to record unlike:', err)
        );
      }
    },

    recordPlay(songId, duration, completed = false) {
      if (!this.userId || !songId) return;

      recordPlay(this.userId, songId, Math.floor(duration), completed).catch(
        err => console.error('Failed to record play:', err)
      );
    },

    recordSkip(songId, skipTime, songDuration) {
      if (!this.userId || !songId) return;

      recordSkip(
        this.userId,
        songId,
        Math.floor(skipTime),
        Math.floor(songDuration || 0)
      ).catch(err => console.error('Failed to record skip:', err));
    },

    isLikedTrack(songId) {
      // Check if track is in liked list from Vuex
      const likedSongs = this.$store.state?.liked?.songs || [];
      return likedSongs.some(s => s.id === songId);
    },
  },
};
