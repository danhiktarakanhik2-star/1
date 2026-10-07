// ============================================================
//  Fortress Arena — управление (клавиатура + мышь + pointer lock).
//  Превращает ввод в команду игрока (тот же формат, что у ботов).
// ============================================================
import { emptyCmd } from './world.js';
import { clamp } from './physics.js';
import { CLASSES, CLASS_ORDER } from './data.js';

const PREVENT = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);

export class Controls {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.sensitivity = opts.sensitivity ?? 0.0022;
    this.keys = new Set();
    this.once = new Set();
    this.mouse = { left: false, right: false, leftClicked: false, wheel: 0 };
    this.yaw = 0;
    this.pitch = 0;
    this.locked = false;
    this.enabled = true;
    this.onAction = opts.onAction || (() => {});
    this.lastWeapon = 1;
    this.disguiseIndex = 0;
    this._bind();
  }

  _bind() {
    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      if (PREVENT.has(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.once.add(e.code);
      this.keys.add(e.code);
      if (e.code === 'Tab') this.onAction('scoreboard', true);
      if (e.code === 'Escape') this.onAction('pause');
      if (e.code === 'KeyM') this.onAction('classmenu');
      if (e.code === 'Enter') this.onAction('enter');
    };
    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Tab') this.onAction('scoreboard', false);
    };
    this._onMouseDown = (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement !== this.canvas) { this.requestLock(); return; }
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftClicked = true; }
      if (e.button === 2) this.mouse.right = true;
      if (e.button === 1) this.onAction('zoomAlt');
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    };
    this._onMouseMove = (e) => {
      if (!this.locked || !this.enabled) return;
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch = clamp(this.pitch - e.movementY * this.sensitivity, -1.5, 1.5);
    };
    this._onWheel = (e) => {
      if (!this.locked) return;
      e.preventDefault();
      this.mouse.wheel += Math.sign(e.deltaY);
    };
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.keys.clear();
        this.mouse.left = this.mouse.right = false;
        this.onAction('unlocked');
      }
    };
    this._onContext = (e) => e.preventDefault();
    this._onBlur = () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('pointerlockchange', this._onLockChange);
    this.canvas.addEventListener('contextmenu', this._onContext);
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    this.canvas.removeEventListener('contextmenu', this._onContext);
  }

  requestLock() {
    if (this.canvas.requestPointerLock) this.canvas.requestPointerLock();
  }

  exitLock() {
    if (document.exitPointerLock) document.exitPointerLock();
  }

  syncFrom(player) {
    this.yaw = player.yaw;
    this.pitch = player.pitch;
  }

  consume(code) {
    if (this.once.has(code)) { this.once.delete(code); return true; }
    return false;
  }

  // Построить команду для локального игрока
  buildCommand(player, world) {
    const cmd = emptyCmd();
    cmd.yaw = this.yaw;
    cmd.pitch = this.pitch;

    const k = this.keys;
    let f = 0, r = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) r += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) r -= 1;
    cmd.forward = f;
    cmd.right = r;
    cmd.jump = k.has('Space');
    cmd.crouch = k.has('ShiftLeft') || k.has('ShiftRight');
    cmd.attack = this.mouse.left;
    cmd.attack2 = this.mouse.right;
    cmd.zoom = this.mouse.right || k.has('KeyZ');
    cmd.reload = this.consume('KeyR');
    cmd.uber = this.consume('KeyE');
    cmd.cloak = player.classId === 'spy' ? k.has('KeyC') : false;
    cmd.detonate = this.consume('KeyG');
    cmd.suicide = this.consume('KeyK');

    // постройки инженера
    if (player.classId === 'engineer') {
      if (this.consume('Digit4')) cmd.build = 'sentry';
      if (this.consume('Digit5')) cmd.build = 'dispenser';
      if (this.consume('Digit6')) cmd.build = 'teleporter';
      if (this.consume('KeyX')) cmd.buildCancel = true;
      if (player.build && player.build.pending) {
        if (this.mouse.leftClicked) { cmd.buildPlace = true; cmd.attack = false; }
      }
    }

    // маскировка шпиона: V — следующая из списка
    if (player.classId === 'spy' && this.consume('KeyV')) {
      const list = CLASS_ORDER.filter((c) => c !== 'spy' && c !== player.classId);
      this.disguiseIndex = (this.disguiseIndex + 1) % list.length;
      cmd.disguise = list[this.disguiseIndex];
    }

    // оружие
    let slot = -1;
    if (this.consume('Digit1')) slot = 0;
    if (this.consume('Digit2')) slot = 1;
    if (this.consume('Digit3')) slot = 2;
    if (this.consume('KeyQ')) slot = player.prevSelected;
    if (this.mouse.wheel !== 0) {
      const dir = this.mouse.wheel > 0 ? 1 : -1;
      const available = [0, 1, 2].filter((s) => hasSlot(player, s));
      if (available.length) {
        const idx = available.indexOf(player.selected);
        slot = available[(idx + dir + available.length) % available.length];
      }
    }
    if (slot >= 0 && slot !== player.selected) cmd.select = slot;

    // сброс одноразовых состояний
    this.mouse.leftClicked = false;
    this.mouse.wheel = 0;
    this.once.clear();
    return cmd;
  }
}

function hasSlot(player, slot) {
  const cls = CLASSES[player.classId];
  if (slot === 0) return !!cls.weapon;
  if (slot === 1) return !!cls.secondary;
  if (slot === 2) return true;
  return false;
}
