#!/usr/bin/env bash
set -euo pipefail

echo "[entrypoint] Waiting for database to be ready..."
node ./scripts/wait-for-db.mjs
echo "[entrypoint] Database is ready. Running migrations..."

# Run migrations (drizzle-kit push)
if npm run -s migrate:push; then
  echo "[entrypoint] Migrations applied."
else
  echo "[entrypoint] Migration step failed." >&2
  exit 1
fi

echo "[entrypoint] Starting app..."
exec "$@"
