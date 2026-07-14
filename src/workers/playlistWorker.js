import { Worker } from 'bullmq';
import { connection } from '../config/queue.js';
import db from '../config/db.js';
import { parsePlaylistImage } from '../services/geminiService.js';
import { uploadFile } from '../services/storageService.js';
import * as spotify from '../clients/spotifyClient.js';
import crypto from 'crypto';
import fs from 'fs';

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
    fileBufferBase64,
    mimeType,
    fileName,
    customPrompt,
    userId,
    spotifyToken,
    webImagePath,
    excludedSongs = [],
    pastPlaylistIds = []
  } = jobData;

  const fileBuffer = Buffer.from(fileBufferBase64, 'base64');

  // Check rate limit before starting
  const rateLimitTime = spotify.getRateLimitResetTime();
  if (rateLimitTime > 0) {
    const delayMs = Math.max(rateLimitTime - Date.now(), 1000);
    throw new Error(`RATE_LIMIT_ACTIVE:${delayMs}`);
  }

  // Resolve repeat recommendation playlist history in background
  const finalExcludedSongs = [...excludedSongs];
  if (pastPlaylistIds && pastPlaylistIds.length > 0) {
    console.log(`[Worker] Resolving history for ${pastPlaylistIds.length} playlists...`);
    for (const playlistId of pastPlaylistIds) {
      try {
        let readToken = spotifyToken;
        try {
          readToken = await spotify.getMasterAccountToken();
        } catch (tokenErr) {
          console.warn("[Worker] Failed to get master account token, falling back to client credentials:", tokenErr);
        }
        const tracks = await spotify.getPlaylistTracks(readToken, playlistId);
        if (tracks) {
          for (const track of tracks) {
            if (track && track.name) {
              finalExcludedSongs.push(`${track.name} by ${track.artists?.[0]?.name || ''}`);
            }
          }
        }
      } catch (err) {
        console.warn(`[Worker] Failed to resolve tracks for past playlist ${playlistId}:`, err);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // 1. LLM Parsing
  await updateProgressFn({ stage: 'analyzing', message: 'Analyzing visual energy with Gemini...' });
  const metadata = await parsePlaylistImage(fileBuffer, mimeType, customPrompt, fileName, finalExcludedSongs.slice(0, 50));
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

  // 3. Finalization
  await updateProgressFn({ stage: 'finalizing', message: 'Finalizing your playlist...' });
  const generationId = crypto.randomUUID();

  // Save generation logs to Database (only if user is logged in)
  if (userId) {
    await db.generation.create({
      data: {
        id: generationId,
        user_id: userId,
        image_path: webImagePath,
        dominant_colors: JSON.stringify(metadata.dominantColorPalette),
        environmental_context: metadata.environmentalContext,
        emotional_vibe: metadata.emotionalVibe,
        seed_genres: JSON.stringify(metadata.seedGenres),
        valence: metadata.valence,
        energy: metadata.energy,
        acousticness: metadata.acousticness
      }
    });
  }

  // Fetch supplementary suggestions
  await updateProgressFn({ stage: 'finalizing', message: 'Adding more song ideas…' });
  const suggestedTracks = await fetchSupplementaryTracks(spotifyToken, metadata, customPrompt, finalTracks);

  return {
    success: true,
    generationId: userId ? generationId : null,
    imagePath: webImagePath,
    metadata,
    isAuthenticated: !!userId,
    tracks: finalTracks,
    suggestedTracks
  };
}

let worker = null;

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
      // Normalize overload signals so queue retry backoff applies cleanly
      if (err?.message?.startsWith('GEMINI_OVERLOADED:')) {
        const userMsg = err.message.replace(/^GEMINI_OVERLOADED:/, '');
        throw new Error(`Failed to parse image with Gemini Flash: ${userMsg}`);
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
