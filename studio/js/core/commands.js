// Undoable editor operations. Each factory returns a command object for
// History: { label, do(), undo(), mergeKey?, merge? }.

function clone(value) {
  return structuredClone(value);
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Change one field. Consecutive edits of the same field merge. */
export function setFieldCommand(model, id, path, before, after, label = 'Change Property') {
  return {
    label,
    mergeKey: `${id}:${path.join('.')}`,
    before: clone(before),
    after: clone(after),
    do() {
      model.setField(id, path, this.after);
    },
    undo() {
      model.setField(id, path, this.before);
    },
    merge(next) {
      this.after = next.after;
      return true;
    },
    isNoop() {
      return sameValue(this.before, this.after);
    },
  };
}

/** Change the same field on several entities at once. */
export function setFieldsCommand(model, edits, label = 'Change Property') {
  const list = edits.map((e) => ({ ...e, before: clone(e.before), after: clone(e.after) }));
  return {
    label,
    do() {
      for (const e of list) model.setField(e.id, e.path, e.after);
    },
    undo() {
      for (const e of list) model.setField(e.id, e.path, e.before);
    },
  };
}

/** Replace transforms (used by gizmo drags). Entries: { id, before, after }. */
export function setTransformsCommand(model, entries, label = 'Transform') {
  const list = entries.map((e) => ({ id: e.id, before: clone(e.before), after: clone(e.after) }));
  return {
    label,
    do() {
      for (const e of list) model.setField(e.id, ['transform'], e.after);
    },
    undo() {
      for (const e of list) model.setField(e.id, ['transform'], e.before);
    },
    isNoop() {
      return list.every((e) => sameValue(e.before, e.after));
    },
  };
}

/**
 * Insert one or more subtrees (arrays of entity records, root first) and
 * select their roots.
 */
export function createEntitiesCommand(model, selection, subtrees, parentId = null, index, label = 'Create Object') {
  const trees = subtrees.map((records) => clone(records));
  const selectionBefore = selection.ids.slice();
  return {
    label,
    rootIds: trees.map((t) => t[0].id),
    do() {
      trees.forEach((records, i) => {
        model.insertSubtree(records, parentId, index === undefined ? undefined : index + i);
      });
      selection.set(this.rootIds);
    },
    undo() {
      for (const id of [...this.rootIds].reverse()) model.remove(id);
      selection.set(selectionBefore.filter((id) => model.has(id)));
    },
  };
}

/** Keep only ids whose ancestors are not also in the list. */
export function topLevelIds(model, ids) {
  const set = new Set(ids);
  return ids.filter((id) => {
    let cursor = model.get(id)?.parent ?? null;
    while (cursor !== null) {
      if (set.has(cursor)) return false;
      cursor = model.get(cursor)?.parent ?? null;
    }
    return model.has(id);
  });
}

export function deleteEntitiesCommand(model, selection, ids, label = 'Delete') {
  const targets = topLevelIds(model, ids);
  const selectionBefore = selection.ids.slice();
  let removed = [];
  return {
    label,
    do() {
      removed = [];
      for (const id of targets) {
        const info = model.remove(id);
        if (info) removed.push(info);
      }
      selection.prune((id) => model.has(id));
    },
    undo() {
      for (const info of [...removed].reverse()) model.insertSubtree(info.records, info.parent, info.index);
      selection.set(selectionBefore.filter((id) => model.has(id)));
    },
  };
}

/**
 * Reparent/reorder entities. Moves: { id, parent, index, transform? } where
 * `transform` (optional) is the new local transform that keeps the world
 * pose unchanged under the new parent.
 */
export function moveEntitiesCommand(model, moves, label = 'Reparent') {
  const list = moves.map((m) => ({ ...m, transform: m.transform ? clone(m.transform) : null }));
  let undoInfo = [];
  return {
    label,
    do() {
      undoInfo = [];
      list.forEach((m, i) => {
        const e = model.get(m.id);
        if (!e) return;
        undoInfo.push({ id: m.id, parent: e.parent, index: model.indexOf(m.id), transform: clone(e.transform) });
        const index = m.index === undefined ? undefined : m.index + i;
        if (model.move(m.id, m.parent, index) && m.transform) model.setField(m.id, ['transform'], m.transform);
      });
    },
    undo() {
      for (const u of [...undoInfo].reverse()) {
        model.move(u.id, u.parent, u.index);
        model.setField(u.id, ['transform'], u.transform);
      }
    },
  };
}

export function setSettingCommand(model, key, before, after, label = 'Change Scene Settings') {
  return {
    label,
    mergeKey: `settings:${key}`,
    before: clone(before),
    after: clone(after),
    do() {
      model.setSettings(key, this.after);
    },
    undo() {
      model.setSettings(key, this.before);
    },
    merge(next) {
      this.after = next.after;
      return true;
    },
  };
}
