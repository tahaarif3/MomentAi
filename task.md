# Refactor Tasks: Master Spotify + Supabase Auth

## Phase 1: Foundation
- [x] Update `prisma/schema.prisma` — new User PK, remove Spotify token fields
- [x] Create `src/config/supabase.js` — Supabase server client
- [x] Update `.env` + `.env.example` — add Supabase + master token vars
- [x] Update `package.json` — add `@supabase/supabase-js`
- [x] Run `npm install`

## Phase 2: Core Backend
- [x] Refactor `src/clients/spotifyClient.js` — master account token mgmt, remove user OAuth
- [x] Rewrite `src/utils/session.js` — Supabase JWT extraction
- [x] Rewrite `src/routes/auth.js` — Supabase Auth (Google sign-in)

## Phase 3: Business Logic
- [x] Refactor `src/routes/playlist.js` — master account playlist creation, anonymous track blurring
- [x] Refactor `src/routes/payment.js` — switch to Supabase user ID
- [x] Update `src/server.js` — middleware + route updates

## Phase 4: Frontend
- [x] Update `src/public/index.html` — Supabase CDN, new auth UI
- [x] Refactor `src/public/app.js` — Supabase auth flow, blurred track gate, new save UX

## Phase 5: Tooling & Verification
- [x] Create `scripts/spotify-master-setup.js` — one-time master token script
- [x] Run Prisma migration (db push reset)
- [x] Manual end-to-end test (server boots successfully)
