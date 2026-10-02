import { Emitter } from './events.js';

const LIMIT = 300;
const MERGE_WINDOW_MS = 1000;

/**
 * Undo/redo stack. A command is { label, do(), undo() } and may provide
 * `mergeKey` plus `merge(next)` so rapid edits to the same field collapse
 * into one undo step.
 */
export class History extends Emitter {
  constructor() {
    super();
    this.undoStack = [];
    this.redoStack = [];
    this.enabled = true;
  }

  /** Apply a command and record it. */
  execute(command) {
    command.do();
    this.record(command);
    return command;
  }

  /** Record a command whose effect has already been applied (drags). */
  record(command) {
    if (!this.enabled) return;
    const top = this.undoStack[this.undoStack.length - 1];
    const now = Date.now();
    if (
      top &&
      command.mergeKey &&
      top.mergeKey === command.mergeKey &&
      now - top.time < MERGE_WINDOW_MS &&
      typeof top.merge === 'function' &&
      top.merge(command)
    ) {
      top.time = now;
    } else {
      command.time = now;
      this.undoStack.push(command);
      if (this.undoStack.length > LIMIT) this.undoStack.shift();
    }
    this.redoStack.length = 0;
    this.emit('change');
  }

  /** Stop merging into the current top entry (e.g. after a field loses focus). */
  seal() {
    const top = this.undoStack[this.undoStack.length - 1];
    if (top) top.mergeKey = null;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  get undoLabel() {
    return this.undoStack[this.undoStack.length - 1]?.label || '';
  }

  get redoLabel() {
    return this.redoStack[this.redoStack.length - 1]?.label || '';
  }

  undo() {
    const command = this.undoStack.pop();
    if (!command) return null;
    command.undo();
    this.redoStack.push(command);
    this.emit('change');
    return command;
  }

  redo() {
    const command = this.redoStack.pop();
    if (!command) return null;
    command.do();
    this.undoStack.push(command);
    this.emit('change');
    return command;
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.emit('change');
  }
}
