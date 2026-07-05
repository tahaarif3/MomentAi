# Project Checklist: Playlist_pic

## Phase 1: Setup & Scaffolding
- [x] Initialize `package.json` with dependencies
- [x] Create `.env.example` file
- [x] Implement database initialization (`src/config/db.js`) and migration for users/generations tables

## Phase 2: Core Pipeline (Ingestion -> Parsing -> Spotify Match)
- [x] Setup Express server & Multer upload directory
- [x] Implement `src/services/geminiService.js` for Gemini Flash vision structured extraction
- [x] Implement Spotify API helper `src/clients/spotifyClient.js` (client credentials for recommendation matching)
- [x] Create base backend route `POST /api/playlist/process` to run core pipeline
- [ ] Verify core pipeline with a sample image upload (Requires API keys)

## Phase 3: Spotify OAuth & Playlist Saving
- [x] Implement Spotify authorization redirect & callback routes
- [x] Store / update user credentials in SQLite database
- [x] Add backend endpoint to create playlist and add recommendation tracks to user's Spotify account

## Phase 4: Token Tracking & Payment Gates
- [x] Implement middleware to check/deduct tokens for free-tier users
- [x] Implement payment mock routes for purchasing tokens & subscribing to premium

## Phase 5: Responsive UI & Player Integration
- [x] Implement static folder serving in Express
- [x] Design HTML/CSS frontend dashboard (dark-themed, glassmorphism, responsive grids)
- [x] Implement Javascript client to render track cards, player preview widgets, and upload state
- [ ] Perform final end-to-end verification (Requires API keys)
