import { test, expect } from '@playwright/test';

test.describe('Desktop landing layout', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('landing hero and drop zone align in a full-width card', async ({ page }) => {
    await page.goto('/');

    const grid = page.locator('.dashboard-grid.landing-state');
    const landingStack = page.locator('#landingStack');
    const landingLayout = page.locator('.landing-layout');
    const hero = page.locator('.landing-hero');
    const dropCard = page.locator('.landing-drop-card');
    const prompt = page.locator('.custom-prompt-container');
    const steps = page.locator('.steps-grid');

    await expect(grid).toBeVisible();
    await expect(landingStack).toBeVisible();
    await expect(landingLayout).toBeVisible();

    const stackBox = await landingStack.boundingBox();
    const layoutBox = await landingLayout.boundingBox();
    const heroCard = page.locator('.landing-hero-card');
    const uploadCard = page.locator('.landing-upload-card');

    await expect(heroCard).toBeVisible();
    await expect(uploadCard).toBeVisible();

    const heroCardBox = await heroCard.boundingBox();
    const uploadCardBox = await uploadCard.boundingBox();
    const heroBox = await hero.boundingBox();
    const dropBox = await dropCard.boundingBox();
    const promptBox = await prompt.boundingBox();
    const stepsBox = await steps.boundingBox();

    expect(stackBox.width).toBeGreaterThan(900);
    expect(layoutBox.width).toBeGreaterThan(stackBox.width * 0.85);

    expect(heroCardBox.y).toBeCloseTo(uploadCardBox.y, 0);
    expect(heroCardBox.x).toBeLessThan(uploadCardBox.x);
    expect(heroBox.y).toBeCloseTo(dropBox.y, 0);
    expect(heroBox.x).toBeLessThan(dropBox.x);
    expect(dropBox.x + dropBox.width).toBeLessThanOrEqual(layoutBox.x + layoutBox.width + 2);

    expect(promptBox.x).toBeGreaterThanOrEqual(dropBox.x - 2);
    expect(promptBox.x + promptBox.width).toBeLessThanOrEqual(dropBox.x + dropBox.width + 2);

    expect(stepsBox.width).toBeGreaterThan(stackBox.width * 0.9);
    expect(stepsBox.y).toBeGreaterThan(layoutBox.y + layoutBox.height + 12);
  });

  test('header items stay on one row with user panel on the right', async ({ page }) => {
    await page.goto('/');

    const header = page.locator('.app-header');
    const logo = page.locator('.logo h1');
    const nav = page.locator('.header-nav');
    const userPanel = page.locator('#userPanel');

    await expect(logo).toBeVisible();
    await expect(nav).toBeVisible();

    const headerBox = await header.boundingBox();
    const logoBox = await logo.boundingBox();
    const navBox = await nav.boundingBox();
    const userBox = await userPanel.boundingBox();

    const logoCenterY = logoBox.y + logoBox.height / 2;
    const navCenterY = navBox.y + navBox.height / 2;
    expect(logoCenterY).toBeCloseTo(navCenterY, 0);
    expect(userBox.x + userBox.width).toBeLessThanOrEqual(headerBox.x + headerBox.width + 2);
    expect(userBox.x).toBeGreaterThan(navBox.x + navBox.width);
  });
});
