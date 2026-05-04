/**
 * Frontend E2E Tests using Playwright
 * Tests the ai-musicplayer web application
 */

const { test, expect } = require('@playwright/test');

test.describe('Home Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    // Wait for Vue app to mount
    await page.waitForTimeout(2000);
  });

  test('app container exists', async ({ page }) => {
    // The #app element should exist (may be hidden behind login)
    const app = page.locator('#app');
    await expect(app).toHaveCount(1);
  });

  test('login page is accessible', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    
    // Check login form exists or we're redirected to login
    const loginArea = page.locator('.login, form, input[type="text"], input[type="email"]');
    await expect(loginArea.first()).toBeVisible({ timeout: 10000 });
  });

  test('settings page loads without error', async ({ page }) => {
    const response = await page.goto('/settings', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    
    // Check page loaded (not 404)
    expect(response.status()).toBeLessThan(400);
    
    // Check page content exists
    const html = await page.content();
    expect(html.length).toBeGreaterThan(100);
  });
});

test.describe('Login Flow', () => {
  test('login page has phone/email input', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    
    // Look for login inputs
    const inputs = page.locator('input');
    await expect(inputs.first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Navigation', () => {
  test('main routes are accessible', async ({ page }) => {
    const routes = ['/', '/login', '/settings'];
    
    for (const route of routes) {
      const response = await page.goto(route, { waitUntil: 'networkidle' });
      // Should not return 404
      expect(response.status()).toBeLessThan(400);
      await page.waitForTimeout(500);
    }
  });
});
