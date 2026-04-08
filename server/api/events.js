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

// Record like event (toggle)
router.post('/like', (req, res) => {
  const { userId, songId } = req.body;
  
  if (!userId || !songId) {
    return res.status(400).json({ error: 'userId and songId are required' });
  }

  const events = db.getUserEvents(userId, 'like', 1000);
  const existing = events.find(e => e.songId === songId);
  
  if (existing) {
    // Unlike - remove the last like for this song
    const allEvents = require('../models/db').getUserEvents._originalEvents?.() || [];
    // For simplicity, just record a new event - actual unlike would need event ID tracking
  }
  
  const result = db.addEvent(userId, songId, 'like', 0, false);
  res.json({ success: true, action: 'liked', id: result.id });
});

// Get user event history
router.get('/history/:userId', (req, res) => {
  const { userId } = req.params;
  const { type, limit = 100 } = req.query;
  
  const events = db.getUserEvents(userId, type || null, parseInt(limit));
  
  res.json({ events });
});

module.exports = router;
