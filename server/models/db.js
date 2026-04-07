const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/recommender.db');

let db = null;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initTables();
  }
  return db;
}

function initTables() {
  // User events table (play, skip, like)
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      song_id INTEGER NOT NULL,
      event_type TEXT NOT NULL CHECK(event_type IN ('play', 'skip', 'like')),
      duration INTEGER DEFAULT 0,
      completed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Song features table
  db.exec(`
    CREATE TABLE IF NOT EXISTS song_features (
      song_id INTEGER PRIMARY KEY,
      artist_id INTEGER,
      artist_name TEXT,
      album_id INTEGER,
      album_name TEXT,
      duration INTEGER,
      bpm INTEGER,
      genre TEXT,
      publish_time INTEGER,
      features_vector TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // User profiles table
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY,
      like_vector TEXT,
      dislike_vector TEXT,
      play_count INTEGER DEFAULT 0,
      skip_count INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Indexes for performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_user ON user_events(user_id);
    CREATE INDEX IF NOT EXISTS idx_events_song ON user_events(song_id);
    CREATE INDEX IF NOT EXISTS idx_events_type ON user_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_events_time ON user_events(created_at);
  `);
}

module.exports = { getDb };
