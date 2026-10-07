import { Emitter } from './events.js';

/**
 * Long-running work shown in the status bar (imports, builds, benchmarks).
 * task.update(progress, message), task.done(), task.onCancel = fn.
 */
export class TaskTracker extends Emitter {
  constructor() {
    super();
    this.tasks = [];
    this.nextId = 1;
  }

  start(label) {
    const tracker = this;
    const task = {
      id: this.nextId++,
      label,
      progress: 0,
      message: '',
      onCancel: null,
      update(progress, message) {
        this.progress = Math.max(0, Math.min(1, progress));
        if (message) this.message = message;
        tracker.emit('change');
      },
      cancel() {
        this.onCancel?.();
      },
      done() {
        tracker.tasks = tracker.tasks.filter((t) => t !== task);
        tracker.emit('change');
      },
    };
    this.tasks.push(task);
    this.emit('change');
    return task;
  }

  /** Run fn(task) as a task and always finish it. */
  async run(label, fn) {
    const task = this.start(label);
    try {
      return await fn(task);
    } finally {
      task.done();
    }
  }
}
