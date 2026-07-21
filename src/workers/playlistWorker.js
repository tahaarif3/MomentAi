import { Worker, UnrecoverableError } from 'bullmq';
import { connection } from '../config/queue.js';
import db from '../config/db.js';
import { parsePlaylistImage } from '../services/geminiService.js';
import * as spotify from '../clients/spotifyClient.js';
import crypto from 'crypto';
import { slimTracks, FREE_TRACK_LIMIT, publicPlaylistUrl } from '../utils/moments.js';
import { loadImageBytes } from '../utils/image.js';
import { ensureIsrcs, enrichTrackLinks } from '../services/trackLinkService.js';

// Helper to filter unique tracks
function filterUniqueTracks(tracks, excludeTracks = []) {
  const excludeIds = new Set(excludeTracks.map((track) => track.id).filter(Boolean));
  const seen = new Set();

  return tracks.filter((track) => {
    if (!track?.id || excludeIds.has(track.id)) return false;

    const cleanTitle = track.name.toLowerCase().replace(/\s*[\(\[-].*$/g, '').trim();
    const artistName = track.artists?.[0]?.name?.toLowerCase() || '';
    const key = `${cleanTitle} - ${artistName}`;

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Helper to fetch supplementary tracks via Spotify search fallback
async function fetchSupplementaryTracks(spotifyToken, metadata, customPrompt, excludeTracks = []) {
  try {
    const pool = await spotify.getRecommendationsFallback(
      spotifyToken,
      metadata.seedGenres,
      customPrompt,
      metadata.emotionalVibe
    );
    return filterUniqueTracks(pool, excludeTracks);
  } catch (err) {
    console.warn('Failed to fetch supplementary track suggestions:', err);
    return [];
  }
}

// Core processing logic that runs inside the worker (and inline in tests)
export async function processPlaylistJob(jobData, updateProgressFn = async () => {}) {
  const {
    sourceImagePath,
    fileName,
    customPrompt,
    userId,
    webImagePath,
    imageThumb = null,
    excludedSongs = [],
    trackLimit = FREE_TRACK_LIMIT
  } = jobData;

  // Queue jobs contain a durable image path, not the original image bytes.
  // This keeps Redis payloads small even for 10 MB uploads and retries.
  const { buffer: fileBuffer, mimeType } = await loadImageBytes(sourceImagePath);
  const spotifyToken = await spotify.getClientCredentialsToken();

  // Check rate limit before starting
  const rateLimitTime = spotify.getRateLimitResetTime();
  if (rateLimitTime > 0) {
    const delayMs = Math.max(rateLimitTime - Date.now(), 1000);
    throw new Error(`RATE_LIMIT_ACTIVE:${delayMs}`);
  }

  // 1. LLM Parsing
  await updateProgressFn({ stage: 'analyzing', message: 'Analyzing visual energy with Gemini...' });
  const metadata = await parsePlaylistImage(fileBuffer, mimeType, customPrompt, fileName, excludedSongs.slice(0, 50));
  console.log("Gemini parsed metadata:", JSON.stringify(metadata, null, 2));

  // Check rate limit after Gemini
  const rateLimitTimeAfterGemini = spotify.getRateLimitResetTime();
  if (rateLimitTimeAfterGemini > 0) {
    const delayMs = Math.max(rateLimitTimeAfterGemini - Date.now(), 1000);
    throw new Error(`RATE_LIMIT_ACTIVE:${delayMs}`);
  }

  // 2. Track Resolution
  await updateProgressFn({ stage: 'resolving', message: 'Finding tracks on Spotify...' });
  const recommendedSongs = metadata.recommendedSongs || [];
  console.log(`AI recommended ${recommendedSongs.length} tracks - resolving on Spotify...`);

  const searchResults = [];
  for (let i = 0; i < recommendedSongs.length; i++) {
    const song = recommendedSongs[i];
    // Intercept rate limits during loop
    const limitReset = spotify.getRateLimitResetTime();
    if (limitReset > 0) {
      const delayMs = Math.max(limitReset - Date.now(), 1000);
      throw new Error(`RATE_LIMIT_ACTIVE:${delayMs}`);
    }

    try {
      const track = await spotify.searchTrackByDetails(spotifyToken, song.title, song.artist);
      if (track) {
        searchResults.push(track);
      }
    } catch (err) {
      console.warn(`Failed to resolve track "${song.title}" by "${song.artist}" on Spotify:`, err);
    }

    // Keep SSE/proxy alive with progress every few tracks
    if (i === 0 || (i + 1) % 4 === 0 || i === recommendedSongs.length - 1) {
      await updateProgressFn({
        stage: 'resolving',
        message: `Matching tracks on Spotify… ${i + 1}/${recommendedSongs.length}`
      });
    }
  }

  let finalTracks = searchResults;

  // Deduplicate and filter repeat recommendations
  const seenTitles = new Set();
  const pastTitles = new Set(excludedSongs.map(s => {
    const parts = s.split(' by ');
    const title = parts[0].toLowerCase().replace(/\s*[\(\[-].*$/g, '').trim();
    const artist = parts[1]?.toLowerCase() || '';
    return `${title} - ${artist}`;
  }));

  finalTracks = finalTracks.filter(track => {
    if (!track || !track.id) return false;
    const cleanTitle = track.name.toLowerCase().replace(/\s*[\(\[-].*$/g, '').trim();
    const artistName = track.artists?.[0]?.name?.toLowerCase() || '';
    const uniqueKey = `${cleanTitle} - ${artistName}`;
    
    if (seenTitles.has(uniqueKey) || pastTitles.has(uniqueKey)) {
      return false;
    }
    seenTitles.add(uniqueKey);
    return true;
  });

  // Failsafe backup
  if (finalTracks.length === 0) {
    console.warn("Spotify failed to resolve any of Gemini's recommendations. Running backup genre-based blend...");
    try {
      const backupPool = await fetchSupplementaryTracks(spotifyToken, metadata, customPrompt, []);
      if (backupPool.length > 0) {
        const splitIndex = Math.ceil(backupPool.length / 2);
        finalTracks = backupPool.slice(0, splitIndex);
      }
    } catch (backupErr) {
      console.error("Failsafe backup recommendation also failed:", backupErr);
    }
  }

  // 3. Finalization — apply tier track cap before persist/return
  await updateProgressFn({ stage: 'finalizing', message: 'Finalizing your playlist...' });
  const generationId = crypto.randomUUID();
  const cappedTracks = finalTracks.slice(0, trackLimit);

  // Free generations do not need a second Spotify search pool. Premium users
  // retain the extra discovery tracks as part of their higher-value experience.
  const suggestedTracks = trackLimit > FREE_TRACK_LIMIT
    ? await fetchSupplementaryTracks(spotifyToken, metadata, customPrompt, cappedTracks)
    : [];

  // Backfill ISRCs (and Odesli/Apple when configured) once at generation time.
  await ensureIsrcs(cappedTracks, spotifyToken);
  await ensureIsrcs(suggestedTracks, spotifyToken);

  let slimmedTracks = slimTracks(cappedTracks);
  let slimmedSuggested = slimTracks(suggestedTracks);
  try {
    slimmedTracks = await enrichTrackLinks(slimmedTracks);
    slimmedSuggested = await enrichTrackLinks(slimmedSuggested, { resolveApple: false });
  } catch (linkErr) {
    console.warn('[Worker] Track link enrichment failed (non-fatal):', linkErr.message);
  }

  // Always persist so /p/:id share pages work (user_id may be null for anonymous).
  await db.generation.create({
    data: {
      id: generationId,
      user_id: userId || null,
      image_path: webImagePath,
      image_thumb: imageThumb || null,
      dominant_colors: JSON.stringify(metadata.dominantColorPalette),
      environmental_context: metadata.environmentalContext,
      emotional_vibe: metadata.emotionalVibe,
      seed_genres: JSON.stringify(metadata.seedGenres),
      valence: metadata.valence,
      energy: metadata.energy,
      acousticness: metadata.acousticness,
      tracks: slimmedTracks,
      suggested_tracks: slimmedSuggested
    }
  });

  return {
    success: true,
    generationId,
    shareUrl: publicPlaylistUrl(generationId),
    imagePath: imageThumb || webImagePath,
    imageThumb: imageThumb || null,
    metadata,
    isAuthenticated: !!userId,
    tracks: cappedTracks,
    suggestedTracks
  };
}

let worker = null;

function isRetryableJobError(error) {
  const message = String(error?.message || '').toLowerCase();
  return [
    'gemini_overloaded',
    'rate_limit_active',
    'spotify api rate limit',
    'rate limit',
    'resource_exhausted',
    '429',
    '503',
    'fetch failed',
    'econnreset',
    'etimedout',
    'eai_again'
  ].some((needle) => message.includes(needle));
}

// Initialize worker in non-test environments
if (process.env.NODE_ENV !== 'test') {
  worker = new Worker('playlist-generation', async (job) => {
    console.log(`[Worker] Starting job ${job.id}`);

    try {
      const result = await processPlaylistJob(job.data, async (progressData) => {
        await job.updateProgress(progressData);
      });

      // Cooldown after return is delayed via short sleep before return so Redis
      // 'completed' is not starved by long silent work — sleep runs then we return.
      await new Promise(resolve => setTimeout(resolve, 500));
      console.log(`[Worker] Completed job ${job.id}.`);
      return result;
    } catch (err) {
      if (!isRetryableJobError(err)) {
        // Configuration, validation, and missing-object errors cannot succeed
        // on retry, so do not multiply queue operations for them.
        throw new UnrecoverableError(err?.message || 'Playlist generation failed.');
      }
      throw err;
    }
  }, {
    connection,
    concurrency: 1, // One at a time — concurrent Gemini calls worsen 503 spikes
  });

  worker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('[Worker] Error:', err);
  });

  console.log('[Worker] BullMQ playlist generation worker started');
}

export { worker };
