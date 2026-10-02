// Small DOM helpers. `h('div.row.selected', { onclick }, child, ...)`.

export function h(tag, props, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === 'class') {
        el.className += (el.className ? ' ' : '') + value;
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(el.style, value);
      } else if (key === 'dataset') {
        Object.assign(el.dataset, value);
      } else if (key in el && typeof value !== 'string') {
        el[key] = value;
      } else {
        el.setAttribute(key, value === true ? '' : value);
      }
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : String(child));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** True when keyboard focus is inside a text-entry control. */
export function isTyping(target = document.activeElement) {
  if (!target) return false;
  const tag = target.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') return !['checkbox', 'radio', 'button', 'range', 'color'].includes(target.type);
  return target.isContentEditable === true;
}

/** Track a pointer drag after a small threshold. Returns a cleanup function. */
export function dragTracker(event, { threshold = 3, onStart, onMove, onEnd } = {}) {
  const startX = event.clientX;
  const startY = event.clientY;
  let started = false;
  const move = (e) => {
    if (!started) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < threshold) return;
      started = true;
      onStart?.(e);
    }
    onMove?.(e, e.clientX - startX, e.clientY - startY);
  };
  const up = (e) => {
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    onEnd?.(e, started);
  };
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  return up;
}
