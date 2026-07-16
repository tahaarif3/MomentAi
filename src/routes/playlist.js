import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import db from '../config/db.js';
import { parsePlaylistImage } from '../services/geminiService.js';
import * as spotify from '../clients/spotifyClient.js';
import { getAuthUserId } from '../utils/session.js';
import { uploadFile } from '../services/storageService.js';
import { playlistQueue, connection } from '../config/queue.js';
import { processPlaylistJob } from '../workers/playlistWorker.js';
import { QueueEvents } from 'bullmq';
import {
  FREE_DAILY_LIMIT,
  getRemainingToday,
  trackLimitForTier,
  startOfUtcDay
} from '../utils/moments.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

export { FREE_DAILY_LIMIT, getRemainingToday };

const router = express.Router();

// Configure storage for Multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/';
    // Create uploads directory if it does not exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, 'playlist-' + uniqueSuffix + ext);
  }
});

// File filter to allow only image files
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

/**
 * Middleware: enforce 3 moments/day for free tier (UTC). Anonymous users pass through.
 */
async function checkDailyLimit(req, res, next) {
  try {
    const userId = await getAuthUserId(req);
    if (!userId) return next();

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { tier: true }
    });
    if (!user) return next();
    if (user.tier === 'premium') return next();

    const todayCount = await db.generation.count({
      where: {
        user_id: userId,
        created_at: { gte: startOfUtcDay() }
      }
    });

    if (todayCount >= FREE_DAILY_LIMIT) {
      return res.status(403).json({
        success: false,
        code: 'DAILY_LIMIT',
        remainingToday: 0,
        message: 'You have used all 3 free moments for today. Upgrade to Plus for unlimited generations.'
      });
    }

    next();
  } catch (error) {
    console.error('Error in checkDailyLimit middleware:', error);
    next(error);
  }
}

