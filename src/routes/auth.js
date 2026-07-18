import express from 'express';
import db from '../config/db.js';
import { getAuthUserId, getAuthUser } from '../utils/session.js';
import { getRemainingToday, effectiveDailyLimit, DEFAULT_DAILY_LIMIT } from '../utils/moments.js';
import { deleteStoredObject } from '../services/storageService.js';
import { supabaseAdmin } from '../config/supabase.js';
import Stripe from 'stripe';

const router = express.Router();

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

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
        daily_upload_limit: DEFAULT_DAILY_LIMIT
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
        dailyUploadLimit: effectiveDailyLimit(user),
        momentsRemainingToday: await getRemainingToday(db, user.id, user)
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
        daily_upload_limit: true
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
        dailyUploadLimit: effectiveDailyLimit(user),
        momentsRemainingToday: await getRemainingToday(db, user.id, user)
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

/**
 * Route: DELETE /api/auth/account
 * Permanently delete the authenticated user's account:
 * - Best-effort cancel Stripe subscription (web billing)
 * - Delete generation image objects (Spaces/local)
 * - Delete Postgres user (cascades generations)
 * - Delete Supabase Auth user
 *
 * Store entitlements (RevenueCat) should also revoke via their dashboard/webhooks;
 * we set tier cleanup by removing the user row.
 */
router.delete('/account', async (req, res) => {
  const userId = await getAuthUserId(req);
  if (!userId) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        stripe_customer_id: true,
        stripe_subscription_id: true,
        generations: { select: { image_path: true } }
      }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // Best-effort Stripe cleanup (web subscriptions)
    const stripe = getStripe();
    if (stripe && user.stripe_subscription_id) {
      try {
        await stripe.subscriptions.cancel(user.stripe_subscription_id);
      } catch (err) {
        console.warn(`[account delete] Stripe cancel failed for ${userId}:`, err.message);
      }
    }

    for (const gen of user.generations || []) {
      await deleteStoredObject(gen.image_path);
    }

    await db.user.delete({ where: { id: userId } });

    if (supabaseAdmin && process.env.NODE_ENV !== 'test') {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (error) {
        console.error(`[account delete] Supabase Auth delete failed for ${userId}:`, error.message);
        return res.status(500).json({
          success: false,
          message: 'Account data removed, but auth cleanup failed. Contact support.'
        });
      }
    }

    console.log(`[account delete] Removed user ${userId} (${user.email || 'no-email'})`);
    return res.json({ success: true, message: 'Account deleted.' });
  } catch (err) {
    console.error('Account delete error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
