// Game view: renders the scene through the main Camera entity with a
// selectable aspect ratio (letterboxed), plus an optional stats overlay.

import * as THREE from 'three';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openMenu } from '../ui/menu.js';
import { tooltip } from '../ui/tooltip.js';
import { SceneBuilder } from '../viewport/scene-builder.js';
import { load, save } from '../core/storage.js';

export const ASPECTS = [
  { label: 'Free Aspect', ratio: null },
  { label: '16:9 Aspect', ratio: 16 / 9 },
  { label: '16:10 Aspect', ratio: 16 / 10 },
  { label: '4:3 Aspect', ratio: 4 / 3 },
  { label: '5:4 Aspect', ratio: 5 / 4 },
  { label: '9:16 Portrait', ratio: 9 / 16 },
  { label: 'Full HD (1920x1080)', ratio: 1920 / 1080 },
  { label: 'HD (1280x720)', ratio: 1280 / 720 },
];

export class GameView {
  constructor(editor, builder) {
    this.editor = editor;
    this.builder = builder;
    this.id = 'game';
    this.title = 'Game';
    this.icon = 'gameobject';
    this.visible = false;
    this.needsRender = true;
    this.prefs = load('gameview', { aspect: 'Free Aspect', stats: false });

    this.canvas = h('canvas.game-canvas', { tabindex: '0', 'aria-label': 'Game view' });
    this.message = h('div.viewport-message', h('div', 'Display 1'), h('div', 'No cameras rendering'));
    this.message.hidden = true;
    this.statsEl = h('div.game-stats');
    this.statsEl.hidden = true;
    this.frame = h('div.game-frame', this.canvas);
    this.viewport = h('div.viewport.game-viewport', this.frame, this.message, this.statsEl);
    this.element = h('div.panel.game-view', { dataset: { panel: 'game' } }, this.buildToolbar(), this.viewport);

    this.renderer = null;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    } catch {
      this.message.hidden = false;
      this.message.textContent = 'WebGL is not available in this browser.';
    }
    this.frames = 0;
    this.fpsTime = performance.now();
    this.fps = 0;
    new ResizeObserver(() => this.invalidate()).observe(this.viewport);
    const inv = () => this.invalidate();
    for (const ev of ['load', 'structure', 'change', 'settings']) editor.scene.on(ev, inv);
    this.applyPrefs();
  }

  invalidate() {
    this.needsRender = true;
  }

  onShow() {
    this.visible = true;
    this.invalidate();
  }

  onHide() {
    this.visible = false;
  }

  get aspectRatio() {
    return ASPECTS.find((a) => a.label === this.prefs.aspect)?.ratio ?? null;
  }

  buildToolbar() {
    const display = h('button.tb-btn.dropdown', { type: 'button' }, 'Display 1');
    tooltip(display, 'Target display');
    display.addEventListener('click', () => openMenu([{ label: 'Display 1', checked: true }], { anchor: display }));

    this.aspectBtn = h('button.tb-btn.dropdown', { type: 'button' }, h('span.aspect-label'));
    tooltip(this.aspectBtn, 'Aspect ratio');
    this.aspectBtn.addEventListener('click', () =>
      openMenu(
        ASPECTS.map((a) => ({ label: a.label, checked: a.label === this.prefs.aspect, action: () => this.setPref('aspect', a.label) })),
        { anchor: this.aspectBtn, minWidth: 180 },
      ),
    );

    this.statsBtn = h('button.tb-btn', { type: 'button' }, icon('stats'), 'Stats');
    tooltip(this.statsBtn, 'Show rendering statistics');
    this.statsBtn.addEventListener('click', () => this.setPref('stats', !this.prefs.stats));

    return h('div.panel-toolbar', display, this.aspectBtn, h('div.spacer'), this.statsBtn);
  }

  setPref(key, value) {
    this.prefs[key] = value;
    save('gameview', this.prefs);
    this.applyPrefs();
  }

  applyPrefs() {
    this.aspectBtn.querySelector('.aspect-label').textContent = this.prefs.aspect;
    this.statsBtn.setAttribute('aria-pressed', String(this.prefs.stats));
    this.statsEl.hidden = !this.prefs.stats;
    this.invalidate();
  }

  /** Size the canvas inside the viewport respecting the chosen aspect. */
  layout() {
    const vw = Math.max(1, this.viewport.clientWidth);
    const vh = Math.max(1, this.viewport.clientHeight);
    const ratio = this.aspectRatio;
    let w = vw;
    let hgt = vh;
    if (ratio) {
      if (vw / vh > ratio) w = Math.round(vh * ratio);
      else hgt = Math.round(vw / ratio);
    }
    this.frame.style.width = `${w}px`;
    this.frame.style.height = `${hgt}px`;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== hgt) this.renderer.setSize(w, hgt, false);
    return { w, h: hgt };
  }

  render() {
    if (!this.renderer || !this.visible) return;
    this.needsRender = false;
    const { w, h: hgt } = this.layout();
    const main = this.builder.mainCamera();
    this.message.hidden = !!main;
    if (!main) {
      this.renderer.setClearColor(0x000000, 1);
      this.renderer.clear();
      return;
    }
    const camera = main.camera;
    SceneBuilder.fitCamera(camera, w / hgt);
    const scene = this.builder.scene;
    const bg = scene.background;
    scene.background = new THREE.Color(camera.userData.settings.clearColor);
    this.renderer.render(scene, camera);
    scene.background = bg;
    this.updateStats(w, hgt);
  }

  updateStats(w, hgt) {
    this.frames++;
    const now = performance.now();
    if (now - this.fpsTime > 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsTime));
      this.frames = 0;
      this.fpsTime = now;
    }
    if (!this.prefs.stats) return;
    const info = this.renderer.info.render;
    this.statsEl.textContent = [
      `FPS: ${this.editor.isPlaying ? this.fps : '-'}`,
      `Resolution: ${w}x${hgt}`,
      `Draw calls: ${info.calls}`,
      `Triangles: ${info.triangles.toLocaleString()}`,
      `Objects: ${this.editor.scene.entities.size}`,
    ].join('\n');
  }
}
