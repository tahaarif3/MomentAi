import express from 'express';
import db from '../config/db.js';

const router = express.Router();

/**
 * POST /api/billing/revenuecat
 * Store entitlement webhook (RevenueCat). Syncs users.tier from store events.
 * Stripe remains web-only; native Premium uses StoreKit / Play Billing.
 *
 * Auth: Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>
 *        or X-RevenueCat-Secret header
 */
router.post('/revenuecat', async (req, res) => {
  const expected = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!expected) {
    return res.status(503).json({
      success: false,
      message: 'RevenueCat webhook is not configured.'
    });
  }

  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const headerSecret = req.headers['x-revenuecat-secret'];
  const provided = bearer || headerSecret;
  if (provided !== expected) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const event = req.body?.event || req.body;
    const appUserId =
      event?.app_user_id ||
      event?.appUserId ||
      req.body?.app_user_id ||
      null;

    if (!appUserId) {
      return res.status(400).json({ success: false, message: 'Missing app_user_id' });
    }

    const type = String(event?.type || event?.event_type || '').toUpperCase();
    const entitlements =
      event?.entitlements ||
      event?.subscriber?.entitlements ||
      {};

    const hasPremium =
      Boolean(entitlements.premium?.expires_date
        ? new Date(entitlements.premium.expires_date) > new Date()
        : entitlements.premium) ||
      type.includes('INITIAL_PURCHASE') ||
      type.includes('RENEWAL') ||
      type.includes('UNCANCELLATION') ||
      type.includes('PRODUCT_CHANGE');

    const revoke =
      type.includes('EXPIRATION') ||
      type.includes('CANCELLATION') ||
      type.includes('REFUND');

    let tier = null;
    if (revoke) tier = 'free';
    else if (hasPremium) tier = 'premium';

    if (!tier) {
      return res.json({ success: true, ignored: true, type });
    }

    const user = await db.user.findUnique({ where: { id: appUserId } });
    if (!user) {
      // Also try email-linked lookup is out of scope; RevenueCat app_user_id should be Supabase uid
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    await db.user.update({
      where: { id: appUserId },
      data: { tier }
    });

    console.log(`[billing/revenuecat] user ${appUserId} → tier=${tier} (event=${type || 'n/a'})`);
    return res.json({ success: true, userId: appUserId, tier });
  } catch (err) {
    console.error('RevenueCat webhook error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
