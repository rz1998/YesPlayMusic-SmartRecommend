const express = require('express');
const router = express.Router();
const db = require('../models/db');
const cache = require('../models/cache');

// Get user profile / statistics
router.get('/profile/:userId', (req, res) => {
  const { userId } = req.params;
  
  const stats = db.getUserStats(userId);
  const recentEvents = db.getUserEvents(userId, 'play', 10);
  
  // Get top artists from recent plays
  const artistCounts = {};
  const recentPlays = db.getUserEvents(userId, 'play', 50);
  const playSongIds = recentPlays.map(e => e.songId);
  const playSongs = db.getSongs(playSongIds);
  
  playSongs.forEach(song => {
    if (song && song.artistId) {
      artistCounts[song.artistId] = (artistCounts[song.artistId] || 0) + 1;
    }
  });
  
  const topArtists = Object.entries(artistCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([artistId, count]) => {
      // 找到对应歌曲以获取艺术家名称
      const song = playSongs.find(s => String(s.artistId) === artistId);
      return {
        artistId,
        artistName: song?.artistName || artistId,
        count,
      };
    });
  
  res.json({
    userId,
    statistics: {
      totalPlays: stats.play.count,
      totalSkips: stats.skip.count,
      totalLikes: stats.like.count,
      skipRate: stats.play.count > 0 
        ? ((stats.skip.count / stats.play.count) * 100).toFixed(1) + '%' 
        : '0%',
    },
    topArtists,
    recentPlays: recentEvents.map(e => ({
      songId: e.songId,
      duration: e.duration,
      completed: e.completed,
      createdAt: e.createdAt,
    })),
  });
});

// Sync song data
router.post('/sync-song', (req, res) => {
  const { songId, userId, artistId, artistName, albumId, albumName, duration, bpm, genre, publishTime, name, songName } = req.body;
  
  // Input validation: songId is required and must be a non-empty string
  if (!songId || typeof songId !== 'string' || songId.length > 64) {
    return res.status(400).json({ error: 'Invalid songId' });
  }
  // Sanitize string inputs to prevent injection
  const sanitize = (val) => (typeof val === 'string' ? val.slice(0, 512) : val);
  
  db.saveSong({
    songId,
    artistId: sanitize(artistId),
    artistName: sanitize(artistName),
    albumId: sanitize(albumId),
    albumName: sanitize(albumName),
    duration,
    bpm,
    genre: sanitize(genre),
    publishTime,
    name: sanitize(name || songName),
  });
  
  // Clear this user's cache since song features changed
  cache.clearAllCache();
  res.json({ success: true });
});

// Bulk sync songs
// Options:
//   - songs: array of song objects (required)
//   - userId: user ID (required)
//   - recordLikes: if true, also record each song as a 'like' event (for cold start from Netease liked songs)
router.post('/sync-songs', (req, res) => {
  const { songs, userId, recordLikes = false } = req.body;
  const MAX_BATCH_SIZE = 500; // Limit songs per request

  if (!Array.isArray(songs)) {
    return res.status(400).json({ error: 'songs array is required' });
  }
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  // Limit batch size
  const limitedSongs = songs.slice(0, MAX_BATCH_SIZE);

  // Save song metadata to DB
  db.saveSongs(limitedSongs.map(s => ({
    songId: s.id || s.songId,
    artistId: s.artistId || (s.ar && s.ar[0] && s.ar[0].id),
    artistName: s.artistName || (s.ar && s.ar.map(a => a.name).join(',')),
    albumId: s.albumId || (s.al && s.al.id),
    albumName: s.albumName || (s.al && s.al.name),
    duration: s.duration || s.dt,
    bpm: s.bpm,
    genre: s.genre,
    publishTime: s.publishTime,
    name: s.name || s.songName,
    // 扩展维度
    mood: s.mood,
    language: s.language,
    decade: s.decade,
    energy: s.energy,
    danceability: s.danceability,
    tags: s.tags,
  })));

  // ── 冷启动：用户网易云喜欢的歌曲 → 记录为 'like' 事件 ──
  let actualLikesRecorded = 0;
  if (recordLikes && userId) {
    for (const song of limitedSongs) {
      const songId = String(song.id || song.songId);
      const duration = song.duration || song.dt || 0;
      // 检查该歌曲的最新事件是否已是 like（避免覆盖用户手动操作）
      const existingEvents = db.getUserEventsForSong(userId, songId);
      const latestEvent = existingEvents.length > 0 ? existingEvents[0].eventType : null;
      if (latestEvent !== 'like') {
        db.addEvent(userId, songId, 'like', duration, true, duration);
        actualLikesRecorded++;
      }
    }
  }

  // Clear ALL users' cache since song features may affect all recommendations
  cache.clearAllCache();
  res.json({
    success: true,
    count: limitedSongs.length,
    truncated: songs.length > MAX_BATCH_SIZE,
    likesRecorded: actualLikesRecorded,
  });
});

module.exports = router;
