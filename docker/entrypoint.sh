#!/bin/sh
set -eu

echo "[entrypoint] Waiting for database to be ready..."
node ./scripts/wait-for-db.mjs
echo "[entrypoint] Database is ready. Running migrations..."

# Run migrations (drizzle-kit push)
npm run -s migrate:push || {
  echo "[entrypoint] Migration step failed." >&2
  exit 1
}

echo "[entrypoint] Starting app..."
exec "$@"
