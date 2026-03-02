#!/bin/bash
###############################################################################
# FIAE Cron Checker
#
# Runs every 2 minutes via cron. Checks if origin/master has new commits.
# If yes, triggers deploy.sh.
#
# Cron entry:
#   */2 * * * * /root/app/Wamocon_FIAE/cron-deploy.sh >> /root/app/Wamocon_FIAE/deploy-logs/cron.log 2>&1
###############################################################################

LOCKFILE="/tmp/fiae-deploy.lock"
APP_DIR="/root/app/Wamocon_FIAE"

# Prevent overlapping runs
if [[ -f "$LOCKFILE" ]]; then
    LOCK_PID=$(cat "$LOCKFILE" 2>/dev/null)
    if kill -0 "$LOCK_PID" 2>/dev/null; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') | Deploy already running (PID ${LOCK_PID}), skipping."
        exit 0
    else
        echo "$(date '+%Y-%m-%d %H:%M:%S') | Stale lock found, removing."
        rm -f "$LOCKFILE"
    fi
fi

# Create lock
echo $$ > "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT

cd "$APP_DIR"

# Fetch and compare
git fetch origin master --quiet 2>&1

LOCAL_SHA=$(git rev-parse HEAD)
REMOTE_SHA=$(git rev-parse origin/master)

if [[ "$LOCAL_SHA" != "$REMOTE_SHA" ]]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') | New commits detected (${LOCAL_SHA:0:8} -> ${REMOTE_SHA:0:8}). Deploying..."
    /bin/bash "${APP_DIR}/deploy.sh"
else
    echo "$(date '+%Y-%m-%d %H:%M:%S') | No changes."
fi
