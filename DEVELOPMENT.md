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
- 3001：推荐服务器（YesPlayMusic 后端 API）
- 10754：Netease Music API 代理

### 关键文件
- `vue.config.js`：Electron 构建配置，第 98 行 `asar: false`
- `electron-builder.yml`：electron-builder 平台配置
- `src/electron/services.js`：服务启动逻辑
- `server/server.js`：推荐服务器 Express app
