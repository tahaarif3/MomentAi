# Copilot Instructions for MomentAI

## Build, test, and lint commands

### Runtime / local development
- `npm install`
- `npm run dev` (nodemon server)
- `npm start` (runs `node src/server.js`)

### Database (Prisma)
- `npx prisma db push` (apply schema to configured database)
- `npx prisma generate` (required for generated client updates; also used in Docker build)

### E2E tests (Playwright)
- `npx playwright install` (first-time browser install)
- `npx playwright test` (full suite)
- `npx playwright test tests/playlist.spec.js` (single spec file)
- `npx playwright test tests/playlist.spec.js -g "sunny beach"` (single test by title)

### CI signal
- `.travis.yml` runs: `npm ci`, `npx playwright install --with-deps chromium`, `npx playwright test`

### Lint/build status
- No dedicated `lint` script exists in `package.json`.
- No dedicated JS/TS build script exists; app runs directly from source (`node src/server.js`).

## High-level architecture

- **Server entrypoint:** `src/server.js` wires middleware and routes, serves `src/public` as static frontend, serves `/uploads`, and mounts API routers:
  - `/api/auth` (`src/routes/auth.js`)
  - `/api/playlist` (`src/routes/playlist.js`)
  - `/api/payment` (`src/routes/payment.js`)
  - `/health` (`src/routes/health.js`)
- **Critical webhook ordering:** Stripe webhook is mounted as `app.post('/api/payment/webhook', express.raw(...), ...)` before `express.json()` to preserve signature verification.
- **Frontend:** a single vanilla JS app (`src/public/app.js`) manages auth/session state, upload/import flow, playlist editing, and payment interactions. Animation and transitions are in `src/public/animations.js`.
- **Auth model:** frontend obtains Supabase session token, then sends `Authorization: Bearer <token>` on API calls. Backend verifies JWT via Supabase Admin (`src/config/supabase.js`, `src/utils/session.js`) and upserts profile in local DB via `/api/auth/callback`.
- **Core generation pipeline (`POST /api/playlist/process`):**
  1. Multer image upload + file type/size validation
  2. Gemini image parsing (`src/services/geminiService.js`) for metadata + suggested songs
  3. Spotify track resolution/search (`src/clients/spotifyClient.js`)
  4. Track dedupe + prior-history filtering
  5. Optional token decrement and generation persistence (Prisma)
- **Playlist persistence model:** generated playlists are created on a single Spotify “master” account (`createMasterPlaylist`) and returned as shareable URLs.
- **Payments:** Stripe checkout + portal routes (`src/routes/payment.js`, `src/services/stripeService.js`), with webhook-driven entitlement updates and event idempotency stored in `StripeEvent`.
- **Data layer:** Prisma client in `src/config/db.js`; schema in `prisma/schema.prisma` (users, generations, stripe events).

## Key conventions in this codebase

- **`NODE_ENV=test` is a first-class execution mode across backend services:**
  - `getAuthUserId` accepts bearer token `test_token` as `test_user_id`
  - `server.js` seeds `test_user_id`
  - Gemini and Spotify clients return deterministic mock data in test mode
  - Rate limiter is skipped in test mode
- **Auth is bearer-token based, not cookie-session based:** even though `cookie-parser` is present, auth checks rely on `Authorization` headers and Supabase JWT verification.
- **Anonymous-first product flow is intentional:** unauthenticated users can process images, but frontend blurs playlist tracks after the first few and gates save/export behind sign-in.
- **Playlist editing UX pattern:** maintain two in-memory arrays (`currentGeneration.tracks` and `currentGeneration.suggestedTracks`) and move tracks between them via add/remove actions rather than refetching full results.
- **Storage behavior is dual-path:** `uploadFile` returns S3/R2 URL when configured, otherwise returns local `/uploads/...` path and relies on static serving.
- **API response shape convention:** most backend endpoints return JSON with `success` and `message` fields; auth `/api/auth/me` additionally uses `loggedIn` + `user`.
- **Prisma model field naming:** database columns use snake_case (e.g., `display_name`, `user_id`, `created_at`) mapped directly in JS code.
