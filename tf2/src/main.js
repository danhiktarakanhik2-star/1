// ============================================================
//  Fortress Arena — точка входа: меню, раунд, игровой цикл.
// ============================================================
import {
  MAP_DEFS, CLASSES, CLASS_ORDER, BOT_NAMES, BOT_SKILLS, CFG,
  TEAM_RED, TEAM_BLU, TEAM_INFO, MELEES,
} from './data.js';
import { buildMap } from './map.js';
import { World, eyePos, currentWeapon } from './world.js';
import { createBrain, updateBot } from './bots/ai.js';
import { Renderer } from './render.js';
import { AudioKit } from './audio.js';
import { Controls } from './input.js';
import { HUD } from './hud.js';
import { clamp, dist3 } from './physics.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'fortress-arena-settings';

const DEFAULT_SETTINGS = {
  sensitivity: 2.2,
  volume: 70,
  shadows: true,
  fps: false,
  team: TEAM_RED,
  map: 'gorge',
  bots: 4,
  skill: 'normal',
  classId: 'soldier',
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (e) { /* игнорируем */ }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) { /* ок */ }
}

class Game {
  constructor() {
    this.canvas = $('game');
    this.settings = loadSettings();
    this.renderer = new Renderer(this.canvas);
    this.audio = new AudioKit(this.settings.volume / 100);
    this.hud = new HUD();
    this.controls = new Controls(this.canvas, {
      sensitivity: this.settings.sensitivity * 0.001,
      onAction: (a, v) => this.onAction(a, v),
    });

    this.state = 'menu';        // menu | playing | paused | roundend
    this.world = null;
    this.localId = -1;
    this.accum = 0;
    this.lastFrame = performance.now();
    this.fpsAccum = 0;
    this.fpsFrames = 0;
    this.fpsValue = 0;
    this.pendingDeath = false;
    this.autoClassMenuAt = 0;

    this.buildMenu();
    this.applySettingsToUI();
    $('loading').classList.add('hidden');

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
    this.resize();
    requestAnimationFrame((t) => this.loop(t));
  }

