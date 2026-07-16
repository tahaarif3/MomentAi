import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const API = 'http://127.0.0.1:3000';

test.describe('Regenerate playlist', () => {
  test('free user receives PLUS_REQUIRED', async ({ request }) => {
    const proc = await request.post(`${API}/api/playlist/process`, {
      headers: { Authorization: 'Bearer test_token', 'x-test-user-id': 'history_test_user' },
      multipart: {
        image: {
          name: 'beach.png',
          mimeType: 'image/png',
          buffer: fs.readFileSync(path.resolve('tests/assets/beach.png'))
        }
      }
    });
    const created = await proc.json();
    expect(created.generationId).toBeTruthy();

    const regen = await request.post(`${API}/api/playlist/regenerate`, {
      headers: {
        Authorization: 'Bearer test_token',
        'x-test-user-id': 'history_test_user',
        'Content-Type': 'application/json'
      },
      data: { generationId: created.generationId }
    });
    expect(regen.status()).toBe(403);
    const body = await regen.json();
    expect(body.code).toBe('PLUS_REQUIRED');
  });

  test('premium user can regenerate', async ({ request }) => {
    const proc = await request.post(`${API}/api/playlist/process`, {
      headers: { Authorization: 'Bearer test_token', 'x-test-user-id': 'premium_test_user' },
      multipart: {
        image: {
          name: 'beach.png',
          mimeType: 'image/png',
          buffer: fs.readFileSync(path.resolve('tests/assets/beach.png'))
        }
      }
    });
    const created = await proc.json();
    expect(created.generationId).toBeTruthy();

    const regen = await request.post(`${API}/api/playlist/regenerate`, {
      headers: {
        Authorization: 'Bearer test_token',
        'x-test-user-id': 'premium_test_user',
        'Content-Type': 'application/json'
      },
      data: { generationId: created.generationId }
    });
    expect(regen.ok()).toBeTruthy();
    const body = await regen.json();
    expect(body.success).toBe(true);
    expect(body.tracks?.length || body.jobId).toBeTruthy();
  });
});
