// Agent panel: connection state, this machine's memory and CPU as reported
// by the Vox Agent, and the fixed CPU / memory benchmarks.

import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { tooltip } from '../ui/tooltip.js';

const POLL_MS = 3000;

function gb(bytes) {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function mb(bytes) {
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

export class AgentPanel {
  constructor(editor, agent) {
    this.editor = editor;
    this.agent = agent;
    this.id = 'agent';
    this.title = 'Agent';
    this.icon = 'plug';
    this.visible = false;
    this.info = null;
    this.results = [];
    this.busy = false;

    const refresh = h('button.tb-btn', { type: 'button' }, icon('refresh'));
    tooltip(refresh, 'Refresh');
    refresh.addEventListener('click', () => this.refresh());
    this.cpuBtn = h('button.tb-btn', { type: 'button' }, 'CPU Benchmark');
    this.memBtn = h('button.tb-btn', { type: 'button' }, 'Memory Benchmark');
    tooltip(this.cpuBtn, 'Run a 1 second CPU benchmark on this machine');
    tooltip(this.memBtn, 'Run a 1 second memory bandwidth benchmark on this machine');
    this.cpuBtn.addEventListener('click', () => this.bench('cpu'));
    this.memBtn.addEventListener('click', () => this.bench('memory'));

    this.body = h('div.agent-body');
    this.element = h('div.panel.agent-panel', { dataset: { panel: 'agent' } }, h('div.panel-toolbar', refresh, h('span.tb-sep'), this.cpuBtn, this.memBtn), this.body);
    agent.on('status', () => this.refresh());
    this.render();
  }

  onShow() {
    this.visible = true;
    this.refresh();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.refresh(), POLL_MS);
  }

  onHide() {
    this.visible = false;
    clearInterval(this.timer);
  }

  async refresh() {
    if (!this.visible) return;
    if (this.agent.connected) {
      try {
        this.info = await this.agent.get('/api/system');
      } catch {
        this.info = null;
      }
    } else {
      this.info = null;
    }
    this.render();
  }

  async bench(kind) {
    if (this.busy || !this.agent.connected) return;
    this.busy = true;
    this.render();
    try {
      const r = await this.agent.post('/api/benchmark', { kind, durationMs: 1000 });
      const value = kind === 'cpu' ? `${r.opsPerSecond.toLocaleString()} ${r.unit}` : `${r.mbPerSecond.toLocaleString()} ${r.unit}`;
      this.results.unshift({ kind, value, time: new Date() });
      this.results.length = Math.min(this.results.length, 6);
      this.editor.log.info(`${kind === 'cpu' ? 'CPU' : 'Memory'} benchmark: ${value}`);
    } catch (err) {
      this.editor.log.error('Benchmark failed', err.message);
    }
    this.busy = false;
    this.render();
  }

  row(label, value) {
    return h('div.field-row', h('span.field-label', label), h('div.field-control', h('span.agent-value', value)));
  }

  bar(used, total) {
    const pct = total > 0 ? Math.round((used / total) * 100) : 0;
    return h('div.field-row', h('span.field-label', 'Used'), h('div.field-control', h('div.meter', h('div.meter-fill', { style: { width: `${pct}%` } })), h('span.agent-value.meter-text', `${pct}%`)));
  }

  section(title, ...rows) {
    return h('section.agent-section', h('div.agent-section-title', title), ...rows);
  }

  render() {
    clear(this.body);
    const connected = this.agent.connected;
    this.cpuBtn.disabled = this.memBtn.disabled = !connected || this.busy;
    const status = { connected: 'Connected', connecting: 'Connecting', offline: 'Offline', unpaired: 'Not paired' }[this.agent.status] || this.agent.status;
    this.body.append(
      this.section(
        'Vox Agent',
        this.row('Status', status),
        this.row('Version', this.agent.info?.version || '-'),
        this.row('Project', this.agent.info?.project || '-'),
      ),
    );
    if (!connected) {
      this.body.append(h('p.agent-hint', 'Start the agent with "node agent/agent.js" and open the Studio URL it prints to see this machine\'s RAM and CPU and run heavy jobs locally.'));
      return;
    }
    const i = this.info;
    if (i) {
      this.body.append(
        this.section('Memory', this.row('Total', gb(i.memory.total)), this.row('Free', gb(i.memory.free)), this.bar(i.memory.total - i.memory.free, i.memory.total), this.row('Agent process', mb(i.memory.agentRss))),
        this.section('CPU', this.row('Model', i.cpu.model), this.row('Cores', String(i.cpu.cores)), this.row('Load (1m)', i.cpu.loadAverage[0].toFixed(2))),
        this.section('System', this.row('Platform', `${i.platform} ${i.arch}`), this.row('Node.js', i.node)),
      );
    }
    const results = this.results.map((r) => this.row(`${r.kind === 'cpu' ? 'CPU' : 'Memory'} ${r.time.toTimeString().slice(0, 8)}`, r.value));
    this.body.append(this.section('Benchmarks', ...(this.busy ? [h('p.agent-hint', 'Running...')] : []), ...(results.length ? results : [h('p.agent-hint', 'No benchmark run yet.')])));
  }
}
