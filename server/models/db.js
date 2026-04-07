/**
 * Simple JSON-based database for recommendations
 * Replaces SQLite for easier deployment
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '../data');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const SONGS_FILE = path.join(DATA_DIR, 'songs.json');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize files if they don't exist
function initFiles() {
  if (!fs.existsSync(EVENTS_FILE)) {
    fs.writeFileSync(EVENTS_FILE, JSON.stringify([]));
  }
  if (!fs.existsSync(SONGS_FILE)) {
    fs.writeFileSync(SONGS_FILE, JSON.stringify({}));
  }
  if (!fs.existsSync(PROFILES_FILE)) {
    fs.writeFileSync(PROFILES_FILE, JSON.stringify({}));
  }
}

initFiles();

// Helper functions
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Event operations
function addEvent(userId, songId, eventType, duration = 0, completed = false) {
  const events = readJson(EVENTS_FILE);
  const newEvent = {
    id: uuidv4(),
    userId,
    songId,
    eventType,
    duration,
    completed: completed ? 1 : 0,
    createdAt: new Date().toISOString(),
  };
  events.unshift(newEvent); // Add to beginning
  // Keep only last 10000 events
  if (events.length > 10000) {
    events.pop();
  }
  writeJson(EVENTS_FILE, events);
  return newEvent;
}

function getUserEvents(userId, eventType = null, limit = 100) {
  const events = readJson(EVENTS_FILE);
  let filtered = events.filter(e => e.userId === userId);
  if (eventType) {
    filtered = filtered.filter(e => e.eventType === eventType);
  }
  return filtered.slice(0, limit);
}

function getUserLikedSongs(userId, limit = 100) {
  const events = readJson(EVENTS_FILE);
  const likedSongIds = new Set();
  const result = [];
  
  for (const e of events) {
    if (e.userId !== userId) continue;
    if (e.eventType === 'like' && !likedSongIds.has(e.songId)) {
      likedSongIds.add(e.songId);
      result.push(e.songId);
      if (result.length >= limit) break;
    }
  }
  return result;
}

function getUserSkippedSongs(userId, limit = 100) {
  const events = readJson(EVENTS_FILE);
  const skippedSongIds = new Set();
  const result = [];
  
  for (const e of events) {
    if (e.userId !== userId) continue;
    if (e.eventType === 'skip' && !skippedSongIds.has(e.songId)) {
      skippedSongIds.add(e.songId);
      result.push(e.songId);
      if (result.length >= limit) break;
    }
  }
  return result;
}

// Song operations
function saveSong(song) {
  const songs = readJson(SONGS_FILE);
  songs[song.songId] = {
    ...song,
    updatedAt: new Date().toISOString(),
  };
  writeJson(SONGS_FILE, songs);
}

function saveSongs(songsArray) {
  const songs = readJson(SONGS_FILE);
  for (const song of songsArray) {
    songs[song.songId] = {
      ...song,
      updatedAt: new Date().toISOString(),
    };
  }
  writeJson(SONGS_FILE, songs);
}

function getSong(songId) {
  const songs = readJson(SONGS_FILE);
  return songs[songId] || null;
}

function getSongs(songIds) {
  const songs = readJson(SONGS_FILE);
  return songIds.map(id => songs[id]).filter(Boolean);
}

function getAllSongs(limit = 500) {
  const songs = readJson(SONGS_FILE);
  return Object.values(songs).slice(0, limit);
}

// User profile operations
function getUserProfile(userId) {
  const profiles = readJson(PROFILES_FILE);
  return profiles[userId] || null;
}

function updateUserProfile(userId, updates) {
  const profiles = readJson(PROFILES_FILE);
  profiles[userId] = {
    ...profiles[userId],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  writeJson(PROFILES_FILE, profiles);
}

// Statistics
function getUserStats(userId) {
  const events = readJson(EVENTS_FILE);
  const userEvents = events.filter(e => e.userId === userId);
  
  const stats = {
    play: { count: 0, totalDuration: 0 },
    skip: { count: 0, totalDuration: 0 },
    like: { count: 0 },
  };
  
  for (const e of userEvents) {
    if (stats[e.eventType]) {
      stats[e.eventType].count++;
      if (e.duration) {
        stats[e.eventType].totalDuration += e.duration;
      }
    }
  }
  
  return stats;
}

module.exports = {
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
