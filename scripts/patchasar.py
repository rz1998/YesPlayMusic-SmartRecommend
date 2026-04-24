#!/usr/bin/env python3
"""
Patch asar to include @neteaseapireborn/api and other required node_modules.
This script should be run AFTER electron-builder packages the app.
"""
import os
import sys
import json
import shutil
import subprocess
from pathlib import Path

def get_all_files(directory):
    """Get all files in a directory recursively."""
    files = []
    for root, dirs, filenames in os.walk(directory):
        for filename in filenames:
            files.append(os.path.join(root, filename))
    return files

def main():
    project_root = Path(__file__).parent.parent
    bundled_nm = project_root / "dist_electron" / "bundled" / "node_modules"
    asar_file = project_root / "dist_electron" / "win-unpacked" / "resources" / "app.asar"
    unpacked_dir = project_root / "dist_electron" / "win-unpacked" / "resources" / "app.asar.unpacked"
    
    # Extract asar
    extract_dir = Path("/tmp/ypm-asar-patch")
    if extract_dir.exists():
        shutil.rmtree(extract_dir)
    extract_dir.mkdir(parents=True)
    
    print(f"Extracting {asar_file}...")
    subprocess.run(
        ["node", str(project_root / "node_modules" / ".bin" / "asar"), "extract", str(asar_file), str(extract_dir)],
        check=True, capture_output=True
    )
    
    # Copy node_modules into the extracted asar
    nm_dest = extract_dir / "node_modules"
    print(f"Copying node_modules to {nm_dest}...")
    
    # Copy @neteaseapireborn first (biggest)
    netease_src = bundled_nm / "@neteaseapireborn"
    if netease_src.exists():
        netease_dest = nm_dest / "@neteaseapireborn"
        if netease_dest.exists():
            shutil.rmtree(netease_dest)
        print(f"  Copying @neteaseapireborn ({sum(1 for _ in get_all_files(netease_src))} files)...")
        shutil.copytree(netease_src, netease_dest, symlinks=True)
    else:
        print(f"  WARNING: {netease_src} not found!")
    
    # Copy @unblockneteasemusic (includes rust-napi which is critical)
    unblock_src = bundled_nm / "@unblockneteasemusic"
    if unblock_src.exists():
        unblock_dest = nm_dest / "@unblockneteasemusic"
        if unblock_dest.exists():
            shutil.rmtree(unblock_dest)
        print(f"  Copying @unblockneteasemusic ({sum(1 for _ in get_all_files(unblock_src))} files)...")
        shutil.copytree(unblock_src, unblock_dest, symlinks=True)
    
    # Copy other critical production deps
    critical_mods = [
        "express", "ws", "axios", "cli-color", "compression",
        "express-http-proxy", "electron-store", "electron-log",
        "electron-updater", "body-parser", "ip", "uuid",
        "crypto-js", "dotenv", "express-fileupload", "md5",
        "music-metadata", "node-forge", "pac-proxy-agent", "qrcode",
        "tunnel", "xml2js", "yargs"
    ]
    for mod in critical_mods:
        src = bundled_nm / mod
        if src.exists():
            dest = nm_dest / mod
            if dest.exists():
                shutil.rmtree(dest)
            shutil.copytree(src, dest, symlinks=True)
            print(f"  Copied {mod}")
    
    # Copy @unblockneteasemusic/server if it exists
    server_src = bundled_nm / "@unblockneteasemusic" / "server"
    if server_src.exists():
        dest = nm_dest / "@unblockneteasemusic" / "server"
        print(f"  Copying @unblockneteasemusic/server...")
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(server_src, dest, symlinks=True)
    
    # Repack asar
    print(f"Repacking asar...")
    if asar_file.exists():
        os.remove(asar_file)
    subprocess.run(
        ["node", str(project_root / "node_modules" / ".bin" / "asar"), "pack", str(extract_dir), str(asar_file)],
        check=True, capture_output=True
    )
    
    # Cleanup
    shutil.rmtree(extract_dir)
    
    # Also copy node_modules to unpacked for native modules
    print(f"Copying node_modules to app.asar.unpacked...")
    unpacked_nm = unpacked_dir / "node_modules"
    if unpacked_nm.exists():
        shutil.rmtree(unpacked_nm)
    
    # Copy entire node_modules to unpacked
    shutil.copytree(nm_dest, unpacked_nm, symlinks=True)
    
    print("Done!")

if __name__ == "__main__":
    main()
