# 智能推荐系统集成文档

## 新增文件

### 1. API客户端
- `src/api/recommend.js` - 推荐系统API接口

### 2. 页面组件
- `src/views/smartRecommend.vue` - 智能推荐页面

### 3. Mixin
- `src/mixins/playBehaviorTracker.js` - 播放行为追踪

## 集成步骤

### Step 1: 添加路由
在 `src/router/index.js` 中添加：

```javascript
{
  path: '/smart-recommend',
  name: 'smart-recommend',
  component: () => import(/* webpackChunkName: "smartRecommend" */ '@/views/smartRecommend.vue'),
  meta: { requireUser: true },
},
```

### Step 2: 添加播放器事件追踪
在播放器组件中导入mixin：

```javascript
import playBehaviorTracker from '@/mixins/playBehaviorTracker';

export default {
  mixins: [playBehaviorTracker],
  // ...
}
```

### Step 3: 启动推荐服务

```bash
cd server
npm start
```

## 算法参数调整

在 `server/services/recommender.js` 中可以调整：

```javascript
const DISLIKE_WEIGHT = 0.5;  // 排斥权重，越大越避免不喜欢的
const SKIP_THRESHOLD = 30;  // 跳过阈值（秒）
```

## 数据库

推荐数据存储在 `server/data/recommender.db` (SQLite)

### 表结构

```sql
-- 用户事件
user_events: user_id, song_id, event_type, duration, completed, created_at

-- 歌曲特征
song_features: song_id, artist_id, album_id, bpm, genre, duration, features_vector

-- 用户画像
user_profiles: user_id, like_vector, dislike_vector, play_count, skip_count
```
