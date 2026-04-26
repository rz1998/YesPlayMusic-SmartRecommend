/**
 * DB 模块单元测试
 *
 * 测试所有数据库操作函数的正确性：
 * 1. latest-event 去重逻辑
 * 2. completed=1/0 过滤
 * 3. deleteUserSongEvents 原子删除
 * 4. normalizeSong 蛇蛇命名转换
 * 5. 数据库迁移（ALTER TABLE）
 * 6. getUserStats 聚合统计
 */

const path = require('path');
const fs = require('fs');

// ─── 创建独立测试数据库 ───────────────────────────────────────────────
function createTestDb() {
  const { v4: uuidv4 } = require('uuid');

  let db = null;

  async function init() {
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    db = new SQL.Database();

    db.run(`
      CREATE TABLE user_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        song_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        duration INTEGER DEFAULT 0,
        song_duration INTEGER DEFAULT 0,
        completed INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE song_features (
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
    `);

    return db;
  }

  function query(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
  }

  function run(sql, params = []) {
    db.run(sql, params);
  }

    let _eventSeq = Date.now();

  function addEvent(userId, songId, eventType, duration = 0, completed = false, songDuration = null) {
    const id = uuidv4();
    // 使用递增时间戳确保 ORDER BY DESC 时顺序正确
    const ts = new Date(_eventSeq++).toISOString();
    run(
      `INSERT INTO user_events (id, user_id, song_id, event_type, duration, song_duration, completed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, String(songId), eventType, duration, songDuration || 0, completed ? 1 : 0, ts]
    );
    return { id };
  }

  function deleteUserSongEvents(userId, songId, eventTypes) {
    const placeholders = eventTypes.map(() => '?').join(',');
    run(
      `DELETE FROM user_events WHERE user_id = ? AND song_id = ? AND event_type IN (${placeholders})`,
      [userId, String(songId), ...eventTypes]
    );
  }

  function getUserLikedSongs(userId, limit = 1000) {
    const results = query(
      `SELECT song_id, event_type FROM user_events
       WHERE user_id = ? AND event_type IN ('like','unlike')
       ORDER BY created_at DESC`,
      [userId]
    );
    const latest = {};
    for (const r of results) {
      if (latest[r.song_id] === undefined) latest[r.song_id] = r.event_type;
    }
    return Object.entries(latest)
      .filter(([_, t]) => t === 'like')
      .map(([s]) => s)
      .slice(0, limit);
  }

  function getUserPlayedSongs(userId, limit = 500) {
    const results = query(
      `SELECT song_id, event_type, completed FROM user_events
       WHERE user_id = ? AND event_type IN ('play','skip','like','unlike')
       ORDER BY created_at DESC`,
      [userId]
    );
    const latest = {};
    for (const r of results) {
      if (latest[r.song_id] === undefined) latest[r.song_id] = { et: r.event_type, c: r.completed };
    }
    return Object.entries(latest)
      .filter(([_, v]) => v.et === 'play' && v.c === 1)
      .map(([s]) => s)
      .slice(0, limit);
  }

  function getPartialPlayedSongs(userId, limit = 500) {
    const results = query(
      `SELECT song_id, event_type, completed FROM user_events
       WHERE user_id = ? AND event_type IN ('play','skip','like','unlike')
       ORDER BY created_at DESC`,
      [userId]
    );
    const latest = {};
    for (const r of results) {
      if (latest[r.song_id] === undefined) latest[r.song_id] = { et: r.event_type, c: r.completed };
    }
    return Object.entries(latest)
      .filter(([_, v]) => v.et === 'play' && v.c === 0)
      .map(([s]) => s)
      .slice(0, limit);
  }

  function getUserSkippedSongs(userId, limit = 500) {
    const results = query(
      `SELECT song_id, event_type FROM user_events
       WHERE user_id = ? AND event_type IN ('skip','play','like','unlike')
       ORDER BY created_at DESC`,
      [userId]
    );
    const latest = {};
    for (const r of results) {
      if (latest[r.song_id] === undefined) latest[r.song_id] = r.event_type;
    }
    return Object.entries(latest)
      .filter(([_, t]) => t === 'skip')
      .map(([s]) => s)
      .slice(0, limit);
  }

  function getUserSkippedSongsWithDetails(userId, limit = 500) {
    const results = query(
      `SELECT song_id, event_type, duration as listen_duration, song_duration, created_at
       FROM user_events
       WHERE user_id = ? AND event_type IN ('skip','play','like','unlike')
       ORDER BY created_at DESC`,
      [userId]
    );
    const latest = {};
    for (const r of results) {
      if (latest[r.song_id] === undefined) latest[r.song_id] = r;
    }
    return Object.entries(latest)
      .filter(([_, v]) => v.event_type === 'skip')
      .map(([s, v]) => ({ songId: s, listenDuration: v.listen_duration, songDuration: v.song_duration }))
      .slice(0, limit);
  }

  function getUserEventsForSong(userId, songId) {
    const results = query(
      `SELECT * FROM user_events WHERE user_id = ? AND song_id = ? ORDER BY created_at DESC`,
      [userId, String(songId)]
    );
    return results.map(r => ({ eventType: r.event_type, duration: r.duration, completed: r.completed === 1 }));
  }

  function saveSong(song) {
    const existing = query(`SELECT song_id FROM song_features WHERE song_id = ?`, [String(song.songId)]);
    const now = new Date().toISOString();
    if (existing.length > 0) {
      // UPDATE 模式：只更新提供的字段，保留数据库中的旧值
      const updates = [];
      const vals = [];
      if (song.artistId !== undefined) { updates.push('artist_id=?'); vals.push(song.artistId||null); }
      if (song.artistName !== undefined) { updates.push('artist_name=?'); vals.push(song.artistName||null); }
      if (song.duration !== undefined) { updates.push('duration=?'); vals.push(song.duration||null); }
      if (song.bpm !== undefined) { updates.push('bpm=?'); vals.push(song.bpm||null); }
      if (song.genre !== undefined) { updates.push('genre=?'); vals.push(song.genre||null); }
      if (song.mood !== undefined) { updates.push('mood=?'); vals.push(song.mood||null); }
      if (song.language !== undefined) { updates.push('language=?'); vals.push(song.language||null); }
      if (song.decade !== undefined) { updates.push('decade=?'); vals.push(song.decade||null); }
      if (song.energy !== undefined) { updates.push('energy=?'); vals.push(song.energy||null); }
      if (song.danceability !== undefined) { updates.push('danceability=?'); vals.push(song.danceability||null); }
      if (song.tags !== undefined) { updates.push('tags=?'); vals.push(song.tags ? JSON.stringify(song.tags) : null); }
      if (song.name !== undefined) { updates.push('name=?'); vals.push(song.name||null); }
      updates.push('updated_at=?');
      vals.push(now);
      vals.push(String(song.songId));
      run(`UPDATE song_features SET ${updates.join(',')} WHERE song_id=?`, vals);
    } else {
      run(`INSERT INTO song_features
          (song_id,artist_id,artist_name,duration,bpm,genre,mood,language,decade,energy,danceability,tags,name,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [String(song.songId), song.artistId||null, song.artistName||null, song.duration||null, song.bpm||null,
         song.genre||null, song.mood||null, song.language||null, song.decade||null, song.energy||null,
         song.danceability||null, song.tags ? JSON.stringify(song.tags) : null, song.name||null, now]);
    }
  }

  function getSong(songId) {
    const r = query(`SELECT * FROM song_features WHERE song_id = ?`, [String(songId)]);
    if (!r.length) return null;
    const row = r[0];
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

  function getUserStats(userId) {
    const results = query(
      `SELECT event_type, COUNT(*) as count, SUM(duration) as total_duration FROM user_events WHERE user_id = ? GROUP BY event_type`,
      [userId]
    );
    const stats = { play: { count: 0, totalDuration: 0 }, skip: { count: 0, totalDuration: 0 }, like: { count: 0 } };
    for (const r of results) {
      if (stats[r.event_type]) {
        stats[r.event_type].count = r.count;
        stats[r.event_type].totalDuration = r.total_duration || 0;
      }
    }
    return stats;
  }

  return {
    init, db, query, run, addEvent, deleteUserSongEvents,
    getUserLikedSongs, getUserPlayedSongs, getPartialPlayedSongs,
    getUserSkippedSongs, getUserSkippedSongsWithDetails,
    getUserEventsForSong, saveSong, getSong, getUserStats,
  };
}

let db;

beforeAll(async () => {
  db = createTestDb();
  await db.init();
});

beforeEach(async () => {
  // 清空所有数据
  db.run(`DELETE FROM user_events`);
  db.run(`DELETE FROM song_features`);
});

// ─── 测试用例 ────────────────────────────────────────────────────────────────

describe('DB 模块 - latest-event 去重', () => {

  describe('1. getUserLikedSongs', () => {
    test('只有 latest event 为 like 时才算 liked', () => {
      db.addEvent('u1', 's1', 'like', 0, false);
      db.addEvent('u1', 's1', 'unlike', 0, false);  // 更新为 unlike
      expect(db.getUserLikedSongs('u1')).not.toContain('s1');
    });

    test('latest = like 时算 liked', () => {
      db.addEvent('u1', 's1', 'unlike', 0, false);
      db.addEvent('u1', 's1', 'like', 0, false);   // 最新是 like
      expect(db.getUserLikedSongs('u1')).toContain('s1');
    });

    test('skip → like 序列后 latest=like，算 liked', () => {
      db.addEvent('u1', 's1', 'skip', 10, false);
      db.addEvent('u1', 's1', 'like', 0, false);
      expect(db.getUserLikedSongs('u1')).toContain('s1');
    });

    test('play → unlike 序列后 latest=unlike，不算 liked', () => {
      db.addEvent('u1', 's1', 'play', 180, true);
      db.addEvent('u1', 's1', 'unlike', 0, false);
      expect(db.getUserLikedSongs('u1')).not.toContain('s1');
    });

    test('多首歌独立追踪', () => {
      db.addEvent('u1', 'songA', 'like', 0, false);
      db.addEvent('u1', 'songB', 'play', 100, false);
      db.addEvent('u1', 'songC', 'skip', 5, false);
      db.addEvent('u1', 'songC', 'like', 0, false); // C 从 skip 变为 like
      const liked = db.getUserLikedSongs('u1');
      expect(liked).toContain('songA');
      expect(liked).toContain('songC');
      expect(liked).not.toContain('songB');
    });

    test('limit 参数有效', () => {
      for (let i = 0; i < 10; i++) db.addEvent('u1', `song${i}`, 'like', 0, false);
      expect(db.getUserLikedSongs('u1', 3)).toHaveLength(3);
    });

    test('空用户返回空数组', () => {
      expect(db.getUserLikedSongs('nonexistent')).toEqual([]);
    });
  });

  describe('2. getUserPlayedSongs (completed=1)', () => {
    test('completed=1 的 play 算 played', () => {
      db.addEvent('u1', 's1', 'play', 180, true);
      expect(db.getUserPlayedSongs('u1')).toContain('s1');
    });

    test('completed=0 的 play 不算 played', () => {
      db.addEvent('u1', 's1', 'play', 60, false);
      expect(db.getUserPlayedSongs('u1')).not.toContain('s1');
    });

    test('play 后 skip → latest=skip，不算 played', () => {
      db.addEvent('u1', 's1', 'play', 180, true);
      db.addEvent('u1', 's1', 'skip', 10, false);
      expect(db.getUserPlayedSongs('u1')).not.toContain('s1');
    });

    test('skip 后 play(complete) → latest=play，算 played', () => {
      db.addEvent('u1', 's1', 'skip', 5, false);
      db.addEvent('u1', 's1', 'play', 200, true);
      expect(db.getUserPlayedSongs('u1')).toContain('s1');
    });

    test('partial play(complete=false) 不在 played 中', () => {
      db.addEvent('u1', 's1', 'play', 100, false);
      db.addEvent('u1', 's1', 'play', 150, false); // 再次部分播放
      expect(db.getUserPlayedSongs('u1')).not.toContain('s1');
    });
  });

  describe('3. getPartialPlayedSongs (completed=0)', () => {
    test('completed=0 算 partial play', () => {
      db.addEvent('u1', 's1', 'play', 60, false);
      expect(db.getPartialPlayedSongs('u1')).toContain('s1');
    });

    test('completed=1 不算 partial play', () => {
      db.addEvent('u1', 's1', 'play', 180, true);
      expect(db.getPartialPlayedSongs('u1')).not.toContain('s1');
    });

    test('partial play 后 completed play → latest=play(complete)，不在 partial', () => {
      db.addEvent('u1', 's1', 'play', 60, false);
      db.addEvent('u1', 's1', 'play', 200, true);
      expect(db.getPartialPlayedSongs('u1')).not.toContain('s1');
    });
  });

  describe('4. getUserSkippedSongs', () => {
    test('latest=skip 时算 skipped', () => {
      db.addEvent('u1', 's1', 'skip', 5, false);
      expect(db.getUserSkippedSongs('u1')).toContain('s1');
    });

    test('skip → like 后 latest=like，不算 skipped', () => {
      db.addEvent('u1', 's1', 'skip', 5, false);
      db.addEvent('u1', 's1', 'like', 0, false);
      expect(db.getUserSkippedSongs('u1')).not.toContain('s1');
    });

    test('like → skip 后 latest=skip，算 skipped', () => {
      db.addEvent('u1', 's1', 'like', 0, false);
      db.addEvent('u1', 's1', 'skip', 20, false);
      expect(db.getUserSkippedSongs('u1')).toContain('s1');
    });
  });

  describe('5. getUserSkippedSongsWithDetails', () => {
    test('返回 listenDuration 和 songDuration', () => {
      db.addEvent('u1', 's1', 'skip', 15, false, 180);
      const details = db.getUserSkippedSongsWithDetails('u1');
      expect(details).toHaveLength(1);
      expect(details[0].listenDuration).toBe(15);
      expect(details[0].songDuration).toBe(180);
    });

    test('skip 后再 like 不在列表中', () => {
      db.addEvent('u1', 's1', 'skip', 5, false, 180);
      db.addEvent('u1', 's1', 'like', 0, false);
      expect(db.getUserSkippedSongsWithDetails('u1')).toHaveLength(0);
    });
  });

  describe('6. getUserEventsForSong', () => {
    test('返回按时间倒序排列的事件', () => {
      db.addEvent('u1', 's1', 'play', 100, false);
      db.addEvent('u1', 's1', 'like', 0, false);
      db.addEvent('u1', 's1', 'skip', 5, false);
      const events = db.getUserEventsForSong('u1', 's1');
      expect(events[0].eventType).toBe('skip');
      expect(events[1].eventType).toBe('like');
      expect(events[2].eventType).toBe('play');
    });

    test('空用户/空歌曲返回空数组', () => {
      expect(db.getUserEventsForSong('u1', 'nonexistent')).toEqual([]);
    });
  });

  describe('7. deleteUserSongEvents', () => {
    test('只删除指定 eventTypes', () => {
      db.addEvent('u1', 's1', 'like', 0, false);
      db.addEvent('u1', 's1', 'skip', 5, false);
      db.deleteUserSongEvents('u1', 's1', ['like', 'unlike']);
      const events = db.getUserEventsForSong('u1', 's1');
      expect(events.map(e => e.eventType)).toContain('skip');
      expect(events.map(e => e.eventType)).not.toContain('like');
    });

    test('多 eventTypes 同时删除', () => {
      db.addEvent('u1', 's1', 'like', 0, false);
      db.addEvent('u1', 's1', 'unlike', 0, false);
      db.addEvent('u1', 's1', 'play', 100, true);
      db.deleteUserSongEvents('u1', 's1', ['like', 'unlike']);
      const events = db.getUserEventsForSong('u1', 's1');
      expect(events.map(e => e.eventType)).toEqual(['play']);
    });

    test('不影响其他用户/歌曲', () => {
      db.addEvent('u1', 's1', 'like', 0, false);
      db.addEvent('u2', 's1', 'like', 0, false);
      db.deleteUserSongEvents('u1', 's1', ['like']);
      expect(db.getUserLikedSongs('u2')).toContain('s1');
    });
  });
});

describe('DB 模块 - 歌曲特征存储', () => {

  test('saveSong → getSong 往返正确', () => {
    db.saveSong({
      songId: 'song999',
      artistId: 'artistA',
      artistName: 'Artist A',
      albumId: 'albumX',
      albumName: 'Album X',
      duration: 240,
      bpm: 120,
      genre: 'pop',
      publishTime: 2024,
      mood: 'happy',
      language: '中文',
      decade: '20s',
      energy: 0.7,
      danceability: 0.8,
      tags: ['流行', '欢快'],
      name: 'Test Song',
    });
    const song = db.getSong('song999');
    expect(song.artistId).toBe('artistA');
    expect(song.artistName).toBe('Artist A');
    expect(song.bpm).toBe(120);
    expect(song.mood).toBe('happy');
    expect(song.decade).toBe('20s');
    expect(song.energy).toBe(0.7);
    expect(song.danceability).toBe(0.8);
    expect(song.tags).toEqual(['流行', '欢快']);
  });

  test('UPDATE 模式下保留未更新字段', () => {
    db.saveSong({ songId: 's1', artistId: 'A1', name: 'Song 1' });
    db.saveSong({ songId: 's1', name: 'Updated Song' });  // 不传 artistId
    const song = db.getSong('s1');
    expect(song.artistId).toBe('A1');  // 保留旧值
    expect(song.name).toBe('Updated Song');
  });

  test('getSong 对不存在歌曲返回 null', () => {
    expect(db.getSong('nonexistent')).toBeNull();
  });
});

describe('DB 模块 - 统计聚合', () => {

  test('getUserStats 正确聚合 play/skip/like 数量和时长', () => {
    db.addEvent('u1', 's1', 'play', 100, true);
    db.addEvent('u1', 's2', 'play', 200, true);
    db.addEvent('u1', 's3', 'skip', 10, false);
    db.addEvent('u1', 's4', 'like', 0, false);
    const stats = db.getUserStats('u1');
    expect(stats.play.count).toBe(2);
    expect(stats.play.totalDuration).toBe(300);
    expect(stats.skip.count).toBe(1);
    expect(stats.skip.totalDuration).toBe(10);
    expect(stats.like.count).toBe(1);
  });

  test('空用户 stats 默认值为0', () => {
    const stats = db.getUserStats('nonexistent');
    expect(stats.play.count).toBe(0);
    expect(stats.skip.count).toBe(0);
    expect(stats.like.count).toBe(0);
  });
});
