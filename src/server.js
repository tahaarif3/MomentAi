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

// Seed test user if in test environment
import db from './config/db.js';
if (process.env.NODE_ENV === 'test') {
  console.log("Seeding test user in database using Prisma...");
  db.user.upsert({
    where: { spotify_id: 'test_user_id' },
    update: {
      display_name: 'Test User',
      email: 'test@example.com',
      spotify_access_token: 'mock_access_token',
      spotify_refresh_token: 'mock_refresh_token',
      spotify_token_expires_at: BigInt(Date.now() + 3600 * 1000),
      tier: 'free',
      tokens: 10
    },
    create: {
      spotify_id: 'test_user_id',
      display_name: 'Test User',
      email: 'test@example.com',
      spotify_access_token: 'mock_access_token',
      spotify_refresh_token: 'mock_refresh_token',
      spotify_token_expires_at: BigInt(Date.now() + 3600 * 1000),
      tier: 'free',
      tokens: 10
    }
  }).then(() => {
    console.log("Test user seeded successfully.");
  }).catch(err => {
    console.error("Failed to seed test user:", err);
  });
}

// Middleware
// CORS configuration to support native mobile apps (Capacitor) and production deploy URL
app.use((req, res, next) => {
  const appBaseUrl = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
  const allowedOrigins = [
    'http://localhost',
    'capacitor://localhost',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://momentai.dev',
    'https://www.momentai.dev',
    ...(appBaseUrl ? [appBaseUrl] : [])
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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure cookie-parser with a secure secret for cryptographically signed session cookies
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(` Playlist_pic running on port ${PORT}`);
  console.log(`===============================================`);
});
