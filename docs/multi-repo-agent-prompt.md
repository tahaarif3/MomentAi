# Copy-paste prompt for multi-repo Cloud Agent

Attach (or ensure the agent can read from MomentAi):

1. `docs/mobile-migration-brief.md` ← full context
2. `docs/mobile-api.md` ← API contract
3. `docs/spaces-setup.md` ← Spaces/CORS (ops)

Then paste everything below the line into the agent.

---

You are working in a **multi-repo** Cursor Cloud environment with:

- **Primary:** `tahaarif3/MomentAi` — Express/Prisma API + web UI
- **Secondary:** `tahaarif3/momentai-mobile` — Capacitor + Vite (vanilla JS) iOS/Android app

You have **no prior chat history**. Read these files in MomentAi first:

- `docs/mobile-migration-brief.md`
- `docs/mobile-api.md`
- `docs/spaces-setup.md`

## Goal

Continue the MomentAI mobile migration:

1. Confirm MomentAi Phase 0 API is present (progressToken-secured jobs, `/api/mobile/compatibility`, `DELETE /api/auth/account`, HEIC, RevenueCat webhook stub). If Phase 0 is only on branch `cursor/phase-0-mobile-api-f096`, note that production must merge/deploy it; implement mobile against that contract.
2. On **momentai-mobile** `main`, Phase 1 scaffold already exists. Implement **Phase 2 then Phase 3** (then Phase 4 if time):

### Phase 2 — Supabase auth (momentai-mobile)
- PKCE: parse Universal Link / `momentai://` callback → `exchangeCodeForSession` or `setSession`
- Persist session with Capacitor Preferences (or secure) storage adapter
- Wire sign-in / sign-up / password reset / logout / session refresh
- No Stripe; no per-user Spotify OAuth

### Phase 3 — Camera + job progress (momentai-mobile)
- Separate camera vs photo library permissions; handle denial
- URI-based Camera results → File; compress JPEG ~2–4MB; HEIC handling
- After `POST /api/playlist/process`, use returned `progressToken`:
  - Primary: SSE to absolute `VITE_API_BASE/api/playlist/job/:id/stream?progressToken=...`
  - Fallback: poll `GET .../job/:id` with same token; persist job for app resume
- End-to-end: capture → loading → playlist against `VITE_API_BASE` (default `https://momentai.dev`)

### Phase 4 (if Phase 2–3 done)
- History, suggest-more, regenerate, save playlist (master Spotify) + Browser open URL
- Share card: Filesystem temp PNG → Share sheet → delete temp

## Rules
- Put native/Capacitor code **only** in momentai-mobile
- Put API-only fixes in MomentAi if you discover gaps; open separate PRs per repo
- Branch naming: `cursor/<descriptive-name>-…`
- Do **not** open Stripe Checkout in native builds
- Keep Spotify master-account export
- Never commit secrets; use `.env.example` only
- Commit and push; open/update PRs on each repo you change

## Done when
- Auth deep link + password flows work in the Capacitor app (or documented Maestro/manual steps)
- Camera/library → generate → playlist works with progressToken SSE/poll + resume
- Unit/smoke tests updated where practical; README notes env vars and deep link setup
