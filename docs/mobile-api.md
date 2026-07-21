# MomentAI Mobile API Contract

Base URL (production): `https://momentai.dev`  
Auth: `Authorization: Bearer <supabase_access_token>`  
Job progress (SSE/poll): owner JWT **or** `progressToken` from `POST /process`.

Spotify playlist **export uses the master Spotify account** (unchanged). Clients open the returned playlist URL.

Multi-target output: generations persist **platform-agnostic tracks** (`isrc`, optional `appleCatalogId`, `odesliLink`). Clients share `shareUrl` (`/p/:id`) or save to Apple Music / Spotify adapters.

## Compatibility

`GET /api/mobile/compatibility` (public)

```json
{
  "success": true,
  "minIosVersion": "1.0.0",
  "minAndroidVersion": "1.0.0",
  "minAppVersion": "1.0.0",
  "forceUpgrade": false,
  "forceUpgradeMessage": "Please update MomentAI to continue.",
  "apiBase": "https://momentai.dev",
  "features": {
    "masterSpotifyExport": true,
    "storeBilling": false,
    "stripeCheckoutInApp": false,
    "multiTargetLinks": true,
    "appleMusicSave": false,
    "appleMusicDevToken": false
  }
}
```

## Auth

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/auth/config` | `supabaseUrl`, `supabaseAnonKey` |
| POST | `/api/auth/callback` | Upsert user after login |
| GET | `/api/auth/me` | Profile + daily remaining |
| POST | `/api/auth/logout` | Ack |
| DELETE | `/api/auth/account` | Permanent account deletion |

## Playlist

| Method | Path | Notes |
|--------|------|--------|
| POST | `/api/playlist/process` | multipart `image` (+ optional `customPrompt`). Accepts JPEG/PNG/WebP/HEIC. Target **2–4 MB JPEG** client-side. Always returns `generationId` + `shareUrl`. |
| GET | `/api/playlist/job/:jobId/stream` | SSE; `?progressToken=` or `X-Progress-Token` or owner JWT |
| GET | `/api/playlist/job/:jobId` | Poll fallback; same credentials |
| POST | `/api/playlist/save` | Master-account Spotify playlist |
| POST | `/api/playlist/suggest-more` | |
| POST | `/api/playlist/regenerate` | Premium |
| GET | `/api/playlist/history` | |
| GET/DELETE | `/api/playlist/generation/:id` | Owner-only reopen / delete |
| GET | `/api/playlist/generation/:id/links` | **Public** multi-target links (Odesli / Apple / Spotify). Lazy-backfills ISRC + links. |
| POST | `/api/playlist/import` | |

### Track shape (persisted + returned)

```json
{
  "id": "spotifyTrackId",
  "uri": "spotify:track:…",
  "name": "Title",
  "artists": [{ "name": "Artist" }],
  "album": { "name": "Album", "images": [] },
  "duration_ms": 180000,
  "preview_url": null,
  "isrc": "USUM71234567",
  "appleCatalogId": "1234567890",
  "odesliLink": "https://song.link/…"
}
```

### Public share page

`GET /p/:id` — server-rendered HTML with Open Graph tags. Same data as `/generation/:id/links`.

### Process response (async)

```json
{
  "success": true,
  "jobId": "123",
  "progressToken": "<signed>",
  "message": "Playlist generation started."
}
```

Persist `jobId` + `progressToken` on device for resume after backgrounding.

Completed job / sync result includes `generationId`, `shareUrl` (`https://momentai.dev/p/<id>`), `tracks`, `metadata`.

## Apple Music

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/apple/dev-token` | Short-lived MusicKit developer JWT (ES256). Requires `APPLE_MUSIC_*` env. |

Music User Token is obtained on-device (iOS MusicKit plugin / Android MusicKit JS). Never send the private key to clients.

## Billing

| Client | Mechanism |
|--------|-----------|
| Web | Stripe Checkout / Portal (`/api/payment/*`) |
| Native | StoreKit / Play Billing via RevenueCat → `POST /api/billing/revenuecat` |

Native public builds must **not** open Stripe Checkout for Premium.

## Rate limits

- Per authenticated user on process / suggest-more / regenerate (primary)
- Per IP via Express limiter (fallback)
- Daily upload cap: `users.daily_upload_limit` (free); premium unlimited

## Storage

Production should set `STORAGE_PROVIDER=s3` with DigitalOcean Spaces (or compatible) so images survive redeploys. See [spaces-setup.md](./spaces-setup.md).

## Web front-end role

Interactive browser generation UI can be soft-retired via `WEB_INTERACTIVE_UI_ENABLED=false` (landing + store CTAs). Keep `/p/:id`, `/auth/callback`, privacy/terms/support pages live — mobile depends on the API + share pages.
