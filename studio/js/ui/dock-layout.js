// Pure operations on the dock layout tree (no DOM), so they can be tested
// in Node.
//
// Node shapes:
//   { type: 'split', dir: 'row' | 'col', children: [node], sizes: [number] }
//   { type: 'tabs', panels: [panelId], active: index }

export function tabs(panels, active = 0) {
  return { type: 'tabs', panels: [...panels], active };
}

export function split(dir, children, sizes) {
  return {
    type: 'split',
    dir,
    children,
    sizes: sizes || children.map(() => 1 / children.length),
  };
}

/** Deep copy without runtime-only keys (those starting with "_"). */
export function serializeLayout(node) {
  return JSON.parse(JSON.stringify(node, (key, value) => (key.startsWith('_') ? undefined : value)));
}

/** Every panel id in the tree, in order. */
export function panelsIn(node) {
  if (!node) return [];
  if (node.type === 'tabs') return [...node.panels];
  return node.children.flatMap(panelsIn);
}

/** Find the tab group holding `panelId`, with its parent chain. */
export function findGroup(node, panelId, parent = null) {
  if (!node) return null;
  if (node.type === 'tabs') return node.panels.includes(panelId) ? { group: node, parent } : null;
  for (const child of node.children) {
    const found = findGroup(child, panelId, node);
    if (found) return found;
  }
  return null;
}

/** Parent split of a node, or null for the root. */
export function parentOf(root, target) {
  if (!root || root.type !== 'split') return null;
  for (const child of root.children) {
    if (child === target) return root;
    const found = parentOf(child, target);
    if (found) return found;
  }
  return null;
}

/** All tab groups in the tree. */
export function groupsIn(node) {
  if (!node) return [];
  if (node.type === 'tabs') return [node];
  return node.children.flatMap(groupsIn);
}

/**
 * Clean up a tree: drop unknown or duplicate panels, empty groups and
 * single-child splits; merge nested splits with the same direction; fix
 * sizes. Returns the new root (possibly null when nothing is left).
 */
export function normalizeLayout(node, knownPanels, seen = new Set()) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'tabs') {
    const panels = (Array.isArray(node.panels) ? node.panels : []).filter(
      (id) => typeof id === 'string' && (!knownPanels || knownPanels.has(id)) && !seen.has(id),
    );
    panels.forEach((id) => seen.add(id));
    if (panels.length === 0) return null;
    const active = Number.isInteger(node.active) ? Math.min(Math.max(node.active, 0), panels.length - 1) : 0;
    return { ...node, type: 'tabs', panels, active };
  }
  if (node.type !== 'split' || !Array.isArray(node.children)) return null;
  const dir = node.dir === 'col' ? 'col' : 'row';
  const children = [];
  const sizes = [];
  node.children.forEach((child, i) => {
    const size = Number(node.sizes?.[i]);
    const clean = normalizeLayout(child, knownPanels, seen);
    if (!clean) return;
    const weight = Number.isFinite(size) && size > 0 ? size : 1;
    if (clean.type === 'split' && clean.dir === dir) {
      const total = clean.sizes.reduce((a, b) => a + b, 0) || 1;
      clean.children.forEach((c, j) => {
        children.push(c);
        sizes.push((weight * clean.sizes[j]) / total);
      });
    } else {
      children.push(clean);
      sizes.push(weight);
    }
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  const total = sizes.reduce((a, b) => a + b, 0);
  return { ...node, type: 'split', dir, children, sizes: sizes.map((s) => s / total) };
}

/** Remove a panel from wherever it is. Returns the normalized root. */
export function removePanel(root, panelId, knownPanels) {
  const found = findGroup(root, panelId);
  if (!found) return root;
  const { group } = found;
  const index = group.panels.indexOf(panelId);
  group.panels.splice(index, 1);
  if (group.active >= group.panels.length) group.active = Math.max(0, group.panels.length - 1);
  else if (index < group.active) group.active -= 1;
  return normalizeLayout(root, knownPanels);
}

/** Add a panel as a tab of `group` at `index`. */
export function addTab(group, panelId, index = group.panels.length) {
  const at = Math.max(0, Math.min(index, group.panels.length));
  group.panels.splice(at, 0, panelId);
  group.active = at;
}

/**
 * Dock a panel beside `target` (a node in the tree) on `side`
 * ('left' | 'right' | 'top' | 'bottom'). Returns the new root.
 */
export function dockBeside(root, target, panelId, side, fraction = 0.5) {
  const dir = side === 'left' || side === 'right' ? 'row' : 'col';
  const before = side === 'left' || side === 'top';
  const newGroup = tabs([panelId]);
  const parent = parentOf(root, target);

  if (parent && parent.dir === dir) {
    const i = parent.children.indexOf(target);
    const share = parent.sizes[i];
    parent.sizes[i] = share * (1 - fraction);
    parent.children.splice(before ? i : i + 1, 0, newGroup);
    parent.sizes.splice(before ? i : i + 1, 0, share * fraction);
    return root;
  }

  const wrapped = split(
    dir,
    before ? [newGroup, target] : [target, newGroup],
    before ? [fraction, 1 - fraction] : [1 - fraction, fraction],
  );
  if (!parent) return wrapped;
  const i = parent.children.indexOf(target);
  parent.children[i] = wrapped;
  return root;
}
