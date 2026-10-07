// Vox Studio entry point: builds the editor, panels, dock layout, menus,
// toolbar, status bar and hotkeys, connects to the Vox Agent and runs the
// render loop.

import { Editor } from './core/editor.js';
import { load, save } from './core/storage.js';
import { AgentClient } from './agent-client.js';
import { AgentProject, LocalProject } from './project-store.js';
import { SceneFiles } from './scene-files.js';
import { SceneBuilder } from './viewport/scene-builder.js';
import { bindSceneModel } from './viewport/scene-sync.js';
import { SceneView } from './panels/scene-view.js';
import { GameView } from './panels/game-view.js';
import { HierarchyPanel } from './panels/hierarchy.js';
import { InspectorPanel } from './panels/inspector.js';
import { ConsolePanel } from './panels/console.js';
import { ProjectPanel } from './panels/project.js';
import { AgentPanel } from './panels/agent-panel.js';
import { DockManager } from './ui/dock.js';
import { LAYOUT_PRESETS, DEFAULT_LAYOUT, PANEL_NEIGHBORS, PANEL_FALLBACK_SIDE } from './ui/layouts.js';
import { layoutSignature, normalizeLayout } from './ui/dock-layout.js';
import { MenuBar } from './ui/menu.js';
import { installTooltips } from './ui/tooltip.js';
import { Toolbar } from './ui/toolbar.js';
import { StatusBar } from './ui/statusbar.js';
import { h } from './ui/dom.js';
import { openDialog } from './ui/dialog.js';
import { buildMenus } from './app-menus.js';
import { Hotkeys } from './hotkeys.js';
import { VERSION } from './version.js';
import { PlayMode } from './play-mode.js';
import { BuildCommands } from './build.js';
import { applyTheme, showPreferences } from './preferences.js';
import { icon } from './ui/icons.js';

const LAYOUT_KEY = 'layout';
const LAYOUT_VERSION = 1;

class App {
  constructor() {
    this.editor = new Editor();
    this.agent = new AgentClient();
    this.editor.agent = this.agent;
    this.editor.project = new LocalProject();
    this.files = new SceneFiles(this.editor);
    this.builder = new SceneBuilder();
    this.panelOrder = [
      ['scene', 'Ctrl+1'],
      ['game', 'Ctrl+2'],
      ['inspector', 'Ctrl+3'],
      ['hierarchy', 'Ctrl+4'],
      ['project', 'Ctrl+5'],
      ['console', 'Ctrl+Shift+C'],
      ['agent', 'Ctrl+9'],
    ];
    this.extensions = { fileItems: [], helpItems: [], playItems: [] };
  }

  start() {
    const { editor } = this;
    applyTheme();
    installTooltips();
    bindSceneModel(this.builder, editor.scene, () => this.invalidateViews());

    this.panels = {
      scene: new SceneView(editor, this.builder),
      game: new GameView(editor, this.builder),
      hierarchy: new HierarchyPanel(editor),
      inspector: new InspectorPanel(editor),
      project: new ProjectPanel(editor),
      console: new ConsolePanel(editor),
      agent: new AgentPanel(editor, this.agent),
    };

    this.dock = new DockManager(document.getElementById('dock'), new Map(Object.values(this.panels).map((p) => [p.id, p])), {
      neighbors: PANEL_NEIGHBORS,
      fallbackSide: PANEL_FALLBACK_SIDE,
    });
    this.play = new PlayMode(this);
    this.extensions.playItems.push(() => this.play.menuItems());
    this.builds = new BuildCommands(this);
    this.extensions.fileItems.push(() => this.builds.menuItems());
    this.beforeRender = (dt) => this.play.tick(dt);

    this.dock.on('change', (tree) => {
      // Rearranging panels by hand turns the named preset into "Custom".
      if (this.currentLayout && LAYOUT_PRESETS[this.currentLayout]) {
        const preset = normalizeLayout(LAYOUT_PRESETS[this.currentLayout](), this.dock.known);
        if (layoutSignature(preset) !== layoutSignature(tree)) this.currentLayout = null;
      }
      save(LAYOUT_KEY, { version: LAYOUT_VERSION, name: this.currentLayout, tree });
      this.toolbar?.update();
    });
    this.restoreLayout();

    this.toolbar = new Toolbar(document.getElementById('toolbar'), editor, {
      layoutItems: () => [
        ...Object.keys(LAYOUT_PRESETS).map((name) => ({ label: name, checked: this.currentLayout === name, action: () => this.applyLayout(name) })),
        { separator: true },
        { label: 'Reset All Layouts', action: () => this.applyLayout(DEFAULT_LAYOUT) },
      ],
      layoutName: () => this.layoutName(),
      onAgentClick: () => this.showAgentInfo(),
      onPlay: () => this.play.togglePlay(),
      onPause: () => this.play.togglePause(),
      onStep: () => this.play.step(),
    });
    this.statusbar = new StatusBar(document.getElementById('statusbar'), editor, {
      onMessageClick: () => this.dock.openPanel('console'),
    });
    this.menubar = new MenuBar(document.getElementById('menubar'), buildMenus(this));
    this.addBrand();
    this.bindHotkeys();
    this.bindEditorEvents();
    this.bindAgent();
    this.loop();

    editor.log.info(`Vox Studio ${VERSION} ready`);
    this.connect();
  }

