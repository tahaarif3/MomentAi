import { Queue, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// ioredis connection options
export const redisConnectionOpts = {
  maxRetriesPerRequest: null, // Critical requirement for BullMQ
};

// Lazily/conditionally initialize Redis and Queue to prevent connection attempts in test mode
export let connection = null;
export let playlistQueue = null;
export let playlistQueueEvents = null;

if (process.env.NODE_ENV !== 'test') {
  connection = new Redis(redisUrl, redisConnectionOpts);

  connection.on('error', (err) => {
    console.error('[Redis] Connection Error:', err.message);
  });

  connection.on('connect', () => {
    console.log('[Redis] Connected successfully');
  });

  playlistQueue = new Queue('playlist-generation', {
    connection,
    defaultJobOptions: {
      // Gemini/Spotify transient errors are retried by the worker. Permanent
      // failures are explicitly marked unrecoverable and do not consume retries.
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 12000 // 12s → 24s → 48s between retries (Gemini 503 needs space)
      },
      removeOnComplete: true,
      // Keep a small, recent failure window for debugging without retaining
      // large job payloads indefinitely in Redis.
      removeOnFail: { age: 24 * 60 * 60, count: 200 }
    }
  });

  // One shared event consumer per app instance. Creating one QueueEvents
  // connection for every browser SSE client is expensive on metered Redis.
  playlistQueueEvents = new QueueEvents('playlist-generation', { connection });
  playlistQueueEvents.on('error', (err) => {
    console.error('[Redis] Queue events error:', err.message);
  });
}
