#!/usr/bin/env python3
"""Copy production node_modules to dist_electron/bundled/node_modules/"""
import os
import json
import shutil
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
SRC_NODE_MODULES = PROJECT_ROOT / "node_modules"
DEST_NODE_MODULES = PROJECT_ROOT / "dist_electron" / "bundled" / "node_modules"

# Modules that are runtime dependencies and MUST be included
REQUIRED_MODULES = [
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
    'axios',
    'body-parser',
    'ip',
    'uuid',
]

SKIP_PREFIXES = ['@types', '.bin', 'typescript', 'jest', 'eslint', 'webpack', 'vue-loader']

def get_all_deps(module_name, seen=None):
    """Recursively get all dependencies of a module."""
    if seen is None:
        seen = set()
    
    if module_name in seen:
        return seen
    
    module_path = SRC_NODE_MODULES / module_name
    if not module_path.exists():
        return seen
    
    seen.add(module_name)
    
    pkg_file = module_path / 'package.json'
    if pkg_file.exists():
        try:
            pkg = json.loads(pkg_file.read_text())
            deps = {**pkg.get('dependencies', {}), **pkg.get('peerDependencies', {})}
            for dep in deps:
                get_all_deps(dep, seen)
        except:
            pass
    
    return seen

def should_skip(name):
    """Check if module should be skipped (dev-only)."""
    for prefix in SKIP_PREFIXES:
        if name.startswith(prefix):
            return True
    return False

def copy_module(module_name):
    """Copy a module to destination."""
    src = SRC_NODE_MODULES / module_name
    dest = DEST_NODE_MODULES / module_name
    
    if not src.exists():
        print(f"  [SKIP] {module_name} (not found)")
        return False
    
    if dest.exists():
        shutil.rmtree(dest)
    
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(src, dest, symlinks=True)
    print(f"  [COPY] {module_name}")
    return True

print("Copying production node_modules to dist_electron/bundled/node_modules/...")

# Get all required modules including dependencies
all_modules = set()
for mod in REQUIRED_MODULES:
    all_modules.update(get_all_deps(mod))

# Filter out skip modules
all_modules = {m for m in all_modules if not should_skip(m)}

# Copy each module
DEST_NODE_MODULES.mkdir(parents=True, exist_ok=True)
for mod in sorted(all_modules):
    copy_module(mod)

print(f"\nDone. Copied {len(all_modules)} modules.")
