/**
 * Compute similarity between two feature vectors
 * Returns a score between -1 and 1 (higher = more similar)
 */
function computeSimilarity(vec1, vec2) {
  if (!vec1 || !vec2) return 0;
  
  let score = 0;
  let weights = 0;
  
  // Artist similarity (0 or 1)
  if (vec1.artistId && vec2.artistId) {
    if (vec1.artistId === vec2.artistId) {
      score += 1.0;
    }
    weights += 1.0;
  }
  
  // Genre similarity (0 or 1)
  if (vec1.genre && vec2.genre) {
    if (vec1.genre === vec2.genre) {
      score += 0.8;
    }
    weights += 0.8;
  }
  
  // BPM similarity (normalized distance)
  if (vec1.avgBpm && vec2.bpm) {
    const bpmDiff = Math.abs(vec1.avgBpm - vec2.bpm);
    const bpmSimilarity = Math.max(0, 1 - bpmDiff / 50); // Within 50 BPM = similar
    score += bpmSimilarity * 0.3;
    weights += 0.3;
  }
  
  // Duration similarity
  if (vec1.avgDuration && vec2.duration) {
    const durDiff = Math.abs(vec1.avgDuration - vec2.duration);
    const durSimilarity = Math.max(0, 1 - durDiff / 120); // Within 2 min = similar
    score += durSimilarity * 0.2;
    weights += 0.2;
  }
  
  // Normalize to -1 to 1 range
  if (weights === 0) return 0;
  
  return (score / weights) * 2 - 1; // Normalize to [-1, 1]
}

/**
 * Compute preference vector from play history
 */
function computePreferenceVector(events, featuresMap) {
  const vector = {
    artistFreq: {},
    genreFreq: {},
    bpmSum: 0,
    durationSum: 0,
    count: 0
  };
  
  events.forEach(event => {
    const song = featuresMap[event.songId];
    if (!song) return;
    
    const weight = event.eventType === 'like' ? 3 : (event.eventType === 'skip' ? -1 : 1);
    
    if (song.artistId) {
      vector.artistFreq[song.artistId] = (vector.artistFreq[song.artistId] || 0) + weight;
    }
    
    if (song.genre) {
      vector.genreFreq[song.genre] = (vector.genreFreq[song.genre] || 0) + weight;
    }
    
    if (song.bpm) {
      vector.bpmSum += song.bpm * Math.abs(weight);
    }
    
    if (song.duration) {
      vector.durationSum += song.duration * Math.abs(weight);
    }
    
    vector.count += Math.abs(weight);
  });
  
  if (vector.count > 0) {
    vector.avgBpm = vector.bpmSum / vector.count;
    vector.avgDuration = vector.durationSum / vector.count;
  }
  
  return vector;
}

// Note: This module contains legacy helper functions.
// The main recommendation logic is in ../api/recommend.js

module.exports = {
  computeSimilarity,
  computePreferenceVector,
};
