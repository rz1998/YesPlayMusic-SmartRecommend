# 开发规范

## 发布流程 ⚠️

**重要：先测 Linux 后端，再编译 Windows 版本**

### 1. 清理旧构建文件

```bash
cd ~/workspace/ai-musicplayer
# 删除旧的打包产物
rm -f dist_electron/*.exe
rm -f dist_electron/*.tar.gz
rm -f dist_electron/*.AppImage
rm -f dist_electron/*.snap
rm -f dist_electron/*.deb
# 删除旧的 unpacked 目录（可选）
rm -rf dist_electron/win-unpacked
rm -rf dist_electron/linux-unpacked
rm -rf dist_electron/linux-arm64-unpacked
rm -rf dist_electron/linux-armv7l-unpacked
```

### 2. Linux 环境测试后端

```bash
# 打包 Linux 版本
npm run electron:build-linux

# 验证后端服务
./dist_electron/linux-unpacked/ai-musicplayer --no-sandbox &
sleep 8

# 检查端口
ss -tlnp | grep -E "3001|10754"

# 测试 API
curl --noproxy '*' -s -o /dev/null -w "%{http_code}" http://localhost:3001/
curl --noproxy '*' -s -o /dev/null -w "%{http_code}" http://localhost:10754/
```

**验证通过标准**：
- 端口 3001 和 10754 都在监听
- 两个端口都返回 200 或有效 JSON

### 3. 编译 Windows 版本

确认 Linux 后端验证通过后，执行：

```bash
npm run electron:build
```

### 4. 文件命名规范

打包产物文件名格式：`ai-musicplayer-{版本号}.{平台}.{后缀}`

| 产物 | 命名规范 | 示例 |
|------|----------|------|
| Windows 便携版 | `ai-musicplayer-{ver}.exe` | `ai-musicplayer-0.5.22.exe` |
| Linux tar.gz | `ai-musicplayer-{ver}.tar.gz` | `ai-musicplayer-0.5.22.tar.gz` |
| Linux ARM64 | `ai-musicplayer-{ver}-arm64.tar.gz` | `ai-musicplayer-0.5.22-arm64.tar.gz` |
| AppImage | `ai-musicplayer-{ver}.AppImage` | `ai-musicplayer-0.5.22.AppImage` |

版本号从 `package.json` 的 `version` 字段读取，不带 `v` 前缀。

### 5. 构建完成检查

```bash
# 确认文件存在
ls -lh dist_electron/*.exe
ls -lh dist_electron/*.tar.gz
```

## 技术备忘

### 模块加载修复
- 使用 `require('module').createRequire(__filename)` 绕过 webpack 的 require 包装
- 参见 `src/electron/services.js`

### 端口说明
| 端口 | 服务 | 说明 |
|------|------|------|
| 3001 | 推荐服务器 | YesPlayMusic 智能推荐后端 |
| 10754 | Netease API | 网易云音乐 API 代理 |
| 6789 | 前端开发服务器 | Vue CLI dev server |

### 关键文件
- `vue.config.js`：Electron 构建配置 + API 路由代理配置
- `electron-builder.yml`：electron-builder 平台配置
- `src/electron/services.js`：服务启动逻辑
- `server/server.js`：推荐服务器 Express app

---

## API 路由架构设计

### 1. 架构概述

本项目采用**三服务分离架构**：

```
┌─────────────┐     ┌─────────────────┐     ┌──────────────────┐
│   前端 Vue   │────▶│  Vue CLI Proxy  │────▶│  Recommender     │
│  (浏览器)    │     │   (路由分发)     │     │  Server :3001    │
└─────────────┘     └────────┬────────┘     └──────────────────┘
                           │
                           │ (未匹配的 /api/*)
                           ▼
                  ┌──────────────────┐
                  │  Netease API     │
                  │  Server :10754   │
                  └──────────────────┘
```

### 2. 服务职责

| 服务 | 端口 | 职责 | 技术栈 |
|------|------|------|--------|
| **Frontend** | 6789 | Vue CLI 开发服务器 + API 代理 | Vue 2 + Webpack |
| **Recommender** | 3001 | 智能推荐服务（用户行为追踪、推荐算法） | Node.js + Express |
| **Netease API** | 10754 | 网易云音乐 API 代理 | @neteaseapireborn/api |

### 3. API 路由对照表

#### 3.1 推荐服务路由 (Recommender Server :3001)

