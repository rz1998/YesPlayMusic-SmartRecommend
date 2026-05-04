#!/bin/bash
#
# ai-musicplayer Electron 构建脚本
#
# 用法:
#   ./scripts/build-electron.sh          # 构建 Windows (默认)
#   ./scripts/build-electron.sh win       # 构建 Windows
#   ./scripts/build-electron.sh linux     # 构建 Linux
#   ./scripts/build-electron.sh mac       # 构建 macOS
#   ./scripts/build-electron.sh all      # 构建全平台
#

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 解析参数
TARGET="${1:-win}"

log_info "开始构建 Electron 应用..."
log_info "目标平台: $TARGET"

# 清理旧构建文件
log_info "清理旧构建文件..."
rm -f "$PROJECT_DIR/dist_electron"/*.exe
rm -f "$PROJECT_DIR/dist_electron"/*.tar.gz
rm -f "$PROJECT_DIR/dist_electron"/*.AppImage
rm -f "$PROJECT_DIR/dist_electron"/*.blockmap

# 设置 NODE_OPTIONS 以支持旧版 OpenSSL
export NODE_OPTIONS="--openssl-legacy-provider"

case "$TARGET" in
    win)
        log_info "构建 Windows 版本..."
        npm run electron:build-win
        log_info "构建完成!"
        log_info "输出文件: dist_electron/"
        ls -lh dist_electron/*.exe 2>/dev/null || true
        ;;
    linux)
        log_info "构建 Linux 版本..."
        npm run electron:build-linux
        log_info "构建完成!"
        log_info "输出文件: dist_electron/"
        ls -lh dist_electron/*.tar.gz 2>/dev/null || ls -lh dist_electron/*.AppImage 2>/dev/null || true
        ;;
    mac)
        log_info "构建 macOS 版本..."
        npm run electron:build-mac
        log_info "构建完成!"
        ;;
    all)
        log_info "构建全平台版本..."
        npm run electron:build-all
        log_info "构建完成!"
        ;;
    *)
        log_error "未知平台: $TARGET"
        echo "用法: $0 [win|linux|mac|all]"
        exit 1
        ;;
esac

log_info "构建流程结束"
