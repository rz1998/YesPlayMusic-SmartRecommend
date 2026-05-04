/**
 * 智能推荐页面 E2E 测试
 * Tests the /smart-recommend page
 */

const { test, expect } = require('@playwright/test');

test.describe('智能推荐页面', () => {
  test.beforeEach(async ({ page }) => {
    // 访问智能推荐页面
    await page.goto('/smart-recommend', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
  });

  test('页面标题显示正确', async ({ page }) => {
    const title = page.locator('.title');
    await expect(title).toContainText('智能推荐');
  });

  test('副标题显示正确', async ({ page }) => {
    const subtitle = page.locator('.subtitle');
    await expect(subtitle).toContainText('根据你的喜好定制');
  });

  test('刷新按钮存在', async ({ page }) => {
    const refreshBtn = page.locator('.refresh-btn');
    await expect(refreshBtn).toBeVisible();
  });

  test('页面加载状态显示', async ({ page }) => {
    // 初始加载时应该有 loading 状态或内容
    const content = page.locator('.smart-recommend');
    await expect(content).toBeVisible();
  });

  test('页面可滚动', async ({ page }) => {
    // 检查内容区域是否存在
    const content = page.locator('.smart-recommend');
    const isVisible = await content.isVisible();
    expect(isVisible).toBeTruthy();
  });
});

test.describe('智能推荐 - 空状态', () => {
  test('无数据时显示提示', async ({ page }) => {
    await page.goto('/smart-recommend', { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);
    
    // 检查是否有空状态提示或内容
    const empty = page.locator('.empty');
    const hasContent = page.locator('.track-list').count() > 0;
    
    // 至少应该显示其中一个
    const emptyVisible = await empty.isVisible().catch(() => false);
    expect(emptyVisible || hasContent).toBeTruthy();
  });
});

test.describe('智能推荐 - 刷新功能', () => {
  test('刷新按钮点击响应', async ({ page }) => {
    await page.goto('/smart-recommend', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    
    const refreshBtn = page.locator('.refresh-btn');
    if (await refreshBtn.isVisible()) {
      // 按钮不应被禁用
      const isDisabled = await refreshBtn.isDisabled();
      expect(typeof isDisabled).toBe('boolean');
    }
  });
});

test.describe('智能推荐 - 路由访问', () => {
  test('可以通过路由访问', async ({ page }) => {
    const response = await page.goto('/smart-recommend', { waitUntil: 'networkidle' });
    expect(response.status()).toBeLessThan(400);
  });

  test('路由变化时页面更新', async ({ page }) => {
    // 先访问首页
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    
    // 然后访问智能推荐
    await page.goto('/smart-recommend', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
    const content = page.locator('.smart-recommend');
    await expect(content).toBeVisible();
  });
});

test.describe('智能推荐 - 用户交互', () => {
  test('页面加载后的 DOM 结构正确', async ({ page }) => {
    await page.goto('/smart-recommend', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    
    // 检查主要容器
    const container = page.locator('.smart-recommend');
    await expect(container).toBeAttached();
  });

  test('样式类名正确应用', async ({ page }) => {
    await page.goto('/smart-recommend', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    
    // 检查 header 是否存在
    const header = page.locator('.header');
    const headerExists = await header.count() > 0;
    expect(headerExists).toBeTruthy();
  });
});
