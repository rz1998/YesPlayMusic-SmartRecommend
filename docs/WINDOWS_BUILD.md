# 构建路径规范

> 最后更新：2026-04-26

---

## 概述

本文档记录 ai-musicplayer 构建中的**关键路径配置**，适用于 **Windows / Linux / macOS** 全平台。

> ⚠️ Windows 特有的内容已用 `[Windows]` 标签标注。

---

## 服务端口

| 服务 | 端口 | 说明 |
|------|------|------|
| Electron 主进程 | 27232 | Express 后台，代理 API 请求 |
| NeteaseMusicAPI | 10754 | 网易云音乐 API 服务 |
| 推荐服务 | 3001 | 个性化推荐服务 |

---

## API 路径规范

### 前端请求路径

```
前端 baseURL: http://127.0.0.1:27232/api
```

**请求流程：**
```
前端 → GET /api/personalized → Express (27232)
                              → proxy: /api/* → NeteaseMusicAPI (10754)
```

**关键约束：**
- `VUE_APP_ELECTRON_API_URL` 必须包含 `/api` 后缀
- 前端请求会自动加上 `/api` 前缀，被 Express 代理到 10754
- 若 baseURL 缺少 `/api`，所有请求会 404

### 反向代理配置

```javascript
// src/background.js
expressApp.use('/api', expressProxy('http://127.0.0.1:10754'));
```

- 所有 `/api/*` 请求转发到 10754
- 10754 返回的数据直接透传给前端

---

## 构建配置

### .env.production

```env
VUE_APP_NETEASE_API_URL=/api
VUE_APP_ELECTRON_API_URL=http://127.0.0.1:27232/api
VUE_APP_ELECTRON_API_URL_DEV=http://127.0.0.1:10754
VUE_APP_LASTFM_API_KEY=09c55292403d961aa517ff7f5e8a3d9c
VUE_APP_LASTFM_API_SHARED_SECRET=307c9fda32b3904e53654baff215cb67
```

### electron-builder.yml

```yaml
appId: com.aimusicplayer.app
productName: ai-musicplayer
directories:
  app: dist_electron/bundled
  output: dist_electron
files:
  - "**/*"
asar: false
afterPack: ./scripts/afterPackNoAsar.js   # 跨平台，注入 server + node_modules
win:                                        # [Windows] NSIS 安装包
  target:
    - target: nsis
      arch:
        - x64
nsis:
  artifactName: ai-musicplayer-${version}-win-setup.exe
```

### afterPack 脚本

`scripts/afterPackNoAsar.js` — 打包后注入：
1. `server/` 目录（推荐服务）
2. 所有必需的 `node_modules`（@neteaseapireborn/api 等）

---

## server/ 目录路径

```javascript
// src/electron/services.js
const isDev = !app.isPackaged;
const serverPath = isDev
  ? path.join(process.cwd(), 'server')
  : path.join(process.resourcesPath, 'app', 'server');  // asar: false
```

---

## 构建命令

```bash
# Windows
npm run electron:build-win

# Linux
npm run electron:build-linux

# macOS
npm run electron:build-mac
```

## 变更记录

| 日期 | 修改内容 |
|------|---------|
| 2026-04-26 | 首次创建文档 |
| | 发现 VUE_APP_ELECTRON_API_URL 必须包含 `/api` 后缀 |
| | 发现 asar: false 时 server 路径为 `process.resourcesPath + '/app/server'` |