| 前端路径 | 后端路径 | 说明 | 实现文件 |
|----------|----------|------|----------|
| `POST /api/event/play` | `/api/event/play` | 记录播放事件 | `server/api/events.js` |
| `POST /api/event/skip` | `/api/event/skip` | 记录跳过事件 | `server/api/events.js` |
| `POST /api/event/like` | `/api/event/like` | 记录喜欢事件 | `server/api/events.js` |
| `POST /api/event/unlike` | `/api/event/unlike` | 取消喜欢 | `server/api/events.js` |
| `GET /api/recommend` | `/api/recommend` | 获取智能推荐 | `server/api/recommend.js` |
| `GET /api/user/profile/:userId` | `/api/user/profile/:userId` | 用户偏好画像 | `server/api/profile.js` |
| `POST /api/user/sync-songs` | `/api/user/sync-songs` | 同步歌曲数据 | `server/api/profile.js` |

#### 3.2 网易云服务路由 (Netease API Server :10754)

所有未匹配推荐服务的 `/api/*` 请求都路由到网易云 API，包括：

| 前端路径 | 后端路径 | 说明 |
|----------|----------|------|
| `/api/user/account` | `/user/account` | 账号信息 |
| `/api/user/detail` | `/user/detail` | 用户详情 |
| `/api/playlist/detail` | `/playlist/detail` | 歌单详情 |
| `/api/song/url` | `/song/url` | 歌曲URL |
| `/api/song/detail` | `/song/detail` | 歌曲详情 |
| `/api/lyric` | `/lyric` | 歌词 |
| `/api/search` | `/search` | 搜索 |
| `/api/personal_fm` | `/personal_fm` | 私人FM |
| `/api/recommend/songs` | `/recommend/songs` | 每日推荐歌曲 |
| `/api/recommend/resource` | `/recommend/resource` | 每日推荐歌单 |
| `/api/album/:id` | `/album` | 专辑内容 |
| `/api/artists` | `/artists` | 歌手信息 |
| `/api/mv/*` | `/mv/*` | MV 相关 |
| `/api/login/*` | `/login/*` | 登录相关 |
| ... | ... | 所有其他网易云 API |

### 4. Vue CLI Proxy 配置

位置：`vue.config.js`

```javascript
proxy: {
  // 推荐服务路由 → :3001
  '^/api/event': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
  '^/api/recommend$': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
  '^/api/user/profile': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },

  // 网易云 API 路由 → :10754 (所有其他 /api/*)
  '^/api': {
    target: 'http://localhost:10754',
    changeOrigin: true,
    pathRewrite: { '^/api': '/' },
  },
}
```

**关键配置说明**：

1. **路由顺序很重要**：Vue CLI proxy 按顺序匹配，先配置的优先
2. **精确匹配 `/api/recommend`**：使用 `$` 锚点确保只匹配根路径，不匹配 `/api/recommend/songs`
3. **pathRewrite 仅用于 Netease API**：网易云 API 路径是 `/song/url` 而不是 `/api/song/url`，所以需要去除 `/api` 前缀
4. **推荐服务不需要 pathRewrite**：因为 recommender 服务器的路由也是 `/api/*` 格式

### 5. 前端 API 调用方式

#### 5.1 推荐服务调用（直接使用 fetch）

```javascript
// src/api/recommend.js
const RECOMMENDER_HOST = process.env.VUE_APP_RECOMMENDER_HOST || 'http://localhost:3001';

export function getRecommendations(userId, limit = 20) {
  return fetch(`${RECOMMENDER_HOST}/api/recommend?userId=${userId}&limit=${limit}`)
    .then(r => r.json());
}
```

**特点**：
- 直接连接推荐服务，不走 Vue CLI proxy
- 适用于需要跨域或自定义配置的请求

#### 5.2 网易云 API 调用（通过 request.js）

```javascript
// src/api/track.js
import request from '@/utils/request';

export function getMP3(id) {
  return request({
    url: '/song/url',
    method: 'get',
    params: { id },
  });
}
```

**特点**：
- 通过 `request.js` 封装的 axios 实例
- baseURL 设为 `/api`，由 Vue CLI proxy 转发到 10754

### 6. 环境变量

