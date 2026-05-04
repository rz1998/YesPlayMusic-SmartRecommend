<div align="center">
	<a href="http://go.warp.dev/ai-musicplayer" target="_blank">
		<sup>Special thanks to:</sup>
		<br>
		<img alt="Warp sponsorship" width="400" src="https://github.com/warpdotdev/brand-assets/blob/main/Github/Sponsor/Warp-Github-LG-03.png?raw=true">
		<br>
		<h>Warp is built for coding with multiple AI agents</b>
		<br>
		<sup>Available for macOS, Linux and Windows</sup>
	</a>
</div>

<br>

---

<br />
<p align="center">
  <a href="https://music.qier222.com" target="blank">
    <img src="images/logo.png" alt="Logo" width="156" height="156">
  </a>
  <h2 align="center" style="font-weight: 600">ai-musicplayer</h2>

  <p align="center">
    高颜值的第三方网易云播放器
    <br />
    <a href="https://music.qier222.com" target="blank"><strong>🌎 访问DEMO</strong></a>&nbsp;&nbsp;|&nbsp;&nbsp;
    <a href="#%EF%B8%8F-安装" target="blank"><strong>📦️ 下载安装包</strong></a>&nbsp;&nbsp;|&nbsp;&nbsp;
    <a href="https://t.me/ai_musicplayer" target="blank"><strong>💬 加入交流群</strong></a>
    <br />
    <br />
  </p>
</p>

