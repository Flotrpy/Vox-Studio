// Console panel: Clear, Collapse, Clear on Play, Error Pause, search,
// info/warning/error filter toggles with counts, alternating rows and a
// detail pane for the selected message.

import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { contextMenu } from '../ui/menu.js';
import { tooltip } from '../ui/tooltip.js';
import { load, save } from '../core/storage.js';

const TYPE_ICON = { info: 'info', warning: 'warning', error: 'error' };
const MAX_ROWS = 1000;

function timeStamp(date) {
  return date.toTimeString().slice(0, 8);
}

export class ConsolePanel {
  constructor(editor) {
    this.editor = editor;
    this.id = 'console';
    this.title = 'Console';
    this.icon = 'info';
    this.prefs = load('console', { collapse: false, clearOnPlay: true, errorPause: false, show: { info: true, warning: true, error: true } });
    this.filter = '';
    this.selectedId = null;
    this.renderQueued = false;

    const btn = (label, tip, onClick) => {
      const b = h('button.tb-btn', { type: 'button' }, label);
      tooltip(b, tip);
      b.addEventListener('click', onClick);
      return b;
    };
    this.clearBtn = btn('Clear', 'Clear all messages', () => editor.log.clear());
    this.collapseBtn = btn('Collapse', 'Group identical messages', () => this.toggle('collapse'));
    this.clearOnPlayBtn = btn('Clear on Play', 'Clear the console when entering Play mode', () => this.toggle('clearOnPlay'));
    this.errorPauseBtn = btn('Error Pause', 'Pause Play mode when a script logs an error', () => this.toggle('errorPause'));

    this.search = h('input.input', { type: 'search', placeholder: 'Search', 'aria-label': 'Search console', spellcheck: false });
    this.search.addEventListener('input', () => {
      this.filter = this.search.value.trim().toLowerCase();
      this.render();
    });
    this.search.addEventListener('keydown', (e) => e.stopPropagation());

    this.counters = {};
    const counterButtons = ['info', 'warning', 'error'].map((type) => {
      const count = h('span.count', '0');
      const b = h('button.tb-btn.counter', { type: 'button', class: `counter-${type}` }, icon(TYPE_ICON[type]), count);
      tooltip(b, `Show ${type === 'info' ? 'log' : type} messages`);
      b.addEventListener('click', () => {
        this.prefs.show[type] = !this.prefs.show[type];
        this.persist();
      });
      this.counters[type] = { button: b, count };
      return b;
    });

    this.list = h('div.console-list', { role: 'log', tabindex: '0', 'aria-label': 'Console messages' });
    this.detail = h('div.console-detail.mono', { tabindex: '0', 'aria-label': 'Message details' });
    const splitter = h('div.console-splitter', { role: 'separator' });
    this.bindSplitter(splitter);

    this.element = h(
      'div.panel.console',
      { dataset: { panel: 'console' } },
      h(
        'div.panel-toolbar',
        this.clearBtn,
        h('span.tb-sep'),
        this.collapseBtn,
        this.clearOnPlayBtn,
        this.errorPauseBtn,
        h('div.spacer'),
        h('div.search.console-search', icon('search'), this.search),
        ...counterButtons,
      ),
      this.list,
      splitter,
      this.detail,
    );

    editor.log.on('add', () => this.queueRender());
    editor.log.on('clear', () => {
      this.selectedId = null;
      this.render();
    });
    this.list.addEventListener('keydown', (e) => this.onKey(e));
    this.list.addEventListener('contextmenu', (e) =>
      contextMenu(e, [
        { label: 'Copy Message', disabled: !this.selectedId, action: () => this.copySelected() },
        { label: 'Clear', action: () => editor.log.clear() },
        { separator: true },
        { label: 'Collapse', checked: this.prefs.collapse, action: () => this.toggle('collapse') },
      ]),
    );
    this.applyPrefs();
    this.render();
  }

  get errorPause() {
    return this.prefs.errorPause;
  }

  get clearOnPlay() {
    return this.prefs.clearOnPlay;
  }

  toggle(key) {
    this.prefs[key] = !this.prefs[key];
    this.persist();
  }

  persist() {
    save('console', this.prefs);
    this.applyPrefs();
    this.render();
  }

