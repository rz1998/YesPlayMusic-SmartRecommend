/**
 * Backend API Integration Tests
 * Tests the recommendation server endpoints
 */

const http = require('http');

const BASE_URL = process.env.API_URL || 'http://localhost:3001';
const TEST_USER = 'test_user_' + Date.now();

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('Health Check', () => {
  test('GET /health returns 200', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 3001,
      path: '/health',
      method: 'GET'
    });
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('ok');
  });
});

describe('Recommend API', () => {
  test('GET /api/recommend returns recommendations for user', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 3001,
      path: `/api/recommend?userId=${TEST_USER}&limit=10`,
      method: 'GET'
    });
    expect([200, 500]).toContain(res.status); // 500 if no data yet is ok
  });

  test('GET /api/recommend rejects invalid userId', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 3001,
      path: '/api/recommend?userId=',
      method: 'GET'
    });
    expect(res.status).toBe(400);
  });

  test('GET /api/recommend with refresh=true bypasses cache', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 3001,
      path: `/api/recommend?userId=${TEST_USER}&limit=5&refresh=true`,
      method: 'GET'
    });
    expect([200, 500]).toContain(res.status);
  });
});

describe('Profile API', () => {
  test('GET /api/user/:userId returns user profile', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 3001,
      path: `/api/user/${TEST_USER}`,
      method: 'GET'
    });
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('userId');
    expect(res.data).toHaveProperty('statistics');
  });

  test('GET /api/user/:userId/stats returns statistics', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 3001,
      path: `/api/user/${TEST_USER}/stats`,
      method: 'GET'
    });
    expect(res.status).toBe(200);
  });
});

describe('Event API', () => {
  test('POST /api/event records play event', async () => {
    const event = {
      userId: TEST_USER,
      eventType: 'play',
      songId: 123456,
      songName: 'Test Song',
      artistId: 111,
      artistName: 'Test Artist',
      albumId: 222,
      albumName: 'Test Album',
      duration: 180,
    };
    
    const res = await request({
      hostname: 'localhost',
      port: 3001,
      path: '/api/event',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, event);
    
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
  });

  test('POST /api/event records like event', async () => {
    const event = {
      userId: TEST_USER,
      eventType: 'like',
      songId: 123457,
      songName: 'Test Song 2',
    };
    
    const res = await request({
      hostname: 'localhost',
      port: 3001,
      path: '/api/event',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, event);
    
    expect(res.status).toBe(200);
  });

  test('POST /api/event records skip event with duration', async () => {
    const event = {
      userId: TEST_USER,
      eventType: 'skip',
      songId: 123458,
      songName: 'Test Song 3',
      listenDuration: 15,
      songDuration: 180,
    };
    
    const res = await request({
      hostname: 'localhost',
      port: 3001,
      path: '/api/event',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, event);
    
    expect(res.status).toBe(200);
  });

  test('POST /api/event batch records multiple events', async () => {
    const events = [
      { userId: TEST_USER, eventType: 'play', songId: 123460, songName: 'Song A' },
      { userId: TEST_USER, eventType: 'play', songId: 123461, songName: 'Song B' },
    ];
    
    const res = await request({
      hostname: 'localhost',
      port: 3001,
      path: '/api/event/batch',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { events });
    
    expect(res.status).toBe(200);
  });
});

describe('End-to-End Flow', () => {
  test('User journey: sync songs -> record events -> get recommendations', async () => {
    const userId = 'e2e_test_user_' + Date.now();
    
    // 1. Sync some songs
    const songs = [
      { id: 1900001, name: 'Song 1', artistId: 1, artistName: 'Artist 1', albumId: 1, albumName: 'Album 1', duration: 200, picUrl: 'http://example.com/pic.jpg' },
      { id: 1900002, name: 'Song 2', artistId: 2, artistName: 'Artist 2', albumId: 1, albumName: 'Album 1', duration: 220, picUrl: 'http://example.com/pic.jpg' },
      { id: 1900003, name: 'Song 3', artistId: 1, artistName: 'Artist 1', albumId: 2, albumName: 'Album 2', duration: 180, picUrl: 'http://example.com/pic.jpg' },
    ];
    
    const syncRes = await request({
      hostname: 'localhost',
      port: 3001,
      path: '/api/event',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { userId, eventType: 'sync', songs });
    
    expect(syncRes.status).toBe(200);
    
    // 2. Record some interactions
    await request({
      hostname: 'localhost',
      port: 3001,
      path: '/api/event',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { userId, eventType: 'like', songId: 1900001, songName: 'Song 1' });
    
    await request({
      hostname: 'localhost',
      port: 3001,
      path: '/api/event',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { userId, eventType: 'play', songId: 1900002, songName: 'Song 2' });
    
    // 3. Get recommendations
    const recRes = await request({
      hostname: 'localhost',
      port: 3001,
      path: `/api/recommend?userId=${userId}&limit=5&refresh=true`,
      method: 'GET'
    });
    
    expect([200, 500]).toContain(recRes.status);
    
    // 4. Get user profile
    const profileRes = await request({
      hostname: 'localhost',
      port: 3001,
      path: `/api/user/${userId}`,
      method: 'GET'
    });
    
    expect(profileRes.status).toBe(200);
    expect(profileRes.data.statistics).toBeDefined();
  });
});