  // ----------------------------------------------------------
  //  Меню и настройки
  // ----------------------------------------------------------
  buildMenu() {
    // карты
    const mapSel = $('map-select');
    mapSel.innerHTML = Object.values(MAP_DEFS)
      .map((m) => `<option value="${m.id}">${m.ru} — ${m.desc}</option>`).join('');

    // сложность ботов
    $('skill-select').innerHTML = BOT_SKILLS
      .map((s) => `<option value="${s.id}">${s.ru}</option>`).join('');

    // классы (в обоих меню)
    for (const containerId of ['class-grid', 'class-grid-2']) {
      const grid = $(containerId);
      grid.innerHTML = '';
      for (const id of CLASS_ORDER) {
        const cls = CLASSES[id];
        const card = document.createElement('div');
        card.className = 'class-card';
        card.dataset.class = id;
        const wep = cls.secondary ? `${cls.weapon.ru} / ${cls.secondary.ru}` : cls.weapon.ru;
        card.innerHTML = `
          <h3>${cls.ru}</h3>
          <div class="en">${cls.name}</div>
          <p>${cls.tagline}</p>
          <div class="class-stats">
            <span>♥ ${cls.hp}</span>
            <span>⚡ ${cls.speed.toFixed(1)} м/с</span>
          </div>
          <p style="margin:8px 0 0;font-size:12px;color:#8e949f">${wep} · ${MELEES[id] ? MELEES[id].ru : ''}</p>`;
        card.addEventListener('click', () => {
          this.settings.classId = id;
          saveSettings(this.settings);
          this.markSelectedClass();
          if (this.state === 'playing' || this.state === 'paused') this.changeClass(id);
        });
        grid.appendChild(card);
      }
    }
    this.markSelectedClass();

    // команда
    for (const btn of document.querySelectorAll('.team-btn')) {
      btn.addEventListener('click', () => {
        this.settings.team = Number(btn.dataset.team);
        saveSettings(this.settings);
        this.markSelectedClass();
      });
    }

    $('play-btn').addEventListener('click', () => this.start());
    $('again-btn').addEventListener('click', () => this.start());
    $('menu-btn').addEventListener('click', () => this.toMenu());
    $('leave-btn').addEventListener('click', () => this.toMenu());
    $('resume-btn').addEventListener('click', () => this.resume());
    $('pause-class-btn').addEventListener('click', () => { this.showClassSelect(true); this.controls.exitLock(); });
    $('class-close-btn').addEventListener('click', () => { this.hideClassSelect(); this.resume(); });
    $('settings-btn').addEventListener('click', () => this.showSettings(true));
    $('pause-settings-btn').addEventListener('click', () => this.showSettings(true));
    $('settings-close').addEventListener('click', () => this.showSettings(false));

    // настройки
    $('sens').addEventListener('input', (e) => {
      this.settings.sensitivity = Number(e.target.value);
      $('sens-val').textContent = this.settings.sensitivity.toFixed(1);
      this.controls.sensitivity = this.settings.sensitivity * 0.001;
      saveSettings(this.settings);
    });
    $('vol').addEventListener('input', (e) => {
      this.settings.volume = Number(e.target.value);
      $('vol-val').textContent = this.settings.volume;
      this.audio.setVolume(this.settings.volume / 100);
      saveSettings(this.settings);
    });
    $('shadows').addEventListener('change', (e) => {
      this.settings.shadows = e.target.checked;
      this.renderer.setQuality({ shadows: this.settings.shadows });
      saveSettings(this.settings);
    });
    $('fps-counter').addEventListener('change', (e) => {
      this.settings.fps = e.target.checked;
      $('fps').classList.toggle('hidden', !this.settings.fps);
      saveSettings(this.settings);
    });

    // выбор карты/ботов/сложности
    mapSel.addEventListener('change', () => { this.settings.map = mapSel.value; saveSettings(this.settings); });
    $('bots-select').addEventListener('change', () => { this.settings.bots = Number($('bots-select').value); saveSettings(this.settings); });
    $('skill-select').addEventListener('change', () => { this.settings.skill = $('skill-select').value; saveSettings(this.settings); });

    // клик по меню — старт звука
    for (const el of document.querySelectorAll('.overlay')) {
      el.addEventListener('mousedown', () => this.audio.init(), { once: true });
    }
  }

  applySettingsToUI() {
    const s = this.settings;
    $('sens').value = s.sensitivity;
    $('sens-val').textContent = Number(s.sensitivity).toFixed(1);
    $('vol').value = s.volume;
    $('vol-val').textContent = s.volume;
    $('shadows').checked = s.shadows;
    $('fps-counter').checked = s.fps;
    $('fps').classList.toggle('hidden', !s.fps);
    $('map-select').value = s.map;
    $('bots-select').value = String(s.bots);
    $('skill-select').value = s.skill;
    this.renderer.setQuality({ shadows: s.shadows });
  }

  markSelectedClass() {
    for (const card of document.querySelectorAll('.class-card')) {
      card.classList.toggle('active', card.dataset.class === this.settings.classId);
    }
    for (const btn of document.querySelectorAll('.team-btn')) {
      btn.classList.toggle('active', Number(btn.dataset.team) === this.settings.team);
    }
  }

  showSettings(on) {
    $('settings').classList.toggle('hidden', !on);
    if (on) this.controls.exitLock();
  }