[![Library][library-screenshot]](https://music.qier222.com)

---

# ai-musicplayer - 智能推荐版

---

## 第一部分：项目起源与简介

### 项目起源

本项目源自 **ai-musicplayer**（原项目地址：https://github.com/qier222/ai-musicplayer），由 [@qier222](https://github.com/qier222) 开发的高颜值第三方网易云音乐播放器。

ai-musicplayer 是一个开源的网易云音乐客户端，使用 Vue.js 开发，提供美观的界面和丰富的功能，支持 Windows、macOS、Linux 多平台。

### 本项目扩展

本项目在原版基础上进行了功能扩展，主要增加了**智能推荐系统**，由 AI 团队协作开发实现。基于用户行为数据，构建个性化推荐模型，为用户推荐更符合口味的歌曲。

---

## 第二部分：为什么进行修改

### 网易云音乐推荐算法的问题

网易云音乐的推荐算法存在以下问题：

1. **推荐同质化严重** - 推荐的歌曲反复出现，缺乏新鲜感
2. **过度依赖热度** - 热门歌曲霸占推荐位，小众优质音乐难以被发现
3. **用户行为利用不足** - 点赞、跳过等行为信号没有被充分利用
4. **缺乏个性化反馈** - 推荐结果与用户实际偏好匹配度不高

### 本项目的改进目标

针对上述问题，本项目开发了一套**智能推荐系统**，具有以下特点：

- 🎯 **真正个性化** - 基于用户真实行为（播放、点赞、跳过）构建用户画像
- ⚖️ **动态权重调整** - Skip行为根据收听比例动态计算惩罚力度
- 🎭 **多维度匹配** - 综合考虑艺术家、流派、情绪、语言、年代、BPM、能量值
- 🔄 **实时学习** - 用户行为实时更新推荐模型

---

## 第三部分：推荐算法详解

### 1. 用户行为追踪系统

推荐系统自动追踪以下用户行为：

| 事件 | 权重 | 说明 |
|------|------|------|
| `like` | +3 | 用户点赞歌曲 |
| `play` | +1 | 用户完整播放歌曲 |
| `skip` | **动态** | 用户跳过（根据收听比例动态惩罚） |

**数据追踪维度**：
- 播放完成率 = 实际收听时长 / 歌曲总时长
- 跳过行为 = 跳过时间点、收听比例
- 点赞/取消点赞 = 双向追踪
- 歌曲特征 = 流派、情绪、语言、年代、BPM、能量值

### 2. 动态 Skip Penalty（核心创新）

传统推荐系统的skip惩罚是固定的，本项目的核心创新在于**动态计算skip权重**：

```javascript
// 基于收听时长计算惩罚权重
const listenRatio = Math.min(1, listenDuration / songDuration);
const skipWeight = -1 * (1 - listenRatio);

// 0% 收听 = -1.0 (完整惩罚，说明完全不喜欢)
// 90% 收听 = -0.1 (轻微惩罚，可能是外部原因导致跳过)
```

**设计原理**：
- 如果用户只听了 10% 就跳过，说明对这首歌强烈不匹配，给予 -0.9 的惩罚
- 如果用户听了 90% 才跳过，可能是突然有事等原因，给予 -0.1 的轻微惩罚

### 3. 推荐评分公式

```
最终分数 = 喜好匹配分 - 1.5 × 排斥匹配分
```

- **喜好匹配分**：基于用户喜欢的歌曲特征计算
- **排斥匹配分**：基于用户跳过或不喜欢的歌曲特征计算
- 系数 1.5 表示排斥惩罚的权重略高于喜好奖励

### 4. 多维度匹配权重

#### 喜好权重（用户喜欢的歌曲具备的特征）

| 维度 | 权重 |
|------|------|
| 艺术家 | 0.50 |
| 流派 | 0.30 |
| BPM相似度 | 0.10 |
| 情绪 | 0.20 |
| 语言 | 0.25 |
| 年代 | 0.10 |
| 能量相似度 | 0.05 |

#### 排斥权重（用户不喜欢的歌曲具备的特征）

| 维度 | 权重 |
|------|------|
| 艺术家 | 0.50 |
| 流派 | 0.30 |
| 情绪 | 0.20 |
| 语言 | 0.25 |
| 年代 | 0.10 |

### 5. 系统架构

```
┌─────────────────────────────────────────────────────┐
│                   前端 (Vue.js)                      │
│  ┌─────────────────┐  ┌─────────────────────────┐  │
│  │ playBehaviorTracker │  │  smartRecommend.vue   │  │
│  │   自动追踪播放行为  │  │     智能推荐页面      │  │
│  └────────┬────────┘  └───────────┬─────────────┘  │
└───────────┼───────────────────────┼─────────────────┘
            │ POST /api/events      │ GET /api/recommend
            ▼                       ▼
┌─────────────────────────────────────────────────────┐
│               后端 (Express.js)                      │
│  ┌──────────────┐  ┌──────────────────────────────┐ │
│  │  events.js   │  │     recommend.js            │ │
│  │  事件追踪API  │  │   推荐算法 + 评分计算        │ │
│  └──────┬───────┘  └──────────────┬───────────────┘ │
│         │                          │                  │
│         ▼                          ▼                  │
│  ┌──────────────────────────────────────────────┐  │
│  │              SQLite 数据库                     │  │
│  │  user_events / song_features / user_profiles  │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## 第四部分：编译安装指南

### 🚀 GitHub Actions 自动编译（本项目推荐方式）

本项目配置了 GitHub Actions CI/CD，**推送版本标签时自动编译**三个平台的安装包。

#### 自动编译触发方式

```bash
# 1. 克隆本仓库
git clone --recursive https://github.com/rz1998/ai-musicplayer.git
cd ai-musicplayer

# 2. 创建版本标签并推送
git tag v0.4.11
git push origin v0.4.11
```

推送标签后，GitHub Actions 会自动构建：
- ✅ **macOS** - 生成 .dmg 安装包
- ✅ **Windows** - 生成 .exe 安装包
- ✅ **Linux** - 生成 .AppImage 等安装包

构建完成后，在 GitHub Releases 页面下载对应平台的安装包。

---

### 各操作系统安装

#### Windows 用户

**方式一：下载安装包（推荐）**

1. 访问 [Releases 页面](https://github.com/rz1998/ai-musicplayer/releases)
2. 下载 Windows 版本安装包（.exe 或 .msi）
3. 双击安装即可

**方式二：Scoop 安装**

```bash
scoop install extras/ai-musicplayer
```

**方式三：从源码打包**

```bash
# 1. 安装 Node.js 和 Yarn
# Node.js: https://nodejs.org/zh-cn/
# Yarn: npm install -g yarn

# 2. 克隆仓库
git clone --recursive https://github.com/rz1998/ai-musicplayer.git
cd ai-musicplayer

# 3. 安装依赖
yarn install

# 4. 配置环境变量
cp .env.example .env
# 修改 .env 中的 VUE_APP_NETEASE_API_URL

# 5. 打包
yarn electron:build --windows nsis:ia32    # Windows 32位
yarn electron:build --windows nsis:arm64    # Windows ARM
```

**方式四：Docker 部署**

```bash
# 构建镜像
docker build -t ai-musicplayer .

# 运行容器
docker run -d --name ai-musicplayer -p 80:80 ai-musicplayer
```

---

### macOS 用户

**方式一：下载安装包（推荐）**

1. 访问 [Releases 页面](https://github.com/rz1998/ai-musicplayer/releases)
2. 下载 macOS 版本安装包（.dmg）
3. 拖动到应用程序文件夹即可

**方式二：Homebrew 安装**

```bash
brew install --cask ai-musicplayer
```

**方式三：从源码打包**

```bash
# 1. 安装 Node.js 和 Yarn
# Node.js: https://nodejs.org/zh-cn/
# Yarn: npm install -g yarn

# 2. 克隆仓库
git clone --recursive https://github.com/rz1998/ai-musicplayer.git
cd ai-musicplayer

# 3. 安装依赖
yarn install

# 4. 配置环境变量
cp .env.example .env
# 修改 .env 中的 VUE_APP_NETEASE_API_URL

# 5. 打包
yarn electron:build --macos dir:arm64    # macOS ARM (Apple Silicon)
yarn electron:build --macos dir:x64      # macOS x64 (Intel)
```

---

### Linux 用户

**方式一：下载安装包（推荐）**

1. 访问 [Releases 页面](https://github.com/rz1998/ai-musicplayer/releases)
2. 下载对应架构的安装包（.deb, .AppImage 等）
3. 使用包管理器安装

**方式二：Docker 部署**

```bash
# 构建镜像
docker build -t ai-musicplayer .

# 运行容器
docker run -d --name ai-musicplayer -p 80:80 ai-musicplayer
```

**方式三：从源码打包**

```bash
# 1. 安装 Node.js 和 Yarn
# Node.js: https://nodejs.org/zh-cn/
# Yarn: npm install -g yarn

# 2. 克隆仓库
git clone --recursive https://github.com/rz1998/ai-musicplayer.git
cd ai-musicplayer

# 3. 安装依赖
yarn install

# 4. 配置环境变量
cp .env.example .env
# 修改 .env 中的 VUE_APP_NETEASE_API_URL

# 5. 打包
yarn electron:build --linux deb:armv7l    # Debian armv7l（树莓派等）
yarn electron:build --linux AppImage       # 通用 AppImage
yarn electron:build --linux deb            # Debian/Ubuntu
yarn electron:build --linux rpm            # Fedora/RHEL
```

---

### 服务器部署

#### Vercel 部署

1. Fork 本仓库到你的 GitHub
2. 创建 `vercel.json` 文件：
```json
{
  "rewrites": [
    {
      "source": "/api/:match*",
      "destination": "https://your-netease-api.example.com/:match*"
    }
  ]
}
```
3. 在 Vercel 导入仓库，设置环境变量 `VUE_APP_NETEASE_API_URL=/api`

#### 宝塔面板 Docker 部署

1. 安装宝塔面板
2. 在 Docker 应用商店找到 ai-musicplayer
3. 点击安装，配置域名和端口即可

#### 手动部署到服务器

```bash
# 1. 克隆仓库
git clone --recursive https://github.com/qier222/ai-musicplayer.git
cd ai-musicplayer

# 2. 安装依赖
yarn install

# 3. 配置环境变量
cp .env.example .env
# 修改 VUE_APP_NETEASE_API_URL

# 4. 编译打包
yarn run build

# 5. 将 dist 目录部署到 Web 服务器
```

---

### 开发环境运行

```bash
# 安装依赖
yarn install

# 创建环境变量
cp .env.example .env

# 运行网页端
yarn serve

# 运行 Electron
yarn electron:serve

# 运行网易云 API
yarn netease_api:run
```

---

## 启动智能推荐服务

```bash
# 1. 启动推荐服务
cd server && npm start

# 2. 访问智能推荐页面
# http://localhost:8080/#/smart-recommend
```

---

## 全新版本

全新 2.0 Alpha 测试版已发布，欢迎前往 [Releases](https://github.com/qier222/ai-musicplayer/releases) 页面下载。
当前版本将会进入维护模式，除重大 bug 修复外，不会再更新新功能。

## 最近更新 (2026-04-14)

### 智能推荐系统 - 性能优化与新功能

- 🆕 **推荐结果缓存** - 服务端 5 分钟 TTL 缓存，减少重复计算
- 🆕 **同步后自动刷新** - 用户同步歌曲后自动刷新推荐结果
- 🆕 **手动刷新按钮** - 智能推荐页面新增「🔄 刷新推荐」按钮
- 🔧 **like/unlike toggle** - 修复取消点赞功能不生效的问题
- 🔧 **动态 skip penalty** - 客户端 skip 检测现在与文档一致（30% 收听比例）
- 🔧 **skip 反悔逻辑** - 跳过后再点赞的歌曲现在可以正确被推荐
- 🔧 **数据库查询优化** - 修复 liked/skipped 歌曲上限截断问题（100→1000）
- 🔧 **代码清理** - 删除重复端点和死代码

详细算法说明见 [docs/SMART_RECOMMEND.md](./docs/SMART_RECOMMEND.md)

## ✨ 特性

- ✅ 使用 Vue.js 全家桶开发
- 🔴 网易云账号登录（扫码/手机/邮箱登录）
- 📺 支持 MV 播放
- 📃 支持歌词显示
- 📻 支持私人 FM / 每日推荐歌曲
- 🤖 **智能推荐** - AI 驱动的个性化歌曲推荐（**本项目扩展**）
- 🚫🤝 无任何社交功能
- 🌎️ 海外用户可直接播放（需要登录网易云账号）
- 🔐 支持 [UnblockNeteaseMusic](https://github.com/UnblockNeteaseMusic/server#音源清单)，自动使用[各类音源](https://github.com/UnblockNeteaseMusic/server#音源清单)替换变灰歌曲链接 （网页版不支持）
  - 「各类音源」指默认启用的音源。
  - YouTube 音源需自行安装 `yt-dlp`。
- ~~✔️ 每日自动签到（手机端和电脑端同时签到）~~
- 🌚 Light/Dark Mode 自动切换
- 👆 支持 Touch Bar
- 🖥️ 支持 PWA，可在 Chrome/Edge 里点击地址栏右边的 ➕ 安装到电脑
- 🟥 支持 Last.fm Scrobble
- ☁️ 支持音乐云盘
- ⌨️ 自定义快捷键和全局快捷键
- 🎧 支持 Mpris
- 🛠 更多特性开发中

## 📦️ 安装

Electron 版本由 [@rz1998](https://github.com/rz1998) 维护，支持 macOS、Windows、Linux。

访问本项目的 [Releases](https://github.com/rz1998/ai-musicplayer/releases)
页面下载安装包。

- macOS 用户可以通过 Homebrew 来安装：`brew install --cask ai-musicplayer`

- Windows 用户可以通过 Scoop 来安装：`scoop install ai-musicplayer`

## 同类项目（排名无先后）

欢迎大家通过 PR 分享你的项目，让更多人看到！

- [algerkong/AlgerMusicPlayer](https://github.com/algerkong/AlgerMusicPlayer)
- [asxez/MusicBox](https://github.com/asxez/MusicBox)
- [lianchengwu/wmplayer](https://github.com/lianchengwu/wmplayer)

## ⚙️ 部署至 Vercel

除了下载安装包使用，你还可以将本项目部署到 Vercel 或你的服务器上。下面是部署到 Vercel 的方法。

本项目的 Demo (https://music.qier222.com) 就是部署在 Vercel 上的网站。

[![Powered by Vercel](https://www.datocms-assets.com/31049/1618983297-powered-by-vercel.svg)](https://vercel.com/?utm_source=ohmusic&utm_campaign=oss)

1. 部署网易云 API，详情参见 [Binaryify/NeteaseCloudMusicApi](https://neteasecloudmusicapi.vercel.app/#/?id=%e5%ae%89%e8%a3%85)
   。你也可以将 API 部署到 Vercel。

2. 点击本仓库右上角的 Fork，复制本仓库到你的 GitHub 账号。

3. 点击仓库的 Add File，选择 Create new file，输入 `vercel.json`，将下面的内容复制粘贴到文件中，并将 `https://your-netease-api.example.com` 替换为你刚刚部署的网易云 API 地址：

```json
{
  "rewrites": [
    {
      "source": "/api/:match*",
      "destination": "https://your-netease-api.example.com/:match*"
    }
  ]
}
```

4. 打开 [Vercel.com](https://vercel.com)，使用 GitHub 登录。

5. 点击 Import Git Repository 并选择你刚刚复制的仓库并点击 Import。

6. 点击 PERSONAL ACCOUNT 旁边的 Select。

7. 点击 Environment Variables，填写 Name 为 `VUE_APP_NETEASE_API_URL`，Value 为 `/api`，点击 Add。最后点击底部的 Deploy 就可以部署到
   Vercel 了。

## ⚙️ 部署到自己的服务器

除了部署到 Vercel，你还可以部署到自己的服务器上

1. 部署网易云 API，详情参见 [Binaryify/NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi)
2. 克隆本仓库

```sh
git clone --recursive https://github.com/qier222/ai-musicplayer.git
```

3. 安装依赖

```sh
yarn install

```

4. （可选）使用 Nginx 反向代理 API，将 API 路径映射为 `/api`，如果 API 和网页不在同一个域名下的话（跨域），会有一些 bug。

5. 复制 `/.env.example` 文件为 `/.env`，修改里面 `VUE_APP_NETEASE_API_URL` 的值为网易云 API 地址。本地开发的话可以填写 API 地址为 `http://localhost:3000`，ai-musicplayer 地址为 `http://localhost:8080`。如果你使用了反向代理 API，可以填写 API 地址为 `/api`。

```
VUE_APP_NETEASE_API_URL=http://localhost:3000
```

6. 编译打包

```sh
yarn run build
```

7. 将 `/dist` 目录下的文件上传到你的 Web 服务器

## ⚙️ 宝塔面板 docker 应用商店 部署

1. 安装宝塔面板，前往[宝塔面板官网](https://www.bt.cn/new/download.html) ，选择正式版的脚本下载安装。

2. 安装后登录宝塔面板，在左侧导航栏中点击 Docker，首次进入会提示安装 Docker 服务，点击立即安装，按提示完成安装

3. 安装完成后在应用商店中找到 ai-musicplayer，点击安装，配置域名、端口等基本信息即可完成安装。

4. 安装后在浏览器输入上一步骤设置的域名即可访问。

## ⚙️ Docker 部署

1. 构建 Docker Image

```sh
docker build -t ai-musicplayer .
```

2. 启动 Docker Container

```sh
docker run -d --name ai-musicplayer -p 80:80 ai-musicplayer
```

3. Docker Compose 启动

```sh
docker-compose up -d
```

ai-musicplayer 地址为 `http://localhost`

## ⚙️ 部署至 Replit

1. 新建 Repl，选择 Bash 模板

2. 在 Replit shell 中运行以下命令

```sh
bash <(curl -s -L https://raw.githubusercontent.com/qier222/ai-musicplayer/main/install-replit.sh)
```

3. 首次运行成功后，只需点击绿色按钮 `Run` 即可再次运行

4. 由于 replit 个人版限制内存为 1G（教育版为 3G），构建过程中可能会失败，请再次运行上述命令或运行以下命令：

```sh
cd /home/runner/${REPL_SLUG}/music && yarn install && yarn run build
```

## 👷♂ 打包客户端

如果在 Release 页面没有找到适合你的设备的安装包的话，你可以根据下面的步骤来打包自己的客户端。

1. 打包 Electron 需要用到 Node.js 和 Yarn。可前往 [Node.js 官网](https://nodejs.org/zh-cn/) 下载安装包。安装 Node.js
   后可在终端里执行 `npm install -g yarn` 来安装 Yarn。

2. 使用 `git clone --recursive https://github.com/qier222/ai-musicplayer.git` 克隆本仓库到本地。

3. 使用 `yarn install` 安装项目依赖。

4. 复制 `/.env.example` 文件为 `/.env` 。

5. 选择下列表格的命令来打包适合的你的安装包，打包出来的文件在 `/dist_electron` 目录下。了解更多信息可访问 [electron-builder 文档](https://www.electron.build/cli)

| 命令                                       | 说明                      |
| ------------------------------------------ | ------------------------- |
| `yarn electron:build --windows nsis:ia32`  | Windows 32 位             |
| `yarn electron:build --windows nsis:arm64` | Windows ARM               |
| `yarn electron:build --linux deb:armv7l`   | Debian armv7l（树莓派等） |
| `yarn electron:build --macos dir:arm64`    | macOS ARM                 |

## :computer: 配置开发环境

本项目由 [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) 提供 API。

运行本项目

```shell
# 安装依赖
yarn install

# 创建本地环境变量
cp .env.example .env

# 运行（网页端）
yarn serve

# 运行（electron）
yarn electron:serve
```

本地运行 NeteaseCloudMusicApi，或者将 API [部署至 Vercel](#%EF%B8%8F-部署至-vercel)

```shell
# 运行 API （默认 3000 端口）
yarn netease_api:run
```

## ☑️ Todo

查看 Todo 请访问本项目的 [Projects](https://github.com/qier222/ai-musicplayer/projects/1)

欢迎提 Issue 和 Pull request。

## 📜 开源许可

本项目仅供个人学习研究使用，禁止用于商业及非法用途。

基于 [MIT license](https://opensource.org/licenses/MIT) 许可进行开源。

## 灵感来源

API 源代码来自 [Binaryify/NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi)

- [Apple Music](https://music.apple.com)
- [YouTube Music](https://music.youtube.com)
- [Spotify](https://www.spotify.com)
- [网易云音乐](https://music.163.com)

## 🖼️ 截图

![lyrics][lyrics-screenshot]
![library-dark][library-dark-screenshot]
![album][album-screenshot]
![home-2][home-2-screenshot]
![artist][artist-screenshot]
![search][search-screenshot]
![home][home-screenshot]
![explore][explore-screenshot]

<!-- MARKDOWN LINKS & IMAGES -->
<!-- https://www.markdownguide.org/basic-syntax/#reference-style-links -->

[album-screenshot]: images/album.png
[artist-screenshot]: images/artist.png
[explore-screenshot]: images/explore.png
[home-screenshot]: images/home.png
[home-2-screenshot]: images/home-2.png
[lyrics-screenshot]: images/lyrics.png
[library-screenshot]: images/library.png
[library-dark-screenshot]: images/library-dark.png
[search-screenshot]: images/search.png
