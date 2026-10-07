// Bottom status bar: the most recent console message on the left.

import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { tooltip } from './tooltip.js';

export class StatusBar {
  constructor(el, editor, { onMessageClick }) {
    this.editor = editor;
    this.message = h('button.message', { type: 'button', 'aria-live': 'polite' });
    this.message.addEventListener('click', onMessageClick);
    this.right = h('div.right');
    this.taskLabel = h('span.task-label');
    this.taskFill = h('span.task-fill');
    this.taskCancel = h('button.task-cancel', { type: 'button' }, icon('close'));
    tooltip(this.taskCancel, 'Cancel');
    this.taskCancel.addEventListener('click', () => editor.tasks.tasks[0]?.cancel());
    this.taskEl = h('div.task', this.taskLabel, h('span.task-bar', this.taskFill), this.taskCancel);
    this.taskEl.hidden = true;
    el.append(this.message, this.taskEl, this.right);
    editor.tasks.on('change', () => this.showTasks());
    editor.log.on('add', (entry) => this.show(entry));
    editor.log.on('clear', () => clear(this.message));
  }

  show(entry) {
    clear(this.message);
    this.message.className = `message ${entry.type}`;
    this.message.append(icon(entry.type === 'info' ? 'info' : entry.type), h('span.text', entry.message));
  }

  showTasks() {
    const tasks = this.editor.tasks.tasks;
    this.taskEl.hidden = tasks.length === 0;
    if (!tasks.length) return;
    const t = tasks[0];
    const more = tasks.length > 1 ? ` (+${tasks.length - 1})` : '';
    this.taskLabel.textContent = `${t.label}${t.message ? ` - ${t.message}` : ''}${more}`;
    this.taskFill.style.width = `${Math.round(t.progress * 100)}%`;
    this.taskCancel.hidden = !t.onCancel;
    this.taskEl.dataset.tip = tasks.map((x) => `${x.label}: ${Math.round(x.progress * 100)}%`).join('\n');
  }

  setRight(text) {
    this.right.textContent = text;
  }
}
