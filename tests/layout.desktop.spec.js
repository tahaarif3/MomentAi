import { test, expect } from '@playwright/test';

test.describe('Home screen layout (v2)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('home hero capture card and moments section render', async ({ page }) => {
    await page.goto('/');

    const home = page.locator('#screenHome.screen--active');
    const hero = page.locator('#captureHeroCard');
    const moments = page.locator('.moments-section');
    const header = page.locator('.app-header');

    await expect(home).toBeVisible();
    await expect(hero).toBeVisible();
    await expect(moments).toBeVisible();
    await expect(page.locator('#btnHomeCapture')).toBeVisible();
    await expect(page.locator('.floating-shutter')).toBeVisible();

    const headerBox = await header.boundingBox();
    const heroBox = await hero.boundingBox();
    expect(headerBox.height).toBeGreaterThanOrEqual(60);
    expect(heroBox.width).toBeGreaterThan(400);
    expect(heroBox.y).toBeGreaterThan(headerBox.y);
  });

  test('header stays on one row with user panel on the right', async ({ page }) => {
    await page.goto('/');

    const logo = page.locator('.logo h1');
    const userPanel = page.locator('#userPanel');

    await expect(logo).toBeVisible();
    const logoBox = await logo.boundingBox();
    const userBox = await userPanel.boundingBox();
    expect(userBox.x).toBeGreaterThan(logoBox.x);
  });
});
