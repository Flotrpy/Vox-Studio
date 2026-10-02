// Scene view grid: a large plane whose shader draws 1 m and 10 m lines that
// fade with distance. Lines stay one pixel wide at any zoom via fwidth().

import * as THREE from 'three';

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uCamera;
  uniform float uFade;
  uniform float uPlane; // 0 = XZ ground, 1 = XY (2D mode)
  varying vec3 vWorld;

  float gridLine(vec2 coord, float size) {
    vec2 g = coord / size;
    vec2 d = abs(fract(g - 0.5) - 0.5) / fwidth(g);
    return 1.0 - min(min(d.x, d.y), 1.0);
  }

  void main() {
    vec2 coord = uPlane > 0.5 ? vWorld.xy : vWorld.xz;
    float minor = gridLine(coord, 1.0);
    float major = gridLine(coord, 10.0);
    float dist = distance(uCamera, vWorld);
    float fade = 1.0 - smoothstep(uFade * 0.35, uFade, dist);
    float alpha = max(minor * 0.16, major * 0.34) * fade;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

export class Grid {
  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0xb4b4b4) },
        uCamera: { value: new THREE.Vector3() },
        uFade: { value: 100 },
        uPlane: { value: 0 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      extensions: { derivatives: true },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.name = '__grid';
    this.setPlane('xz');
  }

  setPlane(plane) {
    this.plane = plane;
    this.material.uniforms.uPlane.value = plane === 'xy' ? 1 : 0;
    this.mesh.rotation.set(plane === 'xy' ? 0 : -Math.PI / 2, 0, 0);
  }

  /** Follow the camera so the grid looks infinite. */
  update(camera, distance) {
    const size = Math.max(200, distance * 40);
    this.mesh.scale.set(size, size, 1);
    const p = camera.position;
    const snap = (v) => Math.round(v / 10) * 10;
    if (this.plane === 'xy') this.mesh.position.set(snap(p.x), snap(p.y), 0);
    else this.mesh.position.set(snap(p.x), 0, snap(p.z));
    this.material.uniforms.uCamera.value.copy(p);
    this.material.uniforms.uFade.value = Math.max(25, distance * 5);
  }
}
