import express from 'express';
import db from '../config/db.js';

const router = express.Router();

// Middleware to check if user is logged in
function requireAuth(req, res, next) {
  const spotifyUserId = req.signedCookies['spotify_user_id'] || req.cookies['spotify_user_id'];
  if (!spotifyUserId) {
    return res.status(401).json({ success: false, message: "Please connect Spotify to perform this action." });
  }
  req.spotifyUserId = spotifyUserId;
  next();
}

/**
 * Route: POST /api/payment/purchase-tokens
 * Mocks the $1.99 token pack purchase (credits 20 tokens)
 */
router.post('/purchase-tokens', requireAuth, async (req, res) => {
  try {
    let user;
    try {
      // Increment the user's token balance by 20
      user = await db.user.update({
        where: { spotify_id: req.spotifyUserId },
        data: { tokens: { increment: 20 } }
      });
    } catch (err) {
      // Handle Prisma Record Not Found (Code P2025)
      if (err.code === 'P2025') {
        return res.status(404).json({ success: false, message: "User not found." });
      }
      throw err;
    }

    res.json({
      success: true,
      message: "Payment successful! 20 tokens have been credited to your account.",
      tokens: user.tokens,
      tier: user.tier
    });
  } catch (error) {
    console.error("Token purchase error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Route: POST /api/payment/subscribe
 * Mocks the $3.99/mo Premium subscription (upgrades tier to 'premium')
 */
router.post('/subscribe', requireAuth, async (req, res) => {
  try {
    let user;
    try {
      // Upgrade tier to premium
      user = await db.user.update({
        where: { spotify_id: req.spotifyUserId },
        data: { tier: 'premium' }
      });
    } catch (err) {
      if (err.code === 'P2025') {
        return res.status(404).json({ success: false, message: "User not found." });
      }
      throw err;
    }

    res.json({
      success: true,
      message: "Welcome to Premium! You now have unlimited playlist generations and advanced mood control.",
      tokens: user.tokens,
      tier: user.tier
    });
  } catch (error) {
    console.error("Subscription error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Route: POST /api/payment/cancel-subscription
 * Mocks cancelling the Premium subscription (downgrades tier to 'free')
 */
router.post('/cancel-subscription', requireAuth, async (req, res) => {
  try {
    let user;
    try {
      // Downgrade tier to free
      user = await db.user.update({
        where: { spotify_id: req.spotifyUserId },
        data: { tier: 'free' }
      });
    } catch (err) {
      if (err.code === 'P2025') {
        return res.status(404).json({ success: false, message: "User not found." });
      }
      throw err;
    }

    res.json({
      success: true,
      message: "Your subscription has been cancelled. You have returned to the Free tier.",
      tokens: user.tokens,
      tier: user.tier
    });
  } catch (error) {
    console.error("Subscription cancellation error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
