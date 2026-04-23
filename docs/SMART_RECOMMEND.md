# 智能推荐系统 - 算法规格说明书

> 最后更新：2026-04-23

---

## 📋 目录

1. [喜欢标准](#1-喜欢标准) — 什么算喜欢/跳过/播放
2. [核心公式](#2-核心公式) — 完整数学公式
3. [推荐流程](#3-推荐流程) — 算法执行步骤
4. [文件结构](#4-文件结构) — 源码组织
5. [API 参考](#5-api-参考)
6. [数据库](#6-数据库)
7. [配置参数](#7-配置参数)
8. [变更记录](#8-变更记录)

---

## 1. 喜欢标准

### 行为事件类型

| 事件 | 触发条件 | 记录方式 | 推荐权重 |
|------|---------|---------|---------|
| **like** | 用户点击 ❤️ 按钮 | `POST /api/event/like` | **+3** |
| **play** | 用户完整播放一首歌（听完 ≥70%） | `POST /api/event/play` | **+1** |
| **skip** | 用户主动跳过（收听 < 30%） | `POST /api/event/skip` | **动态惩罚** |
| **unlike** | 用户取消点赞（点击红心取消） | `POST /api/event/like` toggle | 撤销 like |

### skip 判定标准（客户端）

```javascript
const listenRatio = playedDuration / songDuration;
const isSkip = listenRatio < 0.3 && !isLikedTrack;
```

- 收听比例 < 30% → 判定为 skip
- 收听比例 ≥ 30% → 判定为正常播放（completed）

### like/unlike 双向追踪

系统以**最新事件**为准：

| 操作序列 | 最终状态 | 能否推荐 |
|---------|---------|---------|
| like → unlike | unliked | ✅ 可以 |
| like → skip | skipped | ❌ 排除 |
| skip → like | liked | ✅ 可以（skip 被覆盖）|
| play → unlike | unliked | ✅ 可以 |

---

## 2. 核心公式

### 2.1 动态 Skip Penalty（跳过惩罚权重）

skip 事件的惩罚权重由收听比例决定：

```
skip_weight = -1 × (1 - listen_ratio)
```

| 收听比例 | skip_weight | 含义 |
|---------|-------------|------|
| 0% | **-1.0** | 完全不听，强烈不喜欢 |
| 30% | **-0.7** | 刚开始就跳过 |
| 50% | **-0.5** | 听了一半跳过 |
| 90% | **-0.1** | 快听完了才跳，可能外部原因 |
| ≥100% | **0.0** | 不算 skip（实际是 completed） |

### 2.2 偏好向量构建

从用户行为事件集合构建偏好向量 `V`：

```
V = Σ(event_weight_i × feature_vector_i)
```

其中 `event_weight` 取决于事件类型：

| 事件类型 | event_weight |
|---------|-------------|
| like | **3** |
| play | **1** |
| skip | **动态** = -1 × (1 - listen_ratio) |

偏好向量 `V` 的结构：

```
V = {
  artistFreq: { [artistId]: 加权频次和 },
  genreFreq:  { [genre]: 加权频次和 },
  moodFreq:   { [mood]: 加权频次和 },
  langFreq:   { [language]: 加权频次和 },
  decadeFreq: { [decade]: 加权频次和 },
  avgBpm:     加权平均 BPM,
  avgDuration: 加权平均时长,
  avgEnergy:  加权平均能量值,
  count:      总权重和,
}
```

### 2.3 like + play 向量合并

当同时存在 liked 歌曲和 played 歌曲时，分别构建向量后合并频次：

```
V_likeplay = V_like ⊕ V_play
```

其中 `⊕` 表示同维度频次累加：

```
artistFreq[k] = V_like.artistFreq[k] + V_play.artistFreq[k]
```

### 2.4 推荐评分公式

候选歌曲 `s` 的最终得分：

```
final_score(s) = like_score(s) - α × skip_score(s)
```

其中：
- `α = 1.5`（排斥惩罚系数，可配置）
- `like_score ∈ [0, 1]` — 与正向偏好匹配程度
- `skip_score ∈ [0, 1]` — 与排斥偏好匹配程度

### 2.5 维度匹配得分

单维度匹配得分：

```
match_score = {
  artist:  匹配 → 0.50,
  genre:   匹配 → 0.30,
  mood:    匹配 → 0.20,
  lang:    匹配 → 0.25,
  decade:  匹配 → 0.10,
  bpm:     1 - |avgBpm - songBpm| / 50,  权重 0.10（仅正向）,
  energy:  1 - |avgEnergy - songEnergy| × 2,  权重 0.05（仅正向）,
}
```

总得分归一化：

```
dimension_score = Σ(match_i × weight_i) / Σ(weight_i)
```

---

## 3. 推荐流程

### 执行步骤

```
1. 获取用户交互数据
   ├── liked songs  → 构建 like 向量（weight=3）
   ├── played songs → 构建 play 向量（weight=1）
   └── skipped songs（含收听比例）→ 构建 skip 向量（动态权重）

2. 合并偏好向量
   └── likeVector = merge(likeVector, playVector)

3. 构建候选池
   └── 从数据库获取 5000 首歌曲

4. 排除已交互歌曲
   └── excludeSet = liked ∪ skipped ∪ played

5. 逐曲评分
   └── final_score = like_score - 1.5 × skip_score

6. 排序输出
   └── 按 score 降序，取前 N 首

7. 降级兜底
   └── 若推荐为空 → 返回最近同步歌曲（排除 liked/skipped/played）
```

---

## 4. 文件结构

```
YesPlayMusic-SmartRecommend/
├── start.sh                      # 一键启动脚本（前后端同时启动）
├── docs/
│   └── SMART_RECOMMEND.md        # 本文档（算法规格 + 变更记录）
│
├── server/                       # 推荐后端（Express.js）
│   ├── server.js                 # 服务入口 + 端口自动迁移（3001→3010）
│   ├── package.json
│   │
│   ├── api/
│   │   ├── events.js             # 事件记录 API（play/skip/like/unlike）
│   │   ├── recommend.js          # 推荐算法 API（核心逻辑）
│   │   └── profile.js            # 用户画像 API（topArtists/likedCount）
│   │
│   ├── models/
│   │   ├── db.js                 # SQLite 封装（事件表 + 歌曲特征表）
│   │   └── cache.js             # 推荐结果缓存（5分钟TTL，上限100用户）
│   │
│   ├── __tests__/
│   │   ├── recommender.test.js   # 推荐算法单元测试（51个用例）
│   │   └── cache.test.js         # 缓存模块单元测试
│   │
│   └── data/
│       └── recommender.db        # SQLite 数据库文件
│
└── src/                          # 前端（Vue.js）
    ├── mixins/
    │   └── playBehaviorTracker.js  # 播放行为追踪（skip判定/事件上报）
    ├── views/
    │   └── smartRecommend.vue     # 智能推荐页面（含冷启动 + 刷新）
    └── api/
        └── recommend.js           # 前端 API 客户端
```

### 关键模块职责

| 文件 | 职责 |
|------|------|
| `recommend.js` | `extractFeatures` `computePreferenceVector` `mergePreferenceVectors` `computePreferenceScore` `getDecade` |
| `events.js` | `POST /api/event/{play,skip,like,unlike}` — 事件记录 |
| `db.js` | `getUserLikedSongs` `getUserSkippedSongsWithDetails` `getUserPlayedSongs` `getAllSongs` |
| `cache.js` | `getCachedRecommendations` `setCachedRecommendations` `invalidateCache` `clearAllCache` |
| `playBehaviorTracker.js` | skip 判定逻辑（30%阈值）、事件上报 |

---

## 5. API 参考

### 事件记录

| 接口 | 方法 | 参数 | 说明 |
|------|------|------|------|
| `/api/event/play` | POST | userId, songId, duration, completed | 记录播放 |
| `/api/event/skip` | POST | userId, songId, skipTime, songDuration | 记录跳过 |
| `/api/event/like` | POST | userId, songId | 点赞/取消点赞（toggle）|
| `/api/event/liked/:userId` | GET | userId, songIds（query）| 批量查询点赞状态 |
| `/api/event/history/:userId` | GET | userId, type, limit | 事件历史 |

### 推荐

| 接口 | 方法 | 参数 | 说明 |
|------|------|------|------|
| `/api/recommend` | GET | userId, limit, excludePlayed, refresh | 获取推荐 |
| `/api/recommend/similar/:songId` | GET | songId, limit | 相似歌曲 |
| `/api/recommend/debug` | GET | userId | 调试：查看偏好向量 |

### 用户

| 接口 | 方法 | 参数 | 说明 |
|------|------|------|------|
| `/api/user/profile/:userId` | GET | userId | 用户画像 |
| `/api/user/sync-songs` | POST | songs[], userId, recordLikes | 同步歌曲特征 |

---

## 6. 数据库

### 表结构

```sql
-- 用户事件表
CREATE TABLE user_events (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  song_id      TEXT NOT NULL,
  event_type   TEXT NOT NULL,   -- 'play', 'skip', 'like', 'unlike'
  duration     INTEGER DEFAULT 0,
  song_duration INTEGER DEFAULT 0,
  completed    INTEGER DEFAULT 0,
  created_at   TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 歌曲特征表
CREATE TABLE song_features (
  song_id       TEXT PRIMARY KEY,
  artist_id     TEXT,
  artist_name   TEXT,
  album_id      TEXT,
  album_name    TEXT,
  duration      INTEGER,
  bpm           INTEGER,
  genre         TEXT,
  publish_time  INTEGER,
  mood          TEXT,
  language      TEXT,
  decade        TEXT,
  energy        REAL,
  danceability  REAL,
  tags          TEXT,    -- JSON 数组
  name          TEXT,
  updated_at    TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### 歌曲特征获取

| 字段 | 来源 | 说明 |
|------|------|------|
| artistId/Name | `s.ar[0].id/name` | 首位艺术家 |
| albumId/Name | `s.al.id/name` | 专辑 |
| duration | `s.dt` | 时长（秒）|
| bpm | `s.bpm` | 节拍数（网易云）|
| genre | `s.tag` | 标签数组转字符串 |
| publishTime | `s.publishTime` | 发布时（兼容年份数字和时间戳）|
| decade | `getDecade(publishTime)` | 年代（80s/90s/00s/10s/20s）|

---

## 7. 配置参数

```javascript
// server/api/recommend.js
const DISLIKE_WEIGHT = 1.5;        // 排斥惩罚系数（越大越回避同类）
const CANDIDATE_POOL_SIZE = 5000; // 候选池大小

// src/mixins/playBehaviorTracker.js
const SKIP_RATIO_THRESHOLD = 0.3; // skip 判定：收听 < 30%
const COMPLETED_THRESHOLD  = 0.7;  // completed 判定：收听 ≥ 70%

// server/models/cache.js
const CACHE_TTL_MS    = 5 * 60 * 1000;  // 缓存 TTL：5 分钟
const CACHE_MAX_USERS = 100;            // 最大缓存用户数
```

---

## 8. 变更记录

### 2026-04-23（六次审查后）

#### Bug 修复
- 🔧 **liked+played 权重混淆** - concat 后统一用 weight=3 → 分别计算向量后 merge 合并
- 🔧 **topArtists 艺术家名称失效** - 查找条件 songId===artistId → artistId===artistId
- 🔧 **getDecade 兼容年份数字** - publishTime 为年份数字（如2024）也能正确解析
- 🔧 **refreshRecommendations 不记录新喜欢** - syncSongs(..., false) → true

#### 功能新增
- ✅ **播放事件纳入偏好** - play 事件作为正向信号（权重1）合并到喜好向量
- ✅ **已播放歌曲排除** - liked + skipped + played 三重排除
- ✅ **mergePreferenceVectors** - liked 和 played 向量正确合并（频次累加）

#### 性能优化
- 🔧 **getUserSkippedSongs limit** - 默认从 100 提升到 500
- 🔧 **getAllSongs limit** - 候选池从 1000 扩展到 5000 首

#### 单元测试
- ✅ **53 个测试用例** - 新增 `mergePreferenceVectors` 覆盖 + `getDecade` 年份格式测试

### 2026-04-14（初次实现）

#### 功能新增
- ✅ **推荐结果缓存** - 服务端 5 分钟 TTL
- ✅ **动态 skip penalty** - 基于收听比例计算惩罚权重
- ✅ **冷启动推荐** - 从网易云喜欢列表导入初始偏好
- ✅ **手动刷新按钮** - 智能推荐页面刷新

#### like/unlike 双向追踪
- ✅ 最新事件覆盖历史（skip → like 可被推荐）
