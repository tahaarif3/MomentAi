import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Playlist_pic Custom Prompt E2E Tests', () => {
  // Use committed fixture — uploads/* is gitignored and missing on Travis
  const sampleImagePath = path.resolve('tests/assets/beach.png');

  test('should generate playlist suggestions successfully using an optional custom music prompt', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Moment\.?AI/i);

    const promptInput = page.locator('#customTextPrompt');
    await expect(promptInput).toBeVisible();

    const testStyle = 'dark synthwave cyber metal';
    await promptInput.fill(testStyle);

    const fileInput = page.locator('#fileInput');
    await fileInput.setInputFiles(sampleImagePath);

    const generateBtn = page.locator('#btnGeneratePlaylist');
    await expect(generateBtn).toBeVisible();
    await generateBtn.click();

    await expect(page.locator('#analysisCard')).toBeVisible();
    await page.waitForSelector('#analysisLoader', { state: 'hidden', timeout: 45000 });

    // Metadata lives in sr-only nodes — assert attached/content, not visibility
    await expect(page.locator('#colorTags .tag').first()).toBeAttached();
    const envText = await page.locator('#envContext').textContent();
    expect(envText).not.toBe('-');

    const trackCards = page.locator('#tracklistContainer .track-card');
    const trackCount = await trackCards.count();
    console.log(`[TEST] Found ${trackCount} tracks with custom prompt: "${testStyle}"`);
    expect(trackCount).toBeGreaterThan(0);

    const authCloseBtn = page.locator('#btnAuthGateClose');
    if (await authCloseBtn.isVisible()) {
      await authCloseBtn.click();
    }

    await page.click('#btnResetImage');

    const clearedPromptVal = await promptInput.inputValue();
    expect(clearedPromptVal).toBe('');

    await expect(page.locator('#uploadCard')).toBeVisible();
  });

  test('should generate playlist suggestions successfully without a custom prompt (optional validation)', async ({ page }) => {
    await page.goto('/');

    const fileInput = page.locator('#fileInput');
    await fileInput.setInputFiles(sampleImagePath);

    const generateBtn = page.locator('#btnGeneratePlaylist');
    await expect(generateBtn).toBeVisible();
    await generateBtn.click();

    await expect(page.locator('#analysisCard')).toBeVisible();
    await page.waitForSelector('#analysisLoader', { state: 'hidden', timeout: 45000 });

    const envText = await page.locator('#envContext').textContent();
    expect(envText).not.toBe('-');

    const trackCards = page.locator('#tracklistContainer .track-card');
    const trackCount = await trackCards.count();
    console.log(`[TEST] Found ${trackCount} tracks without custom prompt (pure visual mapping)`);
    expect(trackCount).toBeGreaterThan(0);
  });
});
