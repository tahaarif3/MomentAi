# AGENTS.md

## Cursor Cloud specific instructions

MomentAI is a Node.js/Express monolith: vanilla JS frontend in `src/public/`, Prisma/Postgres, BullMQ+Redis worker, Playwright E2E.

### Services (local dev)

| Service | Required | Notes |
|---------|----------|-------|
| PostgreSQL 16 | Yes | `DATABASE_URL` in `.env` (e.g. `postgresql://momentai:momentai@localhost:5432/momentai_dev`) |
| Redis 7 | Yes (non-test) | Worker queue; skipped when `NODE_ENV=test` (sync job path) |
| Express `npm run dev` | Yes | Port 3000; kill before `npm test` if Playwright webServer conflicts |

Postgres/Redis are not systemd-managed in this VM — start manually if stopped.

### Standard commands

See `package.json`: `npm run dev`, `npm test`, `npm run db:migrate`, `npx prisma generate`.

### UI v2 (camera-first)

- Screen router: `src/public/router.js` — screens `home|capture|loading|playlist|share|paywall`
- Entry pipeline preserved in `src/public/app.js` (`uploadAndProcessImage`, `handleProcessingSuccess`, `renderAnalysisResults`)
- Playwright waits on `#screenPlaylist.screen--active`, not `#analysisLoader` hidden (loader lives on inactive loading screen once playlist shows)
- Test hooks: `#fileInput`, `#btnGeneratePlaylist`, `#analysisLoader`, `#tracklistContainer .track-card`, sr-only `#envContext` / `#emotionalVibe` / valence nodes

### Schema / migrations

- Source of truth: `npm run db:migrate` (`prisma migrate deploy`). Do **not** use `db push` in production.
- Docker boots via `docker-entrypoint.sh`, which runs migrate (and baselines `0_init` if the DB already exists).
- `src/utils/ensureSchema.js` also `ADD COLUMN IF NOT EXISTS` for `tracks` / `suggested_tracks` on non-test startup so history/worker do not crash if migrate was skipped once.
- If a live DB already matches the pre-tracks schema and migrate fails on `0_init`, run once:
  `npx prisma migrate resolve --applied 0_init && npm run db:migrate`