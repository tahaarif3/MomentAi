import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import db from '../config/db.js';
import { parsePlaylistImage } from '../services/geminiService.js';
import * as spotify from '../clients/spotifyClient.js';
import { getValidUserToken } from './auth.js';
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
 * Allows anonymous generation in development, but blocks logged-in free users without tokens.
 */
async function checkTokenLimit(req, res, next) {
  try {
    const spotifyUserId = req.signedCookies['spotify_user_id'] || req.cookies['spotify_user_id'];
    
    // If not logged in, we allow processing using backend client credentials for development preview
    if (!spotifyUserId) {
      return next();
    }

    const user = await db.user.findUnique({
      where: { spotify_id: spotifyUserId },
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

/**
 * Route: POST /api/playlist/process
 * Accepts an image file, parses it via Gemini, fetches Spotify recommendations.
 */
router.post('/process', upload.single('image'), checkTokenLimit, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: "Please upload an image file." });
  }

  const filePath = req.file.path;
  const mimeType = req.file.mimetype;
  const spotifyUserId = req.signedCookies['spotify_user_id'] || req.cookies['spotify_user_id'];

  try {
    // 1. Ingestion: Read file buffer to send to Gemini
    const fileBuffer = await fs.promises.readFile(filePath);

    const customPrompt = req.body.customPrompt || '';

    // 2. LLM Parsing: Extract visual/emotional cues and Spotify metrics
    console.log("Analyzing image with Gemini Flash...");
    const metadata = await parsePlaylistImage(fileBuffer, mimeType, customPrompt, req.file.originalname);
    console.log("Gemini parsed metadata:", JSON.stringify(metadata, null, 2));

    // 3. Upload file to storage provider (S3/R2 or local fallback)
    console.log("Uploading file to storage provider...");
    const webImagePath = await uploadFile(filePath, mimeType);
    console.log(`File uploaded successfully. Web URL/Path: ${webImagePath}`);

    // 4. Spotify Match: Resolve recommendations
    let spotifyToken;
    if (spotifyUserId) {
      spotifyToken = await getValidUserToken(spotifyUserId);
    } else {
      // Anonymous dev preview uses Client Credentials
      console.log("User not logged in, using client credentials token for recommendation preview.");
      spotifyToken = await spotify.getClientCredentialsToken();
    }

    // Pool A: Image-based track pool (Artist tracks or visual recommendations)
    let poolA = [];
    if (metadata.detectedArtist && metadata.detectedArtist.trim()) {
      console.log(`Detected artist: "${metadata.detectedArtist.trim()}" - fetching their top tracks...`);
      poolA = await spotify.getArtistTopTracks(spotifyToken, metadata.detectedArtist.trim());
      // Limit to 10 if customPrompt is present to make it 50/50
      if (customPrompt && customPrompt.trim()) {
        poolA = poolA.slice(0, 10);
      }
    } else {
      console.log("No specific artist detected - fetching visual recommendations...");
      poolA = await spotify.getRecommendations(
        spotifyToken,
        metadata.seedGenres,
        metadata.valence,
        metadata.energy,
        metadata.acousticness,
        customPrompt,
        metadata.emotionalVibe
      );
      // Limit to 10 if customPrompt is present to make it 50/50
      if (customPrompt && customPrompt.trim()) {
        poolA = poolA.slice(0, 10);
      }
    }

    // Pool B: Prompt-based track pool
    let poolB = [];
    if (customPrompt && customPrompt.trim()) {
      console.log(`Custom prompt provided: "${customPrompt.trim()}" - fetching matching search tracks...`);
      poolB = await spotify.searchTracks(spotifyToken, customPrompt.trim(), 10);
    }

    // Interleave Pool A and Pool B 50/50 if customPrompt is present to ensure equal weightage
    let finalTracks = [];
    if (customPrompt && customPrompt.trim() && poolB.length > 0) {
      console.log(`Interleaving ${poolA.length} image tracks and ${poolB.length} prompt tracks...`);
      const maxLength = Math.max(poolA.length, poolB.length);
      for (let i = 0; i < maxLength; i++) {
        if (i < poolA.length) {
          finalTracks.push(poolA[i]);
        }
        if (i < poolB.length) {
          finalTracks.push(poolB[i]);
        }
      }
      finalTracks = finalTracks.slice(0, 20);
    } else {
      finalTracks = poolA;
    }

    // Deduplicate final track list to guarantee 100% uniqueness
    const seenTracks = new Set();
    finalTracks = finalTracks.filter(track => {
      if (!track || !track.id) return false;
      if (seenTracks.has(track.id)) {
        return false;
      }
      seenTracks.add(track.id);
      return true;
    });

    let generationId = crypto.randomUUID();

    // 5. Token deduction and history logging (only if user is logged in)
    if (spotifyUserId) {
      // Deduct 1 token if user is on Free tier
      const user = await db.user.findUnique({ where: { spotify_id: spotifyUserId } });
      if (user && user.tier === 'free') {
        await db.user.update({
          where: { spotify_id: spotifyUserId },
          data: { tokens: { decrement: 1 } }
        });
      }

      // Save generation logs
      await db.generation.create({
        data: {
          id: generationId,
          user_id: spotifyUserId,
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

    res.json({
      success: true,
      generationId: spotifyUserId ? generationId : null,
      imagePath: webImagePath,
      metadata: metadata,
      tracks: finalTracks
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
 * Creates a playlist on the user's Spotify account and adds recommended tracks.
 */
router.post('/save', async (req, res) => {
  const spotifyUserId = req.signedCookies['spotify_user_id'] || req.cookies['spotify_user_id'];
  const { playlistName, playlistDescription, isPublic, trackUris, generationId, coverImageBase64 } = req.body;

  if (!spotifyUserId) {
    return res.status(401).json({ success: false, message: "Please connect your Spotify account first." });
  }

  if (!playlistName || !trackUris || !Array.isArray(trackUris) || trackUris.length === 0) {
    return res.status(400).json({ success: false, message: "Missing playlist name or track URIs." });
  }

  try {
    let playlistId = "mock_playlist_123";
    let playlistUrl = "https://open.spotify.com/playlist/mock_playlist_123";

    if (process.env.NODE_ENV === 'test') {
      console.log("[TEST] Mocking Spotify playlist creation, track adding, and cover upload...");
    } else {
      const token = await getValidUserToken(spotifyUserId);
      
      // Create playlist on user's account
      console.log(`Creating playlist: "${playlistName}" for user: ${spotifyUserId}`);
      const desc = playlistDescription || "AI-generated playlist curated by Playlist_pic.";
      const createdPlaylist = await spotify.createPlaylist(spotifyUserId, token, playlistName, desc, isPublic !== false);
      playlistId = createdPlaylist.id;
      playlistUrl = createdPlaylist.external_urls.spotify;
      
      // Add tracks to playlist
      console.log(`Adding ${trackUris.length} tracks to playlist: ${playlistId}`);
      await spotify.addTracksToPlaylist(token, playlistId, trackUris);

      // Upload custom cover art if provided
      if (coverImageBase64) {
        console.log(`Uploading custom cover art to playlist: ${playlistId}`);
        try {
          await spotify.uploadPlaylistCover(token, playlistId, coverImageBase64);
        } catch (coverErr) {
          console.error("Failed to upload custom cover art to Spotify:", coverErr);
          // We log it but do not throw, so the user still gets their playlist saved
        }
      }
    }

    // Update generation database log with saved playlist metadata
    if (generationId) {
      await db.generation.updateMany({
        where: {
          id: generationId,
          user_id: spotifyUserId
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
 * Route: GET /api/playlist/history
 * Fetch past generated playlists for the logged in user
 */
router.get('/history', async (req, res) => {
  const spotifyUserId = req.signedCookies['spotify_user_id'] || req.cookies['spotify_user_id'];
  if (!spotifyUserId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  try {
    const history = await db.generation.findMany({
      where: { user_id: spotifyUserId },
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

  const spotifyUserId = req.signedCookies['spotify_user_id'] || req.cookies['spotify_user_id'];

  try {
    let token;
    if (spotifyUserId) {
      token = await getValidUserToken(spotifyUserId);
    } else {
      token = await spotify.getClientCredentialsToken();
    }

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
      coverUrl: details.images && details.images.length > 0 ? details.images[0].url : null
    });
  } catch (error) {
    console.error("Error in playlist import route:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