  // ----------------------------------------------------------
  //  Раунд
  // ----------------------------------------------------------
  start() {
    this.audio.init();
    const def = MAP_DEFS[this.settings.map] || MAP_DEFS.gorge;
    const map = buildMap(def);
    const world = new World(map, { gameTime: 480 });
    this.world = world;
    this.accum = 0;
    this.pendingDeath = false;

    const team = this.settings.team;
    const local = world.addPlayer({
      name: 'Игрок', team, classId: this.settings.classId, isBot: false,
    });
    this.localId = local.id;
    this.controls.syncFrom(local);

    const skill = BOT_SKILLS.find((s) => s.id === this.settings.skill) || BOT_SKILLS[1];
    const perTeam = clamp(Number(this.settings.bots) || 4, 0, 6);
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    let n = 0;
    // чередуем классы, чтобы в каждой команде были все роли
    const rota = CLASS_ORDER;
    for (const t of [TEAM_RED, TEAM_BLU]) {
      for (let i = 0; i < perTeam; i++) {
        // в команде игрока на одного бота меньше, чтобы баланс был ровным
        if (t === team && i === perTeam - 1 && perTeam > 2) continue;
        const classId = rota[(i + (t === team ? 3 : 0)) % rota.length];
        const bot = world.addPlayer({
          name: names[n % names.length], team: t, classId, isBot: true,
        });
        bot.bot = createBrain(skill);
        n++;
      }
    }

    this.renderer.buildLevel(map);
    this.renderer.setViewModelClass(local.classId, local.team, currentWeapon(local).id);
    this.hud.show();
    this.hud.notify(`Карта: ${def.ru} · команда ${TEAM_INFO[team].name}`, team === TEAM_BLU ? 'blu' : 'red', 4);
    this.hud.notify('Захватите точки A и C, чтобы принести очки', '', 5);

    $('menu').classList.add('hidden');
    $('roundend').classList.add('hidden');
    $('pause').classList.add('hidden');
    $('classselect').classList.add('hidden');
    this.state = 'playing';
    this.controls.enabled = true;
    this.controls.syncFrom(local);
    this.controls.requestLock();
    this.lastFrame = performance.now();
  }

  toMenu() {
    this.state = 'menu';
    this.controls.exitLock();
    this.hud.hide();
    $('menu').classList.remove('hidden');
    $('pause').classList.add('hidden');
    $('roundend').classList.add('hidden');
    $('classselect').classList.add('hidden');
    $('scoreboard').classList.add('hidden');
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    $('pause').classList.remove('hidden');
    this.controls.exitLock();
  }

  resume() {
    if (!this.world) return;
    $('pause').classList.add('hidden');
    $('classselect').classList.add('hidden');
    $('settings').classList.add('hidden');
    this.state = 'playing';
    this.lastFrame = performance.now();
    if (this.controls.once) this.controls.once.clear();
    this.controls.mouse.leftClicked = false;
    this.controls.requestLock();
  }

  showClassSelect(force) {
    const local = this.world && this.world.getPlayer(this.localId);
    $('classselect').classList.remove('hidden');
    if (local && !local.alive) {
      const left = Math.max(0, local.respawnAt - this.world.time);
      $('respawn-note').textContent = `Возрождение через ${left.toFixed(1)} с`;
    } else {
      $('respawn-note').textContent = 'Смена класса применится после возрождения';
    }
    this.markSelectedClass();
  }

  hideClassSelect() { $('classselect').classList.add('hidden'); }

  changeClass(classId) {
    const local = this.world && this.world.getPlayer(this.localId);
    if (!local) return;
    this.world.setPlayerClass(local, classId);
    this.renderer.setViewModelClass(classId, local.team, currentWeapon(local).id);
    this.hud.notify(`Класс: ${CLASSES[classId].ru}`, '', 2.5);
  }

  onAction(action, value) {
    if (action === 'pause') {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
      return;
    }
    if (action === 'unlocked') {
      if (this.state === 'playing') this.pause();
      return;
    }
    if (action === 'scoreboard') {
      if (this.world && (this.state === 'playing' || this.state === 'paused')) {
        if (value) this.hud.showScoreboard(this.world, this.localId);
        else this.hud.hideScoreboard();
      }
      return;
    }
    if (action === 'classmenu') {
      if (this.world && this.state !== 'menu') this.showClassSelect();
      return;
    }
    if (action === 'enter') {
      if (!$('roundend').classList.contains('hidden')) this.start();
      else if (!$('classselect').classList.contains('hidden')) this.resume();
    }
  }

