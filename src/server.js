import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import rateLimit from 'express-rate-limit';

// Routes
import authRouter from './routes/auth.js';
import playlistRouter from './routes/playlist.js';
import paymentRouter, { handleStripeWebhook } from './routes/payment.js';
import healthRouter from './routes/health.js';
import adminRouter from './routes/admin.js';
import mobileRouter from './routes/mobile.js';
import billingRouter from './routes/billing.js';
import appleRouter from './routes/apple.js';
import {
  ensureGenerationTrackLinks,
  toPublicTrackLinks
} from './services/trackLinkService.js';
import { renderPublicPlaylistHtml } from './services/publicPlaylistPage.js';

// Setup __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// DigitalOcean / reverse proxies send X-Forwarded-For — required for express-rate-limit
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Seed test users before accepting traffic in test environment
import db from './config/db.js';
import { ensureSchema } from './utils/ensureSchema.js';

async function seedTestUsers() {
  const testUsers = [
    { id: 'test_user_id', display_name: 'Test User', email: 'test@example.com', auth_provider: 'google', tier: 'free', daily_upload_limit: 3 },
    { id: 'history_test_user', display_name: 'History Tester', email: 'history@test.com', auth_provider: 'email', tier: 'free', daily_upload_limit: 3 },
    { id: 'daily_limit_user', display_name: 'Daily Limit User', email: 'daily@test.com', auth_provider: 'email', tier: 'free', daily_upload_limit: 3 },
    { id: 'premium_test_user', display_name: 'Premium Tester', email: 'premium@test.com', auth_provider: 'email', tier: 'premium', daily_upload_limit: 3 },
    { id: 'boosted_limit_user', display_name: 'Boosted Free User', email: 'boosted@test.com', auth_provider: 'email', tier: 'free', daily_upload_limit: 10 }
  ];
  console.log('Seeding test users in database using Prisma...');
  await db.generation.deleteMany();
  await Promise.all(testUsers.map((u) => db.user.upsert({
    where: { id: u.id },
    update: {
      display_name: u.display_name,
      email: u.email,
      auth_provider: u.auth_provider,
      tier: u.tier,
      daily_upload_limit: u.daily_upload_limit
    },
    create: u
  })));
  console.log('Test users seeded successfully.');
}

// Middleware
// CORS configuration to support native mobile apps (Capacitor) and production deploy URL
app.use((req, res, next) => {
  const appBaseUrl = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const allowedOrigins = [
    'http://localhost',
    'capacitor://localhost',
    'ionic://localhost',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://momentai.dev',
    'https://www.momentai.dev',
    ...(appBaseUrl ? [appBaseUrl] : []),
    ...(supabaseUrl ? [supabaseUrl] : [])
  ];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Cookie, X-Progress-Token, X-Test-User-Id'
  );
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Stripe webhooks require the raw request body for signature verification.
app.post('/api/payment/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ limit: '15mb', extended: true }));

// Cookie parser — kept for backward compatibility and any non-auth cookie usage
const cookieSecret = process.env.COOKIE_SECRET || process.env.SESSION_SECRET || 'dev_session_secret_playlist_pic_123';
app.use(cookieParser(cookieSecret));

// Rate Limiting to prevent API abuse and cost overflows in production
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests from this IP, please try again after 15 minutes."
  },
  skip: (req) => process.env.NODE_ENV === 'test' // Skip rate limiting in automated E2E testing
});

// Ensure the uploads directory exists
const uploadDir = path.resolve(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Serve uploaded playlist covers statically
app.use('/uploads', express.static(uploadDir));

// Universal Links / App Links association files (mobile auth)
const publicDir = path.resolve(__dirname, 'public');
app.get('/.well-known/apple-app-site-association', (req, res) => {
  res.type('application/json');
  res.sendFile(path.join(publicDir, '.well-known', 'apple-app-site-association'));
});
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.type('application/json');
  res.sendFile(path.join(publicDir, '.well-known', 'assetlinks.json'));
});

// Serve Frontend client statically
app.use(express.static(publicDir));

