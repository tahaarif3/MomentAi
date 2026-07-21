# Apple Music (iOS) — native wiring

Mobile JS dark-launches **Save to Apple Music** when:

- `GET /api/mobile/compatibility` → `features.appleMusicSave` / `appleMusicDevToken`, or
- `VITE_APPLE_ENABLED=true`

## Server (MomentAi web)

1. Create a MusicKit key in Apple Developer.
2. Set on the API host:
   - `APPLE_MUSIC_ENABLED=true`
   - `APPLE_MUSIC_TEAM_ID`
   - `APPLE_MUSIC_KEY_ID`
   - `APPLE_MUSIC_PRIVATE_KEY` (PEM, `\n` escaped OK)
3. Confirm `GET /api/apple/dev-token` returns a JWT.

## iOS project

Plugin sources (add to the Xcode **App** target if not already):

- `ios/App/App/Plugins/AppleMusicPlugin/AppleMusicPlugin.swift`
- `ios/App/App/Plugins/AppleMusicPlugin/AppleMusicPlugin.m`

Also:

1. Enable **MusicKit** for the App ID / capability.
2. `Info.plist` already includes `NSAppleMusicUsageDescription`.
3. Link **StoreKit** + **MusicKit** frameworks.
4. `npx cap sync ios` and rebuild.

## Flow

1. JS fetches developer token from `/api/apple/dev-token`.
2. Plugin `authorize({ developerToken })` → `MusicAuthorization` + Music User Token.
3. Plugin `createPlaylist({ name, description, catalogIds })` → `POST /v1/me/library/playlists`.
4. GA4 `playlist_save` with `{ target: 'apple_music', matched_count, track_count }`.

## Android

v1 opens Apple Music / share-page deep links. Validate create+add REST verbs on device before a full MusicKit JS auth path.
