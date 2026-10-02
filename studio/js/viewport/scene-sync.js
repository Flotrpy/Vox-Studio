// Keeps a SceneBuilder in step with the editor's SceneModel events.

export function bindSceneModel(builder, model, onChange = () => {}) {
  builder.build(model);
  const offs = [
    model.on('load', () => {
      builder.build(model);
      onChange();
    }),
    model.on('structure', ({ kind, ids }) => {
      if (kind === 'add') {
        for (const id of ids) {
          const e = model.get(id);
          if (e && !builder.object(id)) builder.addEntity(e);
        }
      } else if (kind === 'remove') {
        for (const id of ids) builder.removeEntity(id);
      } else if (kind === 'move') {
        for (const id of ids) {
          const e = model.get(id);
          if (e) builder.reparent(e);
        }
      }
      onChange();
    }),
    model.on('change', ({ id, path }) => {
      const e = model.get(id);
      if (!e) return;
      if (path[0] === 'transform') builder.updateTransform(e);
      else builder.updateEntity(e);
      onChange();
    }),
    model.on('settings', () => {
      builder.applySettings();
      onChange();
    }),
  ];
  return () => offs.forEach((off) => off());
}
