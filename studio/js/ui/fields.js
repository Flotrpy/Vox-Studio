// Inspector field controls. Every field factory returns { el, refresh }.
// Value flow: `onPreview(value)` while dragging/typing live, then
// `onCommit(value, before)` once, so a whole drag is a single undo step.

import { h } from './dom.js';
import { icon } from './icons.js';
import { openMenu } from './menu.js';
import { tooltip } from './tooltip.js';

// ---------------------------------------------------------------------------
// Number text: format and a tiny safe arithmetic parser ("2*3", "1/4+0.5").

export function formatNumber(v, integer = false) {
  if (!Number.isFinite(v)) return '0';
  if (integer) return String(Math.round(v));
  const rounded = Number(v.toFixed(5));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/** Evaluate + - * / and parentheses. Returns null for anything else. */
export function evalNumber(text) {
  const src = String(text).replace(/\s+/g, '');
  if (!src) return null;
  let i = 0;
  const peek = () => src[i];
  function number() {
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
    if (!m) throw new Error('number');
    i += m[0].length;
    return parseFloat(m[0]);
  }
  function factor() {
    if (peek() === '-') {
      i++;
      return -factor();
    }
    if (peek() === '+') {
      i++;
      return factor();
    }
    if (peek() === '(') {
      i++;
      const v = expr();
      if (peek() !== ')') throw new Error('paren');
      i++;
      return v;
    }
    return number();
  }
  function term() {
    let v = factor();
    while (peek() === '*' || peek() === '/') {
      const op = src[i++];
      const r = factor();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = src[i++];
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  try {
    const v = expr();
    return i === src.length && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function clamp(v, min, max) {
  if (min !== undefined && v < min) return min;
  if (max !== undefined && v > max) return max;
  return v;
}

// ---------------------------------------------------------------------------
// Layout

/** A labeled inspector row. */
export function fieldRow(label, control, { tip, className } = {}) {
  const labelEl = h('span.field-label', label);
  if (tip) tooltip(labelEl, tip);
  return h('div.field-row', { class: className }, labelEl, h('div.field-control', control));
}

// ---------------------------------------------------------------------------
// Scrubbing: drag horizontally on a label to change a number.

export function makeScrubbable(handle, { get, step = 0.05, min, max, integer, onBegin, onPreview, onEnd }) {
  handle.classList.add('scrub');
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    document.activeElement?.blur?.();
    const start = get();
    const before = onBegin?.();
    let moved = false;
    let accum = 0;
    let lastX = e.clientX;
    const move = (ev) => {
      const dx = ev.clientX - lastX;
      lastX = ev.clientX;
      if (!dx) return;
      moved = true;
      const speed = (ev.shiftKey ? 4 : 1) * (ev.altKey ? 0.25 : 1);
      accum += dx * speed;
      const s = Math.max(step, Math.abs(start) * 0.01);
      let v = start + accum * s;
      if (integer) v = Math.round(v);
      onPreview(clamp(v, min, max));
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      onEnd(moved, before);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

// ---------------------------------------------------------------------------
// Number input

export class NumberInput {
  constructor({ value = 0, min, max, integer = false, step = 1, onPreview, onCommit, ariaLabel }) {
    this.value = value;
    this.min = min;
    this.max = max;
    this.integer = integer;
    this.step = step;
    this.onPreview = onPreview;
    this.onCommit = onCommit;
    this.el = h('input.input.number', { type: 'text', spellcheck: false, inputmode: 'decimal', 'aria-label': ariaLabel });
    this.el.value = formatNumber(value, integer);
    this.editing = false;
    this.before = value;
    this.el.addEventListener('focus', () => {
      this.editing = true;
      this.before = this.value;
      this.el.select();
    });
    this.el.addEventListener('blur', () => {
      this.commitText();
      this.editing = false;
    });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.commitText();
        this.before = this.value;
        this.el.select();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.el.value = formatNumber(this.before, this.integer);
        this.value = this.before;
        this.onPreview?.(this.before);
        this.el.blur();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const dir = e.key === 'ArrowUp' ? 1 : -1;
        const amount = this.step * (e.shiftKey ? 10 : 1);
        this.set(clamp(this.value + dir * amount, this.min, this.max), true);
      }
    });
  }

  commitText() {
    const parsed = evalNumber(this.el.value);
    if (parsed === null) {
      this.el.value = formatNumber(this.value, this.integer);
      return;
    }
    const v = clamp(this.integer ? Math.round(parsed) : parsed, this.min, this.max);
    this.el.value = formatNumber(v, this.integer);
    if (v !== this.before) {
      const before = this.before;
      this.value = v;
      this.onCommit?.(v, before);
      this.before = v;
    }
  }

  set(v, commit = false) {
    const before = this.value;
    this.value = v;
    this.el.value = formatNumber(v, this.integer);
    if (commit) this.onCommit?.(v, before);
  }

  setValue(v) {
    if (this.editing) return;
    this.value = v;
    const text = formatNumber(v, this.integer);
    if (this.el.value !== text) this.el.value = text;
  }
}

// ---------------------------------------------------------------------------
// Field factories

export function numberField({ label, get, step = 0.05, min, max, integer, onPreview, onCommit, tip }) {
  const input = new NumberInput({ value: get(), min, max, integer, step: integer ? 1 : step, onPreview, onCommit, ariaLabel: label });
  const row = fieldRow(label, input.el, { tip });
  const labelEl = row.querySelector('.field-label');
  makeScrubbable(labelEl, {
    get,
    step,
    min,
    max,
    integer,
    onBegin: () => get(),
    onPreview: (v) => {
      input.setValue(v);
      onPreview?.(v);
    },
    onEnd: (moved, before) => {
      if (moved) onCommit?.(get(), before);
    },
  });
  return { el: row, refresh: () => input.setValue(get()) };
}

const AXES = ['X', 'Y', 'Z'];

export function vector3Field({ label, get, step = 0.05, min, onPreview, onCommit, tip }) {
  const inputs = [];
  const parts = AXES.map((axis, i) => {
    const axisLabel = h(`span.axis-label.axis-${axis.toLowerCase()}`, axis);
    const input = new NumberInput({
      value: get()[i],
      min,
      step,
      ariaLabel: `${label} ${axis}`,
      onPreview: (v) => {
        const next = get().slice();
        next[i] = v;
        onPreview?.(next);
      },
      onCommit: (v) => {
        const before = get().slice();
        const next = before.slice();
        next[i] = v;
        onCommit?.(next, before);
      },
    });
    inputs.push(input);
    makeScrubbable(axisLabel, {
      get: () => get()[i],
      step,
      min,
      onBegin: () => get().slice(),
      onPreview: (v) => {
        const next = get().slice();
        next[i] = v;
        input.setValue(v);
        onPreview?.(next);
      },
      onEnd: (moved, before) => {
        if (moved) onCommit?.(get().slice(), before);
      },
    });
    return h('span.vector-part', axisLabel, input.el);
  });
  const row = fieldRow(label, h('div.vector3', parts), { tip, className: 'vector-row' });
  return {
    el: row,
    refresh() {
      const v = get();
      inputs.forEach((input, i) => input.setValue(v[i]));
    },
  };
}

export function checkbox({ checked = false, onChange, label, tip }) {
  const el = h('button.check', { type: 'button', role: 'checkbox', 'aria-checked': String(!!checked), 'aria-label': label }, icon('check'));
  if (tip) tooltip(el, tip);
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    const next = el.getAttribute('aria-checked') !== 'true';
    el.setAttribute('aria-checked', String(next));
    onChange?.(next);
  });
  return {
    el,
    set(v) {
      el.setAttribute('aria-checked', String(!!v));
    },
  };
}

export function boolField({ label, get, onCommit, tip }) {
  const box = checkbox({ checked: get(), label, onChange: (v) => onCommit(v, !v) });
  return { el: fieldRow(label, box.el, { tip, className: 'bool-row' }), refresh: () => box.set(get()) };
}

export function dropdownButton({ get, items, label, onSelect, display = (v) => v }) {
  const value = h('span.value', display(get()));
  const el = h('button.dropdown-field', { type: 'button', 'aria-haspopup': 'listbox', 'aria-label': label }, value, icon('caret-down'));
  el.addEventListener('click', () => {
    const current = get();
    const list = typeof items === 'function' ? items() : items;
    openMenu(
      list.map((item) =>
        item.separator ? item : { label: item.label ?? display(item.value ?? item), checked: (item.value ?? item) === current, action: () => onSelect(item.value ?? item, current) },
      ),
      { anchor: el, keyboard: false },
    );
  });
  return {
    el,
    refresh() {
      value.textContent = display(get());
    },
  };
}

export function enumField({ label, get, values, onCommit, tip, display }) {
  const dd = dropdownButton({ get, items: values, label, display, onSelect: (v, before) => v !== before && onCommit(v, before) });
  return { el: fieldRow(label, dd.el, { tip }), refresh: dd.refresh };
}

export function textField({ label, get, onCommit, tip, maxLength = 128 }) {
  const input = h('input.input', { type: 'text', spellcheck: false, maxLength, 'aria-label': label });
  input.value = get();
  let before = input.value;
  input.addEventListener('focus', () => {
    before = get();
  });
  const commit = () => {
    if (input.value !== before) {
      onCommit(input.value, before);
      before = input.value;
    }
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      commit();
      input.blur();
    } else if (e.key === 'Escape') {
      input.value = before;
      input.blur();
    }
  });
  return {
    el: label === null ? input : fieldRow(label, input, { tip }),
    input,
    refresh() {
      if (document.activeElement !== input) input.value = get();
    },
  };
}

