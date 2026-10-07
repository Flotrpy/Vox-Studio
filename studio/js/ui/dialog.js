// Modal dialogs (About, Build Settings, confirmations).

import { h } from './dom.js';
import { icon } from './icons.js';
import { tooltip } from './tooltip.js';

let openCount = 0;

export function isDialogOpen() {
  return openCount > 0;
}

/**
 * Open a modal. buttons: [{ label, primary, action(close) }]. An action that
 * returns false keeps the dialog open.
 */
export function openDialog({ title, body, buttons = [{ label: 'Close', primary: true }], width, onClose }) {
  const previousFocus = document.activeElement;
  const closeBtn = h('button.tb-btn', { type: 'button' }, icon('close'));
  tooltip(closeBtn, 'Close');
  const footer = h('div.dialog-footer');
  const dialog = h(
    'div.dialog',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div.dialog-title', h('span', title), closeBtn),
    h('div.dialog-body', body),
    buttons.length ? footer : null,
  );
  if (width) dialog.style.width = `${width}px`;
  const backdrop = h('div.dialog-backdrop', dialog);
  openCount++;

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    openCount--;
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
    previousFocus?.focus?.();
  }

  for (const b of buttons) {
    const btn = h('button.btn', { type: 'button', class: b.primary ? 'primary' : undefined }, b.label);
    btn.addEventListener('click', async () => {
      const result = b.action ? await b.action(close) : undefined;
      if (result !== false) close();
    });
    footer.append(btn);
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      // Keep focus inside the dialog.
      const focusable = [...dialog.querySelectorAll('button, input, textarea, select, [tabindex="0"]')].filter((el) => !el.disabled);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    // Other keys reach the focused control; global hotkeys skip while a
    // dialog is open (see hotkeys.js).
  }

  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(backdrop);
  (footer.querySelector('.primary') || closeBtn).focus();
  return { close, dialog };
}

/** Yes/No confirmation. Resolves true when confirmed. */
export function confirmDialog(title, message, confirmLabel = 'OK') {
  return new Promise((resolve) => {
    let answered = false;
    openDialog({
      title,
      body: h('p', message),
      buttons: [
        { label: 'Cancel', action: () => { answered = true; resolve(false); } },
        { label: confirmLabel, primary: true, action: () => { answered = true; resolve(true); } },
      ],
      onClose: () => {
        if (!answered) resolve(false);
      },
    });
  });
}
