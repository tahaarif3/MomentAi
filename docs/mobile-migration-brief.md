# MomentAI → Mobile migration brief (for Cloud Agents)

**Audience:** A multi-repo Cursor Cloud Agent with access to both:
- `github.com/tahaarif3/MomentAi` (web + Express API) — primary
- `github.com/tahaarif3/momentai-mobile` (Capacitor + Vite native client)

You do **not** have prior chat history. Use this doc + `docs/mobile-api.md` + `docs/spaces-setup.md`.

---

## Product

MomentAI turns a photo into a Spotify playlist (Gemini analysis + Spotify search).  
**Spotify playlist export uses one master Spotify account** (server-side). Users open the returned playlist URL. Do **not** add per-user Spotify OAuth.

---

## Repo split (hard rule)

| Repo | Owns | Does not own |
|------|------|----------------|
| **MomentAi** | Express API, Prisma, BullMQ, web UI `src/public/`, Stripe (web), Spaces storage, Playwright | Capacitor, `ios/`, `android/`, native plugins |
| **momentai-mobile** | Vite → `dist/mobile` → Capacitor, native UX, RevenueCat client, Maestro | Prisma, Spotify secrets, Stripe Checkout in native builds |

Share **HTTPS API contract only**. No copying `src/public` into Capacitor. No nesting mobile inside the web repo.

---

## Current status (as of Phase 0/1)

### MomentAi (web) — Phase 0

Implemented on branch `cursor/phase-0-mobile-api-f096` (merge to `master` + deploy if not already):

- `POST /api/playlist/process` returns `{ jobId, progressToken }`
- `GET /api/playlist/job/:id` and `.../stream` require **owner JWT** or valid **progressToken** (closes open jobId leak)
- Per-user rate limits (IP limiter remains fallback)
- HEIC/HEIF accept + sharp → JPEG
- `GET /api/mobile/compatibility` (force-upgrade / min versions)
- `DELETE /api/auth/account` + public `/delete-account.html`
- `POST /api/billing/revenuecat` stub → sync `users.tier` (needs `REVENUECAT_WEBHOOK_SECRET` in prod)
- Docs: `docs/mobile-api.md`, `docs/spaces-setup.md`
- Deep link placeholders: `src/public/.well-known/apple-app-site-association`, `assetlinks.json`
- Web client updated to pass `progressToken` on SSE/poll

**Out of scope for Phase 0:** per-user Spotify; changing master-account export.

### momentai-mobile — Phase 1 (on `main`)

Merged scaffold:

- Vite `webDir: dist/mobile`, Capacitor 7, app id `dev.momentai.app`
- `ios/` + `android/` checked in
- Vanilla screens + `src/lib/{api,auth,camera,share,billing,analytics}.js`
- Auth/camera/billing are **partially stubbed** — finish in Phases 2–6 below
- Stripe must **not** open in public native builds

---

## API contract (mobile must follow)

Base: `VITE_API_BASE` (prod `https://momentai.dev`)  
Auth: `Authorization: Bearer <supabase_access_token>`  
Jobs: after `POST /process`, use `progressToken` on SSE (`?progressToken=`) and poll; persist `jobId`+token for resume.

Full table: **`docs/mobile-api.md`** in MomentAi.

---

## Remaining phases (implement on momentai-mobile unless noted)

### Phase 2 — Supabase auth (real)
- Parse deep link / Universal Link callback URL
- `exchangeCodeForSession` (PKCE) or `setSession` from tokens
- Persist session via Capacitor Preferences (or secure storage) adapter
- Prefer Universal/App Links; `momentai://auth/callback` fallback
- Test: sign-in/up, password reset, email confirm, expired session, reinstall, logout
- Supabase dashboard redirect allowlist (ops): `momentai://auth/callback`, `https://momentai.dev/auth/callback`

### Phase 3 — Camera + progress + resume
- Request camera and photo-library permissions separately; denied / permanently denied UX
- URI-based `@capacitor/camera` (not base64); URI → `File` for multipart `image`
- Compress ~2–4 MB JPEG; strip EXIF/location; HEIC (client and/or Phase 0 server)
- **Primary:** authenticated SSE with `progressToken` (absolute API URL)
- **Fallback:** poll when SSE fails or app resumes; persist active job locally
- Requires Phase 0 **deployed** to production

### Phase 4 — Product
- History open/delete, suggest-more, regenerate, import-by-URL
- Save playlist → master Spotify API → open URL via Browser (handle Spotify installed or not)
- Share: render PNG → **Filesystem** temp file → Share sheet → delete temp
- Spaces CORS needed for remote images on canvas (see `docs/spaces-setup.md`)

### Phase 5 — Compliance / observability
- In-app Delete account → `DELETE /api/auth/account` (+ confirm/re-auth)
- GA4 events with `platform`: `web` | `ios` | `android`; Sentry
- **Never** send images, prompts, tokens, or emails to analytics
- Link `https://momentai.dev/privacy.html` and `/delete-account.html`

### Phase 6 — Store billing
- RevenueCat + StoreKit / Play Billing; **hide Stripe** in native
- Restore purchases; webhook → MomentAi `/api/billing/revenuecat`
- Web Stripe Checkout remains web-only

### Phase 7 — QA / store
- Maestro (or Appium) + physical-device matrix
- iOS builds need macOS/Xcode
- Fill real Apple Team ID / Play cert SHA-256 in `.well-known` before shipping deep links
- Configure DigitalOcean Spaces in prod when durable Moments are required

---

## Progress strategy (do not “poll only”)

```
POST /process → { jobId, progressToken }
  → EventSource(API_BASE + /job/:id/stream?progressToken=...)
  → on error / resume → GET /job/:id?progressToken=...
```

---

## Multi-repo workflow

1. Read API/docs in **MomentAi**; implement UI/plugins in **momentai-mobile**.
2. Open PRs in the repo you change (`cursor/<descriptive>-*` branches).
3. Do **not** add Capacitor trees under MomentAi.
4. After Phase 0 is on `master`, prefer API docs from `master`; until then use Phase 0 branch docs.
5. Verify sibling checkout paths at runtime (e.g. `../MomentAi` vs `../momentai`) and document in each repo’s README/AGENTS if needed.

---

## Ops checklist (human; not blocking Phase 2 coding)

- [ ] Merge/deploy MomentAi Phase 0
- [ ] Supabase mobile redirect URLs
- [ ] Spaces + CORS (before share-card with remote photos in prod)
- [ ] `REVENUECAT_WEBHOOK_SECRET` when enabling store billing
- [ ] Replace `.well-known` placeholders at ship time
- [ ] Remove MomentAi `transfer/` folder when no longer needed

---

## Explicit non-goals

- PWA / service worker as the mobile product
- React Native / Flutter rewrite
- Packaging the live website URL inside a WebView without the Vite mobile build
- Per-user Spotify connect for export
