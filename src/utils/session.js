/**
 * Returns the authenticated Spotify user id from a signed session cookie.
 * Unsigned cookies are accepted only outside production (local/test).
 */
export function getSpotifyUserId(req) {
  const signedId = req.signedCookies?.['spotify_user_id'];
  if (signedId) {
    return signedId;
  }

  if (process.env.NODE_ENV !== 'production') {
    return req.cookies?.['spotify_user_id'] ?? null;
  }

  return null;
}
