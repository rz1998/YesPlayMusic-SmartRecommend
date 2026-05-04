# ai-musicplayer 需求规格说明书

> 本文档定义 ai-musicplayer 智能推荐版的功能需求、技术架构和设计决策。

---

## 1. 项目概述

### 1.1 项目简介

| 项目 | 说明 |
|------|------|
| **名称** | ai-musicplayer (智能推荐版) |
| **类型** | 第三方网易云音乐播放器 + 智能推荐系统 |
| **平台** | Windows / macOS / Linux / Web |
| **技术栈** | Vue 2 + Electron + Node.js + Express |

### 1.2 项目起源

本项目源自 [qier222/YesPlayMusic](https://github.com/qier222/YesPlayMusic)，在原版基础上扩展了**智能推荐系统**，基于用户行为数据构建个性化推荐模型。

### 1.3 核心价值

- 🎵 **高颜值播放体验** - 简洁美观的播放界面
- 🤖 **智能推荐** - 基于用户行为的个性化歌曲推荐
- 🔒 **隐私优先** - 本地行为追踪，不上传用户数据

---

## 2. 系统架构

### 2.1 三服务架构

```
┌─────────────────────────────────────────────────────────────┐
│                        客户端 (浏览器 / Electron)              │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│   │   Frontend  │  │  Recommender │  │  Netease    │        │
│   │   (Vue SPA) │  │   Server     │  │  API        │        │
│   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│          │                 │                  │               │
│          └────────────────┴──────────────────┘               │
│                      本地服务端口                            │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 端口分配

| 端口 | 服务 | 技术栈 | 说明 |
|------|------|--------|------|
| **3001** | Recommender Server | Node.js + Express | 智能推荐后端 |
| **10754** | Netease API | @neteaseapireborn/api | 网易云音乐 API 代理 |
| **6789** | Frontend Dev | Vue CLI | 开发服务器 (browser mode) |
| **27232** | Netease API | @neteaseapireborn/api | Electron 生产模式端口 |

### 2.3 服务职责

| 服务 | 职责 | API 路径 |
|------|------|----------|
| **Frontend** | Vue SPA 前端，用户界面 | - |
| **Recommender Server** | 用户行为追踪、推荐算法 | `/api/event/*`, `/api/recommend` |
| **Netease API** | 网易云音乐接口代理 | 所有其他 `/api/*` |

---

## 3. 功能需求

### 3.1 音乐播放 (核心)

| 功能 | 优先级 | 状态 |
|------|--------|------|
| 歌曲播放/暂停/切歌 | P0 | ✅ |
| 播放列表管理 | P0 | ✅ |
| 歌词显示 | P1 | ✅ |
| 播放模式 (单曲/列表/随机) | P0 | ✅ |
| 音量控制 | P0 | ✅ |
| 进度条拖拽 | P0 | ✅ |

### 3.2 智能推荐系统

| 功能 | 优先级 | 状态 |
|------|--------|------|
| 用户行为追踪 (播放/跳过/喜欢) | P0 | ✅ |
| 个性化推荐列表 | P0 | ✅ |
| Skip Penalty 机制 | P0 | ✅ |
| 多维度特征匹配 | P1 | ✅ |
| 冷启动推荐 | P1 | ✅ |

### 3.3 网易云音乐集成

| 功能 | 优先级 | 状态 |
|------|--------|------|
| 账号登录 | P0 | ✅ |
| 歌单管理 | P0 | ✅ |
| 搜索功能 | P0 | ✅ |
| 私人 FM | P1 | ✅ |
| 每日推荐 | P0 | ✅ |
| 歌手/专辑页面 | P1 | ✅ |
| MV 播放 | P2 | ✅ |

### 3.4 桌面特性 (Electron)

| 功能 | 优先级 | 状态 |
|------|--------|------|
| 系统托盘 | P1 | ✅ |
| 媒体键支持 (MPRIS) | P1 | ✅ |
| Discord Rich Presence | P2 | ✅ |
| 自动更新 | P2 | ✅ |

---

## 4. 技术规格

### 4.1 前端

| 组件 | 技术 | 版本 |
|------|------|------|
| 框架 | Vue.js | 2.6+ |
| 状态管理 | Vuex | 3.x |
| 路由 | Vue Router | 3.x |
| 构建工具 | Vue CLI | 4.x |
| 样式 | Sass | - |
| 播放器 | Plyr + Howler.js | - |
| HTTP 客户端 | Axios | - |

### 4.2 后端

| 组件 | 技术 | 端口 |
|------|------|------|
| 推荐服务 | Express.js | 3001 |
| 网易云 API | @neteaseapireborn/api | 10754 |
| 数据存储 | SQLite (recommender.db) | - |

### 4.3 桌面端

| 组件 | 技术 |
|------|------|
| 框架 | Electron |
| 打包工具 | electron-builder |
| 日志 | electron-log |

---

## 5. API 路由设计

### 5.1 推荐服务 API (端口 3001)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/event/play` | 记录播放事件 |
| POST | `/api/event/skip` | 记录跳过事件 |
| POST | `/api/event/like` | 记录喜欢事件 |
| POST | `/api/event/unlike` | 取消喜欢 |
| GET | `/api/recommend` | 获取推荐列表 |
| GET | `/api/user/profile/:userId` | 用户偏好画像 |
| POST | `/api/user/sync-songs` | 同步歌曲数据 |

### 5.2 网易云 API (端口 10754)

所有未匹配推荐服务的请求都路由到网易云 API，包括：

| 路径模式 | 说明 |
|----------|------|
| `/api/user/*` | 用户相关 |
| `/api/playlist/*` | 歌单相关 |
| `/api/song/*` | 歌曲相关 |
| `/api/search` | 搜索 |
| `/api/personal_fm` | 私人 FM |
| `/api/recommend/songs` | 每日推荐歌曲 |

### 5.3 Vue CLI Proxy 配置

位置：`vue.config.js`

```javascript
proxy: {
  // 推荐服务路由 → :3001
  '^/api/event': { target: 'http://localhost:3001', changeOrigin: true },
  '^/api/recommend$': { target: 'http://localhost:3001', changeOrigin: true },

  // 网易云 API 路由 → :10754
  '^/api': { target: 'http://localhost:10754', changeOrigin: true, pathRewrite: { '^/api': '/' } },
}
```

**注意**：
- 路由顺序很重要，`^/api/recommend$` 必须放在 `^/api` 之前
- `$` 锚点确保精确匹配，避免 `/api/recommend/songs` 被错误路由

---

## 6. 环境变量

### 6.1 开发环境 (`.env.development`)

| 变量 | 值 | 说明 |
|------|-----|------|
| `DEV_SERVER_PORT` | 6789 | 前端开发服务器端口 |
| `VUE_APP_NETEASE_API_URL` | `/api` | 网易云 API (相对路径) |
| `VUE_APP_RECOMMENDER_HOST` | `http://localhost:3001` | 推荐服务 (仅 Electron 模式) |
| `VUE_APP_ELECTRON_API_URL_DEV` | `http://localhost:10754` | Electron 开发环境 API |

### 6.2 生产环境 (`.env.production`)

| 变量 | 值 | 说明 |
|------|-----|------|
| `VUE_APP_NETEASE_API_URL` | `/api` | 网易云 API (相对路径) |
| `VUE_APP_ELECTRON_API_URL` | `http://127.0.0.1:27232/api` | Electron 生产环境 |
| `VUE_APP_RECOMMENDER_HOST` | `http://127.0.0.1:3001` | 推荐服务 (Electron 模式) |

---

## 7. 路径解析逻辑

推荐服务 API (`src/api/recommend.js`) 根据运行环境自动选择路径：

```javascript
const getRecommenderHost = () => {
  if (process.env.IS_ELECTRON) {
    return process.env.VUE_APP_RECOMMENDER_HOST || 'http://localhost:3001';
  }
  return '';  // 浏览器模式用相对路径
};
```

| 运行环境 | 路径方式 | 示例 |
|----------|----------|------|
| 浏览器开发 | 相对路径 (Proxy) | `/api/recommend` → `:3001` |
| Electron 打包 | 绝对路径 | `http://127.0.0.1:3001/api/recommend` |

---

## 8. 关键文件索引

| 文件路径 | 用途 |
|----------|------|
| `vue.config.js` | Vue CLI 配置 + Proxy 路由 |
| `src/utils/request.js` | axios 实例 (网易云 API) |
| `src/api/recommend.js` | 推荐服务 API (含路径解析) |
| `src/electron/services.js` | Electron 后端服务启动 |
| `server/server.js` | 推荐服务 Express 入口 |
| `server/api/events.js` | 事件追踪 API |
| `server/api/recommend.js` | 推荐算法 API |
| `server/api/profile.js` | 用户画像 API |
| `.env.development` | 开发环境变量 |
| `.env.production` | 生产环境变量 |
| `start.sh` | 一键启动脚本 |

---

## 9. 发布流程

### 9.1 发布检查清单

- [ ] Linux 后端验证通过 (端口 3001, 10754)
- [ ] Windows 版本编译成功
- [ ] Git 提交并推送到远程
- [ ] GitHub Release 创建 (如需发布)

### 9.2 构建命令

```bash
# 打包 Linux
npm run electron:build-linux

# 打包 Windows
npm run electron:build-win

# 打包全平台
npm run electron:build
```

---

## 10. 故障排查

### 10.1 404 错误

```bash
# 检查服务状态
ss -tlnp | grep -E "3001|10754"

# 测试服务
curl http://localhost:3001/health
curl http://localhost:10754/personal_fm
```

### 10.2 推荐服务不响应

```bash
# 测试推荐 API
curl "http://localhost:3001/api/recommend?userId=test"
```

### 10.3 路由被错误匹配

确认 `vue.config.js` 中 `^/api/recommend$` 使用了 `$` 锚点。

---

## 附录 A：推荐算法概要

### A.1 用户行为追踪

| 事件 | 触发条件 | 权重影响 |
|------|----------|----------|
| play | 播放超过 30 秒 | +1 播放计数 |
| like | 点击喜欢 | +1 喜好权重 |
| skip | 播放少于 30 秒 | +1 Skip Penalty |
| unlike | 取消喜欢 | -1 喜好权重 |

### A.2 推荐评分公式

```
Score = Σ(特征匹配度 × 权重) - SkipPenalty × 跳过次数
```

### A.3 Skip Penalty 机制

- 播放 < 15 秒跳过：惩罚系数 0.5
- 播放 15-30 秒跳过：惩罚系数 0.3
- 播放 > 30 秒跳过：无惩罚

---

## 附录 B：版本历史

| 版本 | 日期 | 更新内容 |
|------|------|----------|
| 0.5.22 | 2026-04-14 | 智能推荐系统性能优化 |
| 0.5.20 | 2026-04-01 | 初始智能推荐版本 |

---

*文档版本：1.0*
*最后更新：2026-05-04*
