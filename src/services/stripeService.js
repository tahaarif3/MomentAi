import Stripe from 'stripe';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const appBaseUrl = (process.env.APP_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

export const isStripeConfigured = Boolean(stripeSecretKey);

export const stripe = isStripeConfigured
  ? new Stripe(stripeSecretKey)
  : null;

export const TOKEN_PACK_CREDITS = 20;

export function getAppBaseUrl() {
  return appBaseUrl;
}

async function resolvePriceId(lookupKey, envPriceId) {
  if (envPriceId) return envPriceId;
  if (!stripe) {
    throw new Error('Stripe is not configured.');
  }

  const prices = await stripe.prices.list({
    lookup_keys: [lookupKey],
    active: true,
    limit: 1
  });

  const price = prices.data[0];
  if (!price) {
    throw new Error(
      `Stripe price not found for lookup key "${lookupKey}". Create the product in your Stripe Dashboard or set the matching *_PRICE_ID env var.`
    );
  }

  return price.id;
}

export async function getTokenPackPriceId() {
  return resolvePriceId(
    process.env.STRIPE_TOKEN_PACK_LOOKUP_KEY || 'momentai_token_pack_20',
    process.env.STRIPE_TOKEN_PACK_PRICE_ID
  );
}

export async function getPremiumPriceId() {
  return resolvePriceId(
    process.env.STRIPE_PREMIUM_LOOKUP_KEY || 'momentai_premium_monthly',
    process.env.STRIPE_PREMIUM_PRICE_ID
  );
}

export async function getOrCreateStripeCustomer(db, user) {
  if (user.stripe_customer_id) {
    return user.stripe_customer_id;
  }

  const customer = await stripe.customers.create({
    email: user.email || undefined,
    name: user.display_name || undefined,
    metadata: { spotify_id: user.spotify_id }
  });

  await db.user.update({
    where: { spotify_id: user.spotify_id },
    data: { stripe_customer_id: customer.id }
  });

  return customer.id;
}

export async function createCheckoutSession({
  customerId,
  spotifyUserId,
  purchaseType,
  priceId
}) {
  const isSubscription = purchaseType === 'premium';

  return stripe.checkout.sessions.create({
    mode: isSubscription ? 'subscription' : 'payment',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appBaseUrl}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appBaseUrl}/?payment=cancelled`,
    metadata: {
      spotify_user_id: spotifyUserId,
      purchase_type: purchaseType
    },
    ...(isSubscription
      ? {
          subscription_data: {
            metadata: {
              spotify_user_id: spotifyUserId,
              purchase_type: purchaseType
            }
          }
        }
      : {})
  });
}

export async function createPortalSession(customerId) {
  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appBaseUrl}/`
  });
}
