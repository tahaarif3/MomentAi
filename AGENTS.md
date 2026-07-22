# AGENTS.md

## Cursor Cloud specific instructions

MomentAI is a Node.js/Express monolith: vanilla JS frontend in `src/public/`, Prisma/Postgres, BullMQ+Redis worker, Playwright E2E.

### Services (local dev)

| Service | Required | Notes |
|---------|----------|-------|
| PostgreSQL 16 | Yes | `DATABASE_URL` in `.env` (e.g. `postgresql://momentai:momentai@localhost:5432/momentai_dev`) |
| Redis 7 | Yes (non-test) | Worker queue; skipped when `NODE_ENV=test` (sync job path) |
| Express `npm run dev` | Yes | Port 3000; kill before `npm test` if Playwright webServer conflicts |

Postgres/Redis are not systemd-managed in this VM — start manually if stopped:
`sudo service postgresql start` and `sudo service redis-server start`.

First-time DB bootstrap (already done in the snapshot; redo only if the cluster is wiped): create role `momentai`/`momentai` and DBs `momentai_dev` + `momentai_test` owned by it, then `npm run db:migrate`. The dev `.env` (untracked, present in snapshot) points at `postgresql://momentai:momentai@localhost:5432/momentai_dev`, local Redis, and **dummy** Gemini/Spotify/Supabase keys.

### Standard commands

See `package.json`: `npm run dev`, `npm test`, `npm run db:migrate`, `npx prisma generate`.

### Demoing playlist generation without paid keys

Real generation calls Gemini + Spotify (only mocked when `NODE_ENV=test`). With dummy keys, run the server as `NODE_ENV=test npm start` to exercise the full upload→playlist pipeline with mocked externals. Anonymous users see the generated tracks **blurred** behind a sign-in paywall; the authed/unblurred flow is covered by `tests/playlist_save.spec.js` (Supabase auth mocked via Playwright route interception).

### Mobile client (`../momentai-mobile`)

Separate repo: Capacitor + Vite web client. `npm run dev` → Vite on port **5173** bound to `localhost` (not `127.0.0.1`, so curl `http://localhost:5173`). `VITE_API_BASE` in its `.env` points at the backend (`http://127.0.0.1:3000` locally). Unit tests: `npm run test:unit` (`node --test`). Native builds (`cap:android`/`cap:ios`) need Android/Xcode toolchains not present in this VM.

### UI v2 (camera-first)

- Screen router: `src/public/router.js` — screens `home|capture|loading|playlist|share|paywall`
- Entry pipeline preserved in `src/public/app.js` (`uploadAndProcessImage`, `handleProcessingSuccess`, `renderAnalysisResults`)
- Playwright waits on `#screenPlaylist.screen--active`, not `#analysisLoader` hidden (loader lives on inactive loading screen once playlist shows)
- Test hooks: `#fileInput`, `#btnGeneratePlaylist`, `#analysisLoader`, `#tracklistContainer .track-card`, sr-only `#envContext` / `#emotionalVibe` / valence nodes
- Preview volume: `#previewVolumeSlider` in the custom audio player (persisted in `localStorage`)

### Schema / migrations

- Source of truth: `npm run db:migrate` (`prisma migrate deploy`). Do **not** use `db push` in production.
- Docker boots via `docker-entrypoint.sh`, which runs migrate (and baselines `0_init` if the DB already exists).
- `src/utils/ensureSchema.js` ensures `tracks` / `suggested_tracks` / `daily_upload_limit` on non-test startup.
- **Daily uploads (not tokens):** free users are capped by `users.daily_upload_limit` (default `3`). Premium (`tier = 'premium'`) is unlimited.
- To give a user more free uploads:
  1. SQL: `UPDATE users SET daily_upload_limit = 20 WHERE email = 'friend@example.com';`
  2. Admin API (set `ADMIN_API_SECRET`): `PATCH /api/admin/users/by-email/daily-limit` with header `x-admin-secret` and body `{ "email": "...", "dailyUploadLimit": 20 }`
- **Moment thumbnails:** `generations.image_thumb` stores a small JPEG data-URL so Your Moments cards survive ephemeral `/uploads` and private object URLs. Full `image_path` remains for regenerate when reachable. History lazily backfills thumbs from local `/uploads` files when present.
- If migrate fails on `0_init` for an existing DB: `npx prisma migrate resolve --applied 0_init && npm run db:migrate`

### Test mode

- `NODE_ENV=test`: synchronous playlist processing, mocked Gemini/Spotify, test users seeded **before** `app.listen()` in `src/server.js`
- API tests use `Authorization: Bearer test_token` + `x-test-user-id` header (`src/utils/session.js`)
