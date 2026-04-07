const express = require('express');
const router = express.Router();
const { getDb } = require('../models/db');

// Record play event
router.post('/play', (req, res) => {
  const { userId, songId, duration, completed } = req.body;
  
  if (!userId || !songId) {
    return res.status(400).json({ error: 'userId and songId are required' });
  }

  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO user_events (user_id, song_id, event_type, duration, completed)
    VALUES (?, ?, 'play', ?, ?)
  `);
  
  const result = stmt.run(userId, songId, duration || 0, completed ? 1 : 0);
  
  res.json({ success: true, id: result.lastInsertRowid });
});

// Record skip event
router.post('/skip', (req, res) => {
  const { userId, songId, skipTime } = req.body;
  
  if (!userId || !songId) {
    return res.status(400).json({ error: 'userId and songId are required' });
  }

  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO user_events (user_id, song_id, event_type, duration)
    VALUES (?, ?, 'skip', ?)
  `);
  
  const result = stmt.run(userId, songId, skipTime || 0);
  
  res.json({ success: true, id: result.lastInsertRowid });
});

// Record like event
router.post('/like', (req, res) => {
  const { userId, songId } = req.body;
  
  if (!userId || !songId) {
    return res.status(400).json({ error: 'userId and songId are required' });
  }

  const db = getDb();
  
  // Check if already liked
  const existing = db.prepare(`
    SELECT id FROM user_events 
    WHERE user_id = ? AND song_id = ? AND event_type = 'like'
  `).get(userId, songId);
  
  if (existing) {
    // Unlike - remove the like
    db.prepare(`
      DELETE FROM user_events WHERE id = ?
    `).run(existing.id);
    
    return res.json({ success: true, action: 'unliked' });
  }
  
  // New like
  const stmt = db.prepare(`
    INSERT INTO user_events (user_id, song_id, event_type)
    VALUES (?, ?, 'like')
  `);
  
  const result = stmt.run(userId, songId);
  
  res.json({ success: true, action: 'liked', id: result.lastInsertRowid });
});

// Get user event history
router.get('/history/:userId', (req, res) => {
  const { userId } = req.params;
  const { type, limit = 100 } = req.query;
  
  const db = getDb();
  
  let query = `
    SELECT * FROM user_events 
    WHERE user_id = ?
  `;
  const params = [userId];
  
  if (type) {
    query += ' AND event_type = ?';
    params.push(type);
  }
  
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(parseInt(limit));
  
  const events = db.prepare(query).all(...params);
  
  res.json({ events });
});

module.exports = router;
