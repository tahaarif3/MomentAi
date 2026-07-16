/** Daily moment limit helpers (UTC day boundary). */
export const FREE_DAILY_LIMIT = 3;
export const FREE_TRACK_LIMIT = 15;
export const PREMIUM_TRACK_LIMIT = 24;

export function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function getRemainingToday(db, userId, tier) {
  if (!userId) return null;
  if (tier === 'premium') return null;

  const count = await db.generation.count({
    where: {
      user_id: userId,
      created_at: { gte: startOfUtcDay() }
    }
  });

  return Math.max(0, FREE_DAILY_LIMIT - count);
}

export function trackLimitForTier(tier) {
  return tier === 'premium' ? PREMIUM_TRACK_LIMIT : FREE_TRACK_LIMIT;
}

/** Slim Spotify track objects for JSON persistence. */
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
    preview_url: track.preview_url ?? null
  };
}

export function slimTracks(tracks) {
  return (tracks || []).map(slimTrack).filter(Boolean);
}
