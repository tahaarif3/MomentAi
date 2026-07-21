import express from 'express';
import * as appleMusic from '../clients/appleMusicClient.js';

const router = express.Router();

/**
 * GET /api/apple/dev-token
 * Returns a short-lived MusicKit developer JWT (ES256).
 * Private key never leaves the server.
 */
router.get('/dev-token', async (req, res) => {
  try {
    if (!appleMusic.isAppleMusicConfigured() && process.env.NODE_ENV !== 'test') {
      return res.status(503).json({
        success: false,
        message: 'Apple Music is not configured on this server.'
      });
    }

    const token = await appleMusic.getDeveloperToken();
    if (!token) {
      return res.status(503).json({
        success: false,
        message: 'Unable to mint Apple Music developer token.'
      });
    }

    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.json({
      success: true,
      token,
      expiresIn: 12 * 60 * 60
    });
  } catch (err) {
    console.error('[apple/dev-token]', err);
    res.status(500).json({ success: false, message: 'Failed to mint developer token.' });
  }
});

export default router;
