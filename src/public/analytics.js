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

export function trackPhotoUploaded({ fileType, fileSize, hasCustomPrompt, userId, jobId } = {}) {
  if (typeof gtag !== 'function') return;

  const params = {};
  if (fileType) params.file_type = String(fileType);
  if (Number.isFinite(fileSize)) params.file_size = fileSize;
  if (typeof hasCustomPrompt === 'boolean') params.has_custom_prompt = hasCustomPrompt;
  if (userId) params.user_id = String(userId);
  if (jobId) params.job_id = String(jobId);

  gtag('event', 'photo_uploaded', params);
}

export function trackGenerateSoundtrackClicked({ fileType, fileSize, hasCustomPrompt, userId } = {}) {
  if (typeof gtag !== 'function') return;

  const params = {};
  if (fileType) params.file_type = String(fileType);
  if (Number.isFinite(fileSize)) params.file_size = fileSize;
  if (typeof hasCustomPrompt === 'boolean') params.has_custom_prompt = hasCustomPrompt;
  if (userId) params.user_id = String(userId);

  gtag('event', 'generate_soundtrack_clicked', params);
}
