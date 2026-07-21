/** Daily moment limit helpers (UTC day boundary). */
export const DEFAULT_DAILY_LIMIT = 3;
export const FREE_DAILY_LIMIT = DEFAULT_DAILY_LIMIT; // backward-compatible alias
export const FREE_TRACK_LIMIT = 15;
export const PREMIUM_TRACK_LIMIT = 24;

export function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Effective daily cap for a user. Premium → unlimited (null). */
export function effectiveDailyLimit(user) {
  if (!user) return DEFAULT_DAILY_LIMIT;
  if (user.tier === 'premium') return null;
  const limit = user.daily_upload_limit;
  if (limit == null || Number.isNaN(Number(limit))) return DEFAULT_DAILY_LIMIT;
  return Math.max(0, Number(limit));
}

/**
 * @returns {Promise<number|null>} remaining uploads today, or null if unlimited
 */
export async function getRemainingToday(db, userId, userOrTier) {
  if (!userId) return null;

  let user = userOrTier;
  if (typeof userOrTier === 'string' || userOrTier == null) {
    user = await db.user.findUnique({
      where: { id: userId },
      select: { tier: true, daily_upload_limit: true }
    });
  }

  const limit = effectiveDailyLimit(user);
  if (limit == null) return null;

  const count = await db.generation.count({
    where: {
      user_id: userId,
      created_at: { gte: startOfUtcDay() }
    }
  });

  return Math.max(0, limit - count);
}

export function trackLimitForTier(tier) {
  return tier === 'premium' ? PREMIUM_TRACK_LIMIT : FREE_TRACK_LIMIT;
}

/**
 * Slim track objects for JSON persistence.
 * Platform-agnostic fields (isrc, appleCatalogId, odesliLink) enable multi-target output.
 */
export function slimTrack(track) {
  if (!track?.id) return null;
  return {
    id: track.id,
    uri: track.uri,
    name: track.name,
    artists: (track.artists || []).map((a) => ({ name: a.name })),
    album: {
      name: track.album?.name || '',
      images: track.album?.images || []
    },
    duration_ms: track.duration_ms,
    preview_url: track.preview_url ?? null,
    isrc: track.external_ids?.isrc || track.isrc || null,
    appleCatalogId: track.appleCatalogId ?? null,
    odesliLink: track.odesliLink ?? null
  };
}

export function slimTracks(tracks) {
  return (tracks || []).map(slimTrack).filter(Boolean);
}

/** Extract compact, prompt-safe repeat exclusions from persisted Spotify tracks. */
export function trackExclusions(tracks, limit = 50) {
  const seen = new Set();
  const exclusions = [];
  for (const track of tracks || []) {
    const title = track?.name?.trim();
    const artist = track?.artists?.[0]?.name?.trim();
    if (!title) continue;
    const value = `${title} by ${artist || ''}`;
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      exclusions.push(value);
    }
    if (exclusions.length >= limit) break;
  }
  return exclusions;
}

/** Public share URL for a generation (Odesli universal-link surface). */
export function publicPlaylistUrl(generationId, baseUrl = process.env.APP_BASE_URL) {
  if (!generationId) return null;
  const base = (baseUrl || 'https://momentai.dev').replace(/\/$/, '');
  return `${base}/p/${generationId}`;
}
