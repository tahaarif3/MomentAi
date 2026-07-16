import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Capture upload flow', () => {
  test('upload on capture screen produces playlist tracks', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btnHomeCapture').click();
    await expect(page.locator('#viewfinderUpload')).toBeVisible();
    await expect(page.locator('#viewfinderVideo')).toBeHidden();

    const filePath = path.resolve('tests/assets/beach.png');
    await page.setInputFiles('#fileInput', filePath);
    await page.locator('#btnGeneratePlaylist').click();
    await expect(page.locator('#screenPlaylist.screen--active')).toBeVisible({ timeout: 45000 });
    expect(await page.locator('#tracklistContainer .track-card').count()).toBeGreaterThan(0);
  });

  test('shutter opens file picker path via staged upload', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btnHomeCapture').click();
    const filePath = path.resolve('tests/assets/beach.png');
    await page.setInputFiles('#fileInput', filePath);
    await expect(page.locator('#btnGeneratePlaylist')).toBeVisible();
    await page.locator('#btnGeneratePlaylist').click();
    await expect(page.locator('#screenPlaylist.screen--active')).toBeVisible({ timeout: 45000 });
    await expect(page.locator('#tracklistContainer .track-card').first()).toBeVisible({ timeout: 15000 });
  });

  test('home prompt is visible and editable', async ({ page }) => {
    await page.goto('/');
    const prompt = page.locator('#customTextPrompt');
    await expect(prompt).toBeVisible();
    await prompt.fill('soft acoustic morning');
    expect(await prompt.inputValue()).toBe('soft acoustic morning');
  });
});
