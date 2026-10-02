// Script components: compile the user's code into start/update/event hooks
// and provide keyboard input. Scripts are the user's own game code and run
// in the page during Play mode or in an exported build. Self-contained.

export const SCRIPT_HOOKS = ['start', 'update', 'onCollisionEnter', 'onTriggerEnter'];

/** Names injected into every script's scope. */
export const SCRIPT_GLOBALS = ['gameObject', 'transform', 'rigidbody', 'Time', 'Input', 'Debug', 'Scene', 'Mathf'];

export class ScriptError extends Error {
  constructor(message, scriptName, cause) {
    super(message);
    this.scriptName = scriptName;
    this.cause = cause;
  }
}

/**
 * Compile script source into a factory. Calling the factory with an API
 * object returns { start, update, onCollisionEnter, onTriggerEnter } (each a
 * function or null) bound to that API, so every instance has its own
 * variables.
 */
export function compileScript(code, name = 'Script') {
  const prologue = `"use strict";\nconst { ${SCRIPT_GLOBALS.join(', ')} } = __api;\n`;
  const epilogue = `\nreturn { ${SCRIPT_HOOKS.map((h) => `${h}: typeof ${h} === "function" ? ${h} : null`).join(', ')} };`;
  let fn;
  try {
    // The Function constructor compiles the scene author's own script; it
    // never sees data from the network or the agent.
    fn = new Function('__api', `${prologue}${code}${epilogue}\n//# sourceURL=vox-script/${encodeURIComponent(name)}.js`);
  } catch (err) {
    throw new ScriptError(`${name}: ${err.message}`, name, err);
  }
  return (api) => fn.call(api.gameObject, api);
}

/** First "line:column" of an error stack that points into a script. */
export function scriptLocation(err) {
  const match = /vox-script\/([^:]+)\.js:(\d+):(\d+)/.exec(err?.stack || '');
  if (!match) return '';
  // Two prologue lines precede the user's code.
  return `${decodeURIComponent(match[1])}.js:${Number(match[2]) - 2}:${match[3]}`;
}

const AXES = {
  Horizontal: { neg: ['a', 'arrowleft'], pos: ['d', 'arrowright'] },
  Vertical: { neg: ['s', 'arrowdown'], pos: ['w', 'arrowup'] },
};

function normalizeKey(key) {
  const k = String(key).toLowerCase();
  if (k === 'space' || k === 'spacebar') return ' ';
  if (k === 'left') return 'arrowleft';
  if (k === 'right') return 'arrowright';
  if (k === 'up') return 'arrowup';
  if (k === 'down') return 'arrowdown';
  return k;
}

/** Keyboard and mouse state for scripts, attached to one DOM element. */
export class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouse = new Set();
    this.mousePosition = [0, 0];
    this.target = null;
    this.onKeyDown = (e) => {
      const k = normalizeKey(e.key);
      if (!this.down.has(k)) this.pressed.add(k);
      this.down.add(k);
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    };
    this.onKeyUp = (e) => {
      const k = normalizeKey(e.key);
      this.down.delete(k);
      this.released.add(k);
    };
    this.onMouseDown = (e) => this.mouse.add(e.button);
    this.onMouseUp = (e) => this.mouse.delete(e.button);
    this.onMouseMove = (e) => {
      const r = this.target.getBoundingClientRect?.() || { left: 0, top: 0 };
      this.mousePosition = [e.clientX - r.left, e.clientY - r.top];
    };
    this.onBlur = () => this.reset();
  }

  attach(target, keyTarget = target) {
    this.detach();
    this.target = target;
    this.keyTarget = keyTarget;
    keyTarget.addEventListener('keydown', this.onKeyDown);
    keyTarget.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('pointerdown', this.onMouseDown);
    target.addEventListener('pointermove', this.onMouseMove);
    globalThis.addEventListener?.('pointerup', this.onMouseUp);
    keyTarget.addEventListener('blur', this.onBlur);
  }

  detach() {
    if (!this.target) return;
    this.keyTarget.removeEventListener('keydown', this.onKeyDown);
    this.keyTarget.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('pointerdown', this.onMouseDown);
    this.target.removeEventListener('pointermove', this.onMouseMove);
    globalThis.removeEventListener?.('pointerup', this.onMouseUp);
    this.keyTarget.removeEventListener('blur', this.onBlur);
    this.target = null;
    this.reset();
  }

  reset() {
    this.down.clear();
    this.pressed.clear();
    this.released.clear();
    this.mouse.clear();
  }

  /** Clear per-frame edges; call after scripts ran. */
  endFrame() {
    this.pressed.clear();
    this.released.clear();
  }

  /** The API object scripts see as `Input`. */
  api() {
    return Object.freeze({
      getKey: (key) => this.down.has(normalizeKey(key)),
      getKeyDown: (key) => this.pressed.has(normalizeKey(key)),
      getKeyUp: (key) => this.released.has(normalizeKey(key)),
      getMouseButton: (button = 0) => this.mouse.has(button),
      getAxis: (name) => {
        const axis = AXES[name];
        if (!axis) return 0;
        const neg = axis.neg.some((k) => this.down.has(k)) ? 1 : 0;
        const pos = axis.pos.some((k) => this.down.has(k)) ? 1 : 0;
        return pos - neg;
      },
      get mousePosition() {
        return this.mousePosition;
      },
    });
  }
}

export const Mathf = Object.freeze({
  clamp: (v, min, max) => Math.min(max, Math.max(min, v)),
  clamp01: (v) => Math.min(1, Math.max(0, v)),
  lerp: (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t)),
  moveTowards: (current, target, maxDelta) =>
    Math.abs(target - current) <= maxDelta ? target : current + Math.sign(target - current) * maxDelta,
  deg2Rad: Math.PI / 180,
  rad2Deg: 180 / Math.PI,
});