  // ----------------------------------------------------------
  //  Игровой цикл
  // ----------------------------------------------------------
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const rawDt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    const dt = Math.min(0.1, Math.max(0, rawDt));

    if (this.state === 'playing' && this.world) {
      this.simulate(dt);          // здесь же происходит render()
    } else if (this.world) {
      // пауза / итоги / меню: мир заморожен, но картинку обновляем
      this.renderer.updateFx(dt * 0.25);
      this.renderer.syncCaps(this.world);
      this.renderer.syncPlayers(this.world, this.localId, 0);
      this.renderer.syncProjectiles(this.world);
      this.renderer.syncBuildings(this.world, dt * 0.25);
      const local = this.world.getPlayer(this.localId);
      this.renderer.updateCamera(this.world, local, dt);
      this.renderer.render();
    }

    // FPS
    if (this.settings.fps) {
      this.fpsAccum += dt;
      this.fpsFrames++;
      if (this.fpsAccum > 0.5) {
        this.fpsValue = Math.round(this.fpsFrames / this.fpsAccum);
        $('fps').textContent = `${this.fpsValue} FPS`;
        this.fpsAccum = 0; this.fpsFrames = 0;
      }
    }
  }

  simulate(dt) {
    const world = this.world;
    const local = world.getPlayer(this.localId);
    if (!local) return;

    this.accum += dt;
    let steps = 0;
    const maxSteps = 6;
    while (this.accum >= CFG.TICK && steps < maxSteps) {
      // команда игрока
      if (local.alive) {
        world.setCommand(this.localId, this.controls.buildCommand(local, world));
      } else {
        world.setCommand(this.localId, { forward: 0, right: 0, jump: false, crouch: false, attack: false, attack2: false, select: -1, yaw: local.yaw, pitch: local.pitch });
      }
      // боты
      for (const p of world.players) {
        if (p.isBot && p.alive) updateBot(world, p, CFG.TICK);
      }
      world.step(CFG.TICK);
      this.accum -= CFG.TICK;
      steps++;
    }
    if (this.accum > CFG.TICK * 10) this.accum = 0;

    // ---- события мира ----
    this.processSounds(world.drainSounds());
    this.renderer.applyEffects(world.drainEffects(), world);
    this.processMessages(world);

    // ---- отрисовка ----
    this.renderer.updateFx(dt);
    this.renderer.syncPlayers(world, this.localId, dt);
    this.renderer.syncProjectiles(world);
    this.renderer.syncBuildings(world, dt);
    this.renderer.syncCaps(world);
    this.renderer.updateCamera(world, local, dt);
    this.audio.setListener(eyePos(local), local.yaw);

    // вид от третьего лица в модели оружия — обновляем при смене класса/оружия
    const wep = currentWeapon(local);
    if (wep) this.renderer.setViewModelClass(local.classId, local.team, wep.id);

    this.hud.update(world, local, dt);

    // автовозрождение после смерти
    if (!local.alive && !this.pendingDeath) {
      this.pendingDeath = true;
      this.autoClassMenuAt = performance.now() + 900;
      this.hud.notify('Возрождение… нажмите M, чтобы сменить класс', 'red', 3);
      this.hud.showScoreboard(world, this.localId);
      setTimeout(() => this.hud.hideScoreboard(), 2500);
    }
    if (!local.alive && this.pendingDeath && performance.now() > this.autoClassMenuAt
      && $('classselect').classList.contains('hidden') && $('pause').classList.contains('hidden')) {
      this.showClassSelect(true);
      this.controls.exitLock();
      this.state = 'paused';
    }
    if (local.alive) this.pendingDeath = false;

    if (local.alive && !local.lastDamageNotified) local.lastDamageNotified = 0;

    this.renderer.render();
  }

  processSounds(sounds) {
    for (const s of sounds) {
      if (s.kind === 'shot') {
        this.audio.play(s.weapon || 'scatter', { pos: s.pos, power: s.power });
      } else if (s.kind === 'hurt') {
        this.audio.play('hurt', { pos: s.pos });
      } else {
        this.audio.play(s.kind, { pos: s.pos, on: s.on });
      }
    }
  }

  processMessages(world) {
    const local = world.getPlayer(this.localId);
    for (const m of world.messages) {
      switch (m.kind) {
        case 'damage': {
          if (!local) break;
          if (m.attackerId === this.localId && m.targetId !== this.localId) {
            // мы попали
            this.hud.hitmarker(m.crit || m.headshot);
            this.audio.play(m.headshot ? 'crit' : 'hitmarker');
          }
          if (m.targetId === this.localId) {
            const attacker = world.getPlayer(m.attackerId);
            let dir = null;
            if (attacker) {
              const d = dist3(attacker.pos, local.pos) || 1;
              dir = { x: (attacker.pos.x - local.pos.x) / d, z: (attacker.pos.z - local.pos.z) / d };
            }
            this.hud.damage(dir, m.amount);
            if (!local.alive) this.renderer.cameraShake = 0.6;
          }
          break;
        }
        case 'kill': {
          if (m.attacker === local?.name) this.hud.notify(`Вы устранили ${m.victim}`, 'red', 3);
          else if (m.victim === local?.name) this.hud.notify(`${m.attacker} устранил вас`, 'blu', 3);
          break;
        }
        case 'capture': {
          const who = m.team === TEAM_BLU ? 'BLU' : 'RED';
          const mine = m.team === (local ? local.team : -1);
          this.hud.notify(`${m.scorer || who}: точка ${m.cap} захвачена (${who})`, mine ? 'red' : 'blu', 5);
          break;
        }
        case 'backstab': {
          if (m.attacker === local?.name) this.hud.notify('Удар в спину!', 'red', 2);
          break;
        }
        case 'uber': {
          if (m.player === local?.name) this.hud.notify('УБЕР-ЗАРЯД АКТИВИРОВАН', 'red', 3);
          break;
        }
        case 'buildingUpgraded': {
          if (m.player === local?.name) this.hud.notify(`Постройка улучшена до ур. ${m.level}`, '', 2);
          break;
        }
        case 'buildExists': {
          if (m.player === local?.name) this.hud.notify('Такая постройка уже есть', '', 2);
          break;
        }
        case 'roundEnd': {
          this.finishRound(m);
          break;
        }
        default: break;
      }
    }
    world.messages.length = 0;
  }

  finishRound(m) {
    const local = this.world.getPlayer(this.localId);
    const title = $('round-title');
    if (m.winner === null) { title.textContent = 'Ничья'; title.className = 'draw'; }
    else if (local && m.winner === local.team) { title.textContent = 'Победа!'; title.className = 'win'; }
    else { title.textContent = 'Поражение'; title.className = 'lose'; }
    $('final-red').textContent = m.score[TEAM_RED];
    $('final-blu').textContent = m.score[TEAM_BLU];
    $('final-board').innerHTML = this.hud.boardHtml(this.world, this.localId);
    $('roundend').classList.remove('hidden');
    this.state = 'roundend';
    this.controls.exitLock();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.resize(w, h);
  }
}

window.addEventListener('error', (e) => {
  const loading = $('loading');
  if (loading) {
    loading.classList.remove('hidden');
    loading.innerHTML = `<div class="panel small"><h2>Ошибка</h2><p class="sub">${String(e.message).slice(0, 300)}</p></div>`;
  }
});

window.game = new Game();
