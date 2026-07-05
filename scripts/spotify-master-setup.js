#!/usr/bin/env node
/**
 * spotify-master-setup.js
 *
 * One-time helper that performs the Spotify OAuth flow for the
 * "master" account and prints the long-lived refresh_token.
 *
 * Usage:
 *   node scripts/spotify-master-setup.js
 *
 * Prerequisites:
 *   - SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET set in .env
 */

import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { URL } from 'node:url';

// ── Config ──────────────────────────────────────────────────────────────────
const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const PORT          = 8888;
const REDIRECT_URI  = `http://127.0.0.1:${PORT}/callback`;
const SCOPES        = 'playlist-modify-public ugc-image-upload';

// ── Pre-flight checks ───────────────────────────────────────────────────────
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    '\n❌  SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set in your .env file.\n' +
    '    1. Go to https://developer.spotify.com/dashboard\n' +
    '    2. Select your app → Settings → copy the values into .env\n'
  );
  process.exit(1);
}

// ── Build Spotify authorize URL ─────────────────────────────────────────────
const authorizeUrl = new URL('https://accounts.spotify.com/authorize');
authorizeUrl.searchParams.set('client_id',     CLIENT_ID);
authorizeUrl.searchParams.set('response_type',  'code');
authorizeUrl.searchParams.set('redirect_uri',   REDIRECT_URI);
authorizeUrl.searchParams.set('scope',           SCOPES);
authorizeUrl.searchParams.set('show_dialog',     'true');   // always prompt for consent

// ── Express server ──────────────────────────────────────────────────────────
const app    = express();
const server = createServer(app);

app.get('/callback', async (req, res) => {
  const code  = req.query.code;
  const error = req.query.error;

  if (error) {
    res.send(`<h2>Authorization denied</h2><p>${error}</p>`);
    shutdown('Authorization was denied by the user.');
    return;
  }

  if (!code) {
    res.status(400).send('<h2>Missing authorization code</h2>');
    return;
  }

  try {
    // Exchange the authorization code for tokens
    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
      },
      body: new URLSearchParams({
        grant_type:   'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    if (!tokenResponse.ok) {
      const errBody = await tokenResponse.text();
      res.status(500).send(`<h2>Token exchange failed</h2><pre>${errBody}</pre>`);
      shutdown('Token exchange failed — see error above.');
      return;
    }

    const data = await tokenResponse.json();

    // ── Success! ────────────────────────────────────────────────────────────
    res.send(
      '<h2>✅ Success!</h2>' +
      '<p>Your refresh token has been printed to the terminal.</p>' +
      '<p>You can close this tab.</p>'
    );

    console.log('\n' + '═'.repeat(60));
    console.log('  ✅  Spotify Master Account linked successfully!');
    console.log('═'.repeat(60));
    console.log('\n  Your refresh token:\n');
    console.log(`  ${data.refresh_token}`);
    console.log('\n  ➜  Add this to your .env file:\n');
    console.log(`  SPOTIFY_MASTER_REFRESH_TOKEN=${data.refresh_token}`);
    console.log('\n' + '═'.repeat(60) + '\n');

    shutdown();
  } catch (err) {
    res.status(500).send('<h2>Internal error</h2><pre>' + err.message + '</pre>');
    shutdown('Token exchange threw an error: ' + err.message);
  }
});

// ── Helpers ─────────────────────────────────────────────────────────────────
function shutdown(errorMsg) {
  if (errorMsg) {
    console.error(`\n❌  ${errorMsg}\n`);
  }
  server.close(() => process.exit(errorMsg ? 1 : 0));
  // Force-kill after 3 s in case connections linger
  setTimeout(() => process.exit(errorMsg ? 1 : 0), 3000);
}

// ── Start ───────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log('\n' + '─'.repeat(60));
  console.log('  🎵  Spotify Master Account Setup');
  console.log('─'.repeat(60));
  console.log(`\n  Redirect URI registered in your Spotify Dashboard must be:`);
  console.log(`    ${REDIRECT_URI}\n`);
  console.log('  Open this URL in your browser to authorize:\n');
  console.log(`    ${authorizeUrl.toString()}\n`);
  console.log('  Waiting for callback on port ' + PORT + '…');
  console.log('─'.repeat(60) + '\n');
});
