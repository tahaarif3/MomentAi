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
import { ensureGenerationTrackColumns } from './utils/ensureSchema.js';

async function seedTestUsers() {
  const testUsers = [
    { id: 'test_user_id', display_name: 'Test User', email: 'test@example.com', auth_provider: 'google', tier: 'free', tokens: 10 },
    { id: 'history_test_user', display_name: 'History Tester', email: 'history@test.com', auth_provider: 'email', tier: 'free', tokens: 10 },
    { id: 'daily_limit_user', display_name: 'Daily Limit User', email: 'daily@test.com', auth_provider: 'email', tier: 'free', tokens: 10 },
    { id: 'premium_test_user', display_name: 'Premium Tester', email: 'premium@test.com', auth_provider: 'email', tier: 'premium', tokens: 999 }
  ];
  console.log('Seeding test users in database using Prisma...');
  await db.generation.deleteMany();
  await Promise.all(testUsers.map((u) => db.user.upsert({
    where: { id: u.id },
    update: { display_name: u.display_name, email: u.email, auth_provider: u.auth_provider, tier: u.tier, tokens: u.tokens },
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie');
  
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

// Serve Frontend client statically
app.use(express.static(path.resolve(__dirname, 'public')));

// Connect API Routes
app.use('/health', healthRouter); // Mount health check for Load Balancers
app.use('/api/auth', authRouter);
app.use('/api/playlist', apiLimiter, playlistRouter); // Apply rate limiter to process/save routes
app.use('/api/payment', apiLimiter, paymentRouter);   // Apply rate limiter to payments

// Fallback: Send public/index.html for any frontend SPA navigation
app.get('*', (req, res) => {
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
    await ensureGenerationTrackColumns(db);
    console.log('[Prisma] Ensured generations.tracks / suggested_tracks columns.');
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
      const { connection } = await import('./config/queue.js');
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
