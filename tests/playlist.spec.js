import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Playlist_pic Core Pipeline & Recommendation Matching', () => {

  test('should analyze a sunny beach image and return bright, chill recommendations', async ({ page }) => {
    // Navigate to the local server
    await page.goto('/');

    // Check header and initial state
    await expect(page.locator('.logo h1')).toContainText('Moment.AI');
    await expect(page.locator('.tracklist-placeholder')).toBeHidden();

    // Select and upload the sunny beach image
    const filePath = path.resolve('tests/assets/beach.png');
    await page.setInputFiles('#fileInput', filePath);

    // Click the Generate Playlist button to trigger processing
    const generateBtn = page.locator('#btnGeneratePlaylist');
    await expect(generateBtn).toBeVisible();
    await generateBtn.click();

    // Wait for the analysis to start and complete
    await expect(page.locator('#analysisLoader')).toBeVisible();
    await page.waitForSelector('#analysisLoader', { state: 'hidden', timeout: 30000 });

    // Ensure the analysis card is now visible
    await expect(page.locator('#analysisCard')).not.toHaveClass(/hidden/);

    // Extract visual analysis metadata from the page
    const envContext = await page.locator('#envContext').textContent();
    const emotionalVibe = await page.locator('#emotionalVibe').textContent();
    const valence = parseFloat(await page.locator('#valValence').textContent());
    const energy = parseFloat(await page.locator('#valEnergy').textContent());
    const acousticness = parseFloat(await page.locator('#valAcousticness').textContent());
    
    const genreTags = await page.locator('#genreTags .genre-tag').allTextContents();
    const colorTags = await page.locator('#colorTags .color-tag').allTextContents();

    console.log('\n--- SUNNY BEACH TEST RESULTS ---');
    console.log(`Environmental Context: "${envContext}"`);
    console.log(`Emotional Vibe:        "${emotionalVibe}"`);
    console.log(`Valence (Positivity):  ${valence}`);
    console.log(`Energy (Intensity):    ${energy}`);
    console.log(`Acousticness:          ${acousticness}`);
    console.log(`Dominant Colors:       [${colorTags.join(', ')}]`);
    console.log(`Seed Genres:           [${genreTags.join(', ')}]`);
    console.log('--------------------------------\n');

    // Assert that the visual metadata is aligned with a bright/chill vibe
    // 1. Valence (positivity/brightness) should be relatively high
    expect(valence).toBeGreaterThan(0.4);

    // 2. The genres should contain bright, calm, or pop/acoustic sounds
    const brightChillKeywords = ['acoustic', 'chill', 'folk', 'happy', 'pop', 'summer', 'songwriter', 'indie', 'ambient', 'road-trip', 'blues', 'classical'];
    const hasBrightGenre = genreTags.some(genre => brightChillKeywords.includes(genre.toLowerCase()));
    expect(hasBrightGenre).toBe(true);

    // 3. Environmental/emotional descriptions should describe a sunny/calm/beach atmosphere
    const textVibe = `${envContext} ${emotionalVibe}`.toLowerCase();
    const beachKeywords = ['beach', 'sun', 'ocean', 'sand', 'water', 'sky', 'calm', 'relax', 'peace', 'bright', 'tropical', 'warm', 'nature'];
    const hasBeachKeywords = beachKeywords.some(keyword => textVibe.includes(keyword));
    expect(hasBeachKeywords).toBe(true);

    // 4. Assert tracks are returned and rendered in the tracklist
    const tracklistContainer = page.locator('#tracklistContainer');
    await expect(tracklistContainer.locator('.track-card').first()).toBeVisible();
    const tracksCount = await tracklistContainer.locator('.track-card').count();
    expect(tracksCount).toBeGreaterThan(0);
    console.log(`Verified ${tracksCount} tracks were rendered for the beach scene.`);
  });

  test('should analyze a heavy metal concert image and return aggressive, high-energy recommendations', async ({ page }) => {
    // Navigate to the local server
    await page.goto('/');

    // Select and upload the heavy metal concert image
    const filePath = path.resolve('tests/assets/heavy_metal.png');
    await page.setInputFiles('#fileInput', filePath);

    // Click the Generate Playlist button to trigger processing
    const generateBtn = page.locator('#btnGeneratePlaylist');
    await expect(generateBtn).toBeVisible();
    await generateBtn.click();

    // Wait for the analysis to start and complete
    await expect(page.locator('#analysisLoader')).toBeVisible();
    await page.waitForSelector('#analysisLoader', { state: 'hidden', timeout: 30000 });

    // Ensure the analysis card is now visible
    await expect(page.locator('#analysisCard')).not.toHaveClass(/hidden/);

    // Extract visual analysis metadata from the page
    const envContext = await page.locator('#envContext').textContent();
    const emotionalVibe = await page.locator('#emotionalVibe').textContent();
    const valence = parseFloat(await page.locator('#valValence').textContent());
    const energy = parseFloat(await page.locator('#valEnergy').textContent());
    const acousticness = parseFloat(await page.locator('#valAcousticness').textContent());
    
    const genreTags = await page.locator('#genreTags .genre-tag').allTextContents();
    const colorTags = await page.locator('#colorTags .color-tag').allTextContents();

    console.log('\n--- HEAVY METAL CONCERT TEST RESULTS ---');
    console.log(`Environmental Context: "${envContext}"`);
    console.log(`Emotional Vibe:        "${emotionalVibe}"`);
    console.log(`Valence (Positivity):  ${valence}`);
    console.log(`Energy (Intensity):    ${energy}`);
    console.log(`Acousticness:          ${acousticness}`);
    console.log(`Dominant Colors:       [${colorTags.join(', ')}]`);
    console.log(`Seed Genres:           [${genreTags.join(', ')}]`);
    console.log('----------------------------------------\n');

    // Assert that the visual metadata is aligned with a dark/energetic metal vibe
    // 1. Energy (intensity/activity) should be high
    expect(energy).toBeGreaterThan(0.55);

    // 2. The genres should contain heavy, rock, metal, or electronic/cyberpunk sounds
    const intenseMetalKeywords = ['heavy-metal', 'metal', 'hard-rock', 'grunge', 'rock', 'punk', 'industrial', 'goth', 'electro', 'techno', 'alt-rock', 'progressive-house'];
    const hasIntenseGenre = genreTags.some(genre => intenseMetalKeywords.includes(genre.toLowerCase()));
    expect(hasIntenseGenre).toBe(true);

    // 3. Environmental/emotional descriptions should describe a concert/stage/dark/intense atmosphere
    const textVibe = `${envContext} ${emotionalVibe}`.toLowerCase();
    const metalKeywords = ['concert', 'stage', 'dark', 'crowd', 'crowds', 'show', 'intense', 'energy', 'energetic', 'night', 'red', 'purple', 'neon', 'performance', 'heavy', 'laser', 'lights'];
    const hasMetalKeywords = metalKeywords.some(keyword => textVibe.includes(keyword));
    expect(hasMetalKeywords).toBe(true);

    // 4. Assert tracks are returned and rendered in the tracklist
    const tracklistContainer = page.locator('#tracklistContainer');
    await expect(tracklistContainer.locator('.track-card').first()).toBeVisible();
    const tracksCount = await tracklistContainer.locator('.track-card').count();
    expect(tracksCount).toBeGreaterThan(0);
    console.log(`Verified ${tracksCount} tracks were rendered for the heavy metal concert.`);
  });

});
