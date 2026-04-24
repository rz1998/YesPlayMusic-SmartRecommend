const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'server');
const dest = path.join(__dirname, '..', 'dist_electron', 'bundled', 'server');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') {
        // Only copy essential server dependencies, not all node_modules
        copyDir(srcPath, destPath);
      } else if (entry.name !== '.git' && entry.name !== 'test') {
        copyDir(srcPath, destPath);
      }
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

console.log('Copying server/ to dist_electron/bundled/server/ ...');
copyDir(src, dest);
console.log('Done.');
