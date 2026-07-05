import express from 'express';
import crypto from 'crypto';
import db from '../config/db.js';
import * as spotify from '../clients/spotifyClient.js';
import { getSpotifyUserId } from '../utils/session.js';

const router = express.Router();

// Helper to get or refresh user token from the DB
export async function getValidUserToken(spotifyId) {
  const user = await db.user.findUnique({
    where: { spotify_id: spotifyId }
  });
  if (!user) return null;

  // Check if token is expired (giving a 60-second buffer)
  const isExpired = Date.now() > (Number(user.spotify_token_expires_at) - 60000);
  if (isExpired && user.spotify_refresh_token) {
    try {
      console.log(`Refreshing expired Spotify token for user: ${spotifyId}`);
      const refreshData = await spotify.refreshUserToken(user.spotify_refresh_token);
      
      const newAccessToken = refreshData.access_token;
      const expiresIn = refreshData.expires_in; // normally 3600 seconds
      const newExpiresAt = Date.now() + (expiresIn * 1000);

      await db.user.update({
        where: { spotify_id: spotifyId },
        data: {
          spotify_access_token: newAccessToken,
          spotify_token_expires_at: BigInt(newExpiresAt)
        }
      });

      return newAccessToken;
    } catch (error) {
      console.error(`Failed to refresh token for user ${spotifyId}:`, error);
      // fallback to existing token, though it might fail Spotify API queries
      return user.spotify_access_token;
    }
  }

  return user.spotify_access_token;
}

// Redirects user to Spotify OAuth login page
router.get('/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  // Store state in cookies to verify callback integrity (can be unsigned since it's transient, but safe to secure)
  res.cookie('spotify_auth_state', state, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' });
  
  // Track if this was triggered from a mobile app
  if (req.query.platform === 'mobile') {
    res.cookie('auth_platform', 'mobile', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' });
  } else {
    res.clearCookie('auth_platform');
  }
  
  const authUrl = spotify.getAuthUrl(state);
  res.redirect(authUrl);
});

// OAuth Callback Route
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const storedState = req.cookies ? req.cookies['spotify_auth_state'] : null;

  // Clear auth state cookie
  res.clearCookie('spotify_auth_state');

  if (error) {
    console.error("Spotify Auth Callback error:", error);
    return res.redirect(`/?error=${encodeURIComponent(error)}`);
  }

  if (!state || state !== storedState) {
    console.error("State mismatch or missing state cookie.");
    return res.redirect('/?error=state_mismatch');
  }

  try {
    // Exchange authorization code for tokens
    const tokens = await spotify.exchangeCodeForTokens(code);
    const { access_token, refresh_token, expires_in } = tokens;
    const expiresAt = Date.now() + (expires_in * 1000);

    // Get user details from Spotify
    const profile = await spotify.getUserProfile(access_token);
    const spotifyId = profile.id;
    const displayName = profile.display_name || spotifyId;
    const email = profile.email || '';

    // Check if user already exists
    const existingUser = await db.user.findUnique({
      where: { spotify_id: spotifyId }
    });

    if (existingUser) {
      // Update credentials
      await db.user.update({
        where: { spotify_id: spotifyId },
        data: {
          display_name: displayName,
          email: email,
          spotify_access_token: access_token,
          spotify_refresh_token: refresh_token,
          spotify_token_expires_at: BigInt(expiresAt)
        }
      });
      console.log(`Updated returning user: ${displayName} (${spotifyId})`);
    } else {
      // Insert new user with 3 free tokens
      await db.user.create({
        data: {
          spotify_id: spotifyId,
          display_name: displayName,
          email: email,
          spotify_access_token: access_token,
          spotify_refresh_token: refresh_token,
          spotify_token_expires_at: BigInt(expiresAt),
          tier: 'free',
          tokens: 3
        }
      });
      console.log(`Registered new user: ${displayName} (${spotifyId})`);
    }

    // Establish signed cookie session
    res.cookie('spotify_user_id', spotifyId, { 
      httpOnly: true,
      signed: true, // Signed cookie for cryptographic security in production
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    const isMobile = req.cookies && req.cookies['auth_platform'] === 'mobile';
    res.clearCookie('auth_platform');

    if (isMobile) {
      // Redirect back to the native app using custom URL scheme
      res.redirect(`playlistpic://auth-callback?spotify_user_id=${spotifyId}`);
    } else {
      res.redirect('/');
    }
  } catch (err) {
    console.error("Callback token exchange error:", err);
    res.redirect(`/?error=${encodeURIComponent(err.message)}`);
  }
});

// Logs out user
router.get('/logout', (req, res) => {
  res.clearCookie('spotify_user_id');
  res.json({ success: true, message: "Logged out successfully" });
});

// Returns current user profile details
router.get('/me', async (req, res) => {
  const spotifyUserId = getSpotifyUserId(req);
  if (!spotifyUserId) {
    return res.status(401).json({ loggedIn: false, message: "Not logged in" });
  }

  const user = await db.user.findUnique({
    where: { spotify_id: spotifyUserId },
    select: {
      spotify_id: true,
      display_name: true,
      email: true,
      tier: true,
      tokens: true
    }
  });

  if (!user) {
    res.clearCookie('spotify_user_id');
    return res.status(401).json({ loggedIn: false, message: "User session not found in database" });
  }

  res.json({
    loggedIn: true,
    user: {
      id: user.spotify_id,
      displayName: user.display_name,
      email: user.email,
      tier: user.tier,
      tokens: user.tokens
    }
  });
});

export default router;
