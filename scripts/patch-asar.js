#!/usr/bin/env node
// 在 electron-builder 打包后，手动把 server/ 注入到 asar
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const projectRoot = __dirname;
const asarPath = path.join(projectRoot, 'dist_electron/win-unpacked/resources/app.asar');
const extractDir = '/tmp/yesplay-asar-patch';

// 1. 提取 asar
console.log('Extracting asar...');
execSync(`node "${projectRoot}/node_modules/.bin/asar" extract "${asarPath}" "${extractDir}"`, { stdio: 'inherit' });

// 2. 复制 server/ 到正确位置（dist_electron/bundled/server/）
const serverSrc = path.join(projectRoot, 'server');
const serverDest = path.join(extractDir, 'dist_electron/bundled/server');
console.log('Copying server/ to dist_electron/bundled/server/ ...');
fs.mkdirSync(path.dirname(serverDest), { recursive: true });
execSync(`cp -r "${serverSrc}" "${serverDest}"`, { stdio: 'inherit' });

// 3. 重新打包
console.log('Repacking asar...');
execSync(`node "${projectRoot}/node_modules/.bin/asar" pack "${extractDir}" "${asarPath}"`, { stdio: 'inherit' });

// 4. 清理
fs.rmSync(extractDir, { recursive: true, force: true });
console.log('Done! server/ injected into asar.');
