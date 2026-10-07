// ============================================================
//  Мини-заглушка DOM для интеграционного теста в Node.
//  Поддерживает ровно те возможности, которые нужны игре.
// ============================================================

class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...c) { for (const x of c) this.set.add(x); this.sync(); }
  remove(...c) { for (const x of c) this.set.delete(x); this.sync(); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) {
    const want = force === undefined ? !this.set.has(c) : !!force;
    if (want) this.set.add(c); else this.set.delete(c);
    this.sync();
    return want;
  }
  sync() { this.el._className = [...this.set].join(' '); }
  get value() { return this.el._className; }
}

class Style {
  constructor() { this.props = {}; }
  setProperty(k, v) { this.props[k] = v; }
}
// style должен работать и как объект свойств (style.width = '10%')
const styleCache = new WeakMap();
function styleFor(el) {
  if (!styleCache.has(el)) {
    const s = new Style();
    styleCache.set(el, new Proxy(s, {
      get(t, k) {
        if (k === 'setProperty') return (a, b) => { t.props[a] = b; };
        if (k in t) return t[k];
        return t.props[k] ?? '';
      },
      set(t, k, v) { t.props[k] = v; return true; },
    }));
  }
  return styleCache.get(el);
}

export class El {
  constructor(tag = 'div', id = '') {
    this.tagName = String(tag).toUpperCase();
    this.id = id;
    this.children = [];
    this.parent = null;
    this.dataset = {};
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.offsetWidth = 100;
    this.width = 128;
    this.height = 128;
    this._className = '';
    this._html = '';
    this.listeners = new Map();
    this.classList = new ClassList(this);
    this._qcache = new Map();
  }
  get className() { return this._className; }
  set className(v) {
    this._className = String(v);
    this.classList.set = new Set(this._className.split(/\s+/).filter(Boolean));
  }
  get style() { return styleFor(this); }
  get innerHTML() { return this._html; }
  set innerHTML(v) {
    this._html = String(v);
    // «парсим» только class-имена, чтобы querySelectorAll('.card') работал
    const classes = [...String(v).matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/));
    if (classes.length) {
      for (const c of classes) {
        const child = new El('div');
        child.className = c;
        child.parent = this;
        this.children.push(child);
      }
    }
  }
  addEventListener(type, cb) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(cb);
  }
  removeEventListener(type, cb) {
    const arr = this.listeners.get(type);
    if (arr) {
      const i = arr.indexOf(cb);
      if (i >= 0) arr.splice(i, 1);
    }
  }
  dispatch(type, ev = {}) {
    const arr = this.listeners.get(type) || [];
    for (const cb of arr) cb({ preventDefault() {}, stopPropagation() {}, target: this, ...ev });
  }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
  remove() { if (this.parent) this.parent.removeChild(this); }
  querySelector(sel) {
    const found = findAll(this, sel);
    if (found.length) return found[0];
    // запомним «виртуального» потомка, чтобы повторные обращения сохраняли состояние
    if (!this._qcache.has(sel)) {
      const el = new El(sel.startsWith('.') ? 'div' : sel);
      el.parent = this;
      this.children.push(el);
      this._qcache.set(sel, el);
    }
    return this._qcache.get(sel);
  }
  querySelectorAll(sel) { return findAll(this, sel); }
  getContext() { return fake2d; }
  requestPointerLock() { documentStub.pointerLockElement = this; }
  getBoundingClientRect() { return { left: 0, top: 0, width: windowStub.innerWidth, height: windowStub.innerHeight }; }
  focus() {}
  blur() {}
  click() { this.dispatch('click'); }
}

function matches(el, sel) {
  if (sel.startsWith('.')) return el.classList.contains(sel.slice(1));
  if (sel.startsWith('#')) return el.id === sel.slice(1);
  return el.tagName === sel.toUpperCase();
}

