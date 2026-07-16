import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const API = 'http://127.0.0.1:3000';

async function processImage(request, userId) {
  return request.post(`${API}/api/playlist/process`, {
    headers: {
      Authorization: 'Bearer test_token',
      'x-test-user-id': userId
    },
    multipart: {
      image: {
        name: 'beach.png',
        mimeType: 'image/png',
        buffer: fs.readFileSync(path.resolve('tests/assets/beach.png'))
      }
    }
  });
}

test.describe('Your moments history API', () => {
  test('saved generation includes tracks and reopens via GET /generation/:id', async ({ request }) => {
    const userId = `hist_${Date.now()}`;
    await request.post(`${API}/api/auth/callback`, {
      headers: { Authorization: 'Bearer test_token', 'x-test-user-id': userId }
    }).catch(() => {});

    // Seed user via first process (worker creates generation when user exists — seed via process with known seeded user)
    const userIdSeed = 'history_test_user';
    const proc = await processImage(request, userIdSeed);
    expect(proc.ok()).toBeTruthy();
    const body = await proc.json();
    expect(body.tracks?.length).toBeGreaterThan(0);

    const historyRes = await request.get(`${API}/api/playlist/history`, {
      headers: { Authorization: 'Bearer test_token', 'x-test-user-id': userIdSeed }
    });
    const history = await historyRes.json();
    expect(history.success).toBe(true);
    expect(history.history.length).toBeGreaterThan(0);
    expect(history.history[0].track_count).toBeGreaterThan(0);

    const genId = history.history[0].id;
    const detailRes = await request.get(`${API}/api/playlist/generation/${genId}`, {
      headers: { Authorization: 'Bearer test_token', 'x-test-user-id': userIdSeed }
    });
    const detail = await detailRes.json();
    expect(detail.success).toBe(true);
    expect(detail.tracks.length).toBeGreaterThan(0);
    expect(detail.metadata.seedGenres.length).toBeGreaterThan(0);
  });

  test('fourth generation today hits daily limit', async ({ request }) => {
    const userId = `daily_limit_${Date.now()}`;
    await processImage(request, userId);
    await processImage(request, userId);
    await processImage(request, userId);
    const fourth = await processImage(request, userId);
    expect(fourth.status()).toBe(403);
    const err = await fourth.json();
    expect(err.code).toBe('DAILY_LIMIT');
  });
});
