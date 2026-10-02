// "Create" menu items shared by the GameObject menu, the Hierarchy "+"
// button and the Hierarchy context menu.

export function createMenuItems(editor, { asChild = false } = {}) {
  const make = (kind) => () => editor.createObject(kind, { asChild });
  return [
    { label: 'Create Empty', shortcut: asChild ? '' : 'Ctrl+Shift+N', action: make('Empty') },
    {
      label: '3D Object',
      submenu: [
        { label: 'Cube', action: make('Cube') },
        { label: 'Sphere', action: make('Sphere') },
        { label: 'Cylinder', action: make('Cylinder') },
        { label: 'Plane', action: make('Plane') },
      ],
    },
    {
      label: 'Light',
      submenu: [
        { label: 'Directional Light', action: make('Directional Light') },
        { label: 'Point Light', action: make('Point Light') },
        { label: 'Spot Light', action: make('Spot Light') },
      ],
    },
    { label: 'Camera', action: make('Camera') },
  ];
}
