/**
 * Cross-platform track link enrichment (ISRC → Odesli + Apple catalog).
 * Resolve at generation time when possible; lazily backfill on /links and /p/:id.
 */

import * as spotify from '../clients/spotifyClient.js';
import * as appleMusic from '../clients/appleMusicClient.js';
import { slimTrack } from '../utils/moments.js';

const ODESLI_BASE = (process.env.ODESLI_API_BASE || 'https://api.song.link/v1-alpha.1').replace(
  /\/$/,
  ''
);
const ODESLI_CACHE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days (responses are stable)

/** In-memory Odesli cache keyed by ISRC or Spotify id */
const odesliCache = new Map();

function cacheGet(key) {
  const hit = odesliCache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    odesliCache.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet(key, value) {
  odesliCache.set(key, { value, expiresAt: Date.now() + ODESLI_CACHE_MS });
}

/**
 * Ensure Spotify tracks have external_ids.isrc (batch GET /v1/tracks).
 * Mutates track objects in place; returns same array.
 */
export async function ensureIsrcs(tracks, spotifyToken) {
  const list = Array.isArray(tracks) ? tracks : [];
  const missing = list.filter((t) => t?.id && !(t.external_ids?.isrc || t.isrc));
  if (!missing.length) return list;

  const ids = missing.map((t) => t.id);
  const detailed = await spotify.getTracksByIds(spotifyToken, ids);
  const byId = new Map(detailed.map((t) => [t.id, t]));

  for (const track of list) {
    if (!track?.id) continue;
    if (track.external_ids?.isrc || track.isrc) continue;
    const full = byId.get(track.id);
    if (full?.external_ids?.isrc) {
      track.external_ids = { ...(track.external_ids || {}), isrc: full.external_ids.isrc };
      track.isrc = full.external_ids.isrc;
    }
  }
  return list;
}

/**
 * Fetch Odesli / song.link universal URL for a track.
 * Prefer ISRC; fall back to Spotify URL.
 */
export async function fetchOdesliLink(track) {
  const isrc = track?.isrc || track?.external_ids?.isrc || null;
  const spotifyId = track?.id || null;
  const cacheKey = isrc ? `isrc:${isrc}` : spotifyId ? `spotify:${spotifyId}` : null;
  if (!cacheKey) return null;

  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  if (process.env.NODE_ENV === 'test') {
    const link = isrc
      ? `https://song.link/i/${encodeURIComponent(isrc)}`
      : `https://song.link/s/${spotifyId}`;
    cacheSet(cacheKey, link);
    return link;
  }

  const params = new URLSearchParams({ userCountry: 'US' });
  if (isrc) {
    params.set('type', 'song');
    params.set('id', isrc);
    // Odesli accepts platform+type+id; for ISRC use song.link entity id form:
    // https://api.song.link/v1-alpha.1/links?url=... is most reliable
    params.delete('type');
    params.delete('id');
    params.set('url', `https://song.link/i/${encodeURIComponent(isrc)}`);
  } else if (spotifyId) {
    params.set('url', `https://open.spotify.com/track/${spotifyId}`);
  }

  try {
    const res = await fetch(`${ODESLI_BASE}/links?${params.toString()}`, {
      headers: { Accept: 'application/json' }
    });
    if (!res.ok) {
      console.warn(`[Odesli] ${res.status} for ${cacheKey}`);
      cacheSet(cacheKey, null);
      return null;
    }
    const data = await res.json();
    const link = data?.pageUrl || data?.linksByPlatform?.spotify?.url || null;
    cacheSet(cacheKey, link);
    return link;
  } catch (err) {
    console.warn(`[Odesli] error for ${cacheKey}:`, err.message);
    return null;
  }
}

/**
 * Enrich slim tracks with odesliLink + appleCatalogId (best-effort, throttled).
 * @param {object[]} slimTracks
 * @param {{ resolveApple?: boolean }} [opts]
 */
export async function enrichTrackLinks(slimTracks, opts = {}) {
  const resolveApple = opts.resolveApple !== false && appleMusic.isAppleMusicConfigured();
  const out = [];

  for (const track of slimTracks || []) {
    if (!track) continue;
    const next = { ...track };

    if (!next.isrc && track.external_ids?.isrc) {
      next.isrc = track.external_ids.isrc;
    }

    if (!next.odesliLink) {
      next.odesliLink = await fetchOdesliLink(next);
    }

    if (resolveApple && next.isrc && !next.appleCatalogId) {
      next.appleCatalogId = await appleMusic.resolveCatalogIdByIsrc(next.isrc);
    }

    out.push(next);
  }

  return out;
}

/**
 * Load generation, backfill missing link fields, persist if changed.
 * @returns {Promise<object|null>} updated generation row or null
 */
export async function ensureGenerationTrackLinks(db, generationId) {
  const row = await db.generation.findUnique({ where: { id: generationId } });
  if (!row) return null;

  let tracks = Array.isArray(row.tracks) ? row.tracks.map((t) => ({ ...t })) : [];
  const needsIsrc = tracks.some((t) => t?.id && !t.isrc);
  const needsOdesli = tracks.some((t) => t?.id && !t.odesliLink);
  const needsApple =
    appleMusic.isAppleMusicConfigured() && tracks.some((t) => t?.isrc && !t.appleCatalogId);

  if (!needsIsrc && !needsOdesli && !needsApple) {
    return row;
  }

  if (needsIsrc) {
    try {
      const token = await spotify.getClientCredentialsToken();
      // Rehydrate as Spotify-shaped objects for getTracksByIds merge
      const hydrated = tracks.map((t) => ({
        ...t,
        external_ids: t.isrc ? { isrc: t.isrc } : undefined
      }));
      await ensureIsrcs(hydrated, token);
      tracks = hydrated.map((t) =>
        slimTrack({
          ...t,
          isrc: t.isrc || t.external_ids?.isrc || null,
          appleCatalogId: t.appleCatalogId,
          odesliLink: t.odesliLink
        })
      );
    } catch (err) {
      console.warn('[trackLinkService] ISRC backfill failed:', err.message);
    }
  }

  if (needsOdesli || needsApple) {
    tracks = await enrichTrackLinks(tracks, { resolveApple: needsApple });
  }

  await db.generation.update({
    where: { id: generationId },
    data: { tracks }
  });

  return { ...row, tracks };
}

/**
 * Map tracks to the public links API shape.
 */
export function toPublicTrackLinks(tracks) {
  return (tracks || []).map((t) => {
    const isrc = t.isrc || null;
    const appleCatalogId = t.appleCatalogId || null;
    return {
      id: t.id,
      name: t.name,
      artists: t.artists || [],
      isrc,
      appleCatalogId,
      spotifyUrl: t.id ? `https://open.spotify.com/track/${t.id}` : null,
      appleUrl: appleCatalogId ? `https://music.apple.com/song/${appleCatalogId}` : null,
      odesliLink: t.odesliLink || null
    };
  });
}
