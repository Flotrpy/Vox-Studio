// Delayed tooltips for any element with a data-tip attribute. Icon buttons
// also get the text as their accessible name.

import { h } from './dom.js';

const DELAY_MS = 550;
let tip = null;
let timer = 0;
let current = null;

function hide() {
  clearTimeout(timer);
  current = null;
  tip?.remove();
  tip = null;
}

function show(target, x, y) {
  const text = target.dataset.tip;
  if (!text || !target.isConnected) return;
  tip = h('div.tooltip', { role: 'tooltip' }, text);
  document.body.append(tip);
  const rect = tip.getBoundingClientRect();
  const left = Math.min(x + 2, window.innerWidth - rect.width - 4);
  let top = y + 18;
  if (top + rect.height > window.innerHeight - 4) top = y - rect.height - 6;
  tip.style.left = `${Math.max(4, left)}px`;
  tip.style.top = `${Math.max(4, top)}px`;
}

/** Attach a tooltip to an element and give it an accessible label. */
export function tooltip(el, text) {
  el.dataset.tip = text;
  if (!el.getAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', text.split('\n')[0]);
  return el;
}

export function installTooltips(root = document) {
  root.addEventListener('pointerover', (e) => {
    const target = e.target.closest?.('[data-tip]');
    if (target === current) return;
    hide();
    if (!target) return;
    current = target;
    const { clientX, clientY } = e;
    timer = setTimeout(() => show(target, clientX, clientY), DELAY_MS);
  });
  root.addEventListener('pointerdown', hide, true);
  root.addEventListener('keydown', hide, true);
  window.addEventListener('blur', hide);
  root.addEventListener('focusin', (e) => {
    // Keyboard focus shows the tooltip too.
    const target = e.target.closest?.('[data-tip]');
    if (!target || !target.matches(':focus-visible')) return;
    hide();
    current = target;
    const rect = target.getBoundingClientRect();
    timer = setTimeout(() => show(target, rect.left, rect.bottom - 14), DELAY_MS);
  });
  root.addEventListener('focusout', hide);
}
