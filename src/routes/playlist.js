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

    // 2. Spotify Match Setup: Always use Client Credentials for catalog searches
    console.log("Using client credentials token for Spotify catalog search.");
    const spotifyToken = await spotify.getClientCredentialsToken();

    // Retrieve historical tracks to prevent repeat recommendations (only for logged-in users)
    const excludedSongs = [];
    if (userId) {
      try {
        const pastGenerations = await db.generation.findMany({
          where: { user_id: userId, NOT: { playlist_id: null } },
          take: 3,
          orderBy: { created_at: 'desc' }
        });
        
        console.log(`Checking ${pastGenerations.length} past playlists for repeat recommendations...`);
        const results = [];
        for (const gen of pastGenerations) {
          try {
            const tracks = await spotify.getPlaylistTracks(spotifyToken, gen.playlist_id);
            if (tracks) {
              results.push(tracks);
            }
          } catch (err) {
            console.warn(`Failed to fetch tracks for past playlist ${gen.playlist_id}:`, err);
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        for (const tracks of results) {
          for (const track of tracks) {
            if (track && track.name) {
              excludedSongs.push(`${track.name} by ${track.artists?.[0]?.name || ''}`);
            }
          }
        }
      } catch (dbErr) {
        console.warn("Failed to retrieve historical tracks for repeat check:", dbErr);
      }
    }

    const customPrompt = req.body.customPrompt || '';

    // 3. LLM Parsing: Extract visual/emotional cues and Spotify metrics
    console.log("Analyzing image with Gemini Flash...");
    const metadata = await parsePlaylistImage(fileBuffer, mimeType, customPrompt, req.file.originalname, excludedSongs.slice(0, 50));
    console.log("Gemini parsed metadata:", JSON.stringify(metadata, null, 2));

    // 4. Upload file to storage provider (S3/R2 or local fallback)
    console.log("Uploading file to storage provider...");
    const webImagePath = await uploadFile(filePath, mimeType);
    console.log(`File uploaded successfully. Web URL/Path: ${webImagePath}`);

    const recommendedSongs = metadata.recommendedSongs || [];
    console.log(`AI recommended ${recommendedSongs.length} tracks - resolving on Spotify...`);

    // Fetch details for each recommended track sequentially with a 150ms sleep step to protect rate limits
    const searchResults = [];
    for (const song of recommendedSongs) {
      try {
        const track = await spotify.searchTrackByDetails(spotifyToken, song.title, song.artist);
        if (track) {
          searchResults.push(track);
        }
      } catch (err) {
        console.warn(`Failed to resolve track "${song.title}" by "${song.artist}" on Spotify:`, err);
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    let finalTracks = searchResults;

    // Deduplicate final track list to guarantee 100% uniqueness by normalized title and artist
    // and filter out repeat recommendations from past playlists
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

    let generationId = crypto.randomUUID();

    // 5. Token deduction and history logging (only if user is logged in)
    if (userId) {
      // Deduct 1 token if user is on Free tier
      const user = await db.user.findUnique({ where: { id: userId } });
      if (user && user.tier === 'free') {
        await db.user.update({
          where: { id: userId },
          data: { tokens: { decrement: 1 } }
        });
      }

      // Save generation logs
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

    // Determine if user is authenticated to decide what track data to expose
    const isAuthenticated = !!userId;

    res.json({
      success: true,
      generationId: userId ? generationId : null,
      imagePath: webImagePath,
      metadata: metadata,
      isAuthenticated: isAuthenticated,
      tracks: finalTracks,
      suggestedTracks: await fetchSupplementaryTracks(
        spotifyToken,
        metadata,
        customPrompt,
        finalTracks
      )
    });

  } catch (error) {
    console.error("Error in process-image route:", error);
    // Cleanup the uploaded file in case of failure and if it hasn't been uploaded & deleted yet
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    res.status(500).json({ success: false, message: error.message });
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
