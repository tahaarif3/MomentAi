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
 * Middleware to check and enforce token limits.
 * Allows anonymous generation, but blocks logged-in free users without tokens.
 */
async function checkTokenLimit(req, res, next) {
  try {
    const userId = await getAuthUserId(req);
    
    // If not logged in, allow processing (anonymous users get blurred tracks in frontend)
    if (!userId) {
      return next();
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { tier: true, tokens: true }
    });

    if (!user) {
      return next();
    }

    if (user.tier === 'free' && user.tokens <= 0) {
      return res.status(403).json({ 
        success: false, 
        message: "You have run out of generation tokens. Please upgrade to Premium or purchase a token pack." 
      });
    }

    next();
  } catch (error) {
    console.error("Error in checkTokenLimit middleware:", error);
    next(error);
  }
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
router.post('/process', upload.single('image'), checkTokenLimit, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: "Please upload an image file." });
  }

  const filePath = req.file.path;
  const mimeType = req.file.mimetype;
  const userId = await getAuthUserId(req);

  try {
    // 1. Ingestion: Read file buffer to send to Gemini
    const fileBuffer = await fs.promises.readFile(filePath);
    const fileBufferBase64 = fileBuffer.toString('base64');

    // 2. Upload file to storage provider (S3/R2 or local fallback) immediately (fast path)
    console.log("Uploading file to storage provider...");
    const webImagePath = await uploadFile(filePath, mimeType);
    console.log(`File uploaded successfully. Web URL/Path: ${webImagePath}`);

    // Cleanup local temp file
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

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

    // 4. Token deduction (only if logged in) - Done early to prevent double-spending
    if (userId) {
      const user = await db.user.findUnique({ where: { id: userId } });
      if (user && user.tier === 'free') {
        await db.user.update({
          where: { id: userId },
          data: { tokens: { decrement: 1 } }
        });
      }
    }

    const jobData = {
      fileBufferBase64,
      mimeType,
      fileName: req.file.originalname,
      customPrompt: req.body.customPrompt || '',
      userId,
      spotifyToken,
      webImagePath,
      pastPlaylistIds
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

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // If client disconnected early
  let isClosed = false;

  const cleanup = () => {
    if (isClosed) return;
    isClosed = true;
    queueEvents.off('progress', onProgress);
    queueEvents.off('completed', onCompleted);
    queueEvents.off('failed', onFailed);
    queueEvents.off('delayed', onDelayed);
    queueEvents.close().catch(() => {});
    res.end();
  };

  req.on('close', cleanup);

  // Initialize QueueEvents listener
  const queueEvents = new QueueEvents('playlist-generation', { connection });

  queueEvents.on('error', (err) => {
    console.error(`[SSE Stream] QueueEvents Error for job ${jobId}:`, err);
  });

  const onProgress = ({ jobId: id, data }) => {
    if (id === jobId && !isClosed) {
      res.write(`event: progress\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  const onCompleted = ({ jobId: id, returnvalue }) => {
    if (id === jobId && !isClosed) {
      res.write(`event: completed\ndata: ${returnvalue}\n\n`);
      cleanup();
    }
  };

  const onFailed = ({ jobId: id, failedReason }) => {
    if (id === jobId && !isClosed) {
      res.write(`event: failed\ndata: ${JSON.stringify({ message: failedReason })}\n\n`);
      cleanup();
    }
  };

  const onDelayed = ({ jobId: id }) => {
    if (id === jobId && !isClosed) {
      res.write(`event: retrying\ndata: ${JSON.stringify({ message: 'Spotify is busy, retrying...' })}\n\n`);
    }
  };

  // Check current job status to prevent race conditions (in case job is already finished/failed)
  try {
    const job = await playlistQueue.getJob(jobId);
    if (!job) {
      res.write(`event: failed\ndata: ${JSON.stringify({ message: 'Job not found' })}\n\n`);
      res.end();
      return;
    }

    const state = await job.getState();
    if (state === 'completed') {
      res.write(`event: completed\ndata: ${JSON.stringify(job.returnvalue)}\n\n`);
      res.end();
      return;
    } else if (state === 'failed') {
      res.write(`event: failed\ndata: ${JSON.stringify({ message: job.failedReason || 'Job failed' })}\n\n`);
      res.end();
      return;
    }

    // Otherwise, subscribe to live events
    queueEvents.on('progress', onProgress);
    queueEvents.on('completed', onCompleted);
    queueEvents.on('failed', onFailed);
    queueEvents.on('delayed', onDelayed);
  } catch (err) {
    console.error(`[SSE Stream] Error fetching job state for ${jobId}:`, err);
    res.write(`event: failed\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
    res.end();
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
 * Fetch past generated playlists for the logged in user
 */
router.get('/history', async (req, res) => {
  const userId = await getAuthUserId(req);
  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  try {
    const history = await db.generation.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' }
    });

    // Parse JSON strings back to arrays
    const formattedHistory = history.map(item => ({
      ...item,
      dominant_colors: JSON.parse(item.dominant_colors),
      seed_genres: JSON.parse(item.seed_genres)
    }));

    res.json({ success: true, history: formattedHistory });
  } catch (error) {
    console.error("Failed to fetch history:", error);
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
