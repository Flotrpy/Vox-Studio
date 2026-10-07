// Layout metrics for the default window arrangement. These encode the
// reference proportions and control sizes the editor is designed to (see
// docs/UI_REFERENCE.md) and run at the two required screen sizes.
import { test, expect } from '@playwright/test';
import { openStudio } from './helpers.js';

const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
];

async function box(page, selector) {
  const b = await page.locator(selector).first().boundingBox();
  expect(b, selector).not.toBeNull();
  return b;
}

for (const size of SIZES) {
  test.describe(`${size.width}x${size.height}`, () => {
    test.beforeEach(async ({ page }) => {
      await openStudio(page, size);
    });

    test('page body never scrolls', async ({ page }) => {
      const dims = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        sh: document.documentElement.scrollHeight,
        w: innerWidth,
        h: innerHeight,
      }));
      expect(dims.sw).toBeLessThanOrEqual(dims.w);
      expect(dims.sh).toBeLessThanOrEqual(dims.h);
    });

    test('frame bars have the reference heights', async ({ page }) => {
      expect((await box(page, '#menubar')).height).toBe(22);
      expect((await box(page, '#toolbar')).height).toBe(32);
      expect((await box(page, '#statusbar')).height).toBe(20);
      expect((await box(page, '.dock-tabbar')).height).toBe(20);
      expect((await box(page, '.hierarchy .panel-toolbar')).height).toBe(21);
    });

    test('rows and fields are dense', async ({ page }) => {
      await page.evaluate(() => window.voxStudio.editor.selection.select(window.voxStudio.editor.scene.roots[0]));
      expect((await box(page, '.hierarchy .tree-row[data-id]')).height).toBe(18);
      const field = await box(page, '.inspector .field-row');
      expect(field.height).toBeGreaterThanOrEqual(18);
      expect(field.height).toBeLessThanOrEqual(20);
      expect((await box(page, '.inspector .input.number')).height).toBe(18);
      expect((await box(page, '.component-header')).height).toBe(22);
    });

    test('panels sit in the default dock arrangement', async ({ page }) => {
      const hierarchy = await box(page, '.panel.hierarchy');
      const scene = await box(page, '.panel.scene-view');
      const inspector = await box(page, '.panel.inspector');
      const project = await box(page, '.panel.project');
      // Hierarchy | Scene side by side, Inspector on the right at full height,
      // Project/Console below Hierarchy and Scene.
      expect(hierarchy.x + hierarchy.width).toBeLessThanOrEqual(scene.x);
      expect(scene.x + scene.width).toBeLessThanOrEqual(inspector.x);
      expect(project.y).toBeGreaterThanOrEqual(scene.y + scene.height);
      expect(Math.abs(inspector.y - hierarchy.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(inspector.y + inspector.height - (project.y + project.height))).toBeLessThanOrEqual(1);
      // Proportions of the default layout.
      const w = size.width;
      expect(inspector.width / w).toBeGreaterThan(0.17);
      expect(inspector.width / w).toBeLessThan(0.27);
      expect(hierarchy.width / w).toBeGreaterThan(0.12);
      expect(hierarchy.width / w).toBeLessThan(0.22);
      const dockHeight = project.y + project.height - hierarchy.y;
      expect(project.height / dockHeight).toBeGreaterThan(0.25);
      expect(project.height / dockHeight).toBeLessThan(0.4);
    });

    test('toolbar groups are left, center and right', async ({ page }) => {
      const tools = await box(page, '.main-toolbar .left');
      const play = await box(page, '.main-toolbar .center');
      const right = await box(page, '.main-toolbar .right');
      expect(tools.x).toBeLessThan(20);
      expect(Math.abs(play.x + play.width / 2 - size.width / 2)).toBeLessThan(4);
      expect(right.x + right.width).toBeGreaterThan(size.width - 20);
    });
  });
}
