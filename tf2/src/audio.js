// ============================================================
//  Fortress Arena — звук.
//  Всё синтезируется через WebAudio: выстрелы, взрывы, шаги,
//  захват точек, убер, телепорт. Аудиофайлов нет — игра лёгкая.
// ============================================================

export class AudioKit {
  constructor(volume = 0.7) {
    this.ctx = null;
    this.master = null;
    this.volume = volume;
    this.listener = { pos: { x: 0, y: 0, z: 0 }, yaw: 0, right: { x: 1, z: 0 } };
    this.voices = [];
    this.lastPlayed = new Map();
    this.noiseBuffer = null;
  }

  // Инициализация только по жесту пользователя (клик по меню)
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 20;
    comp.ratio.value = 6;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    // буфер белого шума
    const len = Math.floor(ctx.sampleRate * 1.2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  setListener(pos, yaw) {
    this.listener.pos = pos;
    this.listener.yaw = yaw;
    // правая ось слушателя
    this.listener.right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  }

  // Позиционная громкость/панорама
  spatial(pos) {
    if (!pos) return { gain: 1, pan: 0 };
    const dx = pos.x - this.listener.pos.x;
    const dy = pos.y - this.listener.pos.y;
    const dz = pos.z - this.listener.pos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const gain = Math.max(0, 1 - dist / 75) ** 1.4;
    const pan = dist > 0.5
      ? Math.max(-1, Math.min(1, (dx * this.listener.right.x + dz * this.listener.right.z) / Math.max(4, dist)))
      : 0;
    return { gain, pan };
  }

  // --- базовые генераторы ---
  noise({ dur = 0.15, gain = 0.5, type = 'lowpass', freq = 1200, q = 1, sweepTo = null, pan = 0 }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.setValueAtTime(freq, ctx.currentTime);
    if (sweepTo) flt.frequency.exponentialRampToValueAtTime(Math.max(30, sweepTo), ctx.currentTime + dur);
    flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    const p = this.panner(pan);
    src.connect(flt); flt.connect(g); g.connect(p);
    src.start();
    src.stop(ctx.currentTime + dur + 0.02);
    this.trackVoice(g, dur);
  }

  tone({ freq = 440, toFreq = null, dur = 0.2, gain = 0.25, type = 'sine', pan = 0, delay = 0 }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (toFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, toFreq), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const p = this.panner(pan);
    osc.connect(g); g.connect(p);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
    this.trackVoice(g, dur + delay);
  }

  panner(pan) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(this.master);
    } else {
      g.connect(this.master);
    }
    return g;
  }

  trackVoice(node, dur) {
    this.voices.push({ node, end: this.ctx.currentTime + dur + 0.1 });
    if (this.voices.length > 40) {
      for (let i = this.voices.length - 1; i >= 0; i--) {
        if (this.voices[i].end < this.ctx.currentTime) this.voices.splice(i, 1);
      }
    }
  }

  // --- игровые звуки ---
  play(kind, opts = {}) {
    if (!this.ctx) return null;
    const { gain = 1, pan = 0 } = this.spatial(opts.pos);
    if (gain <= 0.01) return null;
    // антиспам: не больше N звуков одного типа за кадр/интервал
    const now = performance.now();
    const minGap = opts.minGap ?? 0.02;
    const last = this.lastPlayed.get(kind) || 0;
    if (kind !== 'explosion' && now - last < minGap * 1000) return null;
    this.lastPlayed.set(kind, now);

    const g = gain * (opts.power ?? 1);
    switch (kind) {
      case 'scatter':
        this.noise({ dur: 0.16, gain: 0.42 * g, type: 'bandpass', freq: 1400, q: 0.8, sweepTo: 400, pan });
        this.noise({ dur: 0.06, gain: 0.3 * g, type: 'highpass', freq: 2500, pan });
        break;
      case 'shotgun':
        this.noise({ dur: 0.2, gain: 0.4 * g, type: 'lowpass', freq: 1400, sweepTo: 300, pan });
        break;
      case 'rocket':
        this.noise({ dur: 0.3, gain: 0.34 * g, type: 'lowpass', freq: 900, sweepTo: 180, pan });
        this.tone({ freq: 180, toFreq: 60, dur: 0.22, gain: 0.22 * g, type: 'square', pan });
        break;
      case 'grenade':
        this.tone({ freq: 220, toFreq: 80, dur: 0.18, gain: 0.24 * g, type: 'triangle', pan });
        this.noise({ dur: 0.12, gain: 0.24 * g, type: 'lowpass', freq: 800, sweepTo: 200, pan });
        break;
      case 'sticky':
        this.tone({ freq: 320, toFreq: 120, dur: 0.14, gain: 0.18 * g, type: 'triangle', pan });
        break;
      case 'minigun':
        this.noise({ dur: 0.05, gain: 0.2 * g, type: 'bandpass', freq: 2200, q: 1.4, pan, minGap: 0.03 });
        break;
      case 'smg':
        this.noise({ dur: 0.06, gain: 0.2 * g, type: 'bandpass', freq: 2600, q: 1.2, pan });
        break;
      case 'sniperrifle':
        this.noise({ dur: 0.45, gain: 0.5 * g, type: 'lowpass', freq: 3000, sweepTo: 200, pan });
        this.tone({ freq: 150, toFreq: 50, dur: 0.3, gain: 0.3 * g, type: 'square', pan });
        break;
      case 'revolver':
        this.noise({ dur: 0.24, gain: 0.4 * g, type: 'bandpass', freq: 1800, q: 0.7, sweepTo: 400, pan });
        break;
      case 'crossbow':
        this.tone({ freq: 900, toFreq: 300, dur: 0.16, gain: 0.2 * g, type: 'sawtooth', pan });
        break;
      case 'swing':
        this.noise({ dur: 0.16, gain: 0.16 * g, type: 'bandpass', freq: 700, q: 0.6, sweepTo: 1600, pan });
        break;
      case 'knife':
        this.noise({ dur: 0.12, gain: 0.2 * g, type: 'highpass', freq: 3200, pan });
        break;
      case 'backstab':
        this.tone({ freq: 1800, toFreq: 700, dur: 0.25, gain: 0.28 * g, type: 'triangle', pan });
        break;
      case 'airblast':
        this.noise({ dur: 0.26, gain: 0.3 * g, type: 'bandpass', freq: 900, q: 0.5, sweepTo: 2600, pan });
        break;
      case 'explosion':
        this.noise({ dur: 0.7, gain: 0.6 * g, type: 'lowpass', freq: 700, sweepTo: 90, pan });
        this.tone({ freq: 90, toFreq: 34, dur: 0.55, gain: 0.42 * g, type: 'square', pan });
        this.noise({ dur: 0.18, gain: 0.5 * g, type: 'highpass', freq: 1800, pan });
        break;
      case 'hurt':
        this.noise({ dur: 0.1, gain: 0.24 * Math.min(1, g), type: 'bandpass', freq: 700, q: 0.9, pan });
        break;
      case 'death':
        this.tone({ freq: 160, toFreq: 60, dur: 0.5, gain: 0.26 * g, type: 'triangle', pan });
        break;
      case 'jump':
        this.noise({ dur: 0.08, gain: 0.1 * g, type: 'bandpass', freq: 500, q: 0.7, pan });
        break;
      case 'land':
        this.noise({ dur: 0.12, gain: 0.16 * g, type: 'lowpass', freq: 400, pan });
        break;
      case 'rocketJump':
        this.noise({ dur: 0.4, gain: 0.28 * g, type: 'bandpass', freq: 600, q: 0.5, sweepTo: 2200, pan });
        break;
      case 'heal':
        this.tone({ freq: 620, toFreq: 780, dur: 0.16, gain: 0.1 * g, type: 'sine', pan, minGap: 0.25 });
        break;
      case 'healHit':
        this.tone({ freq: 880, dur: 0.12, gain: 0.14 * g, type: 'sine', pan });
        this.tone({ freq: 1320, dur: 0.12, gain: 0.1 * g, type: 'sine', pan, delay: 0.06 });
        break;
      case 'uber':
        this.tone({ freq: 320, toFreq: 900, dur: 0.6, gain: 0.3, type: 'sawtooth' });
        this.tone({ freq: 640, toFreq: 1800, dur: 0.6, gain: 0.16, type: 'sine', delay: 0.05 });
        break;
      case 'capture':
        this.tone({ freq: 520, dur: 0.3, gain: 0.26, type: 'triangle' });
        this.tone({ freq: 780, dur: 0.4, gain: 0.24, type: 'triangle', delay: 0.16 });
        break;
      case 'roundEnd':
        this.tone({ freq: 300, dur: 1.1, gain: 0.3, type: 'triangle' });
        this.tone({ freq: 450, dur: 1.1, gain: 0.24, type: 'triangle', delay: 0.02 });
        this.tone({ freq: 600, dur: 1.2, gain: 0.2, type: 'triangle', delay: 0.04 });
        break;
      case 'build':
        this.tone({ freq: 300, toFreq: 700, dur: 0.18, gain: 0.2 * g, type: 'square', pan });
        break;
      case 'upgrade':
        this.tone({ freq: 500, dur: 0.12, gain: 0.2 * g, type: 'square', pan });
        this.tone({ freq: 900, dur: 0.16, gain: 0.18 * g, type: 'square', pan, delay: 0.1 });
        break;
      case 'buildingDestroyed':
        this.noise({ dur: 0.5, gain: 0.4 * g, type: 'lowpass', freq: 900, sweepTo: 150, pan });
        break;
      case 'sentryShot':
        this.noise({ dur: 0.06, gain: 0.2 * g, type: 'bandpass', freq: 2000, q: 1.2, pan, minGap: 0.04 });
        break;
      case 'teleport':
        this.tone({ freq: 400, toFreq: 1500, dur: 0.35, gain: 0.24 * g, type: 'sine', pan });
        this.noise({ dur: 0.35, gain: 0.16 * g, type: 'bandpass', freq: 1200, q: 0.6, sweepTo: 3000, pan });
        break;
      case 'detonate':
        this.tone({ freq: 260, toFreq: 70, dur: 0.16, gain: 0.24 * g, type: 'square', pan });
        break;
      case 'disguise':
        this.tone({ freq: 420, toFreq: 260, dur: 0.22, gain: 0.18 * g, type: 'sine', pan });
        this.tone({ freq: 640, toFreq: 380, dur: 0.22, gain: 0.12 * g, type: 'triangle', pan, delay: 0.05 });
        break;
      case 'reflect':
        this.tone({ freq: 1200, toFreq: 500, dur: 0.2, gain: 0.22 * g, type: 'triangle', pan });
        break;
      case 'charge':
        if (opts.on) this.tone({ freq: 200, toFreq: 420, dur: 0.3, gain: 0.1, type: 'sine' });
        break;
      case 'flame':
        this.noise({ dur: 0.2, gain: 0.1 * g, type: 'bandpass', freq: 1100, q: 0.5, sweepTo: 900, pan, minGap: 0.12 });
        break;
      case 'hitmarker':
        this.tone({ freq: 1400, dur: 0.05, gain: 0.12, type: 'square' });
        break;
      case 'crit':
        this.tone({ freq: 2000, dur: 0.06, gain: 0.16, type: 'square' });
        this.tone({ freq: 1500, dur: 0.06, gain: 0.12, type: 'square', delay: 0.04 });
        break;
      default:
        this.noise({ dur: 0.1, gain: 0.15 * g, pan });
    }
    return { gain, pan };
  }

  // Проиграть все звуки, которые собрал мир
  playWorldSounds(sounds) {
    for (const s of sounds) {
      this.play(s.kind, { pos: s.pos, power: s.power, on: s.on });
    }
  }
}
