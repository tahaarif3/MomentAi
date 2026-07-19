import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import db from '../config/db.js';
import * as spotify from '../clients/spotifyClient.js';
import { getAuthUserId } from '../utils/session.js';
import { uploadFile, deleteStoredObject } from '../services/storageService.js';
import { playlistQueue, playlistQueueEvents } from '../config/queue.js';
import { processPlaylistJob } from '../workers/playlistWorker.js';
import {
  DEFAULT_DAILY_LIMIT,
  FREE_DAILY_LIMIT,
  getRemainingToday,
  effectiveDailyLimit,
  trackLimitForTier,
  startOfUtcDay
} from '../utils/moments.js';
import { createThumbnailDataUrl } from '../utils/thumbnail.js';
import { trackExclusions } from '../utils/moments.js';
import {
  issueProgressToken,
  verifyProgressToken,
  extractProgressToken
} from '../utils/progressToken.js';
import { createUserRateLimiter } from '../utils/userRateLimit.js';
import { isAllowedImageMime, normalizeUploadImage } from '../utils/imageConvert.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), '../..');

export { FREE_DAILY_LIMIT, DEFAULT_DAILY_LIMIT, getRemainingToday };

const router = express.Router();

const userApiLimiter = createUserRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  getUserId: (req) => getAuthUserId(req)
});

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

// JPEG/PNG/WebP + HEIC/HEIF (converted server-side before Gemini/storage)
const fileFilter = (req, file, cb) => {
  if (isAllowedImageMime(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, WebP, and HEIC/HEIF are allowed.'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit — clients should target 2–4MB JPEG
});

/**
 * Authorize job stream/status: owner JWT or valid progressToken for this jobId.
 */
async function assertJobAccess(req, job) {
  const jobIdKey = String(job.id);
  const ownerId = job.data?.userId || null;
  const userId = await getAuthUserId(req);
  const token = extractProgressToken(req);
  const tokenPayload = token ? verifyProgressToken(token, jobIdKey) : null;

  if (userId && ownerId && userId === ownerId) {
    return { ok: true };
  }
  if (tokenPayload) {
    if (ownerId && tokenPayload.userId && tokenPayload.userId !== ownerId) {
      return { ok: false, status: 403, message: 'Forbidden' };
    }
    return { ok: true };
  }
  return { ok: false, status: 403, message: 'Forbidden — missing or invalid progress credentials.' };
}

/**
 * Middleware: enforce per-user daily_upload_limit (UTC). Anonymous users pass through.
 * Premium users are unlimited. Raise a free user's cap via users.daily_upload_limit.
 */
async function checkDailyLimit(req, res, next) {
  try {
    const userId = await getAuthUserId(req);
    if (!userId) return next();

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { tier: true, daily_upload_limit: true }
    });
    if (!user) return next();

    const limit = effectiveDailyLimit(user);
    if (limit == null) return next(); // premium / unlimited

    const todayCount = await db.generation.count({
      where: {
        user_id: userId,
        created_at: { gte: startOfUtcDay() }
      }
    });

    if (todayCount >= limit) {
      return res.status(403).json({
        success: false,
        code: 'DAILY_LIMIT',
        remainingToday: 0,
        dailyUploadLimit: limit,
        message: `You have used all ${limit} free moments for today. Upgrade to Plus for unlimited generations.`
      });
    }

    next();
  } catch (error) {
    console.error('Error in checkDailyLimit middleware:', error);
    next(error);
  }
}

async function loadRecentTrackExclusions(userId, take = 3) {
  if (!userId) return [];
  const generations = await db.generation.findMany({
    where: { user_id: userId },
    take,
    orderBy: { created_at: 'desc' },
    select: { tracks: true }
  });
  return trackExclusions(generations.flatMap((generation) => generation.tracks || []));
}

