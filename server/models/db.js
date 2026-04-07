/**
 * SQLite database using sql.js (WebAssembly)
 * No compilation required, works with any Node.js version
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '../data');
const DB_FILE = path.join(DATA_DIR, 'recommender.db');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db = null;
let SQL = null;

// Initialize database
async function initDb() {
  if (db) return db;
  
  SQL = await initSqlJs();
  
  // Load existing database or create new one
  if (fs.existsSync(DB_FILE)) {
    const buffer = fs.readFileSync(DB_FILE);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
    // Create tables
    db.run(`
      CREATE TABLE IF NOT EXISTS user_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        song_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        duration INTEGER DEFAULT 0,
        completed INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_events_user ON user_events(user_id);
      CREATE INDEX IF NOT EXISTS idx_events_type ON user_events(event_type);
      
      CREATE TABLE IF NOT EXISTS song_features (
        song_id TEXT PRIMARY KEY,
        artist_id TEXT,
        artist_name TEXT,
        album_id TEXT,
        album_name TEXT,
        duration INTEGER,
        bpm INTEGER,
        genre TEXT,
        publish_time INTEGER,
        mood TEXT,
        language TEXT,
        decade TEXT,
        energy REAL,
        danceability REAL,
        tags TEXT,
        name TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS user_profiles (
        user_id TEXT PRIMARY KEY,
        data TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    saveDb();
  }
  
  return db;
}

// Save database to file
function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_FILE, buffer);
}

// Helper: run query and return results
function query(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// Helper: run insert/update/delete
function run(sql, params = []) {
  db.run(sql, params);
  saveDb();
  return db.getRowsModified();
}

// Event operations
function addEvent(userId, songId, eventType, duration = 0, completed = false) {
  const id = uuidv4();
  run(
    `INSERT INTO user_events (id, user_id, song_id, event_type, duration, completed, created_at) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, String(songId), eventType, duration, completed ? 1 : 0, new Date().toISOString()]
  );
  return { id, userId, songId, eventType, duration, completed };
}

function getUserEvents(userId, eventType = null, limit = 100) {
  let sql = `SELECT * FROM user_events WHERE user_id = ?`;
  const params = [userId];
  
  if (eventType) {
    sql += ` AND event_type = ?`;
    params.push(eventType);
  }
  
  sql += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);
  
  return query(sql, params);
}

function getUserLikedSongs(userId, limit = 100) {
  const results = query(
    `SELECT DISTINCT song_id FROM user_events 
     WHERE user_id = ? AND event_type = 'like' 
     ORDER BY created_at DESC LIMIT ?`,
    [userId, limit]
  );
  return results.map(r => r.song_id);
}

function getUserSkippedSongs(userId, limit = 100) {
  const results = query(
    `SELECT DISTINCT song_id FROM user_events 
     WHERE user_id = ? AND event_type = 'skip' 
     ORDER BY created_at DESC LIMIT ?`,
    [userId, limit]
  );
  return results.map(r => r.song_id);
}

// Song operations
function saveSong(song) {
  const existing = query(`SELECT song_id FROM song_features WHERE song_id = ?`, [String(song.songId)]);
  
  if (existing.length > 0) {
    run(`UPDATE song_features SET 
      artist_id = ?, artist_name = ?, album_id = ?, album_name = ?,
      duration = ?, bpm = ?, genre = ?, publish_time = ?,
      mood = ?, language = ?, decade = ?, energy = ?, danceability = ?,
      tags = ?, name = ?, updated_at = ?
      WHERE song_id = ?`,
      [
        song.artistId || null, song.artistName || null, song.albumId || null, song.albumName || null,
        song.duration || null, song.bpm || null, song.genre || null, song.publishTime || null,
        song.mood || null, song.language || null, song.decade || null, song.energy || null, song.danceability || null,
        song.tags ? JSON.stringify(song.tags) : null, song.name || null, new Date().toISOString(),
        String(song.songId)
      ]
    );
  } else {
    run(`INSERT INTO song_features 
      (song_id, artist_id, artist_name, album_id, album_name, duration, bpm, genre, publish_time,
       mood, language, decade, energy, danceability, tags, name, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(song.songId), song.artistId || null, song.artistName || null, song.albumId || null, song.albumName || null,
        song.duration || null, song.bpm || null, song.genre || null, song.publishTime || null,
        song.mood || null, song.language || null, song.decade || null, song.energy || null, song.danceability || null,
        song.tags ? JSON.stringify(song.tags) : null, song.name || null, new Date().toISOString()
      ]
    );
  }
}

function saveSongs(songsArray) {
  for (const song of songsArray) {
    saveSong(song);
  }
}

function getSong(songId) {
  const results = query(`SELECT * FROM song_features WHERE song_id = ?`, [String(songId)]);
  return results.length > 0 ? results[0] : null;
}

function getSongs(songIds) {
  if (songIds.length === 0) return [];
  const placeholders = songIds.map(() => '?').join(',');
  const results = query(
    `SELECT * FROM song_features WHERE song_id IN (${placeholders})`,
    songIds.map(String)
  );
  return results;
}

function getAllSongs(limit = 500) {
  return query(`SELECT * FROM song_features ORDER BY updated_at DESC LIMIT ?`, [limit]);
}

// User profile operations
function getUserProfile(userId) {
  const results = query(`SELECT * FROM user_profiles WHERE user_id = ?`, [userId]);
  if (results.length === 0) return null;
  return JSON.parse(results[0].data || '{}');
}

function updateUserProfile(userId, updates) {
  const existing = query(`SELECT user_id FROM user_profiles WHERE user_id = ?`, [userId]);
  
  if (existing.length > 0) {
    run(`UPDATE user_profiles SET data = ?, updated_at = ? WHERE user_id = ?`,
      [JSON.stringify(updates), new Date().toISOString(), userId]);
  } else {
    run(`INSERT INTO user_profiles (user_id, data, updated_at) VALUES (?, ?, ?)`,
      [userId, JSON.stringify(updates), new Date().toISOString()]);
  }
}

// Statistics
function getUserStats(userId) {
  const results = query(
    `SELECT event_type, COUNT(*) as count, SUM(duration) as total_duration 
     FROM user_events WHERE user_id = ? GROUP BY event_type`,
    [userId]
  );
  
  const stats = {
    play: { count: 0, totalDuration: 0 },
    skip: { count: 0, totalDuration: 0 },
    like: { count: 0 },
  };
  
  for (const row of results) {
    if (stats[row.event_type]) {
      stats[row.event_type].count = row.count;
      stats[row.event_type].totalDuration = row.total_duration || 0;
    }
  }
  
  return stats;
}

// Sync initialization
async function initialize() {
  await initDb();
  console.log('✅ SQLite database initialized');
}

// Export promise-based initialization
module.exports = {
  initialize,
  addEvent,
  getUserEvents,
  getUserLikedSongs,
  getUserSkippedSongs,
  saveSong,
  saveSongs,
  getSong,
  getSongs,
  getAllSongs,
  getUserProfile,
  updateUserProfile,
  getUserStats,
};