export function colorField({ label, get, onPreview, onCommit, tip }) {
  const swatch = h('span.color-swatch-fill');
  const picker = h('input.color-native', { type: 'color', tabindex: '-1', 'aria-hidden': 'true' });
  const button = h('button.color-swatch', { type: 'button', 'aria-label': `${label} color` }, swatch, picker);
  let before = get();
  const paint = (v) => {
    swatch.style.background = v;
    picker.value = v.toLowerCase();
  };
  paint(get());
  button.addEventListener('click', () => {
    before = get();
    picker.click();
  });
  picker.addEventListener('input', () => {
    const v = picker.value.toUpperCase();
    swatch.style.background = v;
    onPreview?.(v);
  });
  picker.addEventListener('change', () => {
    const v = picker.value.toUpperCase();
    if (v !== before) onCommit(v, before);
    before = v;
  });
  return { el: fieldRow(label, button, { tip }), refresh: () => paint(get()) };
}

export function sliderField({ label, get, min = 0, max = 1, invert = false, onPreview, onCommit, tip }) {
  const toView = (v) => (invert ? max + min - v : v);
  const thumb = h('span.thumb');
  const slider = h('div.slider', { role: 'slider', tabindex: '0', 'aria-valuemin': min, 'aria-valuemax': max, 'aria-label': label }, h('span.track'), thumb);
  const input = new NumberInput({
    value: toView(get()),
    min,
    max,
    step: (max - min) / 100,
    ariaLabel: label,
    onPreview: (v) => onPreview?.(toView(v)),
    onCommit: (v) => onCommit(toView(v), get()),
  });
  const place = () => {
    const t = (toView(get()) - min) / (max - min || 1);
    thumb.style.left = `calc(4px + (100% - 8px) * ${Math.min(1, Math.max(0, t))})`;
    slider.setAttribute('aria-valuenow', formatNumber(toView(get())));
  };
  const fromPointer = (e) => {
    const r = slider.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (e.clientX - r.left - 4) / (r.width - 8)));
    return toView(min + t * (max - min));
  };
  slider.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    slider.setPointerCapture(e.pointerId);
    const before = get();
    const move = (ev) => {
      const v = Number(fromPointer(ev).toFixed(3));
      onPreview?.(v);
      input.setValue(toView(v));
      place();
    };
    move(e);
    const up = () => {
      slider.removeEventListener('pointermove', move);
      slider.removeEventListener('pointerup', up);
      if (get() !== before) onCommit(get(), before);
    };
    slider.addEventListener('pointermove', move);
    slider.addEventListener('pointerup', up);
  });
  slider.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const dir = (e.key === 'ArrowRight' ? 1 : -1) * (invert ? -1 : 1);
    const before = get();
    const v = clamp(before + dir * (max - min) * 0.05, min, max);
    onCommit(Number(v.toFixed(3)), before);
  });
  place();
  const row = fieldRow(label, h('div.slider-field', slider, input.el), { tip });
  return {
    el: row,
    refresh() {
      input.setValue(toView(get()));
      place();
    },
  };
}

export function codeField({ get, onCommit, label = 'Source' }) {
  const area = h('textarea.input.code', { spellcheck: false, rows: 12, wrap: 'off', 'aria-label': label });
  area.value = get();
  let before = area.value;
  area.addEventListener('focus', () => {
    before = get();
  });
  area.addEventListener('blur', () => {
    if (area.value !== before) {
      onCommit(area.value, before);
      before = area.value;
    }
  });
  area.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: end } = area;
      area.setRangeText('  ', s, end, 'end');
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      area.blur();
    } else if (e.key === 'Escape') {
      area.value = before;
      area.blur();
    }
  });
  return {
    el: h('div.code-field', area),
    refresh() {
      if (document.activeElement !== area) area.value = get();
    },
  };
}
