/**
 * afterPack hook for electron-builder
 *
 * 在 electron-builder 打包后执行：
 * 1. 提取 app.asar
 * 2. 注入 server/ 目录（copy-server.js 的输出已被 vue-cli-plugin-electron-builder 的清空步骤删除）
 * 3. 注入所有必需的 node_modules
 * 4. 重新打包 asar
 */
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const asar = require('asar');

exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const outDir = context.appOutDir;

  const asarPath = path.join(outDir, 'resources', 'app.asar');
  const extractDir = path.join(os.tmpdir(), `ypm-asar-${Date.now()}`);
  const nmSrc = path.join(__dirname, '..', 'node_modules');
  const serverSrc = path.join(__dirname, '..', 'server');

  console.log(`[afterPack] Extracting asar to ${extractDir}...`);
  fs.mkdirSync(extractDir, { recursive: true });
  await asar.extractAll(asarPath, extractDir);

  // ── 1. 复制 server/ 目录 ──────────────────────────────────────────
  if (fs.existsSync(serverSrc)) {
    const serverDest = path.join(extractDir, 'server');
    console.log('[afterPack] Copying server/ to app directory...');

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

  // ── 2. 注入必需的 node_modules ────────────────────────────────────
  const REQUIRED = [
    '@neteaseapireborn/api',
    '@unblockneteasemusic/server',
    '@unblockneteasemusic/rust-napi-win32-x64-msvc',
    'express', 'ws', 'axios', 'cli-color', 'compression',
    'express-http-proxy', 'electron-store', 'electron-log',
    'electron-updater', 'electron-devtools-installer', 'body-parser',
    'ip', 'uuid', 'crypto-js', 'dotenv', 'express-fileupload',
    'md5', 'music-metadata', 'node-forge', 'pac-proxy-agent',
    'qrcode', 'safe-decode-uri-component', 'tunnel', 'xml2js', 'yargs',
  ];

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

  const nmDest = path.join(extractDir, 'node_modules');
  fs.mkdirSync(nmDest, { recursive: true });

  async function copyDirModule(src, dest) {
    try {
      await fsp.cp(src, dest, { recursive: true, force: true });
    } catch {
      execSync(`cp -r "${src}" "${dest}"`, { stdio: 'ignore' });
    }
  }

  for (const mod of [...allMods].sort()) {
    const src = path.join(nmSrc, mod);
    const dest = path.join(nmDest, mod);
    if (fs.existsSync(src) && fs.lstatSync(src).isDirectory()) {
      if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true });
      await copyDirModule(src, dest);
      console.log(`  + ${mod}`);
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

  // ── 3. 重新打包 ───────────────────────────────────────────────────
  console.log(`[afterPack] Repacking asar (${allMods.size} modules added)...`);
  if (fs.existsSync(asarPath)) fs.unlinkSync(asarPath);
  await asar.createPackage(extractDir, asarPath);
  fs.rmSync(extractDir, { recursive: true, force: true });
  console.log('[afterPack] Done!');
};
