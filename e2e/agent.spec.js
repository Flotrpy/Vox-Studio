import { test, expect } from '@playwright/test';
import { openStudio, studio } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await openStudio(page);
});

test('files written on disk show up in the Project panel without refresh', async ({ page }) => {
  await studio(page, () => window.voxStudio.panels.project.openFolder('Assets/Scenes'));
  const name = `Disk${Date.now()}`;
  await studio(page, (name) => window.voxStudio.agent.post('/api/scene', {
    path: `Assets/Scenes/${name}.voxscene`,
    scene: { format: 'voxscene', version: 1, name, entities: [] },
  }), name);
  await expect(page.locator('.asset-name', { hasText: name })).toBeVisible({ timeout: 5000 });
});

test('large imports upload in chunks and report progress', async ({ page }) => {
  const result = await studio(page, async () => {
    const lines = [];
    for (let i = 0; i < 120000; i++) lines.push(`v ${i} 0 0`, `v ${i} 1 0`, `v ${i} 0 1`);
    for (let i = 0; i < 120000; i++) lines.push(`f ${i * 3 + 1} ${i * 3 + 2} ${i * 3 + 3}`);
    const bytes = new TextEncoder().encode(lines.join('\n'));
    const seen = [];
    const task = { update: (p, m) => seen.push(m), onCancel: null };
    const res = await window.voxStudio.editor.project.importBytes('huge.obj', 'obj', bytes, task);
    return { size: bytes.byteLength, messages: [...new Set(seen)], tris: res.meshes[0].mesh.indices.length / 3 };
  });
  expect(result.size).toBeGreaterThan(3 * 1024 * 1024);
  expect(result.messages).toContain('Uploading');
  expect(result.tris).toBe(120000);
});

test('a large import can be cancelled while it is still uploading', async ({ page }) => {
  const result = await studio(page, async () => {
    const bytes = new Uint8Array(12 * 1024 * 1024).fill(32);
    const task = {
      update: (p, m) => {
        if (m === 'Uploading') task.onCancel?.();
      },
      onCancel: null,
    };
    try {
      await window.voxStudio.editor.project.importBytes('cancel.obj', 'obj', bytes, task);
      return 'finished';
    } catch (err) {
      return err.status;
    }
  });
  expect(result).toBe(499);
  // The agent dropped the upload, so all upload slots are free again.
  const ids = await studio(page, async () => {
    const out = [];
    for (let i = 0; i < 8; i++) out.push((await window.voxStudio.agent.post('/api/uploads/start', { size: 1 })).uploadId);
    for (const id of out) await window.voxStudio.agent.post('/api/uploads/cancel', { id });
    return out.length;
  });
  expect(ids).toBe(8);
});

test('benchmarks run as jobs and can be cancelled from the status bar', async ({ page }) => {
  await page.evaluate(() => window.voxStudio.dock.openPanel('agent'));
  await page.click('.tb-btn:has-text("CPU Benchmark")');
  await expect(page.locator('.statusbar .task')).toBeVisible();
  await page.click('.statusbar .task-cancel');
  await page.waitForFunction(() => window.voxStudio.editor.log.entries.some((e) => e.message === 'Benchmark cancelled'));
  await expect(page.locator('.statusbar .task')).toBeHidden();
});

test('projects can be created and switched from the File menu', async ({ page }) => {
  await page.click('.menubar-item:has-text("File")');
  await page.click('.menu-item:has-text("New Project...")');
  const name = `Game ${Date.now() % 100000}`;
  await page.locator('.dialog input.input').fill(name);
  await page.click('.dialog .btn:has-text("Create")');
  await page.waitForFunction((name) => window.voxStudio.agent.info?.project === name, name);
  await expect(page.locator('.agent-status')).toHaveClass(/connected/);
});

test('a project switch in another tab keeps unsaved edits here', async ({ page, context }) => {
  const other = await context.newPage();
  await openStudio(other);
  await studio(page, () => window.voxStudio.editor.scene.createEntity({ name: 'Unsaved Work' }));
  const name = `Other ${Date.now() % 100000}`;
  await studio(other, (name) => window.voxStudio.projects.create(name), name);
  await page.waitForFunction((name) => window.voxStudio.agent.info?.project === name, name);
  await page.waitForFunction((name) => window.voxStudio.editor.log.entries.some((e) => e.message.includes(`Another tab opened project ${name}.`)), name);
  const state = await studio(page, () => {
    const { scene } = window.voxStudio.editor;
    return { dirty: scene.dirty, path: scene.path, kept: scene.toData().entities.some((e) => e.name === 'Unsaved Work') };
  });
  expect(state).toEqual({ dirty: true, path: null, kept: true });
  await other.close();
});

/** Drop project events in a tab, as if its event stream were down. */
function dropProjectEvents(page) {
  return studio(page, () => {
    const agent = window.voxStudio.agent;
    const emit = agent.emit.bind(agent);
    agent.emit = (name, payload) => (name === 'event' && payload?.type === 'project' ? undefined : emit(name, payload));
  });
}

const warned = (page, name) =>
  page.waitForFunction((name) => window.voxStudio.editor.log.entries.some((e) => e.message.includes(`Another tab opened project ${name}.`)), name);

test('a tab that missed the switch event cannot save into the new project', async ({ page, context }) => {
  const other = await context.newPage();
  await openStudio(other);
  await dropProjectEvents(page);
  await studio(page, () => window.voxStudio.editor.scene.createEntity({ name: 'Stale Edit' }));
  const name = `Missed ${Date.now() % 100000}`;
  await studio(other, (name) => window.voxStudio.projects.create(name), name);
  expect(await studio(page, () => window.voxStudio.files.save())).toBe(false);
  await warned(page, name);
  expect(await studio(page, () => window.voxStudio.editor.scene.path)).toBeNull();
  const scene = await studio(other, () => window.voxStudio.editor.project.readScene('Assets/Scenes/Main.voxscene').catch(() => null));
  expect(scene?.entities.some((e) => e.name === 'Stale Edit') ?? false).toBe(false);
  await other.close();
});

test('a health poll alone does not move a tab onto the new project', async ({ page, context }) => {
  const other = await context.newPage();
  await openStudio(other);
  await dropProjectEvents(page);
  await studio(page, () => window.voxStudio.editor.scene.createEntity({ name: 'Polled Edit' }));
  const name = `Polled ${Date.now() % 100000}`;
  await studio(other, (name) => window.voxStudio.projects.create(name), name);
  // The regular health poll notices the switch and follows it properly.
  await studio(page, () => window.voxStudio.agent.ping());
  await warned(page, name);
  const state = await studio(page, () => ({ dirty: window.voxStudio.editor.scene.dirty, path: window.voxStudio.editor.scene.path }));
  expect(state).toEqual({ dirty: true, path: null });
  await other.close();
});
