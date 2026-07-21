/**
 * GA4 helpers — requires gtag.js loaded in index.html.
 */
export function trackPlaylistCreated({ playlistId, playlistName, trackCount, userId } = {}) {
  if (typeof gtag !== 'function') return;

  const params = {};
  if (playlistId != null) params.playlist_id = String(playlistId);
  if (playlistName) params.playlist_name = String(playlistName);
  if (Number.isFinite(trackCount)) params.track_count = trackCount;
  if (userId) params.user_id = String(userId);

  gtag('event', 'playlist_created', params);
}
