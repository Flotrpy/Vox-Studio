import { E2E_TOKEN } from './token.js';

/** Open the studio paired with the test agent, with clean browser storage. */
export async function openStudio(page, { width = 1366, height = 768, theme } = {}) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(({ theme }) => {
    if (!sessionStorage.getItem('vox:e2e-init')) {
      localStorage.clear();
      if (theme) localStorage.setItem('vox:prefs', JSON.stringify({ theme }));
      sessionStorage.setItem('vox:e2e-init', '1');
    }
  }, { theme });
  await page.goto(`/#token=${E2E_TOKEN}`);
  await page.waitForFunction(() => window.voxStudio?.agent?.status === 'connected');
  await page.waitForFunction(() => window.voxStudio.editor.log.entries.some((e) => /Opened|ready/.test(e.message)));
}

/** Run code against the studio's editor object in the page. */
export function studio(page, fn, arg) {
  return page.evaluate(fn, arg);
}

/** Screen position of a world point in the Scene view. */
export function worldToScreen(page, point) {
  return page.evaluate((p) => {
    const v = window.voxStudio.panels.scene;
    const vec = v.gizmo.root.position.clone().set(p[0], p[1], p[2]).project(v.controls.camera);
    const r = v.canvas.getBoundingClientRect();
    return { x: r.left + ((vec.x + 1) / 2) * r.width, y: r.top + ((1 - vec.y) / 2) * r.height };
  }, point);
}
