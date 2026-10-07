// File > Build Settings / Build And Run. The Vox Agent writes the build to
// Builds/<Name>/play.html in the project; Build And Run opens it through a
// one-time play link.

import { h } from './ui/dom.js';
import { openDialog } from './ui/dialog.js';
import { textField } from './ui/fields.js';
import { load, save } from './core/storage.js';

export class BuildCommands {
  constructor(app) {
    this.app = app;
    this.editor = app.editor;
    this.settings = load('build', { title: '' });
  }

  get available() {
    return this.app.agent.connected;
  }

  folderName() {
    return (this.editor.scene.name || 'Game').replace(/[^A-Za-z0-9 _-]/g, '_').trim().slice(0, 64) || 'Game';
  }

  menuItems() {
    return [
      { label: 'Build Settings...', shortcut: 'Ctrl+Shift+B', action: () => this.showDialog() },
      { label: 'Build And Run', shortcut: 'Ctrl+B', disabled: !this.available, action: () => this.build({ run: true }) },
    ];
  }

  showDialog() {
    const scene = this.editor.scene;
    let title = this.settings.title || scene.name;
    const titleField = textField({ label: 'Window Title', get: () => title, onCommit: (v) => { title = v; } });
    const out = `Builds/${this.folderName()}/play.html`;
    const body = h(
      'div.build-settings',
      h('div.build-section-title', 'Scenes In Build'),
      h('div.build-scenes', h('div.build-scene', h('span', '0'), h('span', scene.path || `${scene.name} (unsaved)`))),
      h('div.build-section-title', 'Platform'),
      h('p', 'Web (standalone HTML). The build is one play.html file with the engine and scene embedded; it runs offline by opening it in a browser.'),
      titleField.el,
      h('div.field-row', h('span.field-label', 'Output'), h('div.field-control', h('span.mono.build-path', out))),
      this.available
        ? null
        : h('p.build-warning', 'Builds are produced by the Vox Agent. Start it with "node agent/agent.js" and open the URL it prints.'),
    );
    const commit = () => {
      title = titleField.input.value;
      this.settings.title = title === scene.name ? '' : title;
      save('build', this.settings);
    };
    openDialog({
      title: 'Build Settings',
      width: 520,
      body,
      buttons: [
        { label: 'Close', action: commit },
        { label: 'Build', action: () => { commit(); if (!this.available) return false; this.build({ title }); } },
        { label: 'Build And Run', primary: true, action: () => { commit(); if (!this.available) return false; this.build({ title, run: true }); } },
      ],
    });
  }

  async build({ title, run = false } = {}) {
    const { editor, app } = this;
    if (!this.available) {
      editor.log.warn('Build needs the Vox Agent. Start it with "node agent/agent.js".');
      return;
    }
    if (editor.isPlaying) {
      editor.log.warn('Exit Play mode before building');
      return;
    }
    // Open the window now so the browser treats it as user-initiated.
    const win = run ? window.open('about:blank', '_blank') : null;
    try {
      editor.log.info('Building...');
      const started = performance.now();
      const res = await editor.tasks.run('Building', (task) => {
        const job = app.agent.runJob('/api/export', {
          scene: editor.scene.toData(),
          title: title || this.settings.title || editor.scene.name,
          folder: this.folderName(),
        }, (j) => task.update(j.progress, j.message));
        task.onCancel = job.cancel;
        return job.promise;
      });
      const kb = Math.round(res.bytes / 1024);
      editor.log.info(`Build succeeded: ${res.path} (${kb} KB, ${Math.round(performance.now() - started)} ms)`);
      editor.emit('project-refresh');
      if (win) {
        const ticket = await app.agent.post('/api/build/ticket', { path: res.path });
        win.location.href = ticket.url;
      }
    } catch (err) {
      win?.close();
      if (err.status === 499) editor.log.warn('Build cancelled');
      else editor.log.error('Build failed', err.message);
    }
  }
}
