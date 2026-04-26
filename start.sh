#!/bin/bash
# ============================================================
# ai-musicplayer 智能推荐 — 同步启动脚本
# 同时启动前端 + 后端，Ctrl+C 一起关闭
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/server"
FRONTEND_DIR="$SCRIPT_DIR"
LOG_DIR="/tmp/ypm-logs"
mkdir -p "$LOG_DIR"

cleanup() {
  echo ""
  echo "🛑 正在关闭所有服务..."
  for pid in $BACKEND_PID $FRONTEND_PID; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  echo "✅ 已全部关闭"
  exit 0
}

trap cleanup SIGINT SIGTERM EXIT

echo "========================================"
echo "🎵 ai-musicplayer 智能推荐 — 启动中"
echo "========================================"

# ── 1. 启动后端 ──────────────────────────────────────────
echo ""
echo "📡 [1/2] 启动后端服务（自动寻找可用端口）..."

cd "$BACKEND_DIR"
node server.js > "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

# 等待后端就绪（最多30秒）
ACTUAL_PORT=""
for i in $(seq 1 30); do
  sleep 1
  for p in 3001 3002 3003 3004 3005 3006 3007 3008 3009 3010; do
    if curl -sf "http://localhost:$p/health" > /dev/null 2>&1; then
      ACTUAL_PORT="$p"
      break 2
    fi
  done
done

if [ -z "$ACTUAL_PORT" ]; then
  echo "❌ 后端启动失败（30秒内未就绪）"
  echo "   日志: tail -f $LOG_DIR/backend.log"
  exit 1
fi

echo "   ✅ 后端已就绪 (端口 $ACTUAL_PORT, PID $BACKEND_PID)"

# ── 2. 启动前端 ──────────────────────────────────────────
echo ""
echo "🖥  [2/2] 启动前端开发服务器..."

cd "$FRONTEND_DIR"

# 检查端口是否可用，自动往后找
check_port() {
  ! curl -sf "http://localhost:$1/" > /dev/null 2>&1
}

FRONTEND_PORT=8080
for p in 8080 8081 8082 8083; do
  if check_port $p; then
    FRONTEND_PORT="$p"
    break
  fi
  echo "   ⚠ 端口 $p 被占用，尝试下一个..."
done

export API_PROXY_TARGET="http://localhost:$ACTUAL_PORT"

npm run serve -- --port "$FRONTEND_PORT" --copyClipboard > "$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!

# 等待前端编译完成
echo "   前端 PID $FRONTEND_PID，等待编译完成..."
for i in $(seq 1 60); do
  sleep 2
  # 检查进程是否还在
  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    echo "❌ 前端启动失败"
    echo "   日志: tail -f $LOG_DIR/frontend.log"
    exit 1
  fi
  # 检查是否编译完成
  if grep -qE "compiled|DONE|Local:" "$LOG_DIR/frontend.log" 2>/dev/null; then
    break
  fi
done

echo "   ✅ 前端已就绪 (端口 $FRONTEND_PORT, PID $FRONTEND_PID)"

# ── 完成 ─────────────────────────────────────────────────
echo ""
echo "========================================"
echo "🎉 全部服务已启动！"
echo ""
echo "   🌐 访问地址: http://localhost:$FRONTEND_PORT"
echo "   🔌 后端 API:  http://localhost:$ACTUAL_PORT"
echo "   📊 API代理:   $API_PROXY_TARGET"
echo ""
echo "   Ctrl+C 同时关闭前后端"
echo "========================================"

# 保持运行
wait $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
