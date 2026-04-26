# ai-musicplayer 智能推荐系统后端

## 功能特性

### 1. 行为追踪
- `POST /api/event/play` - 记录播放事件
- `POST /api/event/skip` - 记录跳过事件
- `POST /api/event/like` - 记录喜欢事件

### 2. 个性化推荐
- `GET /api/recommend?userId=xxx&limit=20` - 获取推荐列表
- `GET /api/recommend/similar/:songId` - 获取相似歌曲

### 3. 用户画像
- `GET /api/user/profile/:userId` - 获取用户偏好分析

## 算法原理

### 推荐分数计算
```
推荐分数 = 喜好匹配度 - α × 排斥匹配度

α = 排斥权重（默认0.5，可调整）
```

### 特征向量
- 艺人特征 (one-hot)
- 风格特征 (genre)
- BPM特征
- 时长特征

## 快速开始

```bash
cd server
npm install
npm start
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| PORT | 3001 | 服务端口 |
| NODE_ENV | development | 运行环境 |

## API 文档

### 记录播放
```bash
curl -X POST http://localhost:3001/api/event/play \
  -H "Content-Type: application/json" \
  -d '{"userId": "user123", "songId": 123456, "duration": 180, "completed": true}'
```

### 获取推荐
```bash
curl "http://localhost:3001/api/recommend?userId=user123&limit=20"
```

### 获取用户画像
```bash
curl "http://localhost:3001/api/user/profile/user123"
```
