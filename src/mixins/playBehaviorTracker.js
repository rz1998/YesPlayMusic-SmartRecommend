/**
 * Play Behavior Tracker Mixin
 *
 * Automatically tracks user play behavior:
 * - Records play events when songs are played
 * - Detects skips (song changed before completion)
 * - Records likes
 *
 * Usage:
 *   import playBehaviorTracker from '@/mixins/playBehaviorTracker';
 *   mixins: [playBehaviorTracker]
 */

import { mapState } from 'vuex';
import { recordPlay, recordSkip, recordLike } from '@/api/recommend';

export default {
  data() {
    return {
      // Track the previous song to detect skips
      previousTrackId: null,
      previousTrackDuration: 0,
      skipThreshold: 30, // Consider skip if played < 30 seconds
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
      },
      immediate: false,
    },
  },
  methods: {
    handleTrackChange(newTrack, oldTrack) {
      if (!oldTrack || !oldTrack.id) return;

      const playedDuration = this.player.currentTime || 0;

      // Detect if it was a skip (didn't finish and didn't like)
      const isSkip =
        playedDuration < this.skipThreshold && !this.isLikedTrack(oldTrack.id);

      if (isSkip) {
        this.recordSkipEvent(
          oldTrack.id,
          playedDuration,
          oldTrack.duration || 0
        );
      } else if (playedDuration > this.skipThreshold) {
        // Record as completed play
        const completed =
          playedDuration >= (this.previousTrackDuration || 0) * 0.8;
        this.recordPlayEvent(oldTrack.id, playedDuration, completed);
      }
    },

    recordPlayEvent(songId, duration, completed = false) {
      if (!this.userId || !songId) return;

      recordPlay(this.userId, songId, Math.floor(duration), completed).catch(
        err => console.error('Failed to record play:', err)
      );
    },

    recordSkipEvent(songId, skipTime, songDuration) {
      if (!this.userId || !songId) return;

      recordSkip(
        this.userId,
        songId,
        Math.floor(skipTime),
        Math.floor(songDuration || 0)
      ).catch(err => console.error('Failed to record skip:', err));
    },

    recordLikeEvent(songId) {
      if (!this.userId || !songId) return;

      recordLike(this.userId, songId).catch(err =>
        console.error('Failed to record like:', err)
      );
    },

    isLikedTrack(songId) {
      // Check if track is in liked list
      const likedSongs = this.$store.state?.data?.likedSongs || [];
      return likedSongs.some(s => s.id === songId);
    },
  },
};
