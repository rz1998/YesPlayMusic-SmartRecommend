/**
 * afterPack hook for electron-builder (no asar mode)
 *
 * 在 electron-builder 打包后（文件已复制到 appOutDir），注入：
 * 1. server/ 目录
 * 2. 所有必需的 node_modules
 *
 * asar: false 时，app 目录直接是 dist_electron/bundled/，
 * afterPack 直接修改该目录
 */
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

exports.default = async function afterPack(context) {
  const { appOutDir } = context;

  // app/ 目录（asar: false 时，文件直接在这里）
  const appDir = path.join(appOutDir, 'resources', 'app');
  const nmSrc = path.join(__dirname, '..', 'node_modules');
  const serverSrc = path.join(__dirname, '..', 'server');

  console.log(`[afterPack] Injecting into ${appDir}...`);

  // ── 1. 复制 server/ 目录 ──────────────────────────────────────────
  if (fs.existsSync(serverSrc)) {
    const serverDest = path.join(appDir, 'server');
    console.log('[afterPack] Copying server/...');

    function copyDirDeep(src, dest) {
      fs.mkdirSync(dest, { recursive: true });
      const entries = fs.readdirSync(src, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '.git' && entry.name !== 'test' && entry.name !== 'node_modules') {
            copyDirDeep(srcPath, destPath);
          }
        } else {
          fs.copyFileSync(srcPath, destPath);
        }
      }
    }

    copyDirDeep(serverSrc, serverDest);
    console.log('  + server/');
  }

  // ── 1.5 复制 server/ 为 node_modules/server/（让 require('server/server.js') 能找到）
  // server/ 被 webpack 标记为 external，运行时需要从 node_modules/server/ 加载
  const serverNmDest = path.join(appDir, 'node_modules', 'server');
  if (fs.existsSync(serverSrc)) {
    console.log('[afterPack] Creating node_modules/server/ for webpack externals...');

    function copyDirDeepForNm(src, dest) {
      fs.mkdirSync(dest, { recursive: true });
      const entries = fs.readdirSync(src, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '.git' && entry.name !== 'test') {
            copyDirDeepForNm(srcPath, destPath);
          }
        } else {
          fs.copyFileSync(srcPath, destPath);
        }
      }
    }

    copyDirDeepForNm(serverSrc, serverNmDest);
    console.log('  + node_modules/server/');
  }

  // ── 1.6 复制 server/node_modules（推荐服务依赖）──────────────────────
  const serverNmSrc = path.join(__dirname, '..', 'server', 'node_modules');
  if (fs.existsSync(serverNmSrc)) {
    const serverNmDest = path.join(appDir, 'server', 'node_modules');
    console.log('[afterPack] Copying server/node_modules...');

    async function copyNmModule(src, dest) {
      try {
        await fsp.cp(src, dest, { recursive: true, force: true });
      } catch {
        execSync(`cp -rL "${src}" "${dest}"`, { stdio: 'ignore' });
      }
    }

    await copyNmModule(serverNmSrc, serverNmDest);
    console.log('  + server/node_modules/');
  } else {
    console.log('[afterPack] Warning: server/node_modules not found');
  }

  // ── 2. 注入必需的 node_modules ────────────────────────────────────
  const REQUIRED = [
    '@neteaseapireborn/api',
    '@unblockneteasemusic/server',
    'express', 'ws', 'axios', 'cli-color', 'compression',
    'express-http-proxy', 'electron-store', 'electron-log',
    'electron-updater', 'electron-devtools-installer', 'body-parser',
    'ip', 'uuid', 'crypto-js', 'dotenv', 'express-fileupload',
    'md5', 'music-metadata', 'node-forge', 'pac-proxy-agent',
    'qrcode', 'safe-decode-uri-component', 'tunnel', 'xml2js', 'yargs',
  ];

  // ── 2.5 下载 Windows 原生模块（跨平台构建需要）─────────────────────
  const WIN_NATIVE_MODULES = [
    '@unblockneteasemusic/rust-napi-win32-x64-msvc',
  ];

  for (const mod of WIN_NATIVE_MODULES) {
    const destPath = path.join(appDir, 'node_modules', mod);
    if (!fs.existsSync(destPath)) {
      console.log(`[afterPack] Downloading Windows native module: ${mod}...`);
      try {
        const tmpDir = path.join(os.tmpdir(), `eb-${Date.now()}`);
        fs.mkdirSync(tmpDir, { recursive: true });
        execSync(`npm pack ${mod} --pack-destination ${tmpDir}`, { stdio: 'pipe' });
        const tarball = fs.readdirSync(tmpDir).find(f => f.endsWith('.tgz'));
        if (tarball) {
          execSync(`mkdir -p ${destPath} && tar -xzf ${path.join(tmpDir, tarball)} -C ${destPath} --strip-components=1`, { stdio: 'pipe' });
          console.log(`  + ${mod}`);
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (e) {
        console.log(`[afterPack] Warning: Failed to download ${mod}: ${e.message}`);
      }
    }
  }

  function getAllDeps(mod, seen = new Set()) {
    if (seen.has(mod)) return seen;
    const modPath = path.join(nmSrc, mod);
    if (!fs.existsSync(modPath)) return seen;
    seen.add(mod);
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(modPath, 'package.json'), 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.peerDependencies };
      for (const d of Object.keys(deps)) {
        if (!d.startsWith('@types') && !['jest', 'eslint', 'webpack'].includes(d)) {
          getAllDeps(d, seen);
        }
      }
    } catch {}
    return seen;
  }

  const allMods = new Set();
  for (const m of REQUIRED) getAllDeps(m, allMods);

  const nmDest = path.join(appDir, 'node_modules');
  fs.mkdirSync(nmDest, { recursive: true });

  async function copyDirModule(src, dest) {
    // 使用 shell cp 避免 symlink 问题（自动解析链接）
    try {
      await fsp.cp(src, dest, { recursive: true, force: true });
    } catch {
      execSync(`cp -rL "${src}" "${dest}"`, { stdio: 'ignore' });
    }
  }

  let copied = 0;
  for (const mod of [...allMods].sort()) {
    const src = path.join(nmSrc, mod);
    const dest = path.join(nmDest, mod);
    if (fs.existsSync(src) && fs.lstatSync(src).isDirectory()) {
      if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true });
      await copyDirModule(src, dest);
      copied++;
    }
  }

  // 复制 @unblockneteasemusic 子包
  const unblockSrc = path.join(nmSrc, '@unblockneteasemusic');
  const unblockDest = path.join(nmDest, '@unblockneteasemusic');
  if (fs.existsSync(unblockSrc)) {
    fs.mkdirSync(unblockDest, { recursive: true });
    for (const sub of fs.readdirSync(unblockSrc)) {
      const s = path.join(unblockSrc, sub);
      const d = path.join(unblockDest, sub);
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true });
      await copyDirModule(s, d);
    }
    console.log('  + @unblockneteasemusic/*');
  }

  console.log(`[afterPack] Done! (${copied} modules injected)`);
};
