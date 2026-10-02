// Templates for objects created from the GameObject menu.

import { createComponent, createTransform } from '../../../shared/scene-format.js';
import { newId } from './scene-model.js';

function base(name, components, transform = createTransform()) {
  return {
    id: newId(),
    name,
    parent: null,
    active: true,
    static: false,
    tag: 'Untagged',
    layer: 'Default',
    transform,
    components,
  };
}

function meshObject(name, mesh, collider) {
  return base(name, [
    createComponent('MeshFilter', { mesh }),
    createComponent('MeshRenderer'),
    collider,
  ]);
}

/** Menu kinds and how to build them. Each returns an entity record. */
export const CREATE_KINDS = {
  Empty: () => base('GameObject', []),
  Cube: () => meshObject('Cube', 'Cube', createComponent('BoxCollider')),
  Sphere: () => meshObject('Sphere', 'Sphere', createComponent('SphereCollider')),
  Plane: () => meshObject('Plane', 'Plane', createComponent('BoxCollider', { size: [10, 0, 10] })),
  Cylinder: () => meshObject('Cylinder', 'Cylinder', createComponent('BoxCollider', { size: [1, 2, 1] })),
  'Directional Light': () =>
    base('Directional Light', [createComponent('Light', { lightType: 'Directional' })], {
      position: [0, 3, 0],
      rotation: [-50, -30, 0],
      scale: [1, 1, 1],
    }),
  'Point Light': () => base('Point Light', [createComponent('Light', { lightType: 'Point', color: '#FFFFFF' })]),
  'Spot Light': () =>
    base('Spot Light', [createComponent('Light', { lightType: 'Spot', color: '#FFFFFF' })], {
      position: [0, 0, 0],
      rotation: [-90, 0, 0],
      scale: [1, 1, 1],
    }),
  Camera: () => base('Camera', [createComponent('Camera')]),
};

/** Entity record for a mesh asset stored in the scene's asset table. */
export function meshAssetObject(name, assetId) {
  return meshObject(name, `asset:${assetId}`, createComponent('BoxCollider'));
}

/** Records for a fresh scene: a camera and a directional light. */
export function defaultSceneEntities() {
  const camera = base('Main Camera', [createComponent('Camera')], {
    position: [0, 1, 10],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  });
  camera.tag = 'MainCamera';
  const light = CREATE_KINDS['Directional Light']();
  return [camera, light];
}
