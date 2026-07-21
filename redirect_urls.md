# Required Redirect URLs & Webhook Configurations

Here are all the URLs you need to configure in your third-party developer consoles to make authentication, playlist saving, and payments work in both local development and production on DigitalOcean (`momentai.dev`).

---

## 🎵 1. Spotify Developer Dashboard
Add this URL under your app's **Redirect URIs** in the Spotify settings to run the master account setup script. 

*Note: Since end-users do not connect their own Spotify accounts anymore under the Master Account architecture, you only need the local redirect URI to obtain your master token.*

* **Settings Page**: [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
* **Redirect URI (Development & Production Setup)**:
  ```text
  http://127.0.0.1:8888/callback
  ```

---

## ⚡ 2. Supabase Dashboard (Authentication)
Configure these under **Authentication** ➔ **URL Configuration** in your Supabase project settings.

* **Settings Page**: [Supabase URL Configuration](https://supabase.com/dashboard/project/bonebcazubomgwuirwfr/auth/url-configuration)

### Development:
* **Site URL**:
  ```text
  http://localhost:3000
  ```
* **Redirect URIs**:
  ```text
  http://localhost:3000
  http://localhost:3000/*
  ```

### Production (DigitalOcean):
* **Site URL**:
  ```text
  https://momentai.dev
  ```
* **Redirect URIs**:
  ```text
  https://momentai.dev
  https://momentai.dev/*
  https://momentai.dev/auth/callback
  momentai://auth/callback
  ```

### Native (`momentai-mobile` repo):
* Prefer Universal / App Links: `https://momentai.dev/auth/callback`
* Fallback custom scheme: `momentai://auth/callback`
* Host files (served by this web app):
  - `/.well-known/apple-app-site-association` — replace `TEAMID` with your Apple Developer Team ID (`TEAMID.dev.momentai.app`)
  - `/.well-known/assetlinks.json` — replace `REPLACE_WITH_PLAY_APP_SIGNING_CERT_SHA256` with Play App Signing cert SHA-256

---

## 💳 3. Stripe Developer Dashboard (Webhooks)

To handle successful subscription checkouts and token pack purchases, configure this webhook in your Stripe settings.

* **Settings Page**: [Stripe Webhooks Dashboard](https://dashboard.stripe.com/test/webhooks)

### Development:
* **Webhook Endpoint URL** (using Stripe CLI forwarding):
  ```text
  http://localhost:3000/api/payment/webhook
  ```

### Production (DigitalOcean):
* **Webhook Endpoint URL**:
  ```text
  https://momentai.dev/api/payment/webhook
  ```
* **Required Events**:
  - `checkout.session.completed`
  - `invoice.payment_succeeded`

Stripe Checkout remains **web-only**. Native Premium uses StoreKit / Play Billing via RevenueCat.

---

## 📱 4. RevenueCat (native store entitlements)
* **Webhook URL**:
  ```text
  https://momentai.dev/api/billing/revenuecat
  ```
* **Authorization**: Bearer token matching `REVENUECAT_WEBHOOK_SECRET`
* Maps store entitlements → `users.tier` (`premium` / `free`)
* Enable on API host: `MOBILE_STORE_BILLING_ENABLED=true`
* Mobile client needs `VITE_REVENUECAT_IOS_API_KEY` / `VITE_REVENUECAT_ANDROID_API_KEY` at build time
* Full launch checklist: `momentai-mobile` → `docs/app-store-launch-plan.md`
