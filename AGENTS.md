# AGENTS.md

## Cursor Cloud specific instructions

MomentAI is a single Node.js/Express app (port `3000`). Standard build/test/run
commands live in `.github/copilot-instructions.md` and `package.json` scripts —
refer to those rather than duplicating. Notes below are the non-obvious,
durable caveats for running it in this Cloud VM.

### Services must be started manually on each boot
PostgreSQL 16 and Redis 7 are installed but are NOT auto-started (no systemd in
this VM). Start both before running the app or tests:

```bash
sudo pg_ctlcluster 16 main start
sudo redis-server /etc/redis/redis.conf --daemonize yes
```

### Local database / `.env`
- A local Postgres role and DBs are provisioned: role `momentai` (password
  `momentai`, superuser), databases `momentai_dev` and `momentai_ci`.
- `.env` is git-ignored and already present on the VM. It points
  `DATABASE_URL`/`DIRECT_URL` at `momentai_dev` and `REDIS_URL` at local Redis.
- External API keys (`GEMINI_API_KEY`, `SPOTIFY_CLIENT_ID/SECRET`, Supabase,
  Stripe) are intentionally left blank locally. The real product features that
  call them will error at request time until real keys are supplied as secrets;
  everything else (server boot, health, DB, queue, frontend) works without them.
- If `momentai_dev` is empty (e.g. schema drift), re-sync with
  `npx prisma db push` (needs Postgres running).

### Running vs. testing (important port caveat)
- Dev run: `npm run dev` requires Postgres + Redis. Verify with
  `curl http://127.0.0.1:3000/health` (expects `"database":"UP"`).
- `npm test` (Playwright) starts its OWN server on port `3000` with
  `NODE_ENV=test` and `reuseExistingServer: false`, so it will FAIL to start if a
  dev server is already bound to `3000`. Stop any server on `3000` first, or run
  the two on different ports.
- Under `NODE_ENV=test`, Gemini/Spotify/Supabase are mocked and Redis is bypassed
  (jobs run synchronously); only PostgreSQL is required for the test suite.

### Product behavior that looks like a bug but isn't
Anonymous (unauthenticated) users get a blurred playlist behind a "Sign in to
unlock" gate — this is the intended value gate. Generation still succeeds; mock
tracks are visible in the "Add more songs" section. In test mode, bearer token
`test_token` authenticates as `test_user_id` for authed flows.

### Lint / build
No linter and no JS build step exist; the app runs directly from source.
