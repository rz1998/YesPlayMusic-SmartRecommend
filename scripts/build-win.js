#!/usr/bin/env node
/**
 * Windows build script for YesPlayMusic
 * Handles the complex asar packaging issue where server/ needs to be in app.asar.unpacked/
 */
const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const projectRoot = __dirname;
const asarPath = path.join(projectRoot, 'dist_electron/win-unpacked/resources/app.asar');
const extractDir = '/tmp/yesplay-asar-final';

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: '--openssl-legacy-provider', npm_config_ignore_scripts: 'true' },
    ...opts,
  });
  if (result.status !== 0 && !opts.ignoreExit) {
    console.error(`Command failed: ${cmd} ${args.join(' ')}`);
    process.exit(result.status);
  }
  return result;
}

console.log('=== Step 1: Build webpack output ===');
// Build webpack (skip electron-builder)
run('npx', ['vue-cli-service', 'electron:build', '-p', 'never', '-w', '--skipElectronBuild']);

// Step 2: Copy server/ into dist_electron/bundled/
console.log('\n=== Step 2: Copy server/ to dist_electron/bundled/server/ ===');
const bundledServer = path.join(projectRoot, 'dist_electron/bundled/server');
fs.mkdirSync(bundledServer, { recursive: true });
execSync(`cp -r "${path.join(projectRoot, 'server')}/." "${bundledServer}/"`, { stdio: 'inherit' });
console.log('Done.');

// Step 3: Run electron-builder
console.log('\n=== Step 3: Package with electron-builder ===');
run('node', ['node_modules/.bin/electron-builder', '--win', '--x64', '--dir']);

// Step 4: Verify asar structure
console.log('\n=== Step 4: Verify asar ===');
const asarList = execSync(`node "${path.join(projectRoot, 'node_modules/.bin/asar')}" list "${asarPath}"`, { encoding: 'utf8' });
const hasBackground = asarList.includes('/background.js');
const hasServer = asarList.includes('/server/');
console.log(`background.js at root: ${hasBackground}`);
console.log(`server/ in asar: ${hasServer}`);

// If server/ not in asar, manually inject
if (!hasServer && hasBackground) {
  console.log('\n=== Step 5: Manually inject server/ into asar ===');
  // Extract
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  execSync(`node "${path.join(projectRoot, 'node_modules/.bin/asar')}" extract "${asarPath}" "${extractDir}"`, { stdio: 'inherit' });
  
  // Copy server/ to the directory where background.js lives (root of asar)
  const bgDir = path.join(extractDir); // background.js is at root
  execSync(`cp -r "${path.join(projectRoot, 'server')}" "${bgDir}/server"`, { stdio: 'inherit' });
  
  // Repack
  execSync(`node "${path.join(projectRoot, 'node_modules/.bin/asar')}" pack "${extractDir}" "${asarPath}"`, { stdio: 'inherit' });
  fs.rmSync(extractDir, { recursive: true, force: true });
  console.log('Done.');
}

// Step 6: Create portable zip
console.log('\n=== Step 6: Create portable zip ===');
const portableZip = path.join(projectRoot, 'dist_electron/YesPlayMusic-0.5.22-win-portable.zip');
fs.unlinkSync(portableZip);
execSync(`cd "${path.join(projectRoot, 'dist_electron')}" && zip -qr "YesPlayMusic-0.5.22-win-portable.zip" win-unpacked/`, { stdio: 'inherit' });
console.log('Done.');

// Step 7: Create NSIS installer
console.log('\n=== Step 7: Create NSIS installer ===');
// Use the system NSIS
const nsisScript = `
!include "MUI2.nsh"
Name "YesPlayMusic"
OutFile "dist_electron/YesPlayMusic-0.5.22-win-setup.exe"
InstallDir "$PROGRAMFILES\\YesPlayMusic"
Section
  SetOutPath "$INSTDIR"
  File /r "dist_electron/win-unpacked/*.*"
  CreateDirectory "$SMPROGRAMS\\YesPlayMusic"
  CreateShortcut "$SMPROGRAMS\\YesPlayMusic\\YesPlayMusic.lnk" "$INSTDIR\\YesPlayMusic.exe"
  CreateShortcut "$SMPROGRAMS\\YesPlayMusic\\Uninstall.lnk" "$INSTDIR\\Uninstall.exe"
  WriteUninstaller "$INSTDIR\\Uninstall.exe"
SectionEnd
`;
run('makensis', ['-'], { input: nsisScript, ignoreExit: true });

console.log('\n=== Build complete! ===');
console.log('Portable: dist_electron/YesPlayMusic-0.5.22-win-portable.zip');
const zipExists = fs.existsSync(portableZip);
console.log(`  Status: ${zipExists ? 'OK' : 'MISSING'}`);
if (zipExists) {
  const stat = fs.statSync(portableZip);
  console.log(`  Size: ${(stat.size / 1024 / 1024).toFixed(1)} MB`);
}