function generationToProcessResult(row) {
  const tracks = Array.isArray(row.tracks) ? row.tracks : [];
  const suggestedTracks = Array.isArray(row.suggested_tracks) ? row.suggested_tracks : [];
  // Prefer durable thumb for UI display when full image_path may 404
  const displayImage = row.image_thumb || row.image_path;
  return {
    success: true,
    generationId: row.id,
    imagePath: displayImage,
    imageThumb: row.image_thumb || null,
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
  const progressToken = issueProgressToken(job.id, jobData.userId || null);
  return res.status(202).json({
    success: true,
    jobId: job.id,
    progressToken,
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
 * Returns jobId + progressToken for SSE/poll authorization.
 */
router.post('/process', userApiLimiter, upload.single('image'), checkDailyLimit, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: "Please upload an image file." });
  }

  let filePath = req.file.path;
  let mimeType = req.file.mimetype;
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
        daily_upload_limit: 3
      }
    });
  }

  try {
    // Convert HEIC/HEIF → JPEG and strip EXIF where needed
    const normalized = await normalizeUploadImage(filePath, mimeType);
    filePath = normalized.path;
    mimeType = normalized.mimeType;
    req.file.path = filePath;
    req.file.mimetype = mimeType;

    // Keep only a small thumbnail in-process. The full image is uploaded before
    // queueing and is never serialized into the Redis job payload.
    const fileBuffer = await fs.promises.readFile(filePath);
    const imageThumb = await createThumbnailDataUrl(fileBuffer, mimeType);

    // Upload to Spaces/S3 (durable) or local /uploads fallback
    console.log("Uploading file to storage provider...");
    const webImagePath = await uploadFile(filePath, mimeType);
    console.log(`File uploaded successfully. Web URL/Path: ${webImagePath}`);

    let excludedSongs = [];
    if (userId) {
      try {
        excludedSongs = await loadRecentTrackExclusions(userId);
      } catch (dbErr) {
        console.warn('Failed to retrieve previous track exclusions:', dbErr);
      }
    }

    let userTier = 'free';
    if (userId) {
      const user = await db.user.findUnique({ where: { id: userId }, select: { tier: true } });
      if (user) userTier = user.tier;
    }

    const jobData = {
      sourceImagePath: webImagePath,
      fileName: req.file.originalname,
      customPrompt: req.body.customPrompt || '',
      userId,
      webImagePath,
      imageThumb,
      excludedSongs,
      trackLimit: trackLimitForTier(userTier)
    };

    return enqueueOrRunJob(jobData, res);

  } catch (error) {
    console.error("Error in process-image route:", error);
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Route: GET /api/playlist/job/:jobId/stream
 * SSE progress — requires owner JWT or ?progressToken= / X-Progress-Token.
 */
router.get('/job/:jobId/stream', async (req, res) => {
  const { jobId } = req.params;
  const jobIdKey = String(jobId);

  const sendSseHeaders = () => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
  };

  let isClosed = false;
  let heartbeatTimer = null;

  const cleanup = () => {
    if (isClosed) return;
    isClosed = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    playlistQueueEvents?.off('progress', onProgress);
    playlistQueueEvents?.off('completed', onCompleted);
    playlistQueueEvents?.off('failed', onFailed);
    playlistQueueEvents?.off('delayed', onDelayed);
    if (!res.writableEnded) res.end();
  };

  req.on('close', cleanup);

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
        const maxAttempts = job.opts?.attempts || 3;
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

  try {
    if (!playlistQueue) {
      return res.status(503).json({
        success: false,
        message: 'Queue unavailable in this environment'
      });
    }

    const job = await playlistQueue.getJob(jobIdKey);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    const access = await assertJobAccess(req, job);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, message: access.message });
    }

    sendSseHeaders();

    heartbeatTimer = setInterval(() => {
      if (isClosed) return;
      res.write(`: heartbeat ${Date.now()}\n\n`);
    }, 15000);

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

    if (!playlistQueueEvents) {
      throw new Error('Queue events are unavailable in this environment.');
    }
    playlistQueueEvents.on('progress', onProgress);
    playlistQueueEvents.on('completed', onCompleted);
    playlistQueueEvents.on('failed', onFailed);
    playlistQueueEvents.on('delayed', onDelayed);

    const refreshedJob = await playlistQueue.getJob(jobIdKey);
    if (refreshedJob) {
      const refreshedState = await refreshedJob.getState();
      if (refreshedState === 'completed') {
        onCompleted({ jobId: jobIdKey, returnvalue: refreshedJob.returnvalue });
      } else if (refreshedState === 'failed') {
        onFailed({ jobId: jobIdKey, failedReason: refreshedJob.failedReason || 'Job failed' });
      }
    }

  } catch (err) {
    console.error(`[SSE Stream] Error fetching job state for ${jobIdKey}:`, err);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, message: err.message });
    }
    res.write(`event: failed\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
    cleanup();
  }
});

/**
 * Route: GET /api/playlist/job/:jobId
 * JSON status/result fallback — requires owner JWT or progressToken.
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

    const access = await assertJobAccess(req, job);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, message: access.message });
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
      attempts: job.opts?.attempts || 3
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
router.post('/suggest-more', userApiLimiter, async (req, res) => {
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
      select: { tier: true, daily_upload_limit: true }
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
        image_thumb: true,
        playlist_name: true,
        playlist_url: true,
        emotional_vibe: true,
        environmental_context: true,
        created_at: true,
        tracks: true
      }
    });

    // Best-effort backfill: if thumb missing but local /uploads file still exists
    for (const row of historyRows) {
      if (row.image_thumb) continue;
      if (!row.image_path?.startsWith('/uploads/')) continue;
      try {
        const localPath = path.resolve(projectRoot, row.image_path.slice(1));
        if (!fs.existsSync(localPath)) continue;
        const buf = await fs.promises.readFile(localPath);
        const thumb = await createThumbnailDataUrl(buf);
        if (!thumb) continue;
        await db.generation.update({
          where: { id: row.id },
          data: { image_thumb: thumb }
        });
        row.image_thumb = thumb;
      } catch (err) {
        console.warn(`[history] thumb backfill failed for ${row.id}:`, err.message);
      }
    }

    const history = historyRows.map((row) => ({
      id: row.id,
      image_path: row.image_path,
      // Prefer durable thumb for cards (full path may 404 after redeploy)
      image_thumb: row.image_thumb || null,
      display_image: row.image_thumb || row.image_path,
      playlist_name: row.playlist_name,
      playlist_url: row.playlist_url,
      emotional_vibe: row.emotional_vibe,
      environmental_context: row.environmental_context,
      created_at: row.created_at,
      track_count: Array.isArray(row.tracks) ? row.tracks.length : 0
    }));

    const remainingToday = await getRemainingToday(db, userId, user);
    const dailyUploadLimit = effectiveDailyLimit(user);

    res.json({
      success: true,
      remainingToday,
      dailyUploadLimit,
      history
    });
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
 * Route: DELETE /api/playlist/generation/:id
 * Remove a saved moment from the user's history.
 */
router.delete('/generation/:id', async (req, res) => {
  const userId = await getAuthUserId(req);
  if (!userId) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const row = await db.generation.findFirst({
      where: { id: req.params.id, user_id: userId },
      select: { id: true, image_path: true }
    });

    if (!row) {
      return res.status(404).json({ success: false, message: 'Moment not found.' });
    }

    await db.generation.delete({ where: { id: row.id } });

    // Best-effort cleanup of local /uploads or Spaces/S3 object
    await deleteStoredObject(row.image_path);

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { tier: true, daily_upload_limit: true }
    });
    const remainingToday = await getRemainingToday(db, userId, user);

    res.json({ success: true, remainingToday });
  } catch (error) {
    console.error('Failed to delete generation:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Route: POST /api/playlist/regenerate
 * Premium-only: re-run generation from a stored moment photo.
 */
router.post('/regenerate', userApiLimiter, async (req, res) => {
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
          daily_upload_limit: 3
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

    const excludedSongs = await loadRecentTrackExclusions(userId);

    const jobData = {
      sourceImagePath: generation.image_path,
      fileName: path.basename(generation.image_path),
      customPrompt: '',
      userId,
      webImagePath: generation.image_path,
      imageThumb: generation.image_thumb || null,
      excludedSongs,
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
