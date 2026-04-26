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
import {
  recordPlay,
  recordSkip,
  recordLike,
  recordUnlike,
} from '@/api/recommend';

export default {
  data() {
    return {
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

      recordPlay(this.userId, song.id, 0, false).catch(err =>
        console.error('Failed to record play:', err)
      );
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
      recordSkip(
        this.userId,
        song.id,
        Math.floor(actualListenDuration),
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
