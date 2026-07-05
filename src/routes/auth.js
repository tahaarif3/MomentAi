import express from 'express';
import db from '../config/db.js';
import { getAuthUserId, getAuthUser } from '../utils/session.js';

const router = express.Router();

/**
 * Route: POST /api/auth/callback
 * Called by the frontend after Supabase OAuth completes.
 * Upserts the user in our database from Supabase session data.
 */
router.post('/callback', async (req, res) => {
  try {
    const supabaseUser = await getAuthUser(req);
    if (!supabaseUser) {
      return res.status(401).json({ success: false, message: 'Invalid or expired session.' });
    }

    const userId = supabaseUser.id;
    const email = supabaseUser.email || null;
    const displayName = supabaseUser.user_metadata?.full_name
      || supabaseUser.user_metadata?.name
      || email?.split('@')[0]
      || 'User';
    const avatarUrl = supabaseUser.user_metadata?.avatar_url
      || supabaseUser.user_metadata?.picture
      || null;
    const provider = supabaseUser.app_metadata?.provider || 'google';

    // Upsert user in our database
    const user = await db.user.upsert({
      where: { id: userId },
      update: {
        display_name: displayName,
        email: email,
        avatar_url: avatarUrl,
        auth_provider: provider
      },
      create: {
        id: userId,
        display_name: displayName,
        email: email,
        avatar_url: avatarUrl,
        auth_provider: provider,
        tier: 'free',
        tokens: 10
      }
    });

    console.log(`Auth callback: upserted user ${displayName} (${userId}) via ${provider}`);

    res.json({
      success: true,
      user: {
        id: user.id,
        displayName: user.display_name,
        email: user.email,
        avatarUrl: user.avatar_url,
        tier: user.tier,
        tokens: user.tokens
      }
    });
  } catch (err) {
    console.error('Auth callback error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Route: GET /api/auth/me
 * Returns the current user's profile from our database.
 * Requires a valid Supabase JWT in the Authorization header.
 */
router.get('/me', async (req, res) => {
  const userId = await getAuthUserId(req);
  if (!userId) {
    return res.status(401).json({ loggedIn: false, message: 'Not logged in' });
  }

  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        display_name: true,
        email: true,
        avatar_url: true,
        tier: true,
        tokens: true
      }
    });

    if (!user) {
      return res.status(401).json({ loggedIn: false, message: 'User not found in database. Please sign in again.' });
    }

    res.json({
      loggedIn: true,
      user: {
        id: user.id,
        displayName: user.display_name,
        email: user.email,
        avatarUrl: user.avatar_url,
        tier: user.tier,
        tokens: user.tokens
      }
    });
  } catch (err) {
    console.error('Auth /me error:', err);
    res.status(500).json({ loggedIn: false, message: err.message });
  }
});

/**
 * Route: GET /api/auth/config
 * Returns public Supabase configuration for the frontend to initialize.
 */
router.get('/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null
  });
});

/**
 * Route: POST /api/auth/logout
 * Server-side logout acknowledgment.
 * The actual session invalidation happens on the frontend via supabase.auth.signOut().
 */
router.post('/logout', (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

export default router;
