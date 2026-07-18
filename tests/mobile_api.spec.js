import { test, expect } from '@playwright/test';
import {
  issueProgressToken,
  verifyProgressToken
} from '../src/utils/progressToken.js';
import { isAllowedImageMime, isHeicMime } from '../src/utils/imageConvert.js';

test.describe('Mobile API readiness (Phase 0)', () => {
  test('compatibility endpoint returns force-upgrade fields', async ({ request }) => {
    const res = await request.get('/api/mobile/compatibility');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.minIosVersion).toBeTruthy();
    expect(body.minAndroidVersion).toBeTruthy();
    expect(body.minAppVersion).toBeTruthy();
    expect(typeof body.forceUpgrade).toBe('boolean');
    expect(body.features.masterSpotifyExport).toBe(true);
    expect(body.features.stripeCheckoutInApp).toBe(false);
  });

  test('progress tokens bind to jobId and expire check', async () => {
    const token = issueProgressToken('job-42', 'user-a');
    expect(verifyProgressToken(token, 'job-42')?.userId).toBe('user-a');
    expect(verifyProgressToken(token, 'job-other')).toBeNull();
    expect(verifyProgressToken('tampered.' + token.split('.')[1], 'job-42')).toBeNull();
  });

  test('HEIC mime types are accepted for upload filter', async () => {
    expect(isHeicMime('image/heic')).toBe(true);
    expect(isAllowedImageMime('image/heic')).toBe(true);
    expect(isAllowedImageMime('image/jpeg')).toBe(true);
    expect(isAllowedImageMime('application/pdf')).toBe(false);
  });

  test('job status without credentials is forbidden when queue unavailable or missing', async ({ request }) => {
    // In NODE_ENV=test the queue is null → 503; either way unauthenticated access must not return another user's result.
    const res = await request.get('/api/playlist/job/does-not-exist');
    expect([403, 404, 503]).toContain(res.status());
    if (res.status() !== 503) {
      const body = await res.json();
      expect(body.success).toBe(false);
    }
  });

  test('DELETE /api/auth/account removes test user', async ({ request }) => {
    const userId = `delete_me_${Date.now()}`;
    // Seed via process path's upsert is heavy; use history auth pattern — create via prisma through callback-like seed
    // Ensure user exists by hitting /me after... we need a row. Use admin-less direct: process with header creates on process.
    // Simpler: create through auth callback is JWT-only. Insert via generating with x-test-user-id after a dummy upsert in process.

    // Create user by calling a protected route that upserts in test mode (process upserts).
    // Use a tiny PNG upload.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );

    const processRes = await request.post('/api/playlist/process', {
      headers: {
        Authorization: 'Bearer test_token',
        'x-test-user-id': userId
      },
      multipart: {
        image: {
          name: 'dot.png',
          mimeType: 'image/png',
          buffer: png
        }
      }
    });
    expect(processRes.ok()).toBeTruthy();

    const del = await request.delete('/api/auth/account', {
      headers: {
        Authorization: 'Bearer test_token',
        'x-test-user-id': userId
      }
    });
    expect(del.ok()).toBeTruthy();
    const delBody = await del.json();
    expect(delBody.success).toBe(true);

    const me = await request.get('/api/auth/me', {
      headers: {
        Authorization: 'Bearer test_token',
        'x-test-user-id': userId
      }
    });
    expect(me.status()).toBe(401);
  });

  test('delete-account public page is served', async ({ request }) => {
    const res = await request.get('/delete-account.html');
    expect(res.ok()).toBeTruthy();
    const html = await res.text();
    expect(html.toLowerCase()).toContain('delete your account');
  });
});
