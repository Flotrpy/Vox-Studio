import { Emitter } from './events.js';

const LIMIT = 5000;

/**
 * Console message store. Entry: { id, type, message, detail, time }.
 * type is 'info' | 'warning' | 'error'.
 */
export class LogStore extends Emitter {
  constructor() {
    super();
    this.entries = [];
    this.counts = { info: 0, warning: 0, error: 0 };
    this.nextId = 1;
  }

  add(type, message, detail = '') {
    const kind = type === 'warning' || type === 'error' ? type : 'info';
    const entry = { id: this.nextId++, type: kind, message: String(message), detail: String(detail || ''), time: new Date() };
    this.entries.push(entry);
    this.counts[kind]++;
    if (this.entries.length > LIMIT) {
      const dropped = this.entries.shift();
      this.counts[dropped.type]--;
    }
    this.emit('add', entry);
    return entry;
  }

  info(message, detail) {
    return this.add('info', message, detail);
  }

  warn(message, detail) {
    return this.add('warning', message, detail);
  }

  error(message, detail) {
    return this.add('error', message, detail);
  }

  clear() {
    this.entries = [];
    this.counts = { info: 0, warning: 0, error: 0 };
    this.emit('clear');
  }

  get last() {
    return this.entries[this.entries.length - 1] || null;
  }
}