  applyPrefs() {
    this.collapseBtn.setAttribute('aria-pressed', String(this.prefs.collapse));
    this.clearOnPlayBtn.setAttribute('aria-pressed', String(this.prefs.clearOnPlay));
    this.errorPauseBtn.setAttribute('aria-pressed', String(this.prefs.errorPause));
    for (const [type, c] of Object.entries(this.counters)) c.button.setAttribute('aria-pressed', String(this.prefs.show[type]));
  }

  bindSplitter(splitter) {
    splitter.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      splitter.setPointerCapture(e.pointerId);
      const startY = e.clientY;
      const startH = this.detail.getBoundingClientRect().height;
      const move = (ev) => {
        const max = this.element.getBoundingClientRect().height - 60;
        this.detail.style.height = `${Math.max(24, Math.min(max, startH - (ev.clientY - startY)))}px`;
      };
      const up = () => {
        splitter.removeEventListener('pointermove', move);
        splitter.removeEventListener('pointerup', up);
      };
      splitter.addEventListener('pointermove', move);
      splitter.addEventListener('pointerup', up);
    });
  }

  queueRender() {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  /** Visible rows after filtering and collapsing. */
  rows() {
    const { entries } = this.editor.log;
    const filtered = entries.filter(
      (e) => this.prefs.show[e.type] && (!this.filter || e.message.toLowerCase().includes(this.filter)),
    );
    if (!this.prefs.collapse) return filtered.map((e) => ({ entry: e, count: 1 }));
    const groups = new Map();
    for (const e of filtered) {
      const key = `${e.type}\u0000${e.message}\u0000${e.detail}`;
      const g = groups.get(key);
      if (g) {
        g.count++;
        g.entry = { ...g.entry, time: e.time };
      } else {
        groups.set(key, { entry: e, count: 1 });
      }
    }
    return [...groups.values()];
  }

  render() {
    const { counts } = this.editor.log;
    for (const [type, c] of Object.entries(this.counters)) c.count.textContent = counts[type] > 999 ? '999+' : String(counts[type]);
    const nearBottom = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 30;
    clear(this.list);
    const rows = this.rows();
    const shown = rows.slice(-MAX_ROWS);
    shown.forEach(({ entry, count }, i) => {
      const row = h(
        'div.console-row',
        { class: `${entry.type}${i % 2 ? ' alt' : ''}${entry.id === this.selectedId ? ' selected' : ''}`, dataset: { id: entry.id } },
        icon(TYPE_ICON[entry.type], 'log-icon'),
        h('span.log-time', `[${timeStamp(entry.time)}]`),
        h('span.log-text', entry.message),
        count > 1 ? h('span.log-count', String(count)) : null,
      );
      row.addEventListener('pointerdown', () => this.select(entry.id));
      this.list.append(row);
    });
    if (nearBottom) this.list.scrollTop = this.list.scrollHeight;
    this.renderDetail();
  }

  select(id) {
    this.selectedId = id;
    for (const row of this.list.children) row.classList.toggle('selected', Number(row.dataset.id) === id);
    this.renderDetail();
  }

  renderDetail() {
    const entry = this.editor.log.entries.find((e) => e.id === this.selectedId);
    this.detail.textContent = entry ? `${entry.message}${entry.detail ? `\n${entry.detail}` : ''}` : '';
  }

  copySelected() {
    const entry = this.editor.log.entries.find((e) => e.id === this.selectedId);
    if (entry) navigator.clipboard?.writeText(`${entry.message}\n${entry.detail}`.trim()).catch(() => {});
  }

  onKey(e) {
    const ids = [...this.list.children].map((r) => Number(r.dataset.id));
    if (!ids.length) return;
    const i = ids.indexOf(this.selectedId);
    if (e.key === 'ArrowDown') this.select(ids[Math.min(ids.length - 1, i + 1)]);
    else if (e.key === 'ArrowUp') this.select(ids[Math.max(0, i < 0 ? ids.length - 1 : i - 1)]);
    else if (e.key === 'c' && (e.ctrlKey || e.metaKey)) this.copySelected();
    else return;
    e.preventDefault();
    e.stopPropagation();
    this.list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  }
}
