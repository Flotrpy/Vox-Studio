// Main menu bar contents: File, Edit, Assets, GameObject, Component,
// Window, Help. Items are built each time a menu opens so labels such as
// "Undo Rename" and check marks stay current.

import { createMenuItems } from './panels/create-menu.js';
import { componentDisplayName } from './panels/inspector.js';
import { COMPONENT_SCHEMAS } from '../../shared/scene-format.js';
import { LAYOUT_PRESETS } from './ui/layouts.js';
import { showAbout, showShortcuts } from './about.js';

export function buildMenus(app) {
  const { editor, dock, files, panels } = app;
  const hasSelection = () => editor.selection.ids.length > 0;
  const editing = () => !editor.isPlaying;

  const file = () => [
    { label: 'New Scene', shortcut: 'Ctrl+N', disabled: !editing(), action: () => files.newScene() },
    { label: 'Open Scene...', shortcut: 'Ctrl+O', disabled: !editing(), action: () => app.openSceneDialog() },
    { separator: true },
    { label: 'Save', shortcut: 'Ctrl+S', disabled: !editing(), action: () => files.save() },
    { label: 'Save As...', shortcut: 'Ctrl+Shift+S', disabled: !editing(), action: () => files.saveAs() },
    { separator: true },
    { label: 'Download Scene File', action: () => files.download() },
    { label: 'Load Scene File...', disabled: !editing(), action: () => files.upload() },
    { separator: true },
    ...app.extraFileItems(),
  ];

  const edit = () => [
    { label: editor.history.canUndo ? `Undo ${editor.history.undoLabel}` : 'Undo', shortcut: 'Ctrl+Z', disabled: !editor.history.canUndo, action: () => editor.undo() },
    { label: editor.history.canRedo ? `Redo ${editor.history.redoLabel}` : 'Redo', shortcut: 'Ctrl+Y', disabled: !editor.history.canRedo, action: () => editor.redo() },
    { separator: true },
    { label: 'Copy', shortcut: 'Ctrl+C', disabled: !hasSelection(), action: () => editor.copySelection() },
    { label: 'Paste', shortcut: 'Ctrl+V', disabled: !editor.clipboard, action: () => editor.paste() },
    { label: 'Duplicate', shortcut: 'Ctrl+D', disabled: !hasSelection(), action: () => editor.duplicateSelection() },
    { label: 'Rename', shortcut: 'F2', disabled: !hasSelection(), action: () => panels.hierarchy.beginRename(editor.selection.active) },
    { label: 'Delete', shortcut: 'Del', disabled: !hasSelection(), action: () => editor.deleteSelection() },
    { separator: true },
    { label: 'Frame Selected', shortcut: 'F', action: () => editor.frameSelected() },
    { label: 'Select All', shortcut: 'Ctrl+A', action: () => editor.selectAll() },
    { label: 'Deselect All', shortcut: 'Shift+D', disabled: !hasSelection(), action: () => editor.selection.clear() },
    { separator: true },
    ...app.playItems(),
    { separator: true },
    { label: 'Keyboard Shortcuts...', action: () => showShortcuts() },
  ];

  const assets = () => [
    {
      label: 'Create',
      submenu: [
        { label: 'Folder', action: () => panels.project.createFolder() },
        { separator: true },
        { label: 'Scene', action: () => files.createSceneAsset(panels.project.currentDir()) },
      ],
    },
    { label: 'Import New Asset...', action: () => app.importAssets() },
    { separator: true },
    { label: 'Refresh', shortcut: 'Ctrl+R', action: () => editor.emit('project-refresh') },
  ];

  const gameObject = () => [
    ...createMenuItems(editor),
    { label: 'Create Empty Child', shortcut: 'Alt+Shift+N', disabled: !hasSelection(), action: () => editor.createObject('Empty', { asChild: true }) },
    { separator: true },
    { label: 'Move To View', shortcut: 'Ctrl+Alt+F', disabled: !hasSelection(), action: () => panels.scene.moveToView() },
    { label: 'Align With View', shortcut: 'Ctrl+Shift+F', disabled: !hasSelection(), action: () => panels.scene.alignWithView() },
    { label: 'Clear Parent', disabled: !hasSelection(), action: () => editor.reparent(editor.selection.ids, null) },
    { separator: true },
    { label: 'Duplicate', shortcut: 'Ctrl+D', disabled: !hasSelection(), action: () => editor.duplicateSelection() },
    { label: 'Delete', shortcut: 'Del', disabled: !hasSelection(), action: () => editor.deleteSelection() },
  ];

  const component = () => {
    const active = editor.selection.active ? editor.scene.get(editor.selection.active) : null;
    const categories = {};
    for (const [type, schema] of Object.entries(COMPONENT_SCHEMAS)) {
      (categories[schema.category] ||= []).push({
        label: type === 'Script' ? 'New Script' : componentDisplayName(type),
        disabled: !active || !panels.inspector.canAdd(active, type),
        action: () => panels.inspector.addComponent(active, type),
      });
    }
    return [
      { label: 'Add...', shortcut: 'Ctrl+Shift+A', disabled: !active, action: () => app.focusAddComponent() },
      { separator: true },
      ...Object.entries(categories).map(([label, submenu]) => ({ label, disabled: !active, submenu })),
    ];
  };

  const windowMenu = () => [
    {
      label: 'Layouts',
      submenu: [
        ...Object.keys(LAYOUT_PRESETS).map((name) => ({ label: name, checked: app.layoutName() === name, action: () => app.applyLayout(name) })),
        { separator: true },
        { label: 'Reset All Layouts', action: () => app.applyLayout('Default') },
      ],
    },
    { separator: true },
    {
      header: 'General',
    },
    ...app.panelOrder.map(([id, shortcut]) => ({
      label: panels[id].title,
      shortcut,
      checked: dock.isOpen(id),
      action: () => (dock.isOpen(id) && dock.isVisible(id) ? dock.closePanel(id) : dock.openPanel(id)),
    })),
  ];

  const help = () => [
    { label: 'About Vox Studio', action: () => showAbout(editor.agent) },
    { label: 'Keyboard Shortcuts', action: () => showShortcuts() },
    ...app.extraHelpItems(),
  ];

  return [
    { label: 'File', items: file },
    { label: 'Edit', items: edit },
    { label: 'Assets', items: assets },
    { label: 'GameObject', items: gameObject },
    { label: 'Component', items: component },
    { label: 'Window', items: windowMenu },
    { label: 'Help', items: help },
  ];
}
