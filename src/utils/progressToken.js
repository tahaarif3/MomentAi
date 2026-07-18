import crypto from 'crypto';

const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function secret() {
  return (
    process.env.JOB_PROGRESS_SECRET ||
    process.env.SESSION_SECRET ||
    process.env.COOKIE_SECRET ||
    'dev_job_progress_secret'
  );
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromB64url(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64');
}

/**
 * Issue a short-lived HMAC token scoped to a BullMQ jobId (and optional userId).
 */
export function issueProgressToken(jobId, userId = null, ttlMs = DEFAULT_TTL_MS) {
  const payload = {
    jobId: String(jobId),
    userId: userId || null,
    exp: Date.now() + ttlMs
  };
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', secret()).update(body).digest());
  return `${body}.${sig}`;
}

/**
 * Verify token for a specific jobId. Returns payload or null.
 */
export function verifyProgressToken(token, jobId) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;

  const expected = b64url(crypto.createHmac('sha256', secret()).update(body).digest());
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(fromB64url(body).toString('utf8'));
    if (!payload?.jobId || String(payload.jobId) !== String(jobId)) return null;
    if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Extract progress token from query (?progressToken=) or header (X-Progress-Token).
 */
export function extractProgressToken(req) {
  const fromQuery = req.query?.progressToken;
  if (typeof fromQuery === 'string' && fromQuery) return fromQuery;
  const fromHeader = req.headers['x-progress-token'];
  if (typeof fromHeader === 'string' && fromHeader) return fromHeader;
  return null;
}
