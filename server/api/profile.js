const express = require('express');
const router = express.Router();
const db = require('../models/db');

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
    .map(([artistId, count]) => ({ artistId, count }));
  
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
  const { songId, artistId, artistName, albumId, albumName, duration, bpm, genre, publishTime, name, songName } = req.body;
  
  if (!songId) {
    return res.status(400).json({ error: 'songId is required' });
  }
  
  db.saveSong({
    songId,
    artistId,
    artistName,
    albumId,
    albumName,
    duration,
    bpm,
    genre,
    publishTime,
    name: name || songName,
  });
  
  res.json({ success: true });
});

// Bulk sync songs
router.post('/sync-songs', (req, res) => {
  const { songs } = req.body;
  
  if (!Array.isArray(songs)) {
    return res.status(400).json({ error: 'songs array is required' });
  }
  
  db.saveSongs(songs.map(s => ({
    songId: s.id || s.songId,
    artistId: s.artistId || s.artist?.id,
    artistName: s.artist?.name || s.artistName,
    albumId: s.album?.id || s.albumId,
    albumName: s.album?.name || s.albumName,
    duration: s.duration,
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
  
  // Clear all recommendation cache since song features changed
  cache.clearAllCache();
  res.json({ success: true, count: songs.length });
});

module.exports = router;