  // Layout ---------------------------------------------------------------------

  layoutName() {
    return this.currentLayout || 'Custom';
  }

  restoreLayout() {
    const stored = load(LAYOUT_KEY, null);
    if (stored?.version === LAYOUT_VERSION && stored.tree) {
      this.currentLayout = stored.name;
      this.dock.setLayout(stored.tree);
      if (this.dock.layout) return;
    }
    this.applyLayout(DEFAULT_LAYOUT);
  }

  applyLayout(name) {
    this.currentLayout = name;
    this.dock.setLayout(LAYOUT_PRESETS[name]());
    this.toolbar?.update();
  }

  addBrand() {
    const brand = h('div.menubar-brand', { title: 'Vox Studio' }, icon('favicon'));
    document.getElementById('menubar').prepend(brand);
  }

  // Extension points used by later features (play mode, builds) ------------------

  extraFileItems() {
    return this.extensions.fileItems.flatMap((fn) => fn());
  }

  extraHelpItems() {
    return this.extensions.helpItems.flatMap((fn) => fn());
  }

  playItems() {
    return this.extensions.playItems.flatMap((fn) => fn());
  }

  // Commands ---------------------------------------------------------------------

  importAssets() {
    return this.files.importDialog();
  }

  focusAddComponent() {
    this.dock.openPanel('inspector');
    this.panels.inspector.element.querySelector('.add-component')?.click();
  }

  async openSceneDialog() {
    const scenes = (await this.panels.project.allEntries().catch(() => [])).filter((e) => e.ext === '.voxscene');
    const list = h('div.scene-picker', { role: 'listbox' });
    let dialog;
    if (!scenes.length) list.append(h('p', 'No scenes in this project yet. Use File > Load Scene File to open a .voxscene file from disk.'));
    for (const s of scenes) {
      const row = h('button.scene-pick', { type: 'button' }, s.path);
      row.addEventListener('click', () => {
        dialog.close();
        this.files.openScene(s.path);
      });
      list.append(row);
    }
    dialog = openDialog({ title: 'Open Scene', body: list, width: 420, buttons: [{ label: 'Cancel' }] });
  }

  showAgentInfo() {
    const { agent } = this;
    if (agent.connected) {
      this.dock.openPanel('agent');
      return;
    }
    const lines =
      agent.status === 'connected'
        ? [`Connected to Vox Agent ${agent.info?.version || ''}.`, `Project: ${agent.info?.project || ''}`, 'Scenes and assets are read from and saved to the project folder on disk.']
        : [
            'Vox Studio is not paired with a Vox Agent, so work is kept in this browser only.',
            'To use your project folder, run this in a terminal from the vox-studio folder:',
            'node agent/agent.js',
            'Then open the Studio URL it prints (it contains a one-time pairing token).',
          ];
    openDialog({
      title: 'Vox Agent',
      width: 460,
      body: h('div', lines.map((l) => (l.startsWith('node ') ? h('pre.mono.command', l) : h('p', l)))),
      buttons: [
        { label: 'Retry', action: () => { this.agent.ping(); } },
        { label: 'Close', primary: true },
      ],
    });
  }

  // Wiring -------------------------------------------------------------------------

