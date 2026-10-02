import { Emitter } from './events.js';

/**
 * Ordered set of selected entity ids. The last selected id is the
 * "active" object shown in the Inspector and used as the gizmo pivot.
 */
export class Selection extends Emitter {
  constructor() {
    super();
    this.ids = [];
  }

  get active() {
    return this.ids.length ? this.ids[this.ids.length - 1] : null;
  }

  has(id) {
    return this.ids.includes(id);
  }

  set(ids) {
    const next = [...new Set(ids.filter((id) => id !== null && id !== undefined))];
    if (next.length === this.ids.length && next.every((id, i) => id === this.ids[i])) return;
    this.ids = next;
    this.emit('change', this.ids);
  }

  select(id) {
    this.set(id === null ? [] : [id]);
  }

  add(id) {
    this.set([...this.ids.filter((x) => x !== id), id]);
  }

  toggle(id) {
    this.set(this.has(id) ? this.ids.filter((x) => x !== id) : [...this.ids, id]);
  }

  clear() {
    this.set([]);
  }

  /** Drop ids that no longer exist in the scene. */
  prune(exists) {
    this.set(this.ids.filter(exists));
  }
}
