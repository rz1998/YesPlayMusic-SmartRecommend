/**
 * API 集成测试
 *
 * 测试所有 HTTP 端点的行为正确性（实际启动服务器）：
 * 1. 事件记录 API（play/skip/like/unlike）
 * 2. 推荐 API（/recommend, /similar, /debug）
 * 3. 用户画像 API（/profile, /sync-songs）
 * 4. 输入校验（userId 长度、songId 必填）
 * 5. like toggle 双向状态
 */

const path = require('path');
const fs = require('fs');

// ─── 设置测试数据库路径（在任何 require 之前）────────────────────────────
const TEST_DB_DIR = path.join(__dirname, '../data_api_test');

// 清理旧测试数据库目录
if (fs.existsSync(TEST_DB_DIR)) fs.rmSync(TEST_DB_DIR, { recursive: true });
fs.mkdirSync(TEST_DB_DIR, { recursive: true });

// 设置环境变量（必须在 require 之前，因为 db.js 在模块级别读取）
process.env.RECOMMENDER_DB_DIR = TEST_DB_DIR;
// RECOMMENDER_DB_FILE 使用默认值 'recommender.db'（在 db.js 中拼接到 DATA_DIR）

// 启动独立测试服务器
const app = require('../server');
const db = require('../models/db');

let baseURL;
let server;

beforeAll(async () => {
  // 初始化数据库
  await db.initialize();
  // 启动服务器（使用端口 0 让系统分配）
  server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      resolve(s);
    }).on('error', reject);
  });
  const { port } = server.address();
  baseURL = `http://127.0.0.1:${port}`;
  console.log(`Test server running on port ${port}`);
});

afterAll(async () => {
  await new Promise(r => server.close(r));
  // 清理测试数据库目录
  if (fs.existsSync(TEST_DB_DIR)) fs.rmSync(TEST_DB_DIR, { recursive: true });
});

// ─── HTTP 辅助 ─────────────────────────────────────────────────────────

