// Play / Pause / Step / Stop for the editor. Entering Play snapshots the
// scene; anything that changes while playing (simulation or manual edits)
// is discarded when Play stops, matching the familiar editor behavior.

import { PlayRuntime } from 'vox/play/runtime.js';
import { Input } from 'vox/play/scripting.js';

const STEP_DT = 1 / 60;

export class PlayMode {
  constructor(app) {
    this.app = app;
    this.editor = app.editor;
    this.runtime = null;
    this.snapshot = null;
    this.input = new Input();
    this.stepRequested = false;
    this.switchedToGame = false;
  }

  get state() {
    return this.editor.playState;
  }

  setState(state) {
    this.editor.playState = state;
    document.body.classList.toggle('playing', state !== 'edit');
    document.body.classList.toggle('paused', state === 'paused');
    this.editor.emit('play-state', state);
  }

  togglePlay() {
    if (this.state === 'edit') this.enter();
    else this.exit();
  }

  togglePause() {
    if (this.state === 'edit') {
      this.enter(true);
      return;
    }
    this.setState(this.state === 'paused' ? 'playing' : 'paused');
  }

  step() {
    if (this.state === 'edit') this.enter(true);
    else if (this.state === 'playing') this.setState('paused');
    this.stepRequested = true;
  }

  enter(paused = false) {
    const { editor, app } = this;
    const consolePanel = app.panels.console;
    if (consolePanel.clearOnPlay) editor.log.clear();
    const scene = editor.scene;
    this.snapshot = {
      data: scene.toData(),
      path: scene.path,
      dirty: scene.dirty,
      selection: editor.selection.ids.slice(),
    };
    // Edits made while playing are thrown away, so they do not enter undo.
    editor.history.seal();
    editor.history.enabled = false;

    this.switchedToGame = !app.dock.isVisible('game');
    app.dock.openPanel('game');
    const canvas = app.panels.game.canvas;
    this.input.attach(canvas);
    canvas.focus({ preventScroll: true });

    this.runtime = new PlayRuntime({
      source: scene,
      builder: app.builder,
      input: this.input,
      log: (type, message, detail) => editor.log.add(type, message, detail),
      notify: (entity, path) => scene.emit('change', { id: entity.id, path }),
      onError: () => {
        if (consolePanel.errorPause && this.state === 'playing') {
          this.setState('paused');
          editor.log.warn('Paused on error (Error Pause is on)');
        }
      },
    });
    this.setState(paused ? 'paused' : 'playing');
    editor.log.info('Entered Play mode');
    this.runtime.start();
  }

  exit() {
    const { editor, app } = this;
    if (this.state === 'edit') return;
    this.runtime?.stop();
    this.runtime = null;
    this.input.detach();
    const snap = this.snapshot;
    this.snapshot = null;
    this.setState('edit');
    editor.scene.load(snap.data, { path: snap.path });
    if (snap.dirty) editor.scene.markDirty();
    editor.selection.set(snap.selection.filter((id) => editor.scene.has(id)));
    editor.history.enabled = true;
    if (this.switchedToGame) app.dock.openPanel('scene');
    editor.log.info('Exited Play mode. Changes made during play were discarded.');
  }

  /** Called every animation frame by the app loop. */
  tick(dt) {
    if (!this.runtime) return;
    if (this.state === 'playing') {
      this.runtime.update(dt);
    } else if (this.stepRequested) {
      this.runtime.update(STEP_DT);
    }
    this.stepRequested = false;
  }

  menuItems() {
    const playing = this.state !== 'edit';
    return [
      { label: playing ? 'Stop' : 'Play', shortcut: 'Ctrl+P', action: () => this.togglePlay() },
      { label: 'Pause', shortcut: 'Ctrl+Shift+P', checked: this.state === 'paused', action: () => this.togglePause() },
      { label: 'Step', shortcut: 'Ctrl+Alt+P', action: () => this.step() },
    ];
  }
}
