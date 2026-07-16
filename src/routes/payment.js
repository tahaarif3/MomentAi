import express from 'express';
import db from '../config/db.js';
import { getAuthUserId } from '../utils/session.js';
import {
  createCheckoutSession,
  createPortalSession,
  getOrCreateStripeCustomer,
  getPremiumPriceId,
  isStripeConfigured,
  stripe
} from '../services/stripeService.js';

const router = express.Router();

function requireAuth(req, res, next) {
  // getAuthUserId is async, so we wrap it
  getAuthUserId(req).then(userId => {
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Please sign in to perform this action.' });
    }
    req.userId = userId;
    next();
  }).catch(err => {
    console.error('Auth check error:', err);
    res.status(500).json({ success: false, message: 'Authentication error.' });
  });
}

async function findUserOr404(userId, res) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    res.status(404).json({ success: false, message: 'User not found.' });
    return null;
  }
  return user;
}

async function claimStripeEvent(eventId) {
  try {
    await db.stripeEvent.create({ data: { event_id: eventId } });
    return true;
  } catch (error) {
    if (error.code === 'P2002') {
      return false;
    }
    throw error;
  }
}

async function activatePremium(userId, subscriptionId) {
  return db.user.update({
    where: { id: userId },
    data: {
      tier: 'premium',
      stripe_subscription_id: subscriptionId || undefined
    }
  });
}

async function deactivatePremium(userId) {
  return db.user.update({
    where: { id: userId },
    data: {
      tier: 'free',
      stripe_subscription_id: null
    }
  });
}

async function handleCheckoutCompleted(session) {
  const paidStatuses = new Set(['paid', 'no_payment_required']);
  if (session.payment_status && !paidStatuses.has(session.payment_status)) {
    console.warn('Checkout session completed without paid status:', session.id, session.payment_status);
    return;
  }

  const userId = session.metadata?.user_id;
  const purchaseType = session.metadata?.purchase_type;

  if (!userId || !purchaseType) {
    console.warn('Checkout session completed without expected metadata:', session.id);
    return;
  }

  if (purchaseType === 'token_pack') {
    console.warn('Ignoring deprecated token_pack purchase for user', userId);
    return;
  }

  if (purchaseType === 'premium') {
    await activatePremium(userId, session.subscription);
  }
}

async function handleSubscriptionChange(subscription) {
  const userId = subscription.metadata?.user_id;
  if (!userId) {
    return;
  }

  const isActive = ['active', 'trialing'].includes(subscription.status);
  if (isActive) {
    await activatePremium(userId, subscription.id);
  } else {
    await deactivatePremium(userId);
  }
}

/**
 * Route: POST /api/payment/create-checkout-session
 * Creates a Stripe Checkout Session for token pack or premium subscription.
 */
router.post('/create-checkout-session', requireAuth, async (req, res) => {
  if (!isStripeConfigured) {
    return res.status(503).json({
      success: false,
      message: 'Stripe is not configured yet. Add STRIPE_SECRET_KEY to your environment.'
    });
  }

  const purchaseType = req.body?.purchaseType;
  if (purchaseType === 'token_pack') {
    return res.status(410).json({
      success: false,
      message: 'Token packs are retired. Upgrade to MomentAI Plus for unlimited daily moments.'
    });
  }
  if (purchaseType !== 'premium') {
    return res.status(400).json({
      success: false,
      message: 'purchaseType must be "premium".'
    });
  }

  try {
    const user = await findUserOr404(req.userId, res);
    if (!user) return;

    const customerId = await getOrCreateStripeCustomer(db, user);
    const priceId = await getPremiumPriceId();

    const session = await createCheckoutSession({
      customerId,
      userId: req.userId,
      purchaseType,
      priceId
    });

    res.json({ success: true, url: session.url });
  } catch (error) {
    console.error('Checkout session error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Route: POST /api/payment/create-portal-session
 * Opens Stripe Customer Portal for subscription management.
 */
router.post('/create-portal-session', requireAuth, async (req, res) => {
  if (!isStripeConfigured) {
    return res.status(503).json({
      success: false,
      message: 'Stripe is not configured yet. Add STRIPE_SECRET_KEY to your environment.'
    });
  }

  try {
    const user = await findUserOr404(req.userId, res);
    if (!user) return;

    const customerId = await getOrCreateStripeCustomer(db, user);
    const portalSession = await createPortalSession(customerId);

    res.json({ success: true, url: portalSession.url });
  } catch (error) {
    console.error('Portal session error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Route: POST /api/payment/purchase-tokens
 * Legacy mock route — used only when Stripe is not configured.
 */
router.post('/purchase-tokens', requireAuth, async (req, res) => {
  return res.status(410).json({
    success: false,
    message: 'Token packs are retired. Upgrade to MomentAI Plus for unlimited daily moments.'
  });
});

/**
 * Route: POST /api/payment/subscribe
 * Legacy mock route — used only when Stripe is not configured.
 */
router.post('/subscribe', requireAuth, async (req, res) => {
  if (isStripeConfigured) {
    return res.status(400).json({
      success: false,
      message: 'Use Stripe Checkout for premium subscriptions.',
      checkoutRequired: true
    });
  }

  try {
    const user = await activatePremium(req.userId);
    res.json({
      success: true,
      message: 'Welcome to Plus! You now have unlimited moments.',
      dailyUploadLimit: null,
      tier: user.tier
    });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    console.error('Subscription error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Route: POST /api/payment/cancel-subscription
 * Legacy mock route — used only when Stripe is not configured.
 */
router.post('/cancel-subscription', requireAuth, async (req, res) => {
  if (isStripeConfigured) {
    return res.status(400).json({
      success: false,
      message: 'Manage your subscription in the Stripe Customer Portal.',
      portalRequired: true
    });
  }

  try {
    const user = await deactivatePremium(req.userId);
    res.json({
      success: true,
      message: 'Your subscription has been cancelled. You have returned to the Free tier.',
      dailyUploadLimit: user.daily_upload_limit,
      tier: user.tier
    });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    console.error('Subscription cancellation error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Stripe webhook handler — mounted separately with raw body parsing.
 */
export async function handleStripeWebhook(req, res) {
  if (!isStripeConfigured) {
    return res.status(503).send('Stripe is not configured.');
  }

  const signature = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is missing.');
    return res.status(500).send('Webhook secret is not configured.');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (error) {
    console.error('Stripe webhook signature verification failed:', error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  try {
    const claimed = await claimStripeEvent(event.id);
    if (!claimed) {
      return res.json({ received: true, duplicate: true });
    }

    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await handleSubscriptionChange(event.data.object);
        break;
      default:
        break;
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook processing error:', error);
    res.status(500).send('Webhook handler failed.');
  }
}

export default router;
