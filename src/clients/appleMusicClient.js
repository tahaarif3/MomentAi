/**
 * Apple Music API helpers — developer token (ES256 JWT) + catalog ISRC lookup.
 * Private MusicKit key stays server-side only.
 */

import { SignJWT, importPKCS8 } from 'jose';

const TOKEN_TTL_SECONDS = 12 * 60 * 60; // 12h (Apple allows up to ~6 months)
let tokenCache = { token: null, expiresAt: 0 };
let privateKeyPromise = null;

function appleConfigured() {
  return Boolean(
    process.env.APPLE_MUSIC_TEAM_ID &&
      process.env.APPLE_MUSIC_KEY_ID &&
      process.env.APPLE_MUSIC_PRIVATE_KEY
  );
}

export function isAppleMusicConfigured() {
  return appleConfigured();
}

function normalizePrivateKey(raw) {
  if (!raw) return '';
  // Support env values with literal \n or already-formatted PEM
  return String(raw).replace(/\\n/g, '\n').trim();
}

async function getPrivateKey() {
  if (!privateKeyPromise) {
    const pem = normalizePrivateKey(process.env.APPLE_MUSIC_PRIVATE_KEY);
    privateKeyPromise = importPKCS8(pem, 'ES256');
  }
  return privateKeyPromise;
}

/**
 * Sign a short-lived MusicKit developer token.
 * @returns {Promise<string|null>}
 */
export async function getDeveloperToken() {
  if (process.env.NODE_ENV === 'test') {
    return 'test_apple_dev_token';
  }
  if (!appleConfigured()) return null;

  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.token && tokenCache.expiresAt > now + 60) {
    return tokenCache.token;
  }

  const teamId = process.env.APPLE_MUSIC_TEAM_ID;
  const keyId = process.env.APPLE_MUSIC_KEY_ID;
  const key = await getPrivateKey();
  const exp = now + TOKEN_TTL_SECONDS;

  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(key);

  tokenCache = { token, expiresAt: exp };
  return token;
}

/**
 * Resolve Apple Music catalog song ID from ISRC.
 * @param {string} isrc
 * @param {string} [storefront='us']
 * @returns {Promise<string|null>}
 */
export async function resolveCatalogIdByIsrc(isrc, storefront = 'us') {
  if (!isrc) return null;
  if (process.env.NODE_ENV === 'test') {
    return `apple_mock_${String(isrc).slice(0, 12)}`;
  }

  const token = await getDeveloperToken();
  if (!token) return null;

  const url =
    `https://api.music.apple.com/v1/catalog/${encodeURIComponent(storefront)}` +
    `/songs?filter[isrc]=${encodeURIComponent(isrc)}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      console.warn(`[AppleMusic] ISRC lookup failed ${res.status} for ${isrc}`);
      return null;
    }
    const data = await res.json();
    const id = data?.data?.[0]?.id || null;
    return id;
  } catch (err) {
    console.warn(`[AppleMusic] ISRC lookup error for ${isrc}:`, err.message);
    return null;
  }
}
