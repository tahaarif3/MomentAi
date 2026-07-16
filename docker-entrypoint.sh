#!/bin/sh
# Production entrypoint: apply Prisma migrations, then start the app.
# Existing DBs that predate migration history may fail on 0_init —
# mark it applied and retry so add_tracks_and_daily_plan can run.
set -eu

echo "[entrypoint] Applying Prisma migrations..."
if ! npx prisma migrate deploy; then
  echo "[entrypoint] migrate deploy failed — resolving baseline 0_init for existing DB..."
  npx prisma migrate resolve --applied 0_init || true
  npx prisma migrate deploy
fi

echo "[entrypoint] Starting MomentAI..."
exec node src/server.js