function guessMimeFromPath(imagePath) {
  const ext = path.extname(imagePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

async function loadImageBytes(imagePath) {
  if (!imagePath) throw new Error('Missing image path.');
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    const response = await fetch(imagePath);
    if (!response.ok) {
      throw new Error(`Failed to fetch stored image: ${response.statusText}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const mimeType = response.headers.get('content-type') || guessMimeFromPath(imagePath);
    return { buffer, mimeType };
  }

  const relative = imagePath.startsWith('/') ? imagePath.slice(1) : imagePath;
  const localPath = path.resolve(projectRoot, relative);
  const buffer = await fs.promises.readFile(localPath);
  return { buffer, mimeType: guessMimeFromPath(imagePath) };
}

function generationToProcessResult(row) {
  const tracks = Array.isArray(row.tracks) ? row.tracks : [];
  const suggestedTracks = Array.isArray(row.suggested_tracks) ? row.suggested_tracks : [];
  return {
    success: true,
    generationId: row.id,
    imagePath: row.image_path,
    metadata: {
      dominantColorPalette: JSON.parse(row.dominant_colors),
      environmentalContext: row.environmental_context,
      emotionalVibe: row.emotional_vibe,
      seedGenres: JSON.parse(row.seed_genres),
      valence: row.valence,
      energy: row.energy,
      acousticness: row.acousticness
    },
    tracks,
    suggestedTracks,
    playlistUrl: row.playlist_url || null,
    playlistName: row.playlist_name || null,
    isAuthenticated: true
  };
}

async function enqueueOrRunJob(jobData, res) {
  if (process.env.NODE_ENV === 'test') {
    const result = await processPlaylistJob(jobData);
    return res.json(result);
  }

  const job = await playlistQueue.add('playlist-generation', jobData);
  return res.status(202).json({
    success: true,
    jobId: job.id,
    message: 'Playlist generation started.'
  });
}

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

async function fetchSupplementaryTracks(spotifyToken, metadata, customPrompt, excludeTracks = []) {
  try {
    const pool = await spotify.getRecommendations(
      spotifyToken,
      metadata.seedGenres,
      metadata.valence,
      metadata.energy,
      metadata.acousticness,
      customPrompt,
      metadata.emotionalVibe
    );
    return filterUniqueTracks(pool, excludeTracks);
  } catch (err) {
    console.warn('Failed to fetch supplementary track suggestions:', err);
    return [];
  }
}

/**
 * Route: POST /api/playlist/process
 * Accepts an image file, parses it via Gemini, fetches Spotify recommendations.
 * Works for both authenticated and anonymous users.
 */
router.post('/process', upload.single('image'), checkDailyLimit, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: "Please upload an image file." });
  }

  const filePath = req.file.path;
  const mimeType = req.file.mimetype;
  const userId = await getAuthUserId(req);

  if (process.env.NODE_ENV === 'test' && userId) {
    await db.user.upsert({
      where: { id: userId },
      update: {},
      create: {
        id: userId,
        display_name: 'Test User',
        email: `${userId}@test.com`,
        tier: userId === 'premium_test_user' ? 'premium' : 'free',
        tokens: 10
      }
    });
  }

  try {
    // 1. Ingestion: Read file buffer to send to Gemini
    const fileBuffer = await fs.promises.readFile(filePath);
    const fileBufferBase64 = fileBuffer.toString('base64');

    // 2. Upload file to storage provider (S3/R2 or local fallback) immediately (fast path)
    console.log("Uploading file to storage provider...");
    const webImagePath = await uploadFile(filePath, mimeType);
    console.log(`File uploaded successfully. Web URL/Path: ${webImagePath}`);

    // Remote storage (S3/R2) removes the temp file inside uploadFile; keep local uploads on disk for /uploads static + regenerate.

    // 3. Spotify Match Setup
    console.log("Using client credentials token for Spotify catalog search.");
    const spotifyToken = await spotify.getClientCredentialsToken();

    // Retrieve past playlist IDs for repeat check (worker will resolve tracks)
    const pastPlaylistIds = [];
    if (userId) {
      try {
        const pastGenerations = await db.generation.findMany({
          where: { user_id: userId, NOT: { playlist_id: null } },
          take: 3,
          orderBy: { created_at: 'desc' },
          select: { playlist_id: true }
        });
        for (const gen of pastGenerations) {
          if (gen.playlist_id) {
            pastPlaylistIds.push(gen.playlist_id);
          }
        }
      } catch (dbErr) {
        console.warn("Failed to retrieve past generation IDs:", dbErr);
      }
    }

    // Token deduction removed — daily limit enforced in checkDailyLimit middleware

    let userTier = 'free';
    if (userId) {
      const user = await db.user.findUnique({ where: { id: userId }, select: { tier: true } });
      if (user) userTier = user.tier;
    }

    const jobData = {
      fileBufferBase64,
      mimeType,
      fileName: req.file.originalname,
      customPrompt: req.body.customPrompt || '',
      userId,
      spotifyToken,
      webImagePath,
      pastPlaylistIds,
      trackLimit: trackLimitForTier(userTier)
    };

    // ─── Test Mode: Run Synchronously ──────────────────────────────────────────
    if (process.env.NODE_ENV === 'test') {
      console.log("[TEST] Running playlist generation synchronously...");
      const result = await processPlaylistJob(jobData);
      return res.json(result);
    }

    // ─── Production Mode: Queue Asynchronously ─────────────────────────────────
    console.log("Enqueuing playlist generation job...");
    const job = await playlistQueue.add('playlist-generation', jobData);
    
    return res.status(202).json({
      success: true,
      jobId: job.id,
      message: 'Playlist generation started.'
    });

  } catch (error) {
    console.error("Error in process-image route:", error);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Route: GET /api/playlist/job/:jobId/stream
 * Server-Sent Events (SSE) endpoint to stream playlist generation progress.
 */
router.get('/job/:jobId/stream', async (req, res) => {
  const { jobId } = req.params;
  const jobIdKey = String(jobId);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx/proxy buffering
  res.flushHeaders();

  let isClosed = false;
  let heartbeatTimer = null;
  let pollTimer = null;

  const cleanup = () => {
    if (isClosed) return;
    isClosed = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    queueEvents.off('progress', onProgress);
    queueEvents.off('completed', onCompleted);
    queueEvents.off('failed', onFailed);
    queueEvents.off('delayed', onDelayed);
    queueEvents.close().catch(() => {});
    res.end();
  };

  req.on('close', cleanup);

  const queueEvents = new QueueEvents('playlist-generation', { connection });

  queueEvents.on('error', (err) => {
    console.error(`[SSE Stream] QueueEvents Error for job ${jobIdKey}:`, err);
  });

  const matchesJob = (id) => String(id) === jobIdKey;

  const onProgress = ({ jobId: id, data }) => {
    if (matchesJob(id) && !isClosed) {
      res.write(`event: progress\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  const onCompleted = ({ jobId: id, returnvalue }) => {
    if (!matchesJob(id) || isClosed) return;
    const payload = typeof returnvalue === 'string' ? returnvalue : JSON.stringify(returnvalue ?? {});
    res.write(`event: completed\ndata: ${payload}\n\n`);
    cleanup();
  };

  const onFailed = async ({ jobId: id, failedReason }) => {
    if (!matchesJob(id) || isClosed) return;

    try {
      const job = await playlistQueue.getJob(jobIdKey);
      if (job) {
        const maxAttempts = job.opts?.attempts || 4;
        const attemptsMade = job.attemptsMade || 0;
        if (attemptsMade < maxAttempts) {
          res.write(`event: retrying\ndata: ${JSON.stringify({
            message: `AI is busy — automatic retry ${attemptsMade}/${maxAttempts}. Hang tight…`,
            reason: failedReason
          })}\n\n`);
          return;
        }
      }
    } catch (err) {
      console.warn(`[SSE Stream] Could not inspect job state for ${jobIdKey}:`, err.message);
    }

    res.write(`event: failed\ndata: ${JSON.stringify({ message: failedReason })}\n\n`);
    cleanup();
  };

  const onDelayed = ({ jobId: id }) => {
    if (matchesJob(id) && !isClosed) {
      res.write(`event: retrying\ndata: ${JSON.stringify({ message: 'Waiting to retry — the AI is catching up…' })}\n\n`);
    }
  };

  // Keep proxies from closing idle SSE sockets during long Spotify resolve / Gemini backoff
  heartbeatTimer = setInterval(() => {
    if (isClosed) return;
    res.write(`: heartbeat ${Date.now()}\n\n`);
  }, 15000);

  try {
    const job = await playlistQueue.getJob(jobIdKey);
    if (!job) {
      res.write(`event: failed\ndata: ${JSON.stringify({ message: 'Job not found' })}\n\n`);
      cleanup();
      return;
    }

    const state = await job.getState();
    if (state === 'completed') {
      const payload = typeof job.returnvalue === 'string'
        ? job.returnvalue
        : JSON.stringify(job.returnvalue ?? {});
      res.write(`event: completed\ndata: ${payload}\n\n`);
      cleanup();
      return;
    }
    if (state === 'failed') {
      res.write(`event: failed\ndata: ${JSON.stringify({ message: job.failedReason || 'Job failed' })}\n\n`);
      cleanup();
      return;
    }

    queueEvents.on('progress', onProgress);
    queueEvents.on('completed', onCompleted);
    queueEvents.on('failed', onFailed);
    queueEvents.on('delayed', onDelayed);

    // Periodic status poll so a missed Redis event still finishes the UI
    pollTimer = setInterval(async () => {
      if (isClosed) return;
      try {
        const latest = await playlistQueue.getJob(jobIdKey);
        if (!latest) return;
        const latestState = await latest.getState();
        if (latestState === 'completed') {
          onCompleted({ jobId: jobIdKey, returnvalue: latest.returnvalue });
        } else if (latestState === 'failed') {
          const maxAttempts = latest.opts?.attempts || 4;
          if ((latest.attemptsMade || 0) >= maxAttempts) {
            res.write(`event: failed\ndata: ${JSON.stringify({ message: latest.failedReason || 'Job failed' })}\n\n`);
            cleanup();
          }
        } else if (latestState === 'active') {
          res.write(`event: progress\ndata: ${JSON.stringify({
            stage: 'working',
            message: 'Still curating your playlist…'
          })}\n\n`);
        }
      } catch (pollErr) {
        console.warn(`[SSE Stream] Poll error for ${jobIdKey}:`, pollErr.message);
      }
    }, 10000);
  } catch (err) {
    console.error(`[SSE Stream] Error fetching job state for ${jobIdKey}:`, err);
    res.write(`event: failed\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
    cleanup();
  }
});

/**
 * Route: GET /api/playlist/job/:jobId
 * JSON status/result fallback when SSE drops (proxy idle timeout).
 */
router.get('/job/:jobId', async (req, res) => {
  const jobIdKey = String(req.params.jobId);
  try {
    if (!playlistQueue) {
      return res.status(503).json({
        success: false,
        state: 'unavailable',
        message: 'Queue unavailable in this environment'
      });
    }
    const job = await playlistQueue.getJob(jobIdKey);
    if (!job) {
      return res.status(404).json({ success: false, state: 'not_found', message: 'Job not found' });
    }

    const state = await job.getState();
    if (state === 'completed') {
      const result = typeof job.returnvalue === 'string'
        ? JSON.parse(job.returnvalue)
        : job.returnvalue;
      return res.json({ success: true, state, result });
    }

    return res.json({
      success: true,
      state,
      message: job.failedReason || null,
      attemptsMade: job.attemptsMade || 0,
      attempts: job.opts?.attempts || 4
    });
  } catch (err) {
    console.error(`[Job Status] Error for ${jobIdKey}:`, err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Route: POST /api/playlist/save
 * Creates a PUBLIC playlist on the Master Spotify Account and returns the Spotify link.
 * Users can then open the link and save it to their own library.
 * Auth is optional — but if signed in, the generation is linked to their history.
 */
router.post('/save', async (req, res) => {
  const { playlistName, playlistDescription, trackUris, generationId, coverImageBase64 } = req.body;

  if (!playlistName || !trackUris || !Array.isArray(trackUris) || trackUris.length === 0) {
    return res.status(400).json({ success: false, message: "Missing playlist name or track URIs." });
  }

  try {
    // Create playlist on the Master Spotify Account
    const desc = playlistDescription || "AI-generated playlist curated by MomentAI ✨";
    const { playlistId, playlistUrl } = await spotify.createMasterPlaylist(
      playlistName,
      desc,
      trackUris,
      coverImageBase64 || null
    );

    // If user is authenticated, link the playlist to their generation history
    const userId = await getAuthUserId(req);
    if (userId && generationId) {
      await db.generation.updateMany({
        where: {
          id: generationId,
          user_id: userId
        },
        data: {
          playlist_id: playlistId,
          playlist_name: playlistName,
          playlist_url: playlistUrl
        }
      });
    }

    res.json({
      success: true,
      playlistId: playlistId,
      playlistUrl: playlistUrl
    });

  } catch (error) {
    console.error("Error in save-playlist route:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Route: POST /api/playlist/suggest-more
 * Returns additional Spotify track suggestions based on existing analysis metadata.
 */
router.post('/suggest-more', async (req, res) => {
  const { metadata, excludeTrackIds = [], customPrompt = '' } = req.body;

  if (!metadata?.seedGenres) {
    return res.status(400).json({ success: false, message: 'Missing playlist metadata.' });
  }

  try {
    const spotifyToken = await spotify.getClientCredentialsToken();
    const excludeTracks = excludeTrackIds.map((id) => ({ id }));
    const tracks = await fetchSupplementaryTracks(
      spotifyToken,
      metadata,
      customPrompt,
      excludeTracks
    );

    res.json({ success: true, tracks });
  } catch (error) {
    console.error('Error fetching more suggestions:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Route: GET /api/playlist/history
 * Summary list of past moments + remaining free quota today.
 */
router.get('/history', async (req, res) => {
  const userId = await getAuthUserId(req);
  if (!userId) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { tier: true }
    });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const historyRows = await db.generation.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        image_path: true,
        playlist_name: true,
        playlist_url: true,
        emotional_vibe: true,
        environmental_context: true,
        created_at: true,
        tracks: true
      }
    });

    const history = historyRows.map((row) => ({
      id: row.id,
      image_path: row.image_path,
      playlist_name: row.playlist_name,
      playlist_url: row.playlist_url,
      emotional_vibe: row.emotional_vibe,
      environmental_context: row.environmental_context,
      created_at: row.created_at,
      track_count: Array.isArray(row.tracks) ? row.tracks.length : 0
    }));

    const remainingToday = await getRemainingToday(db, userId, user.tier);

    res.json({ success: true, remainingToday, history });
  } catch (error) {
    console.error('Failed to fetch history:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Route: GET /api/playlist/generation/:id
 * Full generation payload for reopening a saved moment in the UI.
 */
router.get('/generation/:id', async (req, res) => {
  const userId = await getAuthUserId(req);
  if (!userId) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const row = await db.generation.findFirst({
      where: { id: req.params.id, user_id: userId }
    });

    if (!row) {
      return res.status(404).json({ success: false, message: 'Moment not found.' });
    }

    res.json({ success: true, ...generationToProcessResult(row) });
  } catch (error) {
    console.error('Failed to fetch generation:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Route: POST /api/playlist/regenerate
 * Premium-only: re-run generation from a stored moment photo.
 */
router.post('/regenerate', async (req, res) => {
  const userId = await getAuthUserId(req);
  if (!userId) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const { generationId } = req.body || {};
  if (!generationId) {
    return res.status(400).json({ success: false, message: 'Missing generationId.' });
  }

  try {
    if (process.env.NODE_ENV === 'test') {
      await db.user.upsert({
        where: { id: userId },
        update: {},
        create: {
          id: userId,
          display_name: 'Test User',
          email: `${userId}@test.com`,
          tier: userId === 'premium_test_user' ? 'premium' : 'free',
          tokens: 10
        }
      });
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { tier: true }
    });

    if (!user || user.tier !== 'premium') {
      return res.status(403).json({
        success: false,
        code: 'PLUS_REQUIRED',
        message: 'Regenerate is a Plus feature. Upgrade to regenerate playlists.'
      });
    }

    const generation = await db.generation.findFirst({
      where: { id: generationId, user_id: userId }
    });

    if (!generation) {
      return res.status(404).json({ success: false, message: 'Moment not found.' });
    }

    const { buffer, mimeType } = await loadImageBytes(generation.image_path);
    const spotifyToken = await spotify.getClientCredentialsToken();

    const pastPlaylistIds = [];
    if (generation.playlist_id) {
      pastPlaylistIds.push(generation.playlist_id);
    }

    const jobData = {
      fileBufferBase64: buffer.toString('base64'),
      mimeType,
      fileName: path.basename(generation.image_path),
      customPrompt: '',
      userId,
      spotifyToken,
      webImagePath: generation.image_path,
      pastPlaylistIds,
      trackLimit: trackLimitForTier('premium')
    };

    console.log(`Regenerating playlist for generation ${generationId}...`);
    return enqueueOrRunJob(jobData, res);
  } catch (error) {
    console.error('Error in regenerate route:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Route: POST /api/playlist/import
 * Fetches details and tracks of any existing Spotify playlist by URL/URI.
 */
router.post('/import', async (req, res) => {
  const { playlistUrl } = req.body;
  if (!playlistUrl) {
    return res.status(400).json({ success: false, message: "Missing playlist URL." });
  }

  const match = playlistUrl.match(/playlist\/([a-zA-Z0-9]+)/) || playlistUrl.match(/spotify:playlist:([a-zA-Z0-9]+)/);
  const playlistId = match ? match[1] : null;

  if (!playlistId) {
    return res.status(400).json({ success: false, message: "Invalid Spotify playlist URL format." });
  }

  try {
    const token = await spotify.getClientCredentialsToken();

    console.log(`Importing playlist details & tracks for: ${playlistId}`);
    const details = await spotify.getPlaylistDetails(token, playlistId);
    const tracks = await spotify.getPlaylistTracks(token, playlistId);

    // Format custom metadata to match visual curator requirements
    const metadata = {
      dominantColorPalette: ["imported", "spotify green"],
      environmentalContext: details.description || "Imported Spotify Playlist",
      emotionalVibe: details.name || "My Imported Playlist",
      seedGenres: ["imported"],
      valence: 0.5,
      energy: 0.5,
      acousticness: 0.5
    };

    res.json({
      success: true,
      metadata: metadata,
      tracks: tracks,
      suggestedTracks: [],
      coverUrl: details.images && details.images.length > 0 ? details.images[0].url : null
    });
  } catch (error) {
    console.error("Error in playlist import route:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
