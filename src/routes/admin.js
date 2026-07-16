import express from 'express';
import db from '../config/db.js';
import { DEFAULT_DAILY_LIMIT } from '../utils/moments.js';

const router = express.Router();

/**
 * Simple admin API for raising a user's daily upload limit.
 * Auth: header `x-admin-secret` must match env ADMIN_API_SECRET.
 *
 * PATCH /api/admin/users/:id/daily-limit
 * Body: { dailyUploadLimit: 20 }
 *
 * Or by email:
 * PATCH /api/admin/users/by-email/daily-limit
 * Body: { email: "friend@example.com", dailyUploadLimit: 20 }
 */
function requireAdmin(req, res, next) {
  const secret = process.env.ADMIN_API_SECRET;
  if (!secret) {
    return res.status(503).json({
      success: false,
      message: 'Admin API disabled. Set ADMIN_API_SECRET to enable.'
    });
  }
  if (req.headers['x-admin-secret'] !== secret) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
}

router.use(requireAdmin);

router.patch('/users/:id/daily-limit', async (req, res) => {
  const limit = Number(req.body?.dailyUploadLimit);
  if (!Number.isFinite(limit) || limit < 0 || limit > 1000) {
    return res.status(400).json({
      success: false,
      message: 'dailyUploadLimit must be a number between 0 and 1000.'
    });
  }

  try {
    const user = await db.user.update({
      where: { id: req.params.id },
      data: { daily_upload_limit: Math.floor(limit) },
      select: {
        id: true,
        email: true,
        display_name: true,
        tier: true,
        daily_upload_limit: true
      }
    });
    res.json({ success: true, user });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    console.error('Admin daily-limit update failed:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch('/users/by-email/daily-limit', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const limit = Number(req.body?.dailyUploadLimit ?? DEFAULT_DAILY_LIMIT);
  if (!email) {
    return res.status(400).json({ success: false, message: 'email is required.' });
  }
  if (!Number.isFinite(limit) || limit < 0 || limit > 1000) {
    return res.status(400).json({
      success: false,
      message: 'dailyUploadLimit must be a number between 0 and 1000.'
    });
  }

  try {
    const existing = await db.user.findUnique({ where: { email } });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const user = await db.user.update({
      where: { id: existing.id },
      data: { daily_upload_limit: Math.floor(limit) },
      select: {
        id: true,
        email: true,
        display_name: true,
        tier: true,
        daily_upload_limit: true
      }
    });
    res.json({ success: true, user });
  } catch (err) {
    console.error('Admin daily-limit (email) update failed:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
