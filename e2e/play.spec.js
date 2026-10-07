import { test, expect } from '@playwright/test';
import { openStudio, studio } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await openStudio(page);
  await studio(page, () => window.voxStudio.editor.newScene('Play'));
});

async function fallingCube(page, code) {
  return studio(page, async (code) => {
    const { createComponent } = await import('/shared/scene-format.js');
    const e = window.voxStudio.editor;
    e.createObject('Plane');
    const cube = e.createObject('Cube');
    e.scene.setField(cube, ['transform', 'position'], [0, 3, 0]);
    const comps = structuredClone(e.scene.get(cube).components);
    comps.push(createComponent('Rigidbody'));
    if (code) comps.push(createComponent('Script', { name: 'Probe', code }));
    e.setField(cube, ['components'], comps);
    return cube;
  }, code);
}

test('Play simulates physics and Stop restores the scene', async ({ page }) => {
  const id = await fallingCube(page);
  await page.keyboard.press('Control+p');
  await expect(page.locator('body')).toHaveClass(/playing/);
  await page.waitForFunction((id) => window.voxStudio.editor.scene.get(id).transform.position[1] < 0.6, id);
  await page.click('.main-toolbar .center .tool >> nth=0');
  await expect(page.locator('body')).not.toHaveClass(/playing/);
  expect(await studio(page, (id) => window.voxStudio.editor.scene.get(id).transform.position[1], id)).toBe(3);
});

test('scripts log to the Console and errors are reported', async ({ page }) => {
  await fallingCube(page, 'function start() { Debug.log("probe started"); }\nfunction update() { if (Time.frameCount === 3) nothing.here(); }');
  await page.keyboard.press('Control+p');
  await page.waitForFunction(() => window.voxStudio.editor.log.entries.some((e) => e.type === 'error'));
  const messages = await studio(page, () => window.voxStudio.editor.log.entries.map((e) => `${e.type}:${e.message}`));
  expect(messages).toContain('info:probe started');
  expect(messages.find((m) => m.startsWith('error:'))).toContain('Probe: nothing is not defined');
  await page.keyboard.press('Control+p');
});

test('edits made during Play are discarded', async ({ page }) => {
  const id = await fallingCube(page);
  await page.keyboard.press('Control+p');
  await studio(page, (id) => window.voxStudio.editor.rename(id, 'Changed In Play'), id);
  await page.keyboard.press('Control+p');
  expect(await studio(page, (id) => window.voxStudio.editor.scene.get(id).name, id)).toBe('Cube');
});

test('Build And Run opens the exported game', async ({ page, context }) => {
  await fallingCube(page, 'function start() { Debug.log("build ok"); }');
  const popupPromise = context.waitForEvent('page');
  await page.keyboard.press('Control+b');
  const popup = await popupPromise;
  const logged = new Promise((resolve) => popup.on('console', (m) => m.text().includes('build ok') && resolve(true)));
  await popup.waitForURL(/\/play\//);
  expect(popup.url()).toMatch(/\/play\/[A-Za-z0-9_-]{32}$/);
  expect(await logged).toBe(true);
});

test('a Mesh Collider holds up falling objects in Play', async ({ page }) => {
  const ids = await studio(page, async () => {
    const { createComponent } = await import('/shared/scene-format.js');
    const e = window.voxStudio.editor;
    // A tilted Plane whose only collider is a Mesh Collider.
    const ramp = e.createObject('Plane');
    e.scene.setField(ramp, ['transform', 'rotation'], [0, 0, -20]);
    const rampComps = e.scene.get(ramp).components.filter((c) => c.type !== 'BoxCollider');
    rampComps.push(createComponent('MeshCollider'));
    e.setField(ramp, ['components'], rampComps);
    const ball = e.createObject('Sphere');
    e.scene.setField(ball, ['transform', 'position'], [-2, 2, 0]);
    const ballComps = structuredClone(e.scene.get(ball).components);
    ballComps.push(createComponent('Rigidbody', { friction: 0 }));
    e.setField(ball, ['components'], ballComps);
    return { ramp, ball };
  });
  await page.keyboard.press('Control+p');
  await expect(page.locator('body')).toHaveClass(/playing/);
  // The ball lands on the slope and slides down it instead of falling through.
  await page.waitForFunction((id) => window.voxStudio.editor.scene.get(id).transform.position[0] > 0, ids.ball);
  const [x, y] = await studio(page, (id) => window.voxStudio.editor.scene.get(id).transform.position, ids.ball);
  const surface = -Math.tan((20 * Math.PI) / 180) * x;
  expect(y).toBeGreaterThan(surface);
  expect(y - surface).toBeLessThan(0.7);
  await page.keyboard.press('Control+p');
});
