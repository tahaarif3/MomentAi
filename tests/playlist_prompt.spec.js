import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Playlist_pic Custom Prompt E2E Tests', () => {
  const sampleImagePath = path.resolve('tests/assets/beach.png');

  async function openCapture(page) {
    await page.goto('/');
    await page.locator('#btnHomeCapture').click();
    await expect(page.locator('#screenCapture.screen--active')).toBeVisible();
  }

  test('should generate playlist suggestions successfully using an optional custom music prompt', async ({ page }) => {
    await openCapture(page);

    const testStyle = 'dark synthwave cyber metal';
    await page.locator('#customTextPrompt').fill(testStyle);

    await page.setInputFiles('#fileInput', sampleImagePath);
    await page.locator('#btnGeneratePlaylist').click();

    await expect(page.locator('#screenPlaylist.screen--active')).toBeVisible({ timeout: 45000 });
    await expect(page.locator('#tracklistContainer .track-card').first()).toBeVisible({ timeout: 10000 });

    await expect(page.locator('#colorTags .tag').first()).toBeAttached();
    expect(await page.locator('#envContext').textContent()).not.toBe('-');

    expect(await page.locator('#tracklistContainer .track-card').count()).toBeGreaterThan(0);

    const authCloseBtn = page.locator('#btnAuthGateClose');
    if (await authCloseBtn.isVisible()) {
      await authCloseBtn.click();
    }

    await page.locator('#btnPlaylistBack').click();
    expect(await page.locator('#customTextPrompt').inputValue()).toBe('');
    await expect(page.locator('#screenHome.screen--active')).toBeVisible();
  });

  test('should generate playlist suggestions successfully without a custom prompt (optional validation)', async ({ page }) => {
    await openCapture(page);
    await page.setInputFiles('#fileInput', sampleImagePath);
    await page.locator('#btnGeneratePlaylist').click();
    await expect(page.locator('#screenPlaylist.screen--active')).toBeVisible({ timeout: 45000 });
    await expect(page.locator('#tracklistContainer .track-card').first()).toBeVisible({ timeout: 10000 });

    expect(await page.locator('#envContext').textContent()).not.toBe('-');
    expect(await page.locator('#tracklistContainer .track-card').count()).toBeGreaterThan(0);
  });
});
