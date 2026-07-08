import { Queue } from 'bullmq';
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
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000 // Retry after 2s, then 4s, then 8s
      },
      removeOnComplete: true, // Clean up completed jobs from Redis
      removeOnFail: false // Keep failed jobs for inspection/retry
    }
  });
}
