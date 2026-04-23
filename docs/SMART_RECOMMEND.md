# 智能推荐系统文档

> 最后更新：2026-04-14

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                     前端 (Vue.js)                            │
│  playBehaviorTracker.js   ← 追踪播放/跳过/点赞行为            │
│  smartRecommend.vue       ← 智能推荐页面（含手动刷新按钮）      │
│  src/api/recommend.js    ← API 客户端                        │
└─────────────────────────────┬───────────────────────────────┘
                              │ HTTP /api/event/*
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   推荐服务 (Express.js)                       │
│  server/api/events.js    ← 事件记录 API                      │
│  server/api/recommend.js ← 推荐算法 API（含缓存）             │
│  server/api/profile.js   ← 用户画像 API                      │
│  server/models/db.js     ← SQLite 数据库封装                 │
│  server/models/cache.js  ← 推荐结果缓存（5分钟TTL）           │
└─────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              SQLite 数据库 (sql.js)                          │
│  server/data/recommender.db                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 用户行为事件

| 事件类型 | 说明 | 权重 |
|---------|------|------|
| `play` | 用户完整播放一首歌 | +1 |
| `like` | 用户点赞一首歌曲 | +3 |
| `skip` | 用户跳过一首歌曲（基于收听比例动态计算惩罚）| -0.1 ~ -1.0 |
| `unlike` | 用户取消点赞 | 状态切换 |

### 动态 Skip Penalty（核心创新）

传统推荐系统的 skip 惩罚是固定的，本系统的核心创新在于**动态计算 skip 权重**：

```
skip_weight = -1 * (1 - listen_ratio)
```

- **0% 收听** → `skip_weight = -1.0`（完整惩罚，表示强烈不喜欢）
- **50% 收听** → `skip_weight = -0.5`（中等惩罚）
- **90% 收听** → `skip_weight = -0.1`（轻微惩罚，可能是外部原因导致跳过）

客户端基于 **30% 收听比例** 判断是否为 skip：

```javascript
const SKIP_RATIO_THRESHOLD = 0.3; // 30%
const listenRatio = playedDuration / songDuration;
const isSkip = listenRatio < 0.3 && !isLikedTrack;
```

---

## 推荐算法

### 评分公式

```
final_score = like_score - 1.5 × skip_score
```

- **like_score**：歌曲与用户喜好向量的匹配程度（0-1）
- **skip_score**：歌曲与用户排斥向量的匹配程度（0-1）
- **系数 1.5**：排斥惩罚权重高于喜好奖励

### 多维度匹配权重

#### 喜好匹配（正向）

| 维度 | 权重 | 说明 |
|------|------|------|
| 艺术家 | 0.50 | 完全匹配 |
| 流派 | 0.30 | 完全匹配 |
| BPM相似度 | 0.10 | 50 BPM 内相似 |
| 情绪 | 0.20 | 完全匹配 |
| 语言 | 0.25 | 完全匹配 |
| 年代 | 0.10 | 完全匹配 |
| 能量相似度 | 0.05 | 差值越小越高 |

#### 排斥匹配（负向）

| 维度 | 权重 | 说明 |
|------|------|------|
| 艺术家 | 0.50 | 完全匹配 |
| 流派 | 0.30 | 完全匹配 |
| 情绪 | 0.20 | 完全匹配 |
| 语言 | 0.25 | 完全匹配 |
| 年代 | 0.10 | 完全匹配 |

### like/unlike 双向追踪

系统会追踪用户对歌曲的 like 和 unlike 事件，以**最新事件**为准：

- 用户先 like 后 unlike → 该歌曲**不算**被 liked
- 用户先 skip 后 like → 该歌曲**仍可被推荐**（skip 被后来的 like 覆盖）
- 用户先 like 后 skip → 该歌曲**不会被推荐**（latest = skip）

---

## 推荐结果缓存

### 缓存策略

- **缓存位置**：服务端内存（`server/models/cache.js`）
- **TTL**：5 分钟
- **粒度**：按用户缓存

### 缓存失效触发

| 操作 | 缓存清除范围 |
|------|-------------|
| 用户播放/跳过/点赞/取消点赞 | 该用户的缓存 |
| 用户同步歌曲到后端 | **所有用户**的缓存 |

> 注意：同步歌曲会清除所有缓存，因为歌曲特征变化可能影响所有用户的推荐结果

### 强制刷新

客户端可使用 `?refresh=true` 参数强制刷新，绕过缓存：

```
GET /api/recommend?userId=xxx&limit=30&refresh=true
```

---

## API 接口

### 事件记录

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/event/play` | POST | 记录播放事件 |
| `/api/event/skip` | POST | 记录跳过事件 |
| `/api/event/like` | POST | 点赞/取消点赞（toggle）|
| `/api/event/unlike` | POST | 明确取消点赞 |
| `/api/event/history/:userId` | GET | 获取用户事件历史 |
| `/api/event/liked/:userId` | GET | 批量查询歌曲点赞状态 |

### 推荐

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/recommend` | GET | 获取个性化推荐 |
| `/api/recommend?refresh=true` | GET | 强制刷新推荐（绕过缓存）|
| `/api/recommend/similar/:songId` | GET | 获取相似歌曲 |
| `/api/recommend/debug` | GET | 调试：查看用户偏好向量 |

### 用户画像

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/user/profile/:userId` | GET | 获取用户画像和统计 |
| `/api/user/sync-songs` | POST | 批量同步歌曲特征（可指定 `recordLikes` 从网易云喜欢列表初始化偏好） |

---

## 算法参数配置

在 `server/api/recommend.js` 中可调整：

```javascript
// 推荐算法权重配置
const DISLIKE_WEIGHT = 1.5;  // 排斥权重：越大越避免推荐同类歌曲

// 客户端跳过检测配置 (src/mixins/playBehaviorTracker.js)
const SKIP_RATIO_THRESHOLD = 0.3; // 30% 收听比例阈值
const skipThreshold = 30;          // 兜底：秒数阈值
```

在 `server/models/cache.js` 中可调整缓存 TTL：

```javascript
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟
```

---

## 冷启动初始化

新用户没有播放/跳过/喜欢记录时，推荐引擎无法构建偏好向量，此时可从网易云喜欢的歌曲列表导入初始偏好：

### 流程

```
用户登录 → 获取网易云喜欢歌曲列表 → 分批获取歌曲详情 → sync-songs(recordLikes=true)
                                                                 ↓
                                              后端：为每首歌记录 'like' 事件（首次才记录）
                                              偏好向量立即可用 → 下次打开即有推荐
```

### recordLikes 参数

`POST /api/user/sync-songs` 增加可选参数：

```json
{
  "songs": [...],
  "userId": "user123",
  "recordLikes": true   // 默认 false
}
```

- `recordLikes=false`（默认）：只同步歌曲特征，不记录事件
- `recordLikes=true`：同步歌曲特征 + 为每首歌记录 `like` 事件（已有更早事件的跳过）

### 注意事项

- 每首歌**只记录一次** `like`（按 `created_at` 排序取最新，跳过已有更早事件的歌曲）
- 同步完成后**清除所有用户缓存**（因为歌曲特征变化可能影响所有用户）
- 前端在用户首次打开智能推荐页面时自动触发，**无需手动操作**

## 数据库

数据存储在 `server/data/recommender.db` (SQLite/sql.js)

### 表结构

```sql
-- 用户事件表
CREATE TABLE user_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  song_id TEXT NOT NULL,
  event_type TEXT NOT NULL,  -- 'play', 'skip', 'like', 'unlike'
  duration INTEGER DEFAULT 0,   -- 播放/收听时长（秒）
  song_duration INTEGER DEFAULT 0, -- 歌曲总时长（秒）
  completed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 歌曲特征表
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
  mood TEXT,        -- 情绪
  language TEXT,    -- 语言
  decade TEXT,      -- 年代
  energy REAL,      -- 能量值 0-1
  danceability REAL, -- 可舞性 0-1
  tags TEXT,        -- JSON 数组
  name TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 用户画像表
CREATE TABLE user_profiles (
  user_id TEXT PRIMARY KEY,
  data TEXT,  -- JSON
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 3001 | 推荐服务端口 |
| `VUE_APP_RECOMMENDER_HOST` | http://localhost:3001 | 推荐服务地址（前端）|

---

## 部署

```bash
# 1. 安装依赖
cd server
npm install

# 2. 启动服务
npm start

# 3. 前端开发环境
cd ..
yarn serve
```

### 生产环境

确保设置正确的 `VUE_APP_RECOMMENDER_HOST` 环境变量指向推荐服务地址。

---

## 变更记录

### 2026-04-23

#### 功能新增
- ✅ **冷启动推荐** - 新用户从网易云喜欢列表自动导入初始偏好，打开页面即有推荐
- ✅ **端口自动迁移** - 后端启动时自动寻找可用端口（3001→3002→...）
- ✅ **一键启动脚本** - `./start.sh` 同时启动前后端，Ctrl+C 一起关闭

#### Bug 修复
- 🔧 **profile 数据未加载** - `smartRecommend.vue` 从未调用 `getUserProfile` API
- 🔧 **缓存清除范围** - sync-songs 时 `invalidateCache(userId)` → `clearAllCache()`
- 🔧 **重复端点** - `POST /api/event/like/:songId` 与 `POST /api/event/like` 冲突

### 2026-04-14

#### 功能新增
- ✅ **推荐结果缓存** - 服务端 5 分钟 TTL 缓存，减少重复计算
- ✅ **同步后自动刷新** - 用户同步歌曲后自动刷新推荐结果
- ✅ **手动刷新按钮** - 智能推荐页面新增「🔄 刷新推荐」按钮

#### Bug 修复
- 🔧 **like/unlike toggle** - 修复取消点赞功能不生效的问题
- 🔧 **动态 skip penalty** - 客户端 skip 检测现在与文档一致（30% 收听比例）
- 🔧 **skip 反悔逻辑** - 跳过后再点赞的歌曲现在可以正确被推荐
- 🔧 **数据库查询优化** - 修复 liked/skipped 歌曲上限截断问题（100→1000）
- 🔧 **代码清理** - 删除重复端点和死代码
- 🔧 **RECUMMENDER_HOST 拼写错误** → `VUE_APP_RECOMMENDER_HOST`

#### 新增 API/数据库函数
- `GET /api/event/liked/:userId` - 批量查询歌曲点赞状态
- `getUserEventsForSong()` - 获取单个歌曲的所有事件
- `server/models/cache.js` - 共享缓存模块
