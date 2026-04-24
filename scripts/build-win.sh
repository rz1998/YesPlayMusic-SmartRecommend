#!/bin/bash
# YesPlayMusic Windows Build Script
# 1. Build webpack output to dist_electron/bundled/
# 2. Copy server/ into dist_electron/bundled/server/
# 3. Run electron-builder to package
# 4. Manually inject server/ into asar at /server/ (for asarUnpack to unpack)
# 5. Create portable zip and NSIS installer

set -e
cd "$(dirname "$0")/.."
PROJECT_ROOT=$PWD
ASAR="$PROJECT_ROOT/dist_electron/win-unpacked/resources/app.asar"
ASAR_LIST="$PROJECT_ROOT/dist_electron/win-unpacked/resources/app.asar.unpacked"
EXTRACT_DIR="/tmp/ypm-asar-$$"

echo "=== Step 1: Build webpack output ==="
NODE_OPTIONS=--openssl-legacy-provider npm_config_ignore_scripts=true \
  npx vue-cli-service electron:build -p never -w --skipElectronBuild

echo ""
echo "=== Step 2: Copy server/ to dist_electron/bundled/server/ ==="
mkdir -p "$PROJECT_ROOT/dist_electron/bundled/server"
cp -r "$PROJECT_ROOT/server/"* "$PROJECT_ROOT/dist_electron/bundled/server/"
echo "Done."

echo ""
echo "=== Step 3: Package with electron-builder ==="
npm_config_ignore_scripts=true \
  node "$PROJECT_ROOT/node_modules/.bin/electron-builder" --win --x64 --dir

echo ""
echo "=== Step 4: Verify asar ==="
BACKGROUND=$(node "$PROJECT_ROOT/node_modules/.bin/asar" list "$ASAR" | grep -c "^/background.js" || true)
SERVER_IN_ASAR=$(node "$PROJECT_ROOT/node_modules/.bin/asar" list "$ASAR" | grep -c "^/server/" || true)
echo "  background.js at root: $BACKGROUND"
echo "  server/ in asar: $SERVER_IN_ASAR"

if [ "$SERVER_IN_ASAR" -eq "0" ] && [ "$BACKGROUND" -eq "1" ]; then
  echo ""
  echo "=== Step 5: Manually inject server/ into asar ==="
  # Extract asar
  rm -rf "$EXTRACT_DIR"
  mkdir -p "$EXTRACT_DIR"
  node "$PROJECT_ROOT/node_modules/.bin/asar" extract "$ASAR" "$EXTRACT_DIR"
  
  # Copy server/ to asar root (where background.js lives)
  cp -r "$PROJECT_ROOT/server" "$EXTRACT_DIR/server"
  
  # Repack
  node "$PROJECT_ROOT/node_modules/.bin/asar" pack "$EXTRACT_DIR" "$ASAR"
  rm -rf "$EXTRACT_DIR"
  echo "  Injected server/ into asar."
fi

echo ""
echo "=== Step 6: Create portable zip ==="
PORTABLE_ZIP="$PROJECT_ROOT/dist_electron/YesPlayMusic-0.5.22-win-portable.zip"
rm -f "$PORTABLE_ZIP"
cd "$PROJECT_ROOT/dist_electron"
zip -qr "YesPlayMusic-0.5.22-win-portable.zip" win-unpacked/
echo "  Created: YesPlayMusic-0.5.22-win-portable.zip"
ls -lh "YesPlayMusic-0.5.22-win-portable.zip"

echo ""
echo "=== Build complete! ==="
