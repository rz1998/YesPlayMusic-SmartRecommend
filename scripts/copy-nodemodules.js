#!/usr/bin/env node
/**
 * Copy production node_modules to dist_electron/bundled/node_modules/
 * This is needed because electron-builder excludes node_modules by default,
 * but @neteaseapireborn/api and other runtime deps need them.
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const projectRoot = __dirname;
const bundledNodeModules = path.join(projectRoot, 'dist_electron/bundled/node_modules');
const srcNodeModules = path.join(projectRoot, 'node_modules');

// Modules that are runtime dependencies and MUST be included
const REQUIRED_MODULES = [
  '@neteaseapireborn/api',
  '@unblockneteasemusic/rust-napi',
  '@unblockneteasemusic/rust-napi-win32-x64-msvc',
  'express',
  'express-http-proxy',
  'electron-store',
  'electron-log',
  'electron-updater',
  'electron-devtools-installer',
  'cli-color',
  'compression',
  'cors',
  'ws',
];

// Check if module exists
function moduleExists(name) {
  try {
    return fs.existsSync(path.join(srcNodeModules, name));
  } catch {
    return false;
  }
}

// Copy a module and its dependencies
function copyModule(moduleName) {
  const srcPath = path.join(srcNodeModules, moduleName);
  const destPath = path.join(bundledNodeModules, moduleName);
  
  if (!moduleExists(moduleName)) {
    console.log(`  [SKIP] ${moduleName} (not found)`);
    return;
  }
  
  // Remove if already exists
  if (fs.existsSync(destPath)) {
    fs.rmSync(destPath, { recursive: true, force: true });
  }
  
  // Copy the module
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  execSync(`cp -r "${srcPath}" "${path.dirname(destPath)}/"`, { stdio: 'pipe' });
  console.log(`  [COPY] ${moduleName}`);
}

// Get all dependencies of a module recursively
function getAllDeps(moduleName, seen = new Set()) {
  if (seen.has(moduleName)) return seen;
  
  const modulePath = path.join(srcNodeModules, moduleName);
  if (!fs.existsSync(modulePath)) return seen;
  
  seen.add(moduleName);
  
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(modulePath, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.peerDependencies };
    for (const dep of Object.keys(deps)) {
      if (!seen.has(dep)) {
        getAllDeps(dep, seen);
      }
    }
  } catch {}
  
  return seen;
}

console.log('Copying production node_modules to dist_electron/bundled/node_modules/...');

// Get all required modules including their dependencies
const allModules = new Set();
for (const mod of REQUIRED_MODULES) {
  getAllDeps(mod, allModules);
}

// Remove dev-only modules that shouldn't be copied
const SKIP_MODULES = ['@types', 'typescript', 'jest', 'eslint', 'webpack', 'vue-loader'];
for (const skip of SKIP_MODULES) {
  allModules.delete(skip);
}

// Copy each module
fs.mkdirSync(bundledNodeModules, { recursive: true });
for (const mod of [...allModules].sort()) {
  copyModule(mod);
}

console.log(`\nDone. Copied ${allModules.size} modules.`);
