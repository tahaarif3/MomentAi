import express from 'express';

const router = express.Router();

/**
 * GET /api/mobile/compatibility
 * Public kill-switch / force-upgrade channel for native builds.
 */
router.get('/compatibility', (req, res) => {
  const appBase = (process.env.APP_BASE_URL || 'https://momentai.dev').replace(/\/$/, '');

  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({
    success: true,
    minIosVersion: process.env.MOBILE_MIN_IOS_VERSION || '1.0.0',
    minAndroidVersion: process.env.MOBILE_MIN_ANDROID_VERSION || '1.0.0',
    minAppVersion: process.env.MOBILE_MIN_APP_VERSION || '1.0.0',
    forceUpgrade: process.env.MOBILE_FORCE_UPGRADE === 'true',
    forceUpgradeMessage:
      process.env.MOBILE_FORCE_UPGRADE_MESSAGE ||
      'Please update MomentAI to continue.',
    apiBase: appBase,
    features: {
      masterSpotifyExport: true,
      storeBilling: process.env.MOBILE_STORE_BILLING_ENABLED === 'true',
      stripeCheckoutInApp: false
    }
  });
});

export default router;
