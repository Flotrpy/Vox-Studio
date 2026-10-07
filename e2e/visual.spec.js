// Screenshot baselines of the editor chrome. Viewports are masked because
// software WebGL output differs between machines. Baselines are platform
// specific; refresh them with `npx playwright test --project=visual -u`.
import { test, expect } from '@playwright/test';
import { openStudio, studio } from './helpers.js';

const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
];

async function prepare(page) {
  await studio(page, () => {
    const e = window.voxStudio.editor;
    e.newScene('Visual');
    e.log.clear();
    e.createObject('Plane');
    e.createObject('Cube');
  });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
}

const mask = (page) => [page.locator('canvas'), page.locator('.log-time'), page.locator('.agent-value')];

for (const size of SIZES) {
  for (const theme of ['Dark', 'Light']) {
    test(`default layout ${theme} ${size.width}x${size.height}`, async ({ page }) => {
      await openStudio(page, { ...size, theme });
      await prepare(page);
      await expect(page).toHaveScreenshot(`layout-${theme.toLowerCase()}-${size.width}.png`, { mask: mask(page) });
    });
  }
}

test('menus and Add Component popup', async ({ page }) => {
  await openStudio(page, SIZES[1]);
  await prepare(page);
  await page.click('.menubar-item:has-text("GameObject")');
  await page.hover('.menu-item:has-text("3D Object")');
  await page.waitForTimeout(300);
  await expect(page).toHaveScreenshot('menu-gameobject.png', { mask: mask(page) });
  await page.keyboard.press('Escape');
  await page.click('.add-component');
  await expect(page).toHaveScreenshot('add-component.png', { mask: mask(page) });
});
