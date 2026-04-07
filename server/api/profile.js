const express = require('express');
const router = express.Router();
const { getDb } = require('../models/db');

// Get user profile / statistics
router.get('/profile/:userId', (req, res) => {
  const { userId } = req.params;
  
  const db = getDb();
  
  // Get event counts
  const stats = db.prepare(`
    SELECT 
      event_type,
      COUNT(*) as count,
      SUM(duration) as total_duration
    FROM user_events
    WHERE user_id = ?
    GROUP BY event_type
  `).all(userId);
  
  const statsMap = {
    play: { count: 0, totalDuration: 0 },
    skip: { count: 0, totalDuration: 0 },
    like: { count: 0 }
  };
  
  stats.forEach(s => {
    statsMap[s.event_type] = {
      count: s.count,
      totalDuration: s.total_duration || 0
    };
  });
  
  // Get top artists (from completed plays)
  const topArtists = db.prepare(`
    SELECT sf.artist_id, sf.artist_name, COUNT(*) as play_count
    FROM user_events e
    JOIN song_features sf ON e.song_id = sf.song_id
    WHERE e.user_id = ? AND e.event_type = 'play' AND e.completed = 1
    GROUP BY sf.artist_id
    ORDER BY play_count DESC
    LIMIT 10
  `).all(userId);
  
  // Get top genres
  const topGenres = db.prepare(`
    SELECT sf.genre, COUNT(*) as count
    FROM user_events e
    JOIN song_features sf ON e.song_id = sf.song_id
    WHERE e.user_id = ? AND e.event_type = 'play' AND e.completed = 1
    GROUP BY sf.genre
    ORDER BY count DESC
    LIMIT 5
  `).all(userId);
  
  // Get recent plays
  const recentPlays = db.prepare(`
    SELECT e.song_id, e.duration, e.completed, e.created_at,
           sf.artist_name, sf.album_name
    FROM user_events e
    LEFT JOIN song_features sf ON e.song_id = sf.song_id
    WHERE e.user_id = ? AND e.event_type = 'play'
    ORDER BY e.created_at DESC
    LIMIT 10
  `).all(userId);
  
  res.json({
    userId,
    statistics: {
      totalPlays: statsMap.play.count,
      totalSkips: statsMap.skip.count,
      totalLikes: statsMap.like.count,
      skipRate: statsMap.play.count > 0 
        ? (statsMap.skip.count / statsMap.play.count * 100).toFixed(1) + '%' 
        : '0%'
    },
    topArtists,
    topGenres,
    recentPlays
  });
});

// Update song features (admin/sync)
router.post('/sync-song', (req, res) => {
  const { songId, artistId, artistName, albumId, albumName, duration, bpm, genre, publishTime } = req.body;
  
  if (!songId) {
    return res.status(400).json({ error: 'songId is required' });
  }
  
  const db = getDb();
  
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO song_features 
    (song_id, artist_id, artist_name, album_id, album_name, duration, bpm, genre, publish_time, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  
  stmt.run(songId, artistId, artistName, albumId, albumName, duration, bpm, genre, publishTime);
  
  res.json({ success: true });
});

// Bulk sync songs
router.post('/sync-songs', (req, res) => {
  const { songs } = req.body;
  
  if (!Array.isArray(songs)) {
    return res.status(400).json({ error: 'songs array is required' });
  }
  
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO song_features 
    (song_id, artist_id, artist_name, album_id, album_name, duration, bpm, genre, publish_time, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  
  const insertMany = db.transaction((songs) => {
    for (const song of songs) {
      stmt.run(
        song.id, song.artistId, song.artistName, 
        song.albumId, song.albumName,
        song.duration, song.bpm, song.genre, song.publishTime
      );
    }
  });
  
  insertMany(songs);
  
  res.json({ success: true, count: songs.length });
});

module.exports = router;
