// Main toolbar: transform tools and handle modes on the left, Play / Pause /
// Step in the center, agent status and layout selector on the right.

import { h } from './dom.js';
import { icon } from './icons.js';
import { openMenu } from './menu.js';
import { tooltip } from './tooltip.js';

const TOOLS = [
  ['hand', 'hand', 'Hand Tool (Q)\nDrag to pan the view'],
  ['move', 'move', 'Move Tool (W)'],
  ['rotate', 'rotate', 'Rotate Tool (E)'],
  ['scale', 'scale', 'Scale Tool (R)'],
  ['rect', 'rect', 'Rect Tool (T)'],
  ['transform', 'transform', 'Move, Rotate or Scale Tool (Y)'],
];

export class Toolbar {
  constructor(el, editor, { layoutItems, layoutName, onAgentClick, onPlay, onPause, onStep }) {
    this.editor = editor;
    this.layoutName = layoutName;

    this.toolButtons = TOOLS.map(([id, iconName, tip]) => {
      const b = h('button.tool', { type: 'button', 'aria-pressed': 'false', dataset: { tool: id } }, icon(iconName));
      tooltip(b, tip);
      b.addEventListener('click', () => editor.setTool(id));
      return b;
    });

    this.pivotBtn = h('button.tool.text.wide', { type: 'button' }, icon('transform-comp'), h('span.label'));
    tooltip(this.pivotBtn, 'Tool handle position (Z)\nPivot: at the active object\nCenter: at the selection center');
    this.pivotBtn.addEventListener('click', () => editor.setPivotMode(editor.pivotMode === 'pivot' ? 'center' : 'pivot'));

    this.spaceBtn = h('button.tool.text.wide', { type: 'button' }, icon('gameobject'), h('span.label'));
    tooltip(this.spaceBtn, 'Tool handle rotation (X)\nGlobal: world axes\nLocal: object axes');
    this.spaceBtn.addEventListener('click', () => editor.setSpace(editor.space === 'global' ? 'local' : 'global'));

    this.playBtn = h('button.tool.wide', { type: 'button', 'aria-pressed': 'false' }, icon('play'));
    this.pauseBtn = h('button.tool.wide', { type: 'button', 'aria-pressed': 'false' }, icon('pause'));
    this.stepBtn = h('button.tool.wide', { type: 'button' }, icon('step'));
    tooltip(this.playBtn, 'Play (Ctrl+P)');
    tooltip(this.pauseBtn, 'Pause (Ctrl+Shift+P)');
    tooltip(this.stepBtn, 'Step one frame (Ctrl+Alt+P)');
    this.playBtn.addEventListener('click', () => onPlay?.());
    this.pauseBtn.addEventListener('click', () => onPause?.());
    this.stepBtn.addEventListener('click', () => onStep?.());

    this.agentEl = h('button.agent-status', { type: 'button' }, h('span.dot'), h('span.agent-label', 'Agent'));
    tooltip(this.agentEl, 'Vox Agent connection');
    this.agentEl.addEventListener('click', onAgentClick);

    this.layoutBtn = h('button.tool.text.dropdown', { type: 'button' }, icon('layout'), h('span.layout-label', layoutName()));
    tooltip(this.layoutBtn, 'Window layout');
    this.layoutBtn.addEventListener('click', () => openMenu(layoutItems(), { anchor: this.layoutBtn, minWidth: 180 }));

    el.append(
      h('div.left', h('div.tool-group', this.toolButtons), h('div.tool-group', this.pivotBtn, this.spaceBtn)),
      h('div.center', h('div.tool-group', this.playBtn, this.pauseBtn, this.stepBtn)),
      h('div.right', this.agentEl, this.layoutBtn),
    );

    editor.on('tool', () => this.update());
    editor.on('play-state', () => this.update());
    this.update();
  }

  update() {
    const { editor } = this;
    for (const b of this.toolButtons) {
      const on = b.dataset.tool === editor.tool;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    this.pivotBtn.querySelector('.label').textContent = editor.pivotMode === 'pivot' ? 'Pivot' : 'Center';
    this.spaceBtn.querySelector('.label').textContent = editor.space === 'global' ? 'Global' : 'Local';
    const playing = editor.playState !== 'edit';
    this.playBtn.classList.toggle('on', playing);
    this.playBtn.dataset.tip = playing ? 'Stop (Ctrl+P)' : 'Play (Ctrl+P)';
    this.playBtn.setAttribute('aria-pressed', String(playing));
    this.pauseBtn.classList.toggle('on', editor.playState === 'paused');
    this.pauseBtn.setAttribute('aria-pressed', String(editor.playState === 'paused'));
    this.layoutBtn.querySelector('.layout-label').textContent = this.layoutName();
  }

  setAgentStatus(status, info) {
    const labels = {
      connected: 'Agent: Connected',
      connecting: 'Agent: Connecting',
      offline: 'Agent: Offline',
      unpaired: 'Agent: Not Paired',
    };
    this.agentEl.className = `agent-status ${status}`;
    this.agentEl.querySelector('.agent-label').textContent = labels[status] || 'Agent';
    const detail =
      status === 'connected'
        ? `Vox Agent ${info?.version || ''} is running.\nProject: ${info?.project || ''}`
        : status === 'unpaired'
          ? 'Not paired. Start "node agent/agent.js" and open the URL it prints.'
          : 'The Vox Agent is not reachable. Work is kept in browser storage.';
    this.agentEl.dataset.tip = detail;
  }
}
