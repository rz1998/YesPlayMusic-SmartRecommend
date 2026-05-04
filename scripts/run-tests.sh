#!/bin/bash
# ============================================================
# ai-musicplayer Test Runner
# Starts services and runs all tests (backend + frontend)
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$PROJECT_DIR/server"
LOG_DIR="/tmp/ypm-test-logs"

mkdir -p "$LOG_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

cleanup() {
  log_info "Cleaning up..."
  # Kill background processes
  for pid in $BACKEND_PID $FRONTEND_PID; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  # Kill any remaining node processes on our ports
  pkill -f "node server.js" 2>/dev/null || true
  pkill -f "vue-cli-service serve" 2>/dev/null || true
  log_info "Cleanup done"
}

trap cleanup EXIT

# ============================================================
# 1. Start Backend Server
# ============================================================
log_info "Starting backend server..."

cd "$BACKEND_DIR"
node server.js > "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

# Wait for backend to be ready
BACKEND_READY=false
for i in $(seq 1 30); do
  sleep 1
  if curl -sf "http://localhost:3001/health" > /dev/null 2>&1; then
    BACKEND_READY=true
    break
  fi
  log_warn "Waiting for backend... ($i/30)"
done

if [ "$BACKEND_READY" = false ]; then
  log_error "Backend failed to start"
  echo "Backend logs:"
  tail -50 "$LOG_DIR/backend.log"
  exit 1
fi

log_info "Backend ready (PID: $BACKEND_PID)"

# ============================================================
# 2. Start Frontend Dev Server
# ============================================================
log_info "Starting frontend dev server..."

cd "$PROJECT_DIR"

# Check if port 8080 is available
FRONTEND_PORT=8080
if curl -sf "http://localhost:$FRONTEND_PORT/" > /dev/null 2>&1; then
  log_warn "Port 8080 is in use, trying 8081..."
  FRONTEND_PORT=8081
fi

export API_PROXY_TARGET="http://localhost:3001"
export PORT="$FRONTEND_PORT"

npm run serve -- --port "$FRONTEND_PORT" --copyClipboard > "$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!

# Wait for frontend to be ready
FRONTEND_READY=false
for i in $(seq 1 60); do
  sleep 2
  # Check if process is still running
  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    log_error "Frontend process died"
    echo "Frontend logs:"
    tail -50 "$LOG_DIR/frontend.log"
    exit 1
  fi
  # Check if server is responding
  if curl -sf "http://localhost:$FRONTEND_PORT/" > /dev/null 2>&1; then
    FRONTEND_READY=true
    break
  fi
  log_warn "Waiting for frontend... ($i/60)"
done

if [ "$FRONTEND_READY" = false ]; then
  log_error "Frontend failed to start"
  echo "Frontend logs:"
  tail -50 "$LOG_DIR/frontend.log"
  exit 1
fi

log_info "Frontend ready (PID: $FRONTEND_PID, Port: $FRONTEND_PORT)"

# ============================================================
# 3. Run Backend Tests
# ============================================================
log_info "Running backend tests..."

cd "$BACKEND_DIR"
npm test 2>&1 | tee "$LOG_DIR/backend-tests.log"
BACKEND_TEST_RESULT=${PIPESTATUS[0]}

if [ $BACKEND_TEST_RESULT -ne 0 ]; then
  log_warn "Backend tests had failures"
else
  log_info "Backend tests passed!"
fi

# ============================================================
# 4. Run Frontend E2E Tests
# ============================================================
log_info "Running frontend E2E tests..."

cd "$PROJECT_DIR"

# Set environment variables for playwright
export FRONTEND_URL="http://localhost:$FRONTEND_PORT"
export API_URL="http://localhost:3001"

# Check if chromium is installed
if npx playwright install chromium 2>/dev/null; then
  log_info "Chromium installed"
fi

npx playwright test --reporter=line 2>&1 | tee "$LOG_DIR/frontend-tests.log"
FRONTEND_TEST_RESULT=${PIPESTATUS[0]}

# ============================================================
# 5. Summary
# ============================================================
echo ""
echo "========================================="
echo "Test Summary"
echo "========================================="
echo "Backend Tests: $([ $BACKEND_TEST_RESULT -eq 0 ] && echo 'PASSED' || echo 'FAILED')"
echo "Frontend E2E Tests: $([ $FRONTEND_TEST_RESULT -eq 0 ] && echo 'PASSED' || echo 'FAILED')"
echo ""
echo "Logs:"
echo "  Backend: $LOG_DIR/backend.log"
echo "  Frontend: $LOG_DIR/frontend.log"
echo "  Backend Tests: $LOG_DIR/backend-tests.log"
echo "  Frontend Tests: $LOG_DIR/frontend-tests.log"
echo "========================================="

# Keep services running if tests passed for manual inspection
if [ $BACKEND_TEST_RESULT -eq 0 ] && [ $FRONTEND_TEST_RESULT -eq 0 ]; then
  log_info "All tests passed!"
  log_info "Services are still running for inspection."
  log_info "Press Ctrl+C to stop."
  tail -f /dev/null & wait
else
  log_warn "Some tests failed. Check logs for details."
  exit 1
fi
