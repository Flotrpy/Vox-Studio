// Standalone player used by exported builds (play.html). Builds the scene
// with the same SceneBuilder and PlayRuntime as the editor and renders
// through the main camera at full window size.

import * as THREE from 'three';
import { SceneBuilder } from 'vox/viewport/scene-builder.js';
import { PlayRuntime } from 'vox/play/runtime.js';
import { Input } from 'vox/play/scripting.js';

/** Turn a scene document into the { entities, roots, settings, assets } shape. */
export function indexScene(data) {
  const entities = new Map();
  const roots = [];
  for (const e of data.entities) entities.set(e.id, { ...structuredClone(e), children: [] });
  for (const e of data.entities) {
    if (e.parent === null || !entities.has(e.parent)) roots.push(e.id);
    else entities.get(e.parent).children.push(e.id);
  }
  return { name: data.name, entities, roots, settings: data.settings, assets: data.assets || {} };
}

export function startPlayer({ data, canvas, overlay }) {
  const source = indexScene(data);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const builder = new SceneBuilder();
  builder.build(source);

  const showMessage = (text) => {
    if (!overlay) return;
    overlay.textContent = text;
    overlay.hidden = !text;
  };

  const input = new Input();
  input.attach(canvas, window);
  canvas.focus();

  const runtime = new PlayRuntime({
    source,
    builder,
    input,
    log: (type, message, detail) => {
      const fn = type === 'error' ? console.error : type === 'warning' ? console.warn : console.log;
      fn(detail ? `${message}\n${detail}` : message);
      if (type === 'error') showMessage(message);
    },
    notify: (entity, path) => {
      if (path[0] === 'transform') builder.updateTransform(entity);
      else builder.updateEntity(entity);
    },
  });
  runtime.start();

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    runtime.update(dt);
    const w = window.innerWidth;
    const h = window.innerHeight;
    const size = renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) renderer.setSize(w, h, false);
    const main = builder.mainCamera();
    if (main) {
      SceneBuilder.fitCamera(main.camera, w / h);
      builder.scene.background = new THREE.Color(main.camera.userData.settings.clearColor);
      renderer.render(builder.scene, main.camera);
    } else {
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      showMessage('No cameras rendering');
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return { runtime, builder, renderer };
}