// Connect API Routes
app.use('/health', healthRouter); // Mount health check for Load Balancers
app.use('/api/auth', authRouter);
app.use('/api/mobile', mobileRouter); // Public native compatibility / force-upgrade
app.use('/api/billing', apiLimiter, billingRouter); // Store entitlement webhooks (RevenueCat)
app.use('/api/playlist', apiLimiter, playlistRouter); // IP limiter fallback; per-user limits inside router
app.use('/api/payment', apiLimiter, paymentRouter);   // Apply rate limiter to payments (web Stripe)
app.use('/api/admin', apiLimiter, adminRouter);
app.use('/api/apple', apiLimiter, appleRouter);

/**
 * Public share page — SSR with Open Graph tags (primary multi-target / viral surface).
 * Must be registered before the SPA catch-all.
 */
app.get('/p/:id', async (req, res) => {
  const appBase = (process.env.APP_BASE_URL || 'https://momentai.dev').replace(/\/$/, '');
  try {
    const enriched = await ensureGenerationTrackLinks(db, req.params.id);
    if (!enriched) {
      return res.status(404).send(`<!DOCTYPE html><html><head><title>Not found · MomentAI</title></head>
<body style="font-family:system-ui;background:#17110c;color:#ece5da;padding:2rem">
<a href="${appBase}" style="color:#e9a94f">MomentAI</a>
<h1>Playlist not found</h1>
<p>This share link may have expired or never existed.</p>
</body></html>`);
    }
    const tracks = toPublicTrackLinks(enriched.tracks || []);
    const html = renderPublicPlaylistHtml({ row: enriched, tracks, appBase });
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.type('html').send(html);
  } catch (err) {
    console.error('[/p/:id]', err);
    res.status(500).send('Failed to render playlist');
  }
});

/**
 * Soft retirement of interactive web UI (flag-off → observe → remove).
 * When WEB_INTERACTIVE_UI_ENABLED=false, `/` serves a store-CTA landing.
 * Legal pages, auth callback, and /p/:id stay live regardless.
 */
const interactiveWebUi =
  process.env.WEB_INTERACTIVE_UI_ENABLED !== 'false' &&
  process.env.WEB_INTERACTIVE_UI_ENABLED !== '0';

app.get('/', (req, res, next) => {
  if (interactiveWebUi) return next();
  return res.sendFile(path.join(publicDir, 'landing-app.html'));
});

// Fallback: Send public/index.html for any frontend SPA navigation
app.get('*', (req, res) => {
  // Keep legal / auth / delete pages as static files (already served above when present)
  if (!interactiveWebUi && !req.path.match(/\.(html|js|css|png|jpg|svg|ico|json|txt|map)$/i)) {
    // Continue-in-app interstitial for old interactive deep paths
    return res.sendFile(path.join(publicDir, 'continue-in-app.html'));
  }
  res.sendFile(path.resolve(__dirname, 'public/index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Express App Error:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "An unexpected server error occurred."
  });
});

if (process.env.NODE_ENV === 'test') {
  await seedTestUsers();
} else {
  try {
    await ensureSchema(db);
    console.log('[Prisma] Ensured schema columns (tracks, daily_upload_limit).');
  } catch (err) {
    console.error('[Prisma] Failed to ensure track columns:', err);
    throw err;
  }
}

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(` MomentAI running on port ${PORT}`);
  console.log(`===============================================`);
});

// Import worker to start listening to the queue (only starts if process.env.NODE_ENV !== 'test')
import './workers/playlistWorker.js';

// Graceful shutdown helper
const gracefulShutdown = async (signal) => {
  console.log(`[Server] Received ${signal}. Starting graceful shutdown...`);
  
  server.close(() => {
    console.log('[Server] HTTP server closed.');
  });

  try {
    await db.$disconnect();
    console.log('[Prisma] Database disconnected.');
  } catch (err) {
    console.error('[Prisma] Error disconnecting database:', err);
  }

  if (process.env.NODE_ENV !== 'test') {
    try {
      const { worker } = await import('./workers/playlistWorker.js');
      if (worker) {
        await worker.close();
        console.log('[Worker] Worker closed.');
      }
    } catch (err) {
      console.error('[Worker] Error closing worker:', err);
    }

    try {
      const { connection, playlistQueueEvents } = await import('./config/queue.js');
      await playlistQueueEvents?.close();
      await connection.quit();
      console.log('[Redis] Connection closed.');
    } catch (err) {
      console.error('[Redis] Error closing Redis connection:', err);
    }
  }

  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
