import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Camera capture flow', () => {
  test('fake camera shutter produces playlist tracks', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btnHomeCapture').click();
    await expect(page.locator('#viewfinderVideo')).toBeVisible({ timeout: 10000 });

    await page.locator('#btnShutter').click();
    await expect(page.locator('#screenPlaylist.screen--active')).toBeVisible({ timeout: 45000 });

    await expect(page.locator('[data-screen="playlist"].screen--active')).toBeVisible();
    expect(await page.locator('#tracklistContainer .track-card').count()).toBeGreaterThan(0);
  });

  test('upload fallback on capture screen', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btnHomeCapture').click();
    const filePath = path.resolve('tests/assets/beach.png');
    await page.setInputFiles('#fileInput', filePath);
    await page.locator('#btnGeneratePlaylist').click();
    await expect(page.locator('#screenPlaylist.screen--active')).toBeVisible({ timeout: 45000 });
    await expect(page.locator('#tracklistContainer .track-card').first()).toBeVisible({ timeout: 15000 });
  });
});
