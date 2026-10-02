// Bottom status bar: the most recent console message on the left.

import { h, clear } from './dom.js';
import { icon } from './icons.js';

export class StatusBar {
  constructor(el, editor, { onMessageClick }) {
    this.editor = editor;
    this.message = h('button.message', { type: 'button', 'aria-live': 'polite' });
    this.message.addEventListener('click', onMessageClick);
    this.right = h('div.right');
    el.append(this.message, this.right);
    editor.log.on('add', (entry) => this.show(entry));
    editor.log.on('clear', () => clear(this.message));
  }

  show(entry) {
    clear(this.message);
    this.message.className = `message ${entry.type}`;
    this.message.append(icon(entry.type === 'info' ? 'info' : entry.type), h('span.text', entry.message));
  }

  setRight(text) {
    this.right.textContent = text;
  }
}
