const express = require('express');
const router = express.Router();
const db = require('../models/db');

// Record play event
router.post('/play', (req, res) => {
  const { userId, songId, duration, completed } = req.body;
  
  if (!userId || !songId) {
    return res.status(400).json({ error: 'userId and songId are required' });
  }

  const result = db.addEvent(userId, songId, 'play', duration || 0, completed);
  res.json({ success: true, id: result.id });
});

// Record skip event
router.post('/skip', (req, res) => {
  const { userId, songId, skipTime, songDuration } = req.body;
  
  if (!userId || !songId) {
    return res.status(400).json({ error: 'userId and songId are required' });
  }

  const result = db.addEvent(userId, songId, 'skip', skipTime || 0, false, songDuration);
  res.json({ success: true, id: result.id });
});

// Record like event (toggle: like if currently unliked, unlike if currently liked)
router.post('/like', (req, res) => {
  const { userId, songId } = req.body;
  
  if (!userId || !songId) {
    return res.status(400).json({ error: 'userId and songId are required' });
  }

  // Check current like status by getting the latest event for this song
  const events = db.getUserEventsForSong(userId, String(songId));
  const latestEvent = events.length > 0 ? events[0].eventType : null;
  
  let action;
  if (latestEvent === 'like') {
    // Already liked, record unlike
    db.addEvent(userId, songId, 'unlike', 0, false);
    action = 'unliked';
  } else {
    // Not liked or already unliked, record like
    db.addEvent(userId, songId, 'like', 0, false);
    action = 'liked';
  }
  
  res.json({ success: true, action });
});

// Record like event (explicit)
router.post('/like/:songId', (req, res) => {
  const { userId } = req.body;
  const { songId } = req.params;
  
  if (!userId || !songId) {
    return res.status(400).json({ error: 'userId and songId are required' });
  }

  const events = db.getUserEventsForSong(userId, String(songId));
  const latestEvent = events.length > 0 ? events[0].eventType : null;
  
  let action;
  if (latestEvent === 'like') {
    db.addEvent(userId, songId, 'unlike', 0, false);
    action = 'unliked';
  } else {
    db.addEvent(userId, songId, 'like', 0, false);
    action = 'liked';
  }
  
  res.json({ success: true, action });
});

// Record unlike event (explicit)
router.post('/unlike', (req, res) => {
  const { userId, songId } = req.body;

  if (!userId || !songId) {
    return res.status(400).json({ error: 'userId and songId are required' });
  }

  const result = db.addEvent(userId, songId, 'unlike', 0, false);
  res.json({ success: true, action: 'unliked', id: result.id });
});

// Get user event history
router.get('/history/:userId', (req, res) => {
  const { userId } = req.params;
  const { type, limit = 100 } = req.query;
  
  const events = db.getUserEvents(userId, type || null, parseInt(limit));
  
  res.json({ events });
});

// Get like status for specific songs
router.get('/liked/:userId', (req, res) => {
  const { userId } = req.params;
  const { songIds } = req.query;  // comma-separated list of songIds
  
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }
  
  if (!songIds) {
    return res.json({ likedSongIds: [] });
  }
  
  const ids = songIds.split(',').map(id => id.trim());
  const likedSongIds = db.getUserLikedSongs(userId, 1000);
  
  // Return which of the requested songs are liked
  const liked = ids.filter(id => likedSongIds.includes(String(id)));
  
  res.json({ likedSongIds: liked });
});

module.exports = router;
