// Selection outline: selected meshes are drawn white into a mask, then a
// full-screen pass draws a light blue edge wherever the mask changes.

import * as THREE from 'three';

const quadVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const quadFragment = /* glsl */ `
  uniform sampler2D uMask;
  uniform vec2 uTexel;
  uniform vec3 uColor;
  uniform float uWidth;
  varying vec2 vUv;
  void main() {
    float center = texture2D(uMask, vUv).r;
    float edge = 0.0;
    for (int x = -2; x <= 2; x++) {
      for (int y = -2; y <= 2; y++) {
        vec2 o = vec2(float(x), float(y));
        if (length(o) > uWidth) continue;
        edge = max(edge, texture2D(uMask, vUv + o * uTexel).r);
      }
    }
    float a = clamp(edge - center, 0.0, 1.0);
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`;

export class SelectionOutline {
  constructor({ color = 0x7ab8ff, width = 2 } = {}) {
    this.target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
    this.maskScene = new THREE.Scene();
    this.maskScene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    this.proxies = [];
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMask: { value: this.target.texture },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uColor: { value: new THREE.Color(color) },
        uWidth: { value: width + 0.5 },
      },
      vertexShader: quadVertex,
      fragmentShader: quadFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setProxies(meshes) {
    while (this.proxies.length < meshes.length) {
      const proxy = new THREE.Mesh();
      proxy.matrixAutoUpdate = false;
      proxy.frustumCulled = false;
      this.maskScene.add(proxy);
      this.proxies.push(proxy);
    }
    this.proxies.forEach((proxy, i) => {
      const mesh = meshes[i];
      proxy.visible = !!mesh;
      if (!mesh) return;
      proxy.geometry = mesh.geometry;
      proxy.matrix.copy(mesh.matrixWorld);
      proxy.matrixWorld.copy(mesh.matrixWorld);
    });
  }

  render(renderer, camera, meshes) {
    if (!meshes.length) return;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (this.target.width !== size.x || this.target.height !== size.y) {
      this.target.setSize(size.x, size.y);
      this.material.uniforms.uTexel.value.set(1 / size.x, 1 / size.y);
    }
    this.setProxies(meshes);
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(this.maskScene, camera);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.autoClear = false;
    renderer.render(this.quadScene, this.quadCamera);
    renderer.autoClear = prevAutoClear;
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
  }
}
