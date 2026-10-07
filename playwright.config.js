// Browser tests for Vox Studio. `npm run test:e2e` runs the functional and
// layout tests; `npm run test:visual` compares screenshots with the
// committed baselines in e2e/visual.spec.js-snapshots.
import { defineConfig } from '@playwright/test';

const port = Number(process.env.VOX_E2E_PORT || 8797);

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    launchOptions: {
      // Software WebGL so viewports render on machines without a GPU.
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' },
  },
  webServer: {
    command: 'node e2e/serve.js',
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
  projects: [
    { name: 'e2e', testIgnore: /visual\.spec\.js/ },
    { name: 'visual', testMatch: /visual\.spec\.js/ },
  ],
});
