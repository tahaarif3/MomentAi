/**
 * Per-authenticated-user sliding-window rate limiter.
 * Falls back to IP key when no user id is available (pair with express-rate-limit).
 */

const hits = new Map();

function prune(bucket, windowMs) {
  const cutoff = Date.now() - windowMs;
  while (bucket.length && bucket[0] < cutoff) bucket.shift();
}

/**
 * @param {object} opts
 * @param {number} opts.windowMs
 * @param {number} opts.max
 * @param {(req) => Promise<string|null>|string|null} opts.getUserId
 */
export function createUserRateLimiter({
  windowMs = 15 * 60 * 1000,
  max = 60,
  getUserId
}) {
  return async function userRateLimit(req, res, next) {
    if (process.env.NODE_ENV === 'test') return next();

    try {
      const userId = getUserId ? await getUserId(req) : null;
      const key = userId ? `user:${userId}` : null;

      // No user → let IP limiter handle; do not double-count here
      if (!key) return next();

      let bucket = hits.get(key);
      if (!bucket) {
        bucket = [];
        hits.set(key, bucket);
      }
      prune(bucket, windowMs);

      if (bucket.length >= max) {
        return res.status(429).json({
          success: false,
          code: 'USER_RATE_LIMIT',
          message: 'Too many requests. Please try again later.'
        });
      }

      bucket.push(Date.now());
      return next();
    } catch (err) {
      console.error('userRateLimit error:', err);
      return next();
    }
  };
}

/** Test helper */
export function _resetUserRateLimitForTests() {
  hits.clear();
}
