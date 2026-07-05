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
  ```

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
