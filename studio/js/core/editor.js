// The editor context shared by every panel: scene, selection, history,
// console log, current tool and project access.

import { Emitter } from './events.js';
import { SceneModel, newId } from './scene-model.js';
import { Selection } from './selection.js';
import { History } from './history.js';
import { LogStore } from './log.js';
import { CREATE_KINDS, defaultSceneEntities } from './primitives.js';
import {
  createEntitiesCommand,
  deleteEntitiesCommand,
  moveEntitiesCommand,
  setFieldCommand,
  topLevelIds,
} from './commands.js';
import { createSceneData } from '../../../shared/scene-format.js';

export const TOOLS = ['hand', 'move', 'rotate', 'scale', 'rect', 'transform'];

/** Fresh scene document with a camera and a light. */
export function newSceneData(name = 'Main') {
  const data = createSceneData(name);
  data.entities = defaultSceneEntities();
  return data;
}

/** Copy subtrees giving every entity a new id. */
export function cloneWithNewIds(subtrees) {
  return subtrees.map((records) => {
    const map = new Map(records.map((r) => [r.id, newId()]));
    return records.map((r) => ({ ...structuredClone(r), id: map.get(r.id), parent: map.get(r.parent) ?? r.parent }));
  });
}

export class Editor extends Emitter {
  constructor() {
    super();
    this.scene = new SceneModel(newSceneData());
    this.selection = new Selection();
    this.history = new History();
    this.log = new LogStore();
    this.tool = 'move';
    this.pivotMode = 'pivot';
    this.space = 'global';
    this.playState = 'edit';
    this.clipboard = null;
    this.project = null;
    this.agent = null;
    /** Set by the scene view: (id, newParentId) => local transform keeping world pose. */
    this.reparentTransform = null;

    this.scene.on('structure', ({ kind }) => {
      if (kind === 'remove') this.selection.prune((id) => this.scene.has(id));
    });
    this.scene.on('load', () => this.selection.clear());
  }

  get isPlaying() {
    return this.playState !== 'edit';
  }

  // Tools -------------------------------------------------------------------

  setTool(tool) {
    if (!TOOLS.includes(tool) || this.tool === tool) return;
    this.tool = tool;
    this.emit('tool', tool);
  }

  setPivotMode(mode) {
    this.pivotMode = mode;
    this.emit('tool', this.tool);
  }

  setSpace(space) {
    this.space = space;
    this.emit('tool', this.tool);
  }

  // Command helpers -----------------------------------------------------------

  execute(command) {
    if (command.isNoop?.()) return command;
    return this.history.execute(command);
  }

  record(command) {
    if (command.isNoop?.()) return;
    this.history.record(command);
  }

  undo() {
    const cmd = this.history.undo();
    if (cmd) this.log.info(`Undo ${cmd.label}`);
  }

  redo() {
    const cmd = this.history.redo();
    if (cmd) this.log.info(`Redo ${cmd.label}`);
  }

  setField(id, path, value, label) {
    const before = this.scene.getField(id, path);
    this.execute(setFieldCommand(this.scene, id, path, before, value, label));
  }

  // Object operations ---------------------------------------------------------

  /** Create an object from the GameObject menu. */
  createObject(kind, { parent = null, asChild = false } = {}) {
    const factory = CREATE_KINDS[kind];
    if (!factory) return null;
    const record = factory();
    const parentId = asChild ? this.selection.active : parent;
    record.parent = parentId;
    record.name = this.scene.uniqueName(record.name, parentId);
    const cmd = createEntitiesCommand(this.scene, this.selection, [[record]], parentId, undefined, `Create ${kind}`);
    this.execute(cmd);
    this.emit('created', record.id);
    return record.id;
  }

  createFromRecords(subtrees, parentId = null, index, label = 'Create Object') {
    const cmd = createEntitiesCommand(this.scene, this.selection, subtrees, parentId, index, label);
    this.execute(cmd);
    return cmd.rootIds;
  }

  deleteSelection() {
    const ids = this.selection.ids.filter((id) => this.scene.has(id));
    if (!ids.length) return;
    this.execute(deleteEntitiesCommand(this.scene, this.selection, ids, ids.length > 1 ? 'Delete Objects' : 'Delete'));
  }

  duplicateSelection() {
    const ids = topLevelIds(this.scene, this.selection.ids);
    if (!ids.length) return;
    // Group by parent so each duplicate lands right after its original.
    const created = [];
    const subtrees = ids.map((id) => this.scene.snapshotSubtree(id));
    const clones = cloneWithNewIds(subtrees);
    const commands = clones.map((records, i) => {
      const source = this.scene.get(ids[i]);
      records[0].name = this.scene.uniqueName(source.name, source.parent);
      return createEntitiesCommand(this.scene, this.selection, [records], source.parent, this.scene.indexOf(ids[i]) + 1, 'Duplicate');
    });
    const combined = {
      label: 'Duplicate',
      do: () => {
        commands.forEach((c) => c.do());
        created.splice(0, created.length, ...commands.flatMap((c) => c.rootIds));
        this.selection.set(created);
      },
      undo: () => [...commands].reverse().forEach((c) => c.undo()),
    };
    this.execute(combined);
  }

  copySelection() {
    const ids = topLevelIds(this.scene, this.selection.ids);
    if (!ids.length) return;
    this.clipboard = ids.map((id) => this.scene.snapshotSubtree(id));
    this.log.info(`Copied ${ids.length} object${ids.length > 1 ? 's' : ''}`);
  }

  paste() {
    if (!this.clipboard) return;
    const active = this.selection.active ? this.scene.get(this.selection.active) : null;
    const parent = active ? active.parent : null;
    const clones = cloneWithNewIds(this.clipboard);
    for (const records of clones) records[0].name = this.scene.uniqueName(records[0].name, parent);
    this.createFromRecords(clones, parent, undefined, 'Paste');
  }

  rename(id, name) {
    const trimmed = String(name).trim().slice(0, 128);
    if (!trimmed || !this.scene.has(id) || this.scene.get(id).name === trimmed) return;
    this.setField(id, ['name'], trimmed, 'Rename');
  }

  /** Reparent ids under `parentId` at `index`, keeping world transforms. */
  reparent(ids, parentId, index) {
    const valid = topLevelIds(this.scene, ids).filter(
      (id) => id !== parentId && !(parentId !== null && this.scene.isAncestor(id, parentId)),
    );
    if (!valid.length) return;
    const moves = valid.map((id) => ({
      id,
      parent: parentId,
      index,
      transform: this.reparentTransform ? this.reparentTransform(id, parentId) : null,
    }));
    this.execute(moveEntitiesCommand(this.scene, moves, valid.length > 1 ? 'Reparent Objects' : 'Reparent'));
  }

  selectAll() {
    this.selection.set([...this.scene.entities.keys()]);
  }

  frameSelected() {
    this.emit('frame', this.selection.ids.slice());
  }

  // Scene documents -----------------------------------------------------------

  loadScene(data, path = null) {
    this.scene.load(data, { path });
    this.history.clear();
    this.emit('scene-loaded', { path });
  }

  newScene(name = 'Untitled') {
    this.loadScene(newSceneData(name));
  }
}