  bindHotkeys() {
    const { editor, files } = this;
    const hk = new Hotkeys();
    this.hotkeys = hk;
    // While playing, plain keys typed into the Game view belong to the game.
    hk.filter = (e, combo) => editor.isPlaying && !combo.startsWith('Ctrl+') && !!e.target.closest?.('.game-view');
    const tools = { Q: 'hand', W: 'move', E: 'rotate', R: 'scale', T: 'rect', Y: 'transform' };
    for (const [key, tool] of Object.entries(tools)) hk.bind(key, () => editor.setTool(tool));
    hk.bind('Z', () => editor.setPivotMode(editor.pivotMode === 'pivot' ? 'center' : 'pivot'));
    hk.bind('X', () => editor.setSpace(editor.space === 'global' ? 'local' : 'global'));
    hk.bind('F', () => editor.frameSelected());
    hk.bind(['Delete', 'Backspace'], () => editor.deleteSelection());
    hk.bind('Ctrl+D', () => editor.duplicateSelection());
    hk.bind('Ctrl+C', () => editor.copySelection());
    hk.bind('Ctrl+V', () => editor.paste());
    hk.bind('Ctrl+A', () => editor.selectAll());
    hk.bind('Shift+D', () => editor.selection.clear());
    hk.bind('Ctrl+Z', () => editor.undo());
    hk.bind(['Ctrl+Y', 'Ctrl+Shift+Z'], () => editor.redo());
    hk.bind('Ctrl+S', () => files.save());
    hk.bind('Ctrl+Shift+S', () => files.saveAs());
    hk.bind('Ctrl+N', () => files.newScene());
    hk.bind('Ctrl+O', () => this.openSceneDialog());
    hk.bind('Ctrl+R', () => editor.emit('project-refresh'));
    hk.bind('Ctrl+P', () => this.play.togglePlay());
    hk.bind('Ctrl+Shift+P', () => this.play.togglePause());
    hk.bind('Ctrl+Alt+P', () => this.play.step());
    hk.bind('Ctrl+Shift+B', () => this.builds.showDialog());
    hk.bind('Ctrl+B', () => this.builds.build({ run: true }));
    hk.bind('Ctrl+,', () => showPreferences());
    hk.bind('Ctrl+Shift+N', () => editor.createObject('Empty'));
    hk.bind('Alt+Shift+N', () => editor.createObject('Empty', { asChild: true }));
    hk.bind('Ctrl+Shift+F', () => this.panels.scene.alignWithView());
    hk.bind('Ctrl+Alt+F', () => this.panels.scene.moveToView());
    hk.bind('Ctrl+Shift+A', () => this.focusAddComponent());
    hk.bind('F2', () => {
      if (editor.selection.active) this.panels.hierarchy.beginRename(editor.selection.active);
    });
    hk.bind('Shift+Space', () => {
      const group = [...this.dock.groupEls.entries()].find(([el]) => el.matches(':hover'))?.[1];
      if (group) this.dock.toggleMaximize(group);
    });
    this.panelOrder.forEach(([id, shortcut]) => hk.bind(shortcut, () => this.dock.openPanel(id)));
  }

  bindEditorEvents() {
    const { editor, files } = this;
    editor.on('command', (cmd) => {
      const name = typeof cmd === 'string' ? cmd : cmd.name;
      if (name === 'save') files.save();
      else if (name === 'save-as') files.saveAs();
      else if (name === 'import') this.importAssets();
      else if (name === 'open-scene') files.openScene(cmd.path);
      else if (name === 'new-scene-asset') files.createSceneAsset(cmd.dir);
    });
    editor.on('drop-asset', (payload) => files.instantiate(payload));
    editor.on('import-files', (list) => files.importFiles(list));
    editor.on('scene-loaded', () => this.updateStatus());
    editor.scene.on('dirty', () => this.updateStatus());
    editor.on('created', () => this.dock.openPanel('inspector'));
    window.addEventListener('beforeunload', (e) => {
      if (editor.scene.dirty && this.agent.connected) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  updateStatus() {
    const { scene } = this.editor;
    const where = this.editor.project.kind === 'agent' ? scene.path || 'unsaved' : `${scene.path || 'unsaved'} (browser)`;
    this.statusbar.setRight(`${where}${scene.dirty ? ' *' : ''}`);
  }

  bindAgent() {
    this.agent.on('status', (status) => {
      this.toolbar.setAgentStatus(status, this.agent.info);
      const wasAgent = this.editor.project.kind === 'agent';
      if (status === 'connected' && !wasAgent) {
        this.editor.project = new AgentProject(this.agent);
        this.editor.log.info(`Connected to Vox Agent ${this.agent.info?.version || ''} (project: ${this.agent.info?.project || ''})`);
        this.editor.emit('project-changed');
      } else if (status !== 'connected' && wasAgent) {
        this.editor.log.warn('Lost connection to the Vox Agent. Save will fail until it is running again.');
      }
      this.updateStatus();
    });
    this.toolbar.setAgentStatus(this.agent.status, null);
  }

  async connect() {
    const ok = await this.agent.ping();
    if (ok) {
      this.editor.project = new AgentProject(this.agent);
      this.editor.emit('project-changed');
      await this.files.openStartScene();
    } else {
      this.editor.emit('project-changed');
      if (!this.files.restoreAutosave()) await this.files.openStartScene();
      this.editor.log.warn(
        this.agent.status === 'unpaired'
          ? 'Not paired with a Vox Agent. Run "node agent/agent.js" and open the URL it prints to work with files on disk.'
          : 'Vox Agent is not reachable. Your work is kept in browser storage.',
      );
    }
    this.toolbar.setAgentStatus(this.agent.status, this.agent.info);
    this.agent.startPolling();
    this.updateStatus();
  }

  invalidateViews() {
    this.panels?.scene.invalidate();
    this.panels?.game.invalidate();
  }

  loop() {
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.beforeRender?.(dt);
      const { scene, game } = this.panels;
      scene.tick(dt);
      if (scene.visible && scene.needsRender) scene.render();
      if (game.visible && (game.needsRender || this.editor.isPlaying)) {
        game.render();
        scene.gameAspect = game.renderer ? game.renderer.domElement.width / Math.max(1, game.renderer.domElement.height) : 16 / 9;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
}

const app = new App();
window.voxStudio = app;
app.start();

export default app;