export function findAll(root, sel) {
  const out = [];
  const walk = (el) => {
    for (const c of el.children) {
      if (matches(c, sel)) out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}

const fake2d = {
  fillStyle: '', strokeStyle: '', font: '', textAlign: '', textBaseline: '', lineWidth: 1,
  fillRect() {}, strokeRect() {}, clearRect() {},
  fillText() {}, strokeText() {},
  beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {},
  createRadialGradient() { return { addColorStop() {} }; },
  createLinearGradient() { return { addColorStop() {} }; },
};

class Document {
  constructor() {
    this.elements = new Map();
    this.pointerLockElement = null;
    this.hidden = false;
    this.listeners = new Map();
  }
  getElementById(id) {
    if (!this.elements.has(id)) {
      const el = new El('div', id);
      this.elements.set(id, el);
      if (this.body) this.body.appendChild(el);
    }
    return this.elements.get(id);
  }
  createElement(tag) { return new El(tag); }
  addEventListener(type, cb) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(cb);
  }
  removeEventListener() {}
  dispatch(type, ev = {}) {
    for (const cb of this.listeners.get(type) || []) cb({ preventDefault() {}, ...ev });
  }
  querySelectorAll(sel) { return this.body ? findAll(this.body, sel) : []; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || new El('div'); }
  exitPointerLock() { this.pointerLockElement = null; this.dispatch('pointerlockchange'); }
}

export const documentStub = new Document();

class WindowStub {
  constructor() {
    this.innerWidth = 1280;
    this.innerHeight = 720;
    this.devicePixelRatio = 1;
    this.listeners = new Map();
    this.rafCallbacks = [];
    this.rafId = 0;
    this.errors = [];
  }
  addEventListener(type, cb) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(cb);
  }
  removeEventListener(type, cb) {
    const arr = this.listeners.get(type);
    if (arr) { const i = arr.indexOf(cb); if (i >= 0) arr.splice(i, 1); }
  }
  dispatch(type, ev = {}) {
    for (const cb of this.listeners.get(type) || []) cb({ preventDefault() {}, ...ev });
  }
  requestAnimationFrame(cb) { this.rafId++; this.rafCallbacks.push(cb); return this.rafId; }
  cancelAnimationFrame(id) { this.rafCallbacks = this.rafCallbacks.filter((c) => c.id !== id); }
}

export const windowStub = new WindowStub();

export class StorageStub {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}

// ------------------------------------------------------------
//  Установка заглушек в глобальную область
// ------------------------------------------------------------
export function installDom() {
  const body = new El('body');
  documentStub.body = body;

  // дерево как в index.html: оверлеи + HUD-элементы
  const ids = [
    'game', 'hud', 'score-red', 'score-blu', 'timer', 'cap-status', 'notify', 'killfeed',
    'crosshair', 'hitmarker', 'charge-wrap', 'charge-bar', 'hp', 'hp-fill', 'health-panel',
    'class-label', 'heal-target', 'ammo', 'ammo-max', 'weapon-name', 'spin-wrap', 'spin-bar',
    'uber-wrap', 'uber-bar', 'uber-label', 'cloak-wrap', 'cloak-bar', 'cloak-label', 'build-menu',
    'build-hint', 'vignette', 'flash', 'damage-dirs', 'scoreboard', 'scoreboard-table',
    'menu', 'pause', 'classselect', 'settings', 'roundend', 'scoreboard',
    'class-grid', 'class-grid-2', 'map-select', 'bots-select', 'skill-select',
    'play-btn', 'settings-btn', 'resume-btn', 'pause-class-btn', 'pause-settings-btn', 'leave-btn',
    'again-btn', 'menu-btn', 'class-close-btn', 'settings-close', 'sens', 'sens-val', 'vol', 'vol-val',
    'shadows', 'fps-counter', 'fps', 'loading', 'round-title', 'final-red', 'final-blu', 'final-board',
  ];
  const overlays = ['menu', 'pause', 'classselect', 'settings', 'roundend', 'scoreboard', 'loading'];
  for (const id of ids) {
    const el = documentStub.getElementById(id);
    if (overlays.includes(id)) el.className = 'overlay';
  }
  for (const id of ['sens', 'vol']) documentStub.getElementById(id).value = '2.2';
  for (const id of ['map-select', 'bots-select', 'skill-select']) documentStub.getElementById(id).value = '';

  // кнопки команд (создаются в HTML вручную)
  for (const team of [0, 1]) {
    const btn = new El('button');
    btn.className = 'team-btn' + (team === 0 ? ' red' : ' blu');
    btn.dataset.team = String(team);
    documentStub.getElementById('menu').appendChild(btn);
  }

  globalThis.document = documentStub;
  globalThis.window = windowStub;
  globalThis.localStorage = new StorageStub();
  globalThis.requestAnimationFrame = (cb) => windowStub.requestAnimationFrame(cb);
  globalThis.cancelAnimationFrame = (id) => windowStub.cancelAnimationFrame(id);
  globalThis.devicePixelRatio = 1;
  globalThis.performance = globalThis.performance || { now: () => Date.now() };
  windowStub.performance = globalThis.performance;
  return { document: documentStub, window: windowStub };
}

export { El as HTMLElementStub };