function req(method, pathStr, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathStr, baseURL);
    const opts = {
      method,
      hostname: '127.0.0.1',
      port: server.address().port,
      path: url.pathname + url.search,
      headers: {},
    };
    if (body) opts.headers['Content-Type'] = 'application/json';
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let json;
        try { json = JSON.parse(data); } catch { json = data; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const http = require('http');
function get(path) { return req('GET', path); }
function post(path, body) { return req('POST', path, body); }
function del(path) { return req('DELETE', path); }

// ─── 测试用例 ────────────────────────────────────────────────────────────────

describe('API - 事件记录', () => {

  describe('POST /api/event/play', () => {
    test('正常记录播放', async () => {
      const res = await post('/api/event/play', { userId: 'u1', songId: 's1', duration: 120, completed: true });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.id).toBeDefined();
    });

    test('缺少 userId → 400', async () => {
      const res = await post('/api/event/play', { songId: 's1' });
      expect(res.status).toBe(400);
    });

    test('userId 超过128字符 → 400', async () => {
      const longId = 'x'.repeat(129);
      const res = await post('/api/event/play', { userId: longId, songId: 's1' });
      expect(res.status).toBe(400);
    });

    test('缺少 songId → 400', async () => {
      const res = await post('/api/event/play', { userId: 'u1' });
      expect(res.status).toBe(400);
    });

    test('completed=false 正确记录', async () => {
      const res = await post('/api/event/play', { userId: 'u2', songId: 's2', duration: 60, completed: false });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('POST /api/event/skip', () => {
    test('正常记录跳过', async () => {
      const res = await post('/api/event/skip', { userId: 'u1', songId: 's1', skipTime: 10, songDuration: 180 });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('缺少 songId → 400', async () => {
      const res = await post('/api/event/skip', { userId: 'u1' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/event/like (toggle)', () => {
    test('首次点赞 → action=liked', async () => {
      const res = await post('/api/event/like', { userId: 'u_like1', songId: 's_like1' });
      expect(res.status).toBe(200);
      expect(res.body.action).toBe('liked');
    });

    test('再次点赞（toggle）→ action=unliked', async () => {
      await post('/api/event/like', { userId: 'u_toggle', songId: 's_toggle' });
      const res = await post('/api/event/like', { userId: 'u_toggle', songId: 's_toggle' });
      expect(res.status).toBe(200);
      expect(res.body.action).toBe('unliked');
    });

    test('取消后再点赞 → action=liked', async () => {
      await post('/api/event/like', { userId: 'u_reopen', songId: 's_reopen' });
      await post('/api/event/like', { userId: 'u_reopen', songId: 's_reopen' });
      const res = await post('/api/event/like', { userId: 'u_reopen', songId: 's_reopen' });
      expect(res.status).toBe(200);
      expect(res.body.action).toBe('liked');
    });

    test('缺少 userId → 400', async () => {
      const res = await post('/api/event/like', { songId: 's1' });
      expect(res.status).toBe(400);
    });

    test('缺少 songId → 400', async () => {
      const res = await post('/api/event/like', { userId: 'u1' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/event/unlike', () => {
    test('正常记录 unlike', async () => {
      const res = await post('/api/event/unlike', { userId: 'u_unlike', songId: 's_unlike' });
      expect(res.status).toBe(200);
      expect(res.body.action).toBe('unliked');
    });

    test('缺少 songId → 400', async () => {
      const res = await post('/api/event/unlike', { userId: 'u1' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/event/history/:userId', () => {
    test('返回用户事件历史', async () => {
      await post('/api/event/play', { userId: 'u_hist', songId: 's1', duration: 100, completed: true });
      await post('/api/event/like', { userId: 'u_hist', songId: 's2' });
      const res = await get('/api/event/history/u_hist');
      expect(res.status).toBe(200);
      expect(res.body.events).toBeDefined();
      expect(Array.isArray(res.body.events)).toBe(true);
    });

    test('type 过滤有效', async () => {
      await post('/api/event/play', { userId: 'u_hist2', songId: 's1', duration: 100, completed: true });
      await post('/api/event/like', { userId: 'u_hist2', songId: 's2' });
      const res = await get('/api/event/history/u_hist2?type=like');
      expect(res.status).toBe(200);
      expect(res.body.events.every(e => e.eventType === 'like')).toBe(true);
    });
  });

  describe('GET /api/event/liked/:userId', () => {
    test('返回被喜欢的歌曲 ID 列表', async () => {
      await post('/api/event/like', { userId: 'u_liked', songId: 'songA' });
      await post('/api/event/like', { userId: 'u_liked', songId: 'songB' });
      const res = await get('/api/event/liked/u_liked');
      expect(res.status).toBe(200);
      expect(res.body.likedSongIds).toContain('songA');
      expect(res.body.likedSongIds).toContain('songB');
    });

    test('songIds 查询参数有效', async () => {
      await post('/api/event/like', { userId: 'u_liked2', songId: 'songX' });
      const res = await get('/api/event/liked/u_liked2?songIds=songX,songY');
      expect(res.status).toBe(200);
      expect(res.body.likedSongIds).toContain('songX');
      expect(res.body.likedSongIds).not.toContain('songY');
    });
  });
});

describe('API - 推荐系统', () => {

  describe('GET /api/recommend', () => {
    test('正常返回推荐结果', async () => {
      // 先同步一首歌曲特征到数据库（确保候选池非空）
      await post('/api/event/sync-songs', {
        songs: [{ id: 'candidate1', artistId: 'A1', artistName: 'Artist A', name: 'Candidate 1', genre: 'pop' }],
        userId: 'u_rec',
      });
      const res = await get('/api/recommend?userId=u_rec&limit=5');
      expect(res.status).toBe(200);
      expect(res.body.recommendations).toBeDefined();
      expect(Array.isArray(res.body.recommendations)).toBe(true);
    });

    test('缺少 userId → 400', async () => {
      const res = await get('/api/recommend');
      expect(res.status).toBe(400);
    });

    test('userId 超过128字符 → 400', async () => {
      const res = await get('/api/recommend?userId=' + 'x'.repeat(129));
      expect(res.status).toBe(400);
    });

    test('limit 参数有效', async () => {
      await post('/api/event/sync-songs', {
        songs: Array.from({ length: 10 }, (_, i) => ({
          id: `c${i}`, artistId: 'A', artistName: 'Artist', name: `Song ${i}`, genre: 'pop'
        })),
        userId: 'u_limit',
      });
      const res = await get('/api/recommend?userId=u_limit&limit=3');
      expect(res.status).toBe(200);
      expect(res.body.recommendations.length).toBeLessThanOrEqual(3);
    });

    test('refresh=true 跳过缓存', async () => {
      await post('/api/event/sync-songs', {
        songs: [{ id: 'c1', artistId: 'A', artistName: 'Artist', name: 'Song', genre: 'pop' }],
        userId: 'u_refresh',
      });
      // 第一次请求（填充缓存）
      await get('/api/recommend?userId=u_refresh');
      // 第二次请求（refresh=true）
      const res = await get('/api/recommend?userId=u_refresh&refresh=true');
      expect(res.status).toBe(200);
      // meta.cached 应该为 false
      expect(res.body.meta.cached).toBe(false);
    });

    test('冷启动用户（无任何事件）返回降级结果', async () => {
      const res = await get('/api/recommend?userId=u_cold');
      expect(res.status).toBe(200);
      expect(res.body.recommendations).toBeDefined();
    });
  });

  describe('GET /api/recommend/similar/:songId', () => {
    beforeAll(async () => {
      await post('/api/user/sync-songs', {
        songs: [
          { id: 'sim_base', artistId: 'SA', artistName: 'Similar Artist', name: 'Base Song', genre: 'jazz', bpm: 120 },
          { id: 'sim_like1', artistId: 'SA', artistName: 'Similar Artist', name: 'Like Song 1', genre: 'jazz', bpm: 118 },
          { id: 'sim_different', artistId: 'Other', artistName: 'Other Artist', name: 'Different', genre: 'rock', bpm: 200 },
        ],
        userId: 'u_sim',
      });
    });

    test('返回相似歌曲', async () => {
      const res = await get('/api/recommend/similar/sim_base?limit=5');
      expect(res.status).toBe(200);
      expect(res.body.similarSongs).toBeDefined();
      expect(res.body.similarSongs.length).toBeGreaterThan(0);
    });

    test('不存在的歌曲 → 404', async () => {
      const res = await get('/api/recommend/similar/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/recommend/debug', () => {
    test('正常返回偏好向量', async () => {
      await post('/api/event/like', { userId: 'u_debug', songId: 's_debug' });
      const res = await get('/api/recommend/debug?userId=u_debug');
      expect(res.status).toBe(200);
      expect(res.body.likeVector).toBeDefined();
    });

    test('缺少 userId → 400', async () => {
      const res = await get('/api/recommend/debug');
      expect(res.status).toBe(400);
    });
  });
});

describe('API - 用户画像 & 同步', () => {

  describe('GET /api/user/profile/:userId', () => {
    test('返回用户统计', async () => {
      await post('/api/event/play', { userId: 'u_profile', songId: 'sp1', duration: 100, completed: true });
      await post('/api/event/skip', { userId: 'u_profile', songId: 'ss1', skipTime: 5, songDuration: 180 });
      await post('/api/event/like', { userId: 'u_profile', songId: 'sl1' });
      await post('/api/event/sync-songs', {
        songs: [
          { id: 'sp1', artistId: 'A1', artistName: 'Artist One', name: 'Song 1', genre: 'pop' },
          { id: 'ss1', artistId: 'A2', artistName: 'Artist Two', name: 'Skipped Song', genre: 'rock' },
        ],
        userId: 'u_profile',
      });
      const res = await get('/api/user/profile/u_profile');
      expect(res.status).toBe(200);
      expect(res.body.statistics.totalPlays).toBe(1);
      expect(res.body.statistics.totalSkips).toBe(1);
      expect(res.body.statistics.totalLikes).toBe(1);
    });
  });

  describe('POST /api/user/sync-song', () => {
    test('正常保存歌曲特征', async () => {
      const res = await post('/api/user/sync-song', {
        songId: 'sync_single',
        userId: 'u_sync',
        artistId: 'SA',
        artistName: 'Sync Artist',
        name: 'Synced Song',
        genre: 'electronic',
        bpm: 128,
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('songId 超过64字符 → 400', async () => {
      const res = await post('/api/user/sync-song', {
        songId: 'x'.repeat(65),
        userId: 'u1',
      });
      expect(res.status).toBe(400);
    });

    test('songId 缺失 → 400', async () => {
      const res = await post('/api/user/sync-song', { userId: 'u1' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/user/sync-songs', () => {
    test('批量同步歌曲', async () => {
      const res = await post('/api/user/sync-songs', {
        songs: [
          { id: 'bulk1', artistId: 'BA1', artistName: 'Bulk Artist 1', name: 'Bulk Song 1', genre: 'pop' },
          { id: 'bulk2', artistId: 'BA2', artistName: 'Bulk Artist 2', name: 'Bulk Song 2', genre: 'rock' },
        ],
        userId: 'u_bulk',
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(2);
    });

    test('超过 MAX_BATCH_SIZE=500 自动截断', async () => {
      const songs = Array.from({ length: 600 }, (_, i) => ({
        id: `big${i}`, artistId: 'A', artistName: 'Artist', name: `Song ${i}`, genre: 'pop'
      }));
      const res = await post('/api/user/sync-songs', { songs, userId: 'u_big' });
      expect(res.status).toBe(200);
      expect(res.body.truncated).toBe(true);
      expect(res.body.count).toBe(500);
    });

    test('recordLikes=true 时记录 like 事件', async () => {
      const res = await post('/api/user/sync-songs', {
        songs: [
          { id: 'like_sync1', artistId: 'LA1', artistName: 'Like Artist', name: 'Like Sync 1', genre: 'jazz' },
          { id: 'like_sync2', artistId: 'LA2', artistName: 'Like Artist 2', name: 'Like Sync 2', genre: 'pop' },
        ],
        userId: 'u_like_sync',
        recordLikes: true,
      });
      expect(res.status).toBe(200);
      expect(res.body.likesRecorded).toBe(2);
    });

    test('songs 非数组 → 400', async () => {
      const res = await post('/api/user/sync-songs', { songs: 'not an array', userId: 'u1' });
      expect(res.status).toBe(400);
    });

    test('缺少 userId → 400', async () => {
      const res = await post('/api/user/sync-songs', { songs: [{ id: 's1' }] });
      expect(res.status).toBe(400);
    });
  });
});
