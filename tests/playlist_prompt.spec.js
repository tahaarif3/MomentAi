import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Playlist_pic Custom Prompt E2E Tests', () => {
  const targetUrl = 'http://127.0.0.1:3000';
  const sampleImagePath = path.resolve('uploads/playlist-1783110237833-53601459.jpg');

  test('should generate playlist suggestions successfully using an optional custom music prompt', async ({ page }) => {
    // 1. Navigate to dashboard
    await page.goto(targetUrl);
    await expect(page).toHaveTitle(/Moment.AI/);

    // Verify custom prompt input exists
    const promptInput = page.locator('#customTextPrompt');
    await expect(promptInput).toBeVisible();

    // 2. Type custom style prompt
    const testStyle = 'dark synthwave cyber metal';
    await promptInput.fill(testStyle);

    // 3. Upload image (stages file)
    const fileInput = page.locator('#fileInput');
    await fileInput.setInputFiles(sampleImagePath);

    // Verify generate button is visible and click it
    const generateBtn = page.locator('#btnGeneratePlaylist');
    await expect(generateBtn).toBeVisible();
    await generateBtn.click();

    // 4. Wait for scanning overlay and suggestions loader to complete
    await expect(page.locator('#analysisCard')).toBeVisible();
    await page.waitForSelector('#analysisLoader', { state: 'hidden', timeout: 45000 });

    // 5. Verify visual metadata extraction outputs exist
    const colorTags = page.locator('#colorTags .tag');
    await expect(colorTags.first()).toBeVisible();
    
    const envText = await page.locator('#envContext').textContent();
    expect(envText).not.toBe('-');

    // 6. Verify tracklist contains recommendations
    const trackCards = page.locator('#tracklistContainer .track-card');
    const trackCount = await trackCards.count();
    console.log(`[TEST] Found ${trackCount} tracks with custom prompt: "${testStyle}"`);
    expect(trackCount).toBeGreaterThan(0);

    // If the auth gate modal is visible (because we are anonymous), close it first so we can click headers
    const authCloseBtn = page.locator('#btnAuthGateClose');
    if (await authCloseBtn.isVisible()) {
      await authCloseBtn.click();
    }

    // 7. Click Reset / Upload New
    await page.click('#btnResetImage');

    // 8. Assert that the custom prompt input is cleared on reset
    const clearedPromptVal = await promptInput.inputValue();
    expect(clearedPromptVal).toBe('');
    
    // Assert that the upload screen is visible again
    await expect(page.locator('#uploadCard')).toBeVisible();
  });

  test('should generate playlist suggestions successfully without a custom prompt (optional validation)', async ({ page }) => {
    // 1. Navigate to dashboard
    await page.goto(targetUrl);

    // 2. Upload image directly without filling out the custom prompt
    const fileInput = page.locator('#fileInput');
    await fileInput.setInputFiles(sampleImagePath);

    // Verify generate button is visible and click it
    const generateBtn = page.locator('#btnGeneratePlaylist');
    await expect(generateBtn).toBeVisible();
    await generateBtn.click();

    // 3. Wait for processing to complete
    await expect(page.locator('#analysisCard')).toBeVisible();
    await page.waitForSelector('#analysisLoader', { state: 'hidden', timeout: 45000 });

    // 4. Verify visual metadata outputs exist
    const envText = await page.locator('#envContext').textContent();
    expect(envText).not.toBe('-');

    // 5. Verify tracklist contains recommendations (verifying optional behavior works)
    const trackCards = page.locator('#tracklistContainer .track-card');
    const trackCount = await trackCards.count();
    console.log(`[TEST] Found ${trackCount} tracks without custom prompt (pure visual mapping)`);
    expect(trackCount).toBeGreaterThan(0);
  });
});
