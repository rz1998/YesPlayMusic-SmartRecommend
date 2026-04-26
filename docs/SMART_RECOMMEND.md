# 智能推荐系统 - 算法规格说明书

> 最后更新：2026-04-26 18:13（登录错误处理修复 + 需求文档同步）

---

## 📋 目录

1. [喜欢标准](#1-喜欢标准) — 什么算喜欢/跳过/播放
2. [核心公式](#2-核心公式) — 完整数学公式
3. [推荐流程](#3-推荐流程) — 算法执行步骤
4. [文件结构](#4-文件结构) — 源码组织
5. [API 参考](#5-api-参考)
6. [数据库](#6-数据库)
7. [配置参数](#7-配置参数)
8. [特征缺失处理](#8-特征缺失处理) — 降级策略
9. [冷启动流程](#9-冷启动流程) — 完整启动链路
10. [效果评估](#10-效果评估) — 离线指标与监控
11. [变更记录](#11-变更记录)

---

## 1. 喜欢标准

### 行为事件类型

| 事件 | 触发条件 | 记录方式 | 推荐权重 | 排除推荐池 |
|------|---------|---------|---------|-----------|
| **like** | 用户点击 ❤️ 按钮 | `POST /api/event/like` | **+3** | ✅ |
| **play（完整）** | 收听比例 ≥ 70% | `POST /api/event/play` + `completed=true` | **+1** | ✅ |
| **play（部分）** | 收听比例 30%-70% | `POST /api/event/play` + `completed=false` | **+1** | ❌ |
| **skip** | 收听比例 < 30% | `POST /api/event/skip` | **动态惩罚** | ✅ |
| **unlike** | 用户取消点赞 | `POST /api/event/like` toggle 或 `POST /api/event/unlike` | 撤销 like | ❌ |

### 收听比例分段语义

```
0%  ── 30% ── 70% ── 100%
   skip    部分    完整
 (惩罚)   play    play
```

| 区间 | 事件类型 | 权重 | 排除推荐池 | 说明 |
|------|---------|------|-----------|------|
| < 30% | skip | 动态（-1×(1-ratio)）| ✅ | 主动跳过，强烈厌恶 |
| 30%-70% | play (未完成) | +1 | ❌ | 没放完但有兴趣想听 |
| ≥ 70% | play (完成) | +1 | ✅ | 完整听过，不再重复推荐 |

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
  avgDanceability: 加权平均可舞性,
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
- `skip_score ∈ [0, 1]` — skip 向量归一化后最大值（skip 全匹配时 = 1.0）

**分数范围**：`final_score ∈ [-1.5, 1.0]`
- 最优（like 全匹配 + skip 无匹配）：1.0
- 最差（like 无匹配 + skip 全匹配）：0 - 1.5×1.0 = -1.5

> **设计说明**：`computePreferenceScore` 统一对所有维度归一化（`score / weights`），skip 和 like 共用同一归一化逻辑。归一化后 skip_score 最大为 1.0，最终分数范围 [-1.5, 1.0]。

### 2.5 维度匹配得分

单维度匹配得分：

```
match_score = {
  artist:      匹配 → 0.50,
  genre:       匹配 → 0.30,
  mood:        匹配 → 0.20,
  lang:        匹配 → 0.25,
  decade:      匹配 → 0.10,
  bpm:         1 - |avgBpm - songBpm| / 50,       权重 0.10（仅正向，BPM差50时相似度=0）,
  energy:      1 - |avgEnergy - songEnergy| × 2,     权重 0.05（仅正向，能量差≥0.5时相似度=0）,
  danceability: 1 - |avgDance - songDance| × 2,      权重 0.05（仅正向，舞蹈性差≥0.5时相似度=0）,
}
```

**skip 向量**：artist(0.5) + genre(0.3) + mood(0.2) + lang(0.25) + decade(0.1) = **1.35**。BPM/energy/danceability 在 skip 中不参与评分（`!isSkip` 跳过），仅在 like 中计算相似度。

**总权重**：like 向量 1.55（8维度全用）；skip 向量 1.35（5维）。归一化后 skip_score ∈ [0, 1]。

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
   └── likeVector = merge(merge(likedVector, completedPlayVector), partialPlayVector)
   ※ completed play（≥70%）和 partial play（30%-70%）权重相同但互斥合并

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
ai-musicplayer/
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
| `db.js` | `getUserLikedSongs` `getUserSkippedSongsWithDetails` `getUserPlayedSongs` `getPartialPlayedSongs` `getAllSongs` |
| `cache.js` | `getCachedRecommendations` `setCachedRecommendations` `invalidateCache` `clearAllCache` |
| `playBehaviorTracker.js` | skip 判定逻辑（30%阈值）、事件上报 |

---

## 5. API 参考

### 事件记录

> **说明**：
> - `like` 与 `unlike` 是**同一个 toggle 接口**，连续调用两次 `POST /api/event/like` 等同于 unlike
> - `unlike` 为独立接口，专门用于主动取消点赞（行为与 toggle 相同）
> - `type` 参数可选值：`play`、`skip`、`like`、`unlike`

| 接口 | 方法 | 参数 | 说明 |
|------|------|------|------|
| `/api/event/play` | POST | userId, songId, duration, completed | 记录播放 |
| `/api/event/skip` | POST | userId, songId, skipTime, songDuration | 记录跳过 |
| `/api/event/like` | POST | userId, songId | 点赞/取消点赞（toggle）|
| `/api/event/unlike` | POST | userId, songId | 主动取消点赞（与 toggle 等效）|
| `/api/event/liked/:userId` | GET | userId, songIds（query，逗号分隔）| 批量查询点赞状态 |
| `/api/event/history/:userId` | GET | userId, type, limit | 事件历史（type: play/skip/like/unlike）|

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

## 8. 特征缺失处理

### 8.1 特征可用性矩阵

| 特征 | 来源 | 缺失率（估算）| 缺失时处理 |
|------|------|-------------|-----------|
| bpm | 网易云 `s.bpm` | **高**（约 60% 歌曲无 BPM）| 设为 `null`，计算 BPM 相关相似度时跳过该维度 |
| energy | 网易云 `s.energy` | **高**（约 80%）| 设为 `null`，energy 维度匹配时跳过 |
| danceability | 网易云 `s.dance` | **高**（约 80%）| 设为 `null`，danceability 维度跳过 |
| genre | 网易云 `s.tag` | 低 | 默认为"未知" |
| mood | 网易云 | **高**（约 90%）| 设为"未知" |
| language | 歌曲名/艺术家名推断 | 低 | 默认为"其他" |
| decade | `publishTime` 推算 | 低 | 默认为"00s" |
| artist | `s.ar[0]` | 极低 | 不可缺失，缺失则过滤该歌曲 |

### 8.2 降级策略

**维度匹配时的降级规则：**

`computePreferenceScore` 函数对 null 值不计入分数也不计入权重，自动跳过该维度。实现逻辑：

```javascript
// 伪代码（实际在 computePreferenceScore 中内联实现）
if (value === null || avgValue === null || vec.artistFreq[artistKey] === undefined) {
  // 该维度不加分，也不增加 weight
} else {
  score += match_score;
  weights += weight;
}
return weights === 0 ? 0 : score / weights;  // 归一化
```

**候选歌曲被过滤的情况：**
- `artistId` 为空 → 该歌曲直接排除（无法计算偏好匹配）
- 所有特征都为 null → 该歌曲相似度得分为 0，但仍可作为兜底推荐

### 8.3 兜底推荐

当推荐结果为空时（候选池过滤后无有效歌曲），从数据库随机选取 50 首作为兜底：

- 已在 `recommend.js` 中实现（`fallbackCandidates = db.getAllSongs(50)`）
- 返回结果包含 `_fallback: true` 标记
- 响应包含 `"fallback": true` 标志

---

## 9. 冷启动流程

### 9.1 冷启动触发条件

用户满足以下任一条件视为冷启动：

| 条件 | 说明 |
|------|------|
| `user_events` 表无记录 | 全新用户 |
| `liked_songs < 3` | 喜欢歌曲少于 3 首 |
| 推荐结果为空 | 候选池过滤后无有效推荐 |

### 9.2 冷启动完整流程

```
用户首次打开推荐页
    │
    ▼
检查 user_events 中 liked 数量
    │
    ├─── liked ≥ 3 ──▶ 正常推荐流程
    │
    └─── liked < 3 ──▶ 冷启动流程
                            │
                            ▼
                    调用 /api/user/sync-songs
                    从网易云拉取用户喜欢列表
                            │
                   ┌────────┴────────┐
                   ▼                 ▼
            拉取成功            拉取失败（网络/Token失效）
                   │                 │
                   ▼                 ▼
            导入歌曲特征         获取用户公开歌单
            标记为 like           作为初始偏好
                   │                 │
                   └──┬──────────────┘
                      ▼
              构建初始偏好向量
                      │
                      ▼
              返回推荐结果
              （可能较少）
                      │
                      ▼
              显示"根据你的口味调整中"
              提示用户多点赞完善偏好
```

### 9.3 冷启动兜底 ⚠️[部分待实现]

**全部失败时的兜底策略：**

| 优先级 | 兜底内容 | 说明 |
|--------|---------|------|
| 1 | 网易云推荐歌单 | `/personalized` 返回的官方推荐 |
| 2 | 热门新歌 | 网易云新歌榜 |
| 3 | 随机精选 | 从候选池随机选取 10 首 |

> ⚠️ 当前 `smartRecommend.vue` 在 syncSongs 失败后无明确 UI 提示，也未切换到官方推荐歌单。"根据你的口味调整中" 等提示文案**尚未实现**。

### 9.4 离线补偿机制 ⚠️[待实现]

如果 skip/play 事件在离线时触发：

```javascript
// 事件队列（前端本地缓存）
const eventQueue = [];

// 上报函数
async function flushEvents() {
  while (eventQueue.length > 0) {
    const event = eventQueue.shift();
    try {
      await sendEvent(event);
    } catch (e) {
      // 发送失败，重新放回队列
      eventQueue.unshift(event);
      await sleep(5000); // 5秒后重试
    }
  }
}
```

- 断网时事件存入本地队列
- 网络恢复后自动重试
- 最多缓存 100 条事件，超出后丢弃最旧事件

> ⚠️ 该功能**尚未实现**，当前 skip/play 事件在断网时**直接丢弃**，不会重试上报。

---

## 10. 效果评估 ⚠️[待实现]

> ⚠️ 以下评估指标和监控功能**尚未实现**，目前仅有基础日志记录。

### 10.1 离线评估指标

| 指标 | 公式 | 目标 |
|------|------|------|
| **Precision@K** | `#(recommended ∩ relevant) / K` | K=10 时 ≥ 0.3 |
| **Recall@K** | `#(recommended ∩ relevant) / #relevant` | K=50 时 ≥ 0.15 |
| **Coverage** | `#(recommended songs) / #all songs` | ≥ 5% |
| **Skip Rate** | `#skip / #total_recommended` | < 30% |
| **Like Rate** | `#like / #total_recommended` | > 10% |
| **Avg Listen Ratio** | `sum(listen_ratio) / #songs` | > 0.6 |

> **`relevant` 集合定义**：基于用户历史行为构建——将用户历史 liked + 完整播放（completed=true）的歌曲视为 relevant。每次推荐结果中出现在 relevant 中的比例即 Precision@K。

### 10.2 在线监控指标

| 指标 | 采集方式 | 告警阈值 |
|------|---------|---------|
| API 响应时间 P99 | APM 埋点 | > 2s |
| 推荐结果空率 | 埋点 | > 5% |
| 事件上报成功率 | 服务端计数 | < 95% |
| 缓存命中率 | cache.js 计数 | < 60% |
| 特征缺失率 | 数据库统计 | > 70% |

### 10.3 参数调优指南

| 参数 | 默认值 | 调优范围 | 调整建议 |
|------|-------|---------|---------|
| `α` (DISLIKE_WEIGHT) | 1.5 | 0.5 ~ 3.0 | skip 率高 → 增大；推荐过于保守 → 减小 |
| CANDIDATE_POOL_SIZE | 5000 | 1000 ~ 20000 | 性能不足 → 减小；推荐多样性差 → 增大 |
| SKIP_RATIO_THRESHOLD | 0.3 | 0.2 ~ 0.4 | 误判 skip 多 → 减小；推荐重复 → 增大 |
| CACHE_TTL_MS | 5min | 1min ~ 30min | 实时性要求高 → 减小；压力大 → 增大 |

---

## 11. 变更记录

#### 2026-04-26 20:34（第十次审查后）

#### 功能优化
- ⭐ **智能推荐入口升级** - 导航栏顺序调整为 `首页 → 智能推荐 → 发现 → 音乐库`，智能推荐提升为一级入口（优先级提高），同步更新 4 种语言翻译

#### Bug 修复
- 🔧 **/api/recommend 路由被网易云API拦截** - Express 路由顺序错误，通用 `/api` 路由放在具体路由之前，导致推荐服务请求（3001）被错误转发到 10754。调整路由优先级 ✅
- 🔧 **proxyReqPathResolver 路径错误** - 使用 `/api + req.url` 导致双重 `/api` 前缀；改为 `req.originalUrl` 保留完整路径 ✅
- 🔧 **/api/user 路由过宽** - `/api/user` 路由到 3001 会拦截 `/api/user/playlist`、`/api/user/cloud` 等网易云接口；改为精确路径 `/api/user/profile` 和 `/api/user/sync-songs` ✅
- 🔧 **localhost vs 127.0.0.1 cookie 跨域** - Express 监听 127.0.0.1，Electron 页面加载用 localhost，不同 origin 导致 cookie 不发送；生产环境 loadURL 改为 `http://127.0.0.1:27232` ✅
- 🔧 **fetchUserProfile 无错误处理** - 301/401 时未捕获错误导致页面崩溃；添加 .catch() 自动登出跳转 ✅
- 🔧 **未登录用户崩溃** - userId=anonymous 时 getUserStats 返回 null，访问 .count 崩溃；添加空值保护 ✅
- 🔧 **VUE_APP_RECOMMENDER_HOST 多余 /api** - 主机地址已含 `/api`，前端再拼接导致双重路径；修正为 `http://127.0.0.1:27232` ✅

#### 需求文档同步
- ✅ 修正 `/api/recommend` 路由目标为 3001（推荐服务），非 10754
- ✅ 修正 `/api/user/profile` 路由目标为 3001（用户画像服务）
- ✅ 修正 `/api/event` 路由目标为 3001（事件服务）
- ✅ 添加 `/api/user/sync-songs` 路由目标为 3001

#### 2026-04-26 18:13（第九次审查后）

#### Bug 修复
- 🔧 **登录失败报错不可读** - axios 400 响应进入 .catch()，error 对象直接 string 化显示 `[object Object]`，用户看不到具体错误。改为读取 `error.response.data.msg` 展示具体错误信息 ✅

#### 需求文档同步
- ✅ final_score 范围修正为 `[-1.5, 1.0]`（skip_score 归一化后最大 1.0）
- ✅ skip 向量维度修正：artist+genre+mood+lang+decade = 1.35（非 0.8）
- ✅ 降级策略描述改为实际 `computePreferenceScore` 逻辑（移除不存在的 `matchDimension` 函数）
- ✅ 测试用例数更新为约 269 个（实际统计）
- ✅ 函数名 `extractFeatures`（与代码一致）

#### 2026-04-26（八次审查后）

#### Bug 修复
- 🔧 **computeSimilarity BPM/时长相似度死代码** - extractFeatures 返回 bpm(单值) 而非 avgBpm，导致 /similar/:songId 中 BPM 和时长相似度计算恒为 undefined。改为 vec1.bpm/vec1.duration ✅
- 🔧 **sync-songs 冷启动 skip→like 失效** - existingEvents.length===0 导致 skip 过的歌无法导入为 like，改为 latestEvent!=='like' ✅
- 🔧 **/recommend 端点 userId 无长度校验** - 添加 userId.length>128 校验，与 events API 一致 ✅
- 🔧 **旧数据库缺少扩展列** - 添加 song_features 表迁移（mood/language/decade/energy/danceability/tags），服务重启自动 ALTER TABLE ✅
- 🔧 **mergePreferenceVectors avg 死代码** - return 语句之后代码不执行，改为 const merged = {...} 后计算再返回
- 🔧 **finalRecommendations 未定义** - scoredCandidates.slice 前未定义变量，提前 let 声明
- 🔧 **Player 单曲循环双重 scrobble** - _replaceCurrentTrack 新增 skipScrobble 参数，repeat-one 时跳过第二次 scrobble
- 🔧 **recommendEngine playInfo 闭包 undefined** - filter+map 合并为单次遍历解决变量作用域问题
- 🔧 **自然结束时 handleTrackChange 双重 recordPlay** - 添加 trigger 参数区分手动切歌和自然结束，避免与 Player.js _scrobble 重复记录

#### 中等修复
- 🔧 **Cache stampede 防护** - cache.js 新增 isComputing/waitForComputation/setComputing，并发请求同一用户时排队等待
- 🔧 **/debug 端点生产环境暴露** - NODE_ENV=production 时返回 403；所有 events API 添加 userId 长度校验（最长128字符）
- 🔧 **sync-song 参数无校验** - songId 必填 + 字符串长度截断防注入
- 🔧 **并发 like 重复记录** - /like toggle 改为 DELETE + INSERT，保证同一 user+song 只有一条 like 事件

#### 清理
- 🔧 **recommendEngine.js 死代码** - 删除从未使用的本地推荐引擎（src/utils/recommendEngine.js）
- 🔧 **previousTrackId/previousTrackDuration 误用** - 移除冗余 data 字段，改用 oldTrack.id !== newTrack.id 直接判断

#### 新增功能
- ✅ **DELETE + INSERT 防并发** - like 事件原子操作，删除旧记录再插入新记录
- ✅ **Cache stampede 保护** - 同一用户并发请求时，第二个请求等待第一个请求的计算结果
- ✅ **并发 like 防护** - deleteUserSongEvents 辅助函数，原子性删除同类事件

#### 2026-04-23（六次审查后）

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
- ✅ **约 269 个测试用例**（截至 2026-04-26）: recommender(74) + api(53) + db(58) + edge(62) + cache(11) + concurrent(11)

#### 2026-04-14（初次实现）

#### 功能新增
- ✅ **推荐结果缓存** - 服务端 5 分钟 TTL
- ✅ **动态 skip penalty** - 基于收听比例计算惩罚权重
- ✅ **冷启动推荐** - 从网易云喜欢列表导入初始偏好
- ✅ **手动刷新按钮** - 智能推荐页面刷新

#### like/unlike 双向追踪
- ✅ 最新事件覆盖历史（skip → like 可被推荐）
