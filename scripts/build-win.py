#!/usr/bin/env python3
"""Windows build script: build + patch asar + create zips"""
import subprocess
import sys
import os
from pathlib import Path

PROJECT = Path(__file__).parent.parent

def run(cmd, cwd=None, env=None, check=True):
    print(f'[RUN] {" ".join(cmd)}')
    r = subprocess.run(cmd, cwd=cwd or PROJECT, env=env or os.environ, capture_output=True, text=True)
    if check and r.returncode != 0:
        print('STDOUT:', r.stdout[-500:])
        print('STDERR:', r.stderr[-500:])
        sys.exit(r.returncode)
    if r.stdout: print(r.stdout[-1000:])
    return r

def main():
    env = {**os.environ, 'NODE_OPTIONS': '--openssl-legacy-provider', 'npm_config_ignore_scripts': 'true'}

    # Step 1: Build with electron-builder
    # Note: webpack overwrites dist_electron/bundled/; server/ is injected by patch_asar.py
    print('\n=== Step 1: vue-cli-service electron:build ===')
    run(['npx', 'vue-cli-service', 'electron:build', '-p', 'never', '-w'], env=env)

    # Step 2: Patch asar (inject node_modules)
    print('\n=== Step 2: Patch asar ===')
    r = run([sys.executable, str(PROJECT / 'scripts/patch_asar.py')], env=env)
    if r.returncode != 0:
        sys.exit(r.returncode)

    # Step 3: Recreate portable zip
    print('\n=== Step 3: Create portable zip ===')
    zip_file = PROJECT / 'dist_electron/YesPlayMusic-0.5.22-win-portable.zip'
    if zip_file.exists(): zip_file.unlink()
    run(['zip', '-qr', str(zip_file), 'win-unpacked/'],
        cwd=str(PROJECT / 'dist_electron'))
    sz = zip_file.stat().st_size / 1024 / 1024
    print(f'✅ Portable: {zip_file} ({sz:.0f}MB)')

    # Step 4: Rebuild NSIS installer from patched win-unpacked
    # CRITICAL: Use --prepackaged so electron-builder uses the already-patched
    # win-unpacked/ (with server/ in asar) instead of rebuilding from bundled/
    print('\n=== Step 4: Build NSIS installer from patched win-unpacked ===')
    nsis_file = PROJECT / 'dist_electron/YesPlayMusic-0.5.22-win-setup.exe'
    if nsis_file.exists(): nsis_file.unlink()
    run([
        'npx', 'electron-builder', '--win', 'nsis',
        '--prepackaged', 'dist_electron/win-unpacked',
        '-c', 'electron-builder.yml'
    ], env=env)
    nsis_sz = nsis_file.stat().st_size / 1024 / 1024
    print(f'✅ NSIS installer: {nsis_file} ({nsis_sz:.0f}MB)')

    print('\n=== Done! ===')
    print(f'  dist_electron/YesPlayMusic-0.5.22-win-portable.zip')
    print(f'  dist_electron/YesPlayMusic-0.5.22-win-setup.exe')

if __name__ == '__main__':
    main()
