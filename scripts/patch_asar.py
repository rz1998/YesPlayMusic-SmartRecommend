#!/usr/bin/env python3
"""
Post-build patch: Extract asar, inject node_modules, repack.
"""
import os
import sys
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

PROJECT = Path(__file__).parent.parent
NM_DIR = PROJECT / 'node_modules'
SERVER_DIR = PROJECT / 'server'
ASAR_PATH = PROJECT / 'dist_electron/win-unpacked/resources/app.asar'
ASAR_BIN = str(PROJECT / 'node_modules/.bin/asar')
ASAR_UNPACKED = PROJECT / 'dist_electron/win-unpacked/resources/app.asar.unpacked'

REQUIRED = [
    '@neteaseapireborn/api', '@unblockneteasemusic/server',
    'express', 'ws', 'axios', 'cli-color', 'compression',
    'express-http-proxy', 'electron-store', 'electron-log',
    'electron-updater', 'electron-devtools-installer', 'body-parser',
    'ip', 'uuid', 'crypto-js', 'dotenv', 'express-fileupload',
    'md5', 'music-metadata', 'node-forge', 'pac-proxy-agent',
    'qrcode', 'safe-decode-uri-component', 'tunnel', 'xml2js', 'yargs',
]

def get_all_deps(mod, seen=None):
    if seen is None: seen = set()
    if mod in seen: return seen
    p = NM_DIR / mod
    if not p.exists(): return seen
    seen.add(mod)
    pf = p / 'package.json'
    if pf.exists():
        try:
            pkg = json.loads(pf.read_text())
            deps = {**pkg.get('dependencies', {}), **pkg.get('peerDependencies', {})}
            for d in deps:
                if not d.startswith('@types') and d not in ['jest', 'eslint', 'webpack', 'typescript']:
                    get_all_deps(d, seen)
        except: pass
    return seen

def copy_mod(src, dst):
    if Path(dst).exists(): shutil.rmtree(dst)
    shutil.copytree(src, dst, symlinks=True)

def main():
    # Build dependency list
    all_mods = set()
    for m in REQUIRED: get_all_deps(m, all_mods)
    ud = NM_DIR / '@unblockneteasemusic'
    if ud.exists():
        for s in ud.iterdir():
            if s.is_dir():
                all_mods.add(f'@unblockneteasemusic/{s.name}')
                get_all_deps(f'@unblockneteasemusic/{s.name}', all_mods)

    print(f'[Patch] Need to inject {len(all_mods)} modules')

    # Extract asar
    extract_dir = tempfile.mkdtemp(prefix='ypm-asar-')
    print(f'[Patch] Extracting to {extract_dir}...')
    subprocess.run([ASAR_BIN, 'extract', str(ASAR_PATH), extract_dir],
                   check=True, capture_output=True)

    # Copy node_modules
    nm_dest = Path(extract_dir) / 'node_modules'
    nm_dest.mkdir(exist_ok=True)
    injected = 0
    for mod in sorted(all_mods):
        src = NM_DIR / mod
        if src.exists():
            copy_mod(src, nm_dest / mod)
            print(f'  + {mod}')
            injected += 1
    print(f'  Injected {injected} modules')

    # Inject server/ directory into asar (for app.asar.unpacked/server/)
    # This ensures the recommender server files are available at:
    #   process.resourcesPath/app.asar.unpacked/server/
    server_count = 0
    if SERVER_DIR.exists():
        server_dest = Path(extract_dir) / 'server'
        print(f'  Injecting server/ directory...')
        if server_dest.exists(): shutil.rmtree(server_dest)
        shutil.copytree(SERVER_DIR, server_dest, symlinks=True)
        # Count files
        for _ in server_dest.rglob('*'):
            server_count += 1
        print(f'  + server/ ({server_count} files)')
    else:
        print('  ⚠️ server/ not found, skipping')

    # Repack using CLI (sync, not async Node API)
    print('[Patch] Repacking asar (this may take a while)...')
    if ASAR_PATH.exists(): ASAR_PATH.unlink()
    subprocess.run([
        'node', ASAR_BIN, 'pack',
        extract_dir,
        str(ASAR_PATH)
    ], check=True, capture_output=True)
    shutil.rmtree(extract_dir)

    # Also copy server/ to app.asar.unpacked/server/
    # background.js uses: process.resourcesPath/app.asar.unpacked/server/server.js
    # for the recommender server spawn cwd
    asar_unpacked_server = ASAR_UNPACKED / 'server'
    if SERVER_DIR.exists():
        print(f'  Copying server/ to app.asar.unpacked/...')
        if asar_unpacked_server.exists(): shutil.rmtree(asar_unpacked_server)
        shutil.copytree(SERVER_DIR, asar_unpacked_server, symlinks=True)
        server_unpacked_count = sum(1 for _ in asar_unpacked_server.rglob('*') if _.is_file())
        print(f'  + app.asar.unpacked/server/ ({server_unpacked_count} files)')
    # Verify
    if not ASAR_PATH.exists():
        print('❌ FAILED: asar not created')
        return 1
    result = subprocess.run([ASAR_BIN, 'list', str(ASAR_PATH)],
                          capture_output=True, text=True)
    if '@neteaseapireborn' in result.stdout:
        count = result.stdout.count('@neteaseapireborn')
        size_mb = ASAR_PATH.stat().st_size / 1024 / 1024
        print(f'✅ SUCCESS: {count} @neteaseapireborn entries, asar={size_mb:.1f}MB')
        return 0
    print('❌ FAILED: @neteaseapireborn not found')
    return 1

if __name__ == '__main__':
    sys.exit(main())
