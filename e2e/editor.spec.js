import { test, expect } from '@playwright/test';
import { openStudio, studio, worldToScreen } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await openStudio(page);
  await studio(page, () => window.voxStudio.editor.newScene('E2E'));
});

test('GameObject menu creates a cube that shows in the Hierarchy and Inspector', async ({ page }) => {
  await page.click('.menubar-item:has-text("GameObject")');
  await page.hover('.menu-item:has-text("3D Object")');
  await page.click('.menu-item:has-text("Cube")');
  await expect(page.locator('.hierarchy .tree-row.selected')).toHaveText('Cube');
  await expect(page.locator('.inspector .object-name')).toHaveValue('Cube');
  await expect(page.locator('.component-title', { hasText: 'Box Collider' })).toBeVisible();
});

test('dragging the move gizmo moves along X and undo restores it', async ({ page }) => {
  await studio(page, () => window.voxStudio.editor.createObject('Cube'));
  const tip = await page.evaluate(() => {
    const v = window.voxStudio.panels.scene;
    v.render();
    const p = v.gizmo.root.localToWorld(v.gizmo.root.position.clone().set(0.88, 0, 0));
    return p.toArray();
  });
  const at = await worldToScreen(page, tip);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(at.x + i * 10, at.y + i * 2);
  await page.mouse.up();
  const x = await studio(page, () => {
    const e = window.voxStudio.editor;
    return e.scene.get(e.selection.active).transform.position[0];
  });
  expect(x).toBeGreaterThan(0.2);
  await page.keyboard.press('Control+z');
  expect(await studio(page, () => {
    const e = window.voxStudio.editor;
    return e.scene.get(e.selection.active).transform.position[0];
  })).toBe(0);
});

test('dragging in the Hierarchy reparents and keeps the world position', async ({ page }) => {
  await studio(page, () => {
    const e = window.voxStudio.editor;
    const parent = e.createObject('Empty');
    e.scene.setField(parent, ['transform', 'position'], [5, 0, 0]);
    e.rename(parent, 'Holder');
    const child = e.createObject('Sphere');
    e.scene.setField(child, ['transform', 'position'], [1, 2, 3]);
  });
  await page.locator('.tree-row:has-text("Sphere")').dragTo(page.locator('.tree-row:has-text("Holder")'));
  const result = await studio(page, () => {
    const e = window.voxStudio.editor;
    const s = e.scene.findByName('Sphere');
    return { parent: e.scene.get(s.parent)?.name, local: s.transform.position };
  });
  expect(result.parent).toBe('Holder');
  expect(result.local).toEqual([-4, 2, 3]);
});

test('scrubbing a Vector3 label changes the value as one undo step', async ({ page }) => {
  await studio(page, () => window.voxStudio.editor.createObject('Cube'));
  const label = page.locator('.inspector .vector-row').first().locator('.axis-y');
  const b = await label.boundingBox();
  await page.mouse.move(b.x + 3, b.y + 5);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + 3 + i * 5, b.y + 5);
  await page.mouse.up();
  const y = await studio(page, () => {
    const e = window.voxStudio.editor;
    return e.scene.get(e.selection.active).transform.position[1];
  });
  expect(y).toBeGreaterThan(0);
  const steps = await studio(page, () => window.voxStudio.editor.history.undoStack.length);
  await page.keyboard.press('Control+z');
  expect(await studio(page, () => window.voxStudio.editor.history.undoStack.length)).toBe(steps - 1);
});

test('tabs can be docked elsewhere and the layout survives a reload', async ({ page }) => {
  const tab = await page.locator('.dock-tab:has-text("Console")').boundingBox();
  const scene = await page.locator('.scene-view').boundingBox();
  await page.mouse.move(tab.x + 20, tab.y + 8);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(tab.x + 20 + ((scene.x + scene.width - 30) - tab.x - 20) * (i / 12), tab.y + 8 + ((scene.y + scene.height / 2) - tab.y - 8) * (i / 12));
  }
  await page.mouse.up();
  await expect(page.locator('.main-toolbar .layout-label')).toHaveText('Custom');
  await page.reload();
  await page.waitForFunction(() => window.voxStudio?.dock?.layout);
  const consoleBox = await page.locator('.panel.console').boundingBox();
  const sceneBox = await page.locator('.panel.scene-view').boundingBox();
  expect(consoleBox.x).toBeGreaterThan(sceneBox.x);
  expect(consoleBox.y).toBeLessThan(sceneBox.y + sceneBox.height);
});

test('Ctrl+S on a new scene asks for a name and saves into the project', async ({ page }) => {
  await studio(page, () => window.voxStudio.editor.createObject('Cube'));
  await page.locator('.tree').click();
  await page.keyboard.press('Control+s');
  const input = page.locator('.dialog input.input');
  await expect(input).toBeVisible();
  await input.fill('Saved Level');
  await input.press('Enter');
  await page.waitForFunction(() => window.voxStudio.editor.log.entries.some((e) => e.message.startsWith('Saved ')));
  expect(await studio(page, () => window.voxStudio.editor.scene.dirty)).toBe(false);
  expect(await studio(page, () => window.voxStudio.editor.scene.path)).toBe('Assets/Scenes/Saved Level.voxscene');
});

test('Window menu closes and reopens panels', async ({ page }) => {
  await page.click('.menubar-item:has-text("Window")');
  await page.click('.menu-item:has-text("Inspector")');
  await expect(page.locator('.panel.inspector')).toHaveCount(0);
  await page.click('.menubar-item:has-text("Window")');
  await page.click('.menu-item:has-text("Inspector")');
  await expect(page.locator('.panel.inspector')).toBeVisible();
});
