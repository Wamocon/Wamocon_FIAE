#!/bin/bash
###############################################################################
# FIAE Auto-Deploy Script
# 
# This script:
#   1. Pulls latest changes from origin/master
#   2. Rebuilds Docker containers
#   3. Verifies the app is healthy
#   4. Logs everything (success & failure) to deploy-logs/
#
# Usage:
#   ./deploy.sh          # Normal deploy
#   ./deploy.sh --force  # Force rebuild even if no new commits
#
# Log files:
#   deploy-logs/deploy-YYYY-MM-DD_HH-MM-SS.log  (individual build logs)
#   deploy-logs/latest.log                        (symlink to latest)
#   deploy-logs/deploy-history.log                (one-line summary per deploy)
###############################################################################

set -euo pipefail

# --- Configuration ---
APP_DIR="/root/app/Wamocon_FIAE"
LOG_DIR="${APP_DIR}/deploy-logs"
BRANCH="master"
REMOTE="origin"
CONTAINER_NAME="fiae-web"
HEALTH_URL="http://localhost:3002/"
HEALTH_TIMEOUT=60
MAX_LOGS=30  # Keep last N log files

# --- Init ---
TIMESTAMP=$(date '+%Y-%m-%d_%H-%M-%S')
LOG_FILE="${LOG_DIR}/deploy-${TIMESTAMP}.log"
FORCE_BUILD=false

if [[ "${1:-}" == "--force" ]]; then
    FORCE_BUILD=true
fi

# Redirect all output to log file AND stdout
exec > >(tee -a "$LOG_FILE") 2>&1

echo "=============================================="
echo "  FIAE Deploy - ${TIMESTAMP}"
echo "=============================================="
echo ""

cd "$APP_DIR"

# --- Step 1: Check for new commits ---
echo "[1/6] Fetching latest from ${REMOTE}/${BRANCH}..."
git fetch "$REMOTE" "$BRANCH" 2>&1

LOCAL_SHA=$(git rev-parse HEAD)
REMOTE_SHA=$(git rev-parse "${REMOTE}/${BRANCH}")

echo "  Local:  ${LOCAL_SHA}"
echo "  Remote: ${REMOTE_SHA}"

if [[ "$LOCAL_SHA" == "$REMOTE_SHA" ]] && [[ "$FORCE_BUILD" == "false" ]]; then
    echo ""
    echo "[SKIP] No new commits. Already up to date."
    echo "$(date '+%Y-%m-%d %H:%M:%S') | SKIP | ${LOCAL_SHA:0:8} | No changes" >> "${LOG_DIR}/deploy-history.log"
    # Update latest symlink
    ln -sf "$LOG_FILE" "${LOG_DIR}/latest.log"
    exit 0
fi

echo ""

# --- Step 2: Pull changes ---
echo "[2/6] Pulling changes..."
PULL_OUTPUT=$(git pull "$REMOTE" "$BRANCH" 2>&1)
echo "$PULL_OUTPUT"
NEW_SHA=$(git rev-parse HEAD)
COMMIT_MSG=$(git log -1 --pretty=format:"%s" HEAD)
echo ""
echo "  New HEAD: ${NEW_SHA}"
echo "  Message:  ${COMMIT_MSG}"
echo ""

# --- Step 3: Export env vars for Docker build args ---
echo "[3/6] Loading environment variables..."
set -a
source "${APP_DIR}/.env.prod"
set +a
echo "  Environment loaded from .env.prod"
echo ""

# --- Step 4: Rebuild Docker ---
echo "[4/6] Stopping old container..."
docker compose down 2>&1 || true
echo ""

echo "[5/6] Building and starting new container..."
BUILD_START=$(date +%s)
if docker compose up --build -d 2>&1; then
    BUILD_END=$(date +%s)
    BUILD_DURATION=$((BUILD_END - BUILD_START))
    echo ""
    echo "  Build completed in ${BUILD_DURATION}s"
else
    BUILD_END=$(date +%s)
    BUILD_DURATION=$((BUILD_END - BUILD_START))
    echo ""
    echo "  [FAILED] Docker build failed after ${BUILD_DURATION}s!"
    echo "$(date '+%Y-%m-%d %H:%M:%S') | FAILED | ${NEW_SHA:0:8} | Build failed after ${BUILD_DURATION}s | ${COMMIT_MSG}" >> "${LOG_DIR}/deploy-history.log"
    ln -sf "$LOG_FILE" "${LOG_DIR}/latest.log"
    exit 1
fi
echo ""

# --- Step 5: Health check ---
echo "[6/6] Running health check..."
HEALTHY=false
for i in $(seq 1 $HEALTH_TIMEOUT); do
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" ]]; then
        HEALTHY=true
        echo "  Health check passed after ${i}s (HTTP ${HTTP_CODE})"
        break
    fi
    sleep 1
done

if [[ "$HEALTHY" == "false" ]]; then
    echo "  [FAILED] Health check failed after ${HEALTH_TIMEOUT}s!"
    echo "  Container logs:"
    docker logs "$CONTAINER_NAME" --tail 30 2>&1
    echo ""
    echo "$(date '+%Y-%m-%d %H:%M:%S') | FAILED | ${NEW_SHA:0:8} | Health check failed | ${COMMIT_MSG}" >> "${LOG_DIR}/deploy-history.log"
    ln -sf "$LOG_FILE" "${LOG_DIR}/latest.log"
    exit 1
fi

# --- Step 6: Final status ---
echo ""
echo "=============================================="
echo "  DEPLOY SUCCESSFUL"
echo "=============================================="
echo "  Commit:   ${NEW_SHA:0:8}"
echo "  Message:  ${COMMIT_MSG}"
echo "  Build:    ${BUILD_DURATION}s"
echo "  Status:   LIVE on port 3002"
echo "=============================================="

# Log to history
echo "$(date '+%Y-%m-%d %H:%M:%S') | SUCCESS | ${NEW_SHA:0:8} | ${BUILD_DURATION}s | ${COMMIT_MSG}" >> "${LOG_DIR}/deploy-history.log"

# Update latest symlink
ln -sf "$LOG_FILE" "${LOG_DIR}/latest.log"

# --- Cleanup old logs ---
LOG_COUNT=$(ls -1 "${LOG_DIR}"/deploy-20*.log 2>/dev/null | wc -l)
if [[ "$LOG_COUNT" -gt "$MAX_LOGS" ]]; then
    REMOVE_COUNT=$((LOG_COUNT - MAX_LOGS))
    ls -1t "${LOG_DIR}"/deploy-20*.log | tail -n "$REMOVE_COUNT" | xargs rm -f
    echo ""
    echo "Cleaned up ${REMOVE_COUNT} old log file(s)."
fi

echo ""
echo "Done. Full log: ${LOG_FILE}"
