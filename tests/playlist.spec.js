import { test, expect } from '@playwright/test';
import path from 'path';

async function goToCaptureAndUpload(page, filePath) {
  await page.goto('/');
  await page.locator('#btnHomeCapture').click();
  await expect(page.locator('#screenCapture.screen--active')).toBeVisible();
  await page.setInputFiles('#fileInput', filePath);
  await expect(page.locator('#btnGeneratePlaylist')).toBeVisible();
  await page.locator('#btnGeneratePlaylist').click();
  await expect(page.locator('#screenPlaylist.screen--active')).toBeVisible({ timeout: 45000 });
  await expect(page.locator('#tracklistContainer .track-card').first()).toBeVisible({ timeout: 10000 });
}

test.describe('Playlist_pic Core Pipeline & Recommendation Matching', () => {

  test('should analyze a sunny beach image and return bright, chill recommendations', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.logo h1')).toContainText('MomentAI');

    const filePath = path.resolve('tests/assets/beach.png');
    await goToCaptureAndUpload(page, filePath);

    await expect(page.locator('#analysisCard')).not.toHaveClass(/hidden/);

    const envContext = await page.locator('#envContext').textContent();
    const emotionalVibe = await page.locator('#emotionalVibe').textContent();
    const valence = parseFloat(await page.locator('#valValence').textContent());
    const energy = parseFloat(await page.locator('#valEnergy').textContent());
    const acousticness = parseFloat(await page.locator('#valAcousticness').textContent());
    
    const genreTags = await page.locator('#genreTags .genre-tag').allTextContents();
    const colorTags = await page.locator('#colorTags .color-tag').allTextContents();

    expect(valence).toBeGreaterThan(0.4);

    const brightChillKeywords = ['acoustic', 'chill', 'folk', 'happy', 'pop', 'summer', 'songwriter', 'indie', 'ambient', 'road-trip', 'blues', 'classical'];
    const hasBrightGenre = genreTags.some(genre => brightChillKeywords.includes(genre.toLowerCase()));
    expect(hasBrightGenre).toBe(true);

    const textVibe = `${envContext} ${emotionalVibe}`.toLowerCase();
    const beachKeywords = ['beach', 'sun', 'ocean', 'sand', 'water', 'sky', 'calm', 'relax', 'peace', 'bright', 'tropical', 'warm', 'nature'];
    const hasBeachKeywords = beachKeywords.some(keyword => textVibe.includes(keyword));
    expect(hasBeachKeywords).toBe(true);

    const tracklistContainer = page.locator('#tracklistContainer');
    await expect(tracklistContainer.locator('.track-card').first()).toBeVisible();
    expect(await tracklistContainer.locator('.track-card').count()).toBeGreaterThan(0);
  });

  test('should analyze a heavy metal concert image and return aggressive, high-energy recommendations', async ({ page }) => {
    const filePath = path.resolve('tests/assets/heavy_metal.png');
    await goToCaptureAndUpload(page, filePath);

    await expect(page.locator('#analysisCard')).not.toHaveClass(/hidden/);

    const envContext = await page.locator('#envContext').textContent();
    const emotionalVibe = await page.locator('#emotionalVibe').textContent();
    const valence = parseFloat(await page.locator('#valValence').textContent());
    const energy = parseFloat(await page.locator('#valEnergy').textContent());
    const genreTags = await page.locator('#genreTags .genre-tag').allTextContents();
    const textVibe = `${envContext} ${emotionalVibe}`.toLowerCase();

    expect(energy).toBeGreaterThan(0.55);

    const intenseMetalKeywords = ['heavy-metal', 'metal', 'hard-rock', 'grunge', 'rock', 'punk', 'industrial', 'goth', 'electro', 'techno', 'alt-rock', 'progressive-house', 'electronic', 'synth-pop'];
    expect(genreTags.some(genre => intenseMetalKeywords.includes(genre.toLowerCase()))).toBe(true);

    const metalKeywords = ['concert', 'stage', 'dark', 'crowd', 'show', 'intense', 'energy', 'energetic', 'night', 'neon', 'performance', 'heavy', 'laser', 'lights', 'cyber', 'futuristic', 'dance', 'gradient', 'electronic', 'movement'];
    expect(metalKeywords.some(keyword => textVibe.includes(keyword))).toBe(true);

    const tracklistContainer = page.locator('#tracklistContainer');
    await expect(tracklistContainer.locator('.track-card').first()).toBeVisible();
    expect(await tracklistContainer.locator('.track-card').count()).toBeGreaterThan(0);
  });

});
