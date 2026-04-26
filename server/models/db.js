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
    
    // Migration: add song_duration column if it doesn't exist
    try {
      db.run(`ALTER TABLE user_events ADD COLUMN song_duration INTEGER DEFAULT 0`);
      console.log('✅ Migrated: added song_duration column');
      saveDb();
    } catch (e) {
      // Column already exists or other error - ignore
    }

    // Migration: add extended columns to song_features if they don't exist
    const songFeatureMigrations = [
      { col: 'mood', type: 'TEXT' },
      { col: 'language', type: 'TEXT' },
      { col: 'decade', type: 'TEXT' },
      { col: 'energy', type: 'REAL' },
      { col: 'danceability', type: 'REAL' },
      { col: 'tags', type: 'TEXT' },
    ];
    for (const mig of songFeatureMigrations) {
      try {
        db.run(`ALTER TABLE song_features ADD COLUMN ${mig.col} ${mig.type}`);
        console.log(`✅ Migrated: added ${mig.col} column to song_features`);
        saveDb();
      } catch (e) {
        // Column already exists or other error - ignore
      }
    }
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
        song_duration INTEGER DEFAULT 0,
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
function addEvent(userId, songId, eventType, duration = 0, completed = false, songDuration = null) {
  const id = uuidv4();
  run(
    `INSERT INTO user_events (id, user_id, song_id, event_type, duration, song_duration, completed, created_at) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, String(songId), eventType, duration, songDuration || 0, completed ? 1 : 0, new Date().toISOString()]
  );
  return { id, userId, songId, eventType, duration, songDuration, completed };
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
  
  const results = query(sql, params);
  return results.map(row => ({
    id: row.id,
    userId: row.user_id,
    songId: row.song_id,
    eventType: row.event_type,
    duration: row.duration,
    completed: row.completed === 1,
    createdAt: row.created_at,
  }));
}

// Get events for a specific song by a user (all events, ordered newest first)
function getUserEventsForSong(userId, songId) {
  const results = query(
    `SELECT * FROM user_events
     WHERE user_id = ? AND song_id = ?
     ORDER BY created_at DESC`,
    [userId, String(songId)]
  );
  return results.map(row => ({
    id: row.id,
    userId: row.user_id,
    songId: row.song_id,
    eventType: row.event_type,
    duration: row.duration,
    completed: row.completed === 1,
    createdAt: row.created_at,
  }));
}

/**
 * Delete specific event types for a user+song combination.
 * Used to prevent duplicate like/unlike records under concurrent requests.
 * @param {string} userId
 * @param {string} songId
 * @param {string[]} eventTypes - e.g. ['like', 'unlike']
 */
function deleteUserSongEvents(userId, songId, eventTypes) {
  if (!eventTypes || eventTypes.length === 0) return;
  const placeholders = eventTypes.map(() => '?').join(',');
  run(
    `DELETE FROM user_events WHERE user_id = ? AND song_id = ? AND event_type IN (${placeholders})`,
    [userId, String(songId), ...eventTypes]
  );
}

// Get user's liked songs (only songs where the latest event is 'like', not 'unlike')
function getUserLikedSongs(userId, limit = 1000) {
  // Get the latest event for each song by this user, only considering like/unlike events
  const results = query(
    `SELECT song_id, event_type, created_at FROM user_events 
     WHERE user_id = ? AND event_type IN ('like', 'unlike')
     ORDER BY created_at DESC`,
    [userId]
  );
  
  // Build a map: song_id -> latest event_type (first occurrence = latest due to DESC order)
  const latestEventMap = {};
  for (const row of results) {
    if (latestEventMap[row.song_id] === undefined) {
      latestEventMap[row.song_id] = row.event_type;
    }
  }
  
  // Only return songs where latest event is 'like'
  const likedSongs = Object.entries(latestEventMap)
    .filter(([_, eventType]) => eventType === 'like')
    .map(([songId, _]) => songId)
    .slice(0, limit);
  
  return likedSongs;
}

// Get user's played songs (only songs where the latest event is 'play', not 'skip'/'like'/'unlike')
function getUserPlayedSongs(userId, limit = 500) {
  // Only count songs where the latest event is a completed play (completed=1).
  // A partial play (completed=0) does NOT count toward "played" — user didn't finish it.
  const results = query(
    `SELECT song_id, event_type, completed FROM user_events
     WHERE user_id = ? AND event_type IN ('play', 'skip', 'like', 'unlike')
     ORDER BY created_at DESC`,
    [userId]
  );
  
  // Build a map: song_id -> latest event info (first occurrence = latest due to DESC order)
  const latestEventMap = {};
  for (const row of results) {
    if (latestEventMap[row.song_id] === undefined) {
      latestEventMap[row.song_id] = { eventType: row.event_type, completed: row.completed };
    }
  }
  
  // Only return songs where latest event is 'play' AND completed=1 (fully listened)
  const playedSongs = Object.entries(latestEventMap)
    .filter(([_, info]) => info.eventType === 'play' && info.completed === 1)
    .map(([songId, _]) => songId)
    .slice(0, limit);
  
  return playedSongs;
}

// Get user's partial plays (latest event is 'play' but completed=0, i.e., 30%-70% listened)
// These contribute +1 to preference vector but are NOT excluded from recommendations
function getPartialPlayedSongs(userId, limit = 500) {
  const results = query(
    `SELECT song_id, event_type, completed FROM user_events
     WHERE user_id = ? AND event_type IN ('play', 'skip', 'like', 'unlike')
     ORDER BY created_at DESC`,
    [userId]
  );
  
  // Build a map: song_id -> latest event info (first occurrence = latest due to DESC order)
  const latestEventMap = {};
  for (const row of results) {
    if (latestEventMap[row.song_id] === undefined) {
      latestEventMap[row.song_id] = { eventType: row.event_type, completed: row.completed };
    }
  }
  
  // Only return songs where latest event is 'play' AND completed=0 (partially listened, 30%-70%)
  const partialPlayedSongs = Object.entries(latestEventMap)
    .filter(([_, info]) => info.eventType === 'play' && info.completed === 0)
    .map(([songId, _]) => songId)
    .slice(0, limit);
  
  return partialPlayedSongs;
}

// Get user's skipped songs (only songs where the latest event is 'skip', not 'like' or 'unlike')
// Songs that were skipped but later liked are NOT excluded from recommendations
function getUserSkippedSongs(userId, limit = 500) {
  const results = query(
    `SELECT song_id, event_type, created_at FROM user_events 
     WHERE user_id = ? AND event_type IN ('skip', 'play', 'like', 'unlike')
     ORDER BY created_at DESC`,
    [userId]
  );
  
  // Build a map: song_id -> latest event_type (first occurrence = latest due to DESC order)
  const latestEventMap = {};
  for (const row of results) {
    if (latestEventMap[row.song_id] === undefined) {
      latestEventMap[row.song_id] = row.event_type;
    }
  }
  
  // Only return songs where latest event is 'skip'
  const skippedSongs = Object.entries(latestEventMap)
    .filter(([_, eventType]) => eventType === 'skip')
    .map(([songId, _]) => songId)
    .slice(0, limit);
  
  return skippedSongs;
}

// Get skipped songs with listen duration details (only songs where skip is the latest event)
function getUserSkippedSongsWithDetails(userId, limit = 500) {
  const results = query(
    `SELECT song_id, event_type, duration as listen_duration, song_duration, created_at
     FROM user_events 
     WHERE user_id = ? AND event_type IN ('skip', 'play', 'like', 'unlike')
     ORDER BY created_at DESC`,
    [userId]
  );
  
  // Build a map: song_id -> latest event info (first occurrence = latest due to DESC order)
  const latestEventMap = {};
  for (const row of results) {
    if (latestEventMap[row.song_id] === undefined) {
      latestEventMap[row.song_id] = row;
    }
  }
  
  // Only return songs where latest event is 'skip', with duration details
  const skippedSongs = Object.entries(latestEventMap)
    .filter(([_, eventInfo]) => eventInfo.event_type === 'skip')
    .map(([songId, eventInfo]) => ({
      songId,
      listenDuration: eventInfo.listen_duration,
      songDuration: eventInfo.song_duration,
    }))
    .slice(0, limit);
  
  return skippedSongs;
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
  return results.length > 0 ? normalizeSong(results[0]) : null;
}

function getSongs(songIds) {
  if (songIds.length === 0) return [];
  const placeholders = songIds.map(() => '?').join(',');
  const results = query(
    `SELECT * FROM song_features WHERE song_id IN (${placeholders})`,
    songIds.map(String)
  );
  return results.map(normalizeSong);
}

function normalizeSong(row) {
  // Convert snake_case from SQLite to camelCase for JavaScript
  return {
    songId: row.song_id,
    artistId: row.artist_id,
    artistName: row.artist_name,
    albumId: row.album_id,
    albumName: row.album_name,
    duration: row.duration,
    bpm: row.bpm,
    genre: row.genre,
    publishTime: row.publish_time,
    mood: row.mood,
    language: row.language,
    decade: row.decade,
    energy: row.energy,
    danceability: row.danceability,
    tags: row.tags ? JSON.parse(row.tags) : null,
    name: row.name,
  };
}

function getAllSongs(limit = 500) {
  const results = query(`SELECT * FROM song_features ORDER BY updated_at DESC LIMIT ?`, [limit]);
  return results.map(normalizeSong);
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
  getUserEventsForSong,
  deleteUserSongEvents,
  getUserPlayedSongs,
  getUserLikedSongs,
  getUserSkippedSongs,
  getUserSkippedSongsWithDetails,
  saveSong,
  saveSongs,
  getSong,
  getSongs,
  getAllSongs,
  getUserProfile,
  updateUserProfile,
  getUserStats,
};
