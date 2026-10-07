// File > Open Project / New Project: switch the agent to another project it
// knows about (folders under its projects root and recent projects).

import { h, clear } from './ui/dom.js';
import { openDialog } from './ui/dialog.js';
import { textField } from './ui/fields.js';
import { icon } from './ui/icons.js';

export class ProjectSwitcher {
  constructor(app) {
    this.app = app;
    this.editor = app.editor;
    app.agent.on('event', ({ type, data }) => {
      // Another tab switched projects: follow it.
      if (type === 'project' && !this.switching && data.name !== this.app.agent.info?.project) this.afterSwitch(data);
    });
  }

  menuItems() {
    const connected = this.app.agent.connected;
    return [
      { label: 'New Project...', disabled: !connected, action: () => this.showDialog(true) },
      { label: 'Open Project...', disabled: !connected, action: () => this.showDialog(false) },
      { separator: true },
    ];
  }

  async showDialog(createFirst) {
    const { agent } = this.app;
    let list;
    try {
      list = await agent.get('/api/projects');
    } catch (err) {
      this.editor.log.error('Could not list projects', err.message);
      return;
    }
    const rows = h('div.project-list', { role: 'listbox' });
    let dialog;
    const fill = () => {
      clear(rows);
      for (const p of list.projects) {
        const row = h(
          'button.project-row',
          { type: 'button', class: p.current ? 'current' : undefined, role: 'option' },
          icon('folder'),
          h('span.project-name', p.name),
          h('span.project-path', p.path),
          h('span.project-date', p.modified ? new Date(p.modified).toLocaleDateString() : ''),
        );
        row.addEventListener('click', async () => {
          if (p.current) return dialog.close();
          dialog.close();
          await this.open(p.id);
        });
        rows.append(row);
      }
    };
    fill();
    let name = '';
    const nameField = textField({ label: 'New project name', get: () => name, onCommit: (v) => { name = v; } });
    const body = h(
      'div.projects-dialog',
      h('div.build-section-title', 'Projects'),
      rows,
      h('p.hint', `New projects are created in ${list.root}`),
      nameField.el,
    );
    dialog = openDialog({
      title: 'Projects',
      width: 620,
      body,
      buttons: [
        { label: 'Close' },
        {
          label: 'Create',
          primary: createFirst,
          action: async () => {
            name = nameField.input.value.trim();
            if (!name) return false;
            await this.create(name);
          },
        },
      ],
    });
    if (createFirst) setTimeout(() => nameField.input.focus(), 0);
  }

  async confirmLeave() {
    if (this.editor.isPlaying) this.app.play.exit();
    return this.app.files.confirmDiscard();
  }

  async open(id) {
    if (!(await this.confirmLeave())) return;
    this.switching = true;
    try {
      const res = await this.app.agent.post('/api/projects/open', { id });
      await this.afterSwitch(res);
    } catch (err) {
      this.editor.log.error('Could not open project', err.message);
    } finally {
      this.switching = false;
    }
  }

  async create(name) {
    if (!(await this.confirmLeave())) return;
    this.switching = true;
    try {
      const res = await this.app.agent.post('/api/projects/create', { name });
      await this.afterSwitch(res);
    } catch (err) {
      this.editor.log.error('Could not create project', err.message);
    } finally {
      this.switching = false;
    }
  }

  async afterSwitch(info) {
    await this.app.agent.ping();
    this.editor.scene.markClean();
    this.editor.emit('project-changed');
    this.editor.log.info(`Opened project ${info.name}`);
    await this.app.files.openStartScene({ forget: true });
  }
}
