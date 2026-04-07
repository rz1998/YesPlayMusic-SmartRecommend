const express = require('express');
const router = express.Router();
const { getDb } = require('../models/db');
const { computeSimilarity } = require('../services/recommender');

// Get personalized recommendations
router.get('/', async (req, res) => {
  const { userId, limit = 20, excludePlayed = true } = req.query;
  
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  const db = getDb();
  
  try {
    // 1. Get user's like history (songs played completely and liked)
    const likedSongs = db.prepare(`
      SELECT DISTINCT e.song_id, sf.* 
      FROM user_events e
      LEFT JOIN song_features sf ON e.song_id = sf.song_id
      WHERE e.user_id = ? 
        AND (e.event_type = 'like' OR (e.event_type = 'play' AND e.completed = 1))
      ORDER BY e.created_at DESC
      LIMIT 100
    `).all(userId);
    
    // 2. Get user's skip history
    const skippedSongs = db.prepare(`
      SELECT DISTINCT song_id 
      FROM user_events 
      WHERE user_id = ? AND event_type = 'skip'
      LIMIT 100
    `).all(userId);
    
    const skippedIds = skippedSongs.map(s => s.song_id);
    
    // 3. Calculate user preference vector (weighted by frequency)
    const likeVector = computePreferenceVector(likedSongs, 'like');
    const skipVector = computePreferenceVector(skippedSongs.map(s => ({ song_id: s.song_id })), 'skip');
    
    // 4. Get candidate songs (recent releases + popular)
    let candidates;
    if (excludePlayed && likedSongs.length > 0) {
      const playedIds = likedSongs.map(s => s.song_id);
      candidates = db.prepare(`
        SELECT * FROM song_features 
        WHERE song_id NOT IN (${playedIds.map(() => '?').join(',')})
        ORDER BY publish_time DESC
        LIMIT 500
      `).all(...playedIds);
    } else {
      candidates = db.prepare(`
        SELECT * FROM song_features 
        ORDER BY publish_time DESC
        LIMIT 500
      `).all();
    }
    
    // 5. Score candidates
    const scoredCandidates = candidates
      .filter(song => !skippedIds.includes(song.song_id)) // Exclude skipped
      .map(song => {
        const songVec = song.features_vector ? JSON.parse(song.features_vector) : extractFeatures(song);
        const likeScore = computeSimilarity(likeVector, songVec);
        const skipScore = computeSimilarity(skipVector, songVec);
        
        // Final score = like_score - α * skip_score
        const DISLIKE_WEIGHT = 0.5;
        const finalScore = likeScore - DISLIKE_WEIGHT * skipScore;
        
        return {
          ...song,
          score: finalScore,
          likeScore,
          skipScore
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, parseInt(limit));
    
    res.json({
      recommendations: scoredCandidates,
      meta: {
        userId,
        totalCandidates: candidates.length,
        likedCount: likedSongs.length,
        skippedCount: skippedSongs.length
      }
    });
    
  } catch (error) {
    console.error('Recommendation error:', error);
    res.status(500).json({ error: 'Failed to generate recommendations' });
  }
});

// Helper: Extract features from song (simple version)
function extractFeatures(song) {
  return {
    artistId: song.artist_id || 0,
    albumId: song.album_id || 0,
    duration: song.duration || 0,
    bpm: song.bpm || 0,
    genre: song.genre || 'unknown',
    publishTime: song.publish_time || 0
  };
}

// Helper: Compute preference vector from song list
function computePreferenceVector(songs, eventType) {
  if (songs.length === 0) return null;
  
  const weights = {
    play: 1,
    like: 3,
    skip: -1
  };
  
  const vector = {
    artistFreq: {},
    genreFreq: {},
    totalBpm: 0,
    totalDuration: 0,
    count: 0
  };
  
  songs.forEach(song => {
    const weight = weights[eventType] || 1;
    
    if (song.artist_id) {
      vector.artistFreq[song.artist_id] = (vector.artistFreq[song.artist_id] || 0) + weight;
    }
    if (song.genre) {
      vector.genreFreq[song.genre] = (vector.genreFreq[song.genre] || 0) + weight;
    }
    if (song.bpm) {
      vector.totalBpm += song.bpm * weight;
    }
    if (song.duration) {
      vector.totalDuration += song.duration * weight;
    }
    vector.count += weight;
  });
  
  // Normalize
  if (vector.count > 0) {
    vector.avgBpm = vector.totalBpm / vector.count;
    vector.avgDuration = vector.totalDuration / vector.count;
  }
  
  return vector;
}

// Similar songs (based on a given song)
router.get('/similar/:songId', (req, res) => {
  const { songId } = req.params;
  const { limit = 10 } = req.query;
  
  const db = getDb();
  
  const targetSong = db.prepare(`
    SELECT * FROM song_features WHERE song_id = ?
  `).get(songId);
  
  if (!targetSong) {
    return res.status(404).json({ error: 'Song not found' });
  }
  
  const allSongs = db.prepare(`
    SELECT * FROM song_features WHERE song_id != ?
    LIMIT 200
  `).all(songId);
  
  const targetVec = extractFeatures(targetSong);
  const similarSongs = allSongs
    .map(song => {
      const songVec = extractFeatures(song);
      return {
        ...song,
        similarity: computeSimilarity(targetVec, songVec)
      };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, parseInt(limit));
  
  res.json({ similarSongs });
});

module.exports = router;