#### 6.1 开发环境 (`.env.development`)

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `DEV_SERVER_PORT` | 6789 | 前端开发服务器端口 |
| `VUE_APP_NETEASE_API_URL` | `/api` | 网易云 API baseURL（开发用相对路径，走 Vue Proxy） |
| `VUE_APP_RECOMMENDER_HOST` | `http://localhost:3001` | 推荐服务地址（仅 Electron 模式使用） |
| `VUE_APP_ELECTRON_API_URL_DEV` | `http://localhost:10754` | Electron 开发环境 API |

#### 6.2 生产环境 (`.env.production`)

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `VUE_APP_NETEASE_API_URL` | `/api` | 网易云 API baseURL（走 Vue Proxy） |
| `VUE_APP_ELECTRON_API_URL` | `http://127.0.0.1:27232/api` | Electron 生产环境网易云 API |
| `VUE_APP_RECOMMENDER_HOST` | `http://127.0.0.1:3001` | 推荐服务地址（Electron 模式直连） |

### 7. 路径解析逻辑

推荐服务 API (`src/api/recommend.js`) 根据运行环境自动选择路径：

```javascript
const getRecommenderHost = () => {
  if (process.env.IS_ELECTRON) {
    // Electron 打包模式：直连本地服务
    return process.env.VUE_APP_RECOMMENDER_HOST || 'http://localhost:3001';
  }
  // 浏览器开发模式：通过 Vue CLI Proxy 转发
  return '';
};
```

| 运行环境 | 路径方式 | 实际地址 |
|----------|----------|----------|
| **浏览器开发** | 相对路径 | `/api/recommend` → Vue Proxy → `:3001` |
| **Electron 打包** | 绝对路径 | `http://127.0.0.1:3001/api/recommend` |

### 8. Electron 打包架构

Electron 打包后，后端服务随应用自动启动，无需额外配置：

```
┌─────────────────────────────────────────────────────────┐
│                    Electron App                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │   Frontend   │  │  Recommender │  │  Netease API │ │
│  │   (Vue SPA)  │  │   :3001      │  │   :10754     │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │
│         │                  │                   │         │
│         └──────────────────┴───────────────────┘         │
│                    127.0.0.1                            │
└─────────────────────────────────────────────────────────┘
```

**启动顺序**：
1. Electron 主进程启动
2. `services.js` 启动 Netease API (`:10754`)
3. `services.js` 启动 Recommender Server (`:3001`)
4. Frontend 通过 `http://127.0.0.1:3001` 调用推荐服务

### 10. 开发启动

```bash
# 一键启动所有服务
./start.sh

# 或手动启动
# 1. 启动推荐服务 (端口 3001)
cd server && node server.js

# 2. 启动网易云 API (端口 10754)
npx @neteaseapireborn/api server &

# 3. 启动前端 (端口 6789)
npm run serve
```

### 11. 故障排查

#### 11.1 404 错误

**症状**：API 返回 404

**排查步骤**：
1. 确认目标服务是否运行：`ss -tlnp | grep -E "3001|10754"`
2. 测试服务是否正常：
   ```bash
   curl http://localhost:3001/health
   curl http://localhost:10754/personal_fm
   ```
3. 检查 vue.config.js proxy 配置顺序

#### 11.2 推荐服务不响应

**症状**：`/api/recommend` 返回错误

**排查**：
```bash
# 查看推荐服务日志
curl http://localhost:3001/api/recommend?userId=test
```

#### 11.3 路由被错误匹配

**症状**：`/api/recommend/songs` 被路由到推荐服务

**原因**：`^/api/recommend$` 配置错误，缺少 `$` 锚点

**修复**：确保配置为 `'^/api/recommend$':` 而不是 `'^/api/recommend':`

---

### 12. 相关文件索引

| 文件路径 | 用途 |
|----------|------|
| `vue.config.js` | Vue CLI 配置，包含 proxy 路由规则 |
| `src/utils/request.js` | axios 实例，网易云 API 调用基础 |
| `src/api/recommend.js` | 推荐服务 API 封装（含路径解析逻辑） |
| `src/electron/services.js` | Electron 后端服务启动逻辑 |
| `server/server.js` | 推荐服务 Express 入口 |
| `server/api/events.js` | 事件追踪 API 实现 |
| `server/api/recommend.js` | 推荐算法 API 实现 |
| `server/api/profile.js` | 用户画像 API 实现 |
| `.env.development` | 开发环境变量 |
| `.env.production` | 生产环境变量 |
| `start.sh` | 一键启动脚本 |
