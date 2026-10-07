// ============================================================
//  Fortress Arena — игровой мир.
//  Вся логика (физика, оружие, урон, боты-объекты, турели,
//  захват точек) живёт здесь и не зависит от three.js,
//  поэтому её можно гонять в Node для автотестов.
// ============================================================

import {
  CFG, CLASSES, CLASS_HP, CLASS_SPEED, MELEES, ARROWS, TEAM_RED, TEAM_BLU, TEAM_INFO, WEAPON_ALIASES,
} from './data.js';
import {
  vec3, len3, norm3, dist3, distXZ, clamp, lerp, randRange,
  hitbox, overlaps, boxContains, moveHitbox, raycastBoxes, raycastLos, rayBox, EPS,
} from './physics.js';

let NEXT_ID = 1;
export function nextId() { return NEXT_ID++; }

// ------------------------------------------------------------
//  Углы → вектор направления
// ------------------------------------------------------------
export function dirFromAngles(yaw, pitch) {
  const cp = Math.cos(pitch);
  return {
    x: -Math.sin(yaw) * cp,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cp,
  };
}

export function anglesFromDir(d) {
  const yaw = Math.atan2(-d.x, -d.z);
  const pitch = Math.asin(clamp(d.y, -1, 1));
  return { yaw, pitch };
}

export function emptyCmd() {
  return {
    forward: 0, right: 0, jump: false, crouch: false,
    attack: false, attack2: false, reload: false, zoom: false,
    detonate: false, cloak: false, uber: false, build: null, buildPlace: false, buildCancel: false,
    select: -1, suicide: false,
  };
}

// Позиция глаз
export function eyePos(p) {
  return { x: p.pos.x, y: p.pos.y + CFG.EYE_HEIGHT * (p.crouch ? 0.7 : 1), z: p.pos.z };
}

// ------------------------------------------------------------
//  Игрок / бот
// ------------------------------------------------------------
export function createPlayer(opts) {
  const classId = opts.classId || 'soldier';
  const cls = CLASSES[classId];
  return {
    id: nextId(),
    name: opts.name || 'Player',
    team: opts.team ?? TEAM_RED,
    classId,
    isBot: !!opts.isBot,
    bot: opts.bot || null,
    pos: vec3(0, 0, opts.team === TEAM_BLU ? 20 : -20),
    vel: vec3(),
    yaw: opts.team === TEAM_BLU ? 0 : Math.PI, // лицом к противнику
    pitch: 0,
    onGround: false,
    crouch: false,
    zoom: false,
    hp: cls.hp,
    maxHp: cls.hp,
    overhealMax: cls.hp * 1.5,
    alive: true,
    respawnAt: 0,
    deathTime: 0,
    spawnProtectUntil: 0,
    burning: null,
    cloak: { active: false, amount: 1, alpha: 1 },
    cloakCooldownUntil: 0,
    disguised: null,
    selected: 0,
    prevSelected: 0,
    ammo: {},
    reload: null,
    nextAttack: {},
    lastShot: {},
    ramp: {},
    charge: null,
    spin: 0,
    stickyIds: [],
    buildings: [],
    build: { pending: null, cooldowns: {} },
    uber: 0,
    uberActiveUntil: 0,
    healTargetId: null,
    cmd: emptyCmd(),
    kills: 0, deaths: 0, points: 0, damageDealt: 0, capsCount: 0,
    lastAttackerId: null,
    lastDamageTime: -99,
    airTime: 0,
    speedMult: 1,
    effects: { muzzle: 0, swing: 0 },
    thinkTimer: 0,
  };
}

// Текущее оружие в слоте
export function weaponInSlot(p, slot) {
  const cls = CLASSES[p.classId];
  if (slot === 0) return cls.weapon;
  if (slot === 1) return cls.secondary || null;
  if (slot === 2) return MELEES[p.classId] || null;
  return null;
}

export function currentWeapon(p) {
  return weaponInSlot(p, p.selected) || weaponInSlot(p, 0);
}

// ------------------------------------------------------------
//  Мир
// ------------------------------------------------------------
export class World {
  constructor(map, opts = {}) {
    this.map = map;
    this.boxes = map.boxes;
    this.solids = map.boxes; // все статические боксы блокируют игроков
    this.caps = map.caps.map((c) => ({ ...c, owner: null, progress: 0, capTeam: null, contested: false, playersInside: [0, 0] }));
    this.players = [];
    this.projectiles = [];
    this.buildings = [];
    this.arrows = [];
    this.time = 0;
    this.gameTime = opts.gameTime ?? 480;
    this.remaining = this.gameTime;
    this.ended = false;
    this.endReason = null;
    this.winner = null;
    this.score = { 0: 0, 1: 0 };
    this.friendlyFire = false;
    this.effects = [];
    this.sounds = [];
    this.messages = [];   // события для HUD (килфид, попадания)
    this.killfeed = [];
    this.teleportCooldown = new Map();
    this.rng = opts.rng || Math.random;
    // базовые телепорты у спавнов
    this.basePads = [];
    for (const step of [-1, 1]) {
      const team = step === 1 ? TEAM_BLU : TEAM_RED;
      const sp = map.spawns.filter((s) => s.team === team);
      if (!sp.length) continue;
      const cx = sp.reduce((a, s) => a + s.pos.x, 0) / sp.length;
      const cz = sp.reduce((a, s) => a + s.pos.z, 0) / sp.length;
      this.basePads.push({ team, pos: { x: cx, y: 0, z: cz } });
    }
  }

  // ---------- игроки ----------
  addPlayer(opts) {
    const p = createPlayer(opts);
    this.players.push(p);
    for (const w of [CLASSES[p.classId].weapon, CLASSES[p.classId].secondary]) {
      if (w && w.magazine) p.ammo[w.id] = w.magazine;
    }
    const melee = MELEES[p.classId];
    if (melee) p.ammo[melee.id] = 1;
    this.spawnPlayer(p);
    return p;
  }

  getPlayer(id) { return this.players.find((p) => p.id === id); }

  removePlayer(id) {
    const i = this.players.findIndex((p) => p.id === id);
    if (i >= 0) this.players.splice(i, 1);
  }

  spawnPlayer(p) {
    const spawns = this.map.spawns.filter((s) => s.team === p.team);
    let best = null, bestScore = -Infinity;
    const enemies = this.players.filter((q) => q.team !== p.team && q.alive);
    for (const s of spawns) {
      let nearestEnemy = Infinity;
      for (const e of enemies) nearestEnemy = Math.min(nearestEnemy, dist3(e.pos, s.pos));
      const score = (nearestEnemy === Infinity ? 999 : nearestEnemy) + this.rng() * 8;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    const s = best || { pos: { x: 0, y: 0, z: p.team === TEAM_BLU ? 20 : -20 } };

    p.pos = { x: s.pos.x, y: s.pos.y + 0.1, z: s.pos.z };
    p.vel = vec3();
    p.yaw = p.team === TEAM_BLU ? 0 : Math.PI; // разворот в сторону поля
    p.pitch = 0;
    p.alive = true;
    p.hp = p.maxHp;
    p.crouch = false;
    p.zoom = false;
    p.burning = null;
    p.cloak.active = false;
    p.cloak.amount = 1;
    p.cloak.alpha = 1;
    p.disguised = null;
    p.selected = 0;
    p.reload = null;
    p.charge = null;
    p.spin = 0;
    p.ramp = {};
    p.nextAttack = {};
    p.stickyIds = [];
    p.uber = p.uber || 0;
    p.uberActiveUntil = 0;
    p.healTargetId = null;
    p.spawnProtectUntil = this.time + 2.5;
    p.speedMult = 1;
    p.cmd = emptyCmd();
    if (p.isBot) p.thinkTimer = 0;
    const cls = CLASSES[p.classId];
    for (const w of [cls.weapon, cls.secondary]) if (w && w.magazine) p.ammo[w.id] = w.magazine;
    const melee = MELEES[p.classId];
    if (melee) p.ammo[melee.id] = 1;
    this.emitEffect({ kind: 'spawn', pos: { ...p.pos }, team: p.team });
    return p;
  }

  // Смена класса в бою (для игрока и ботов)
  setPlayerClass(p, classId) {
    const cls = CLASSES[classId];
    if (!cls) return;
    p.classId = classId;
    p.maxHp = cls.hp;
    p.overhealMax = cls.hp * 1.5;
    p.hp = p.alive ? Math.min(p.hp, cls.hp) : cls.hp;
    p.ammo = {};
    for (const w of [cls.weapon, cls.secondary]) if (w && w.magazine) p.ammo[w.id] = w.magazine;
    const melee = MELEES[classId];
    if (melee) p.ammo[melee.id] = 1;
    p.selected = 0;
    p.prevSelected = 0;
    p.reload = null;
    p.charge = null;
    p.spin = 0;
    p.building = null;
    p.cloak.active = false;
    p.cloak.amount = 1;
    p.cloak.alpha = 1;
    p.disguised = null;
    p.healTargetId = null;
  }

  setCommand(id, cmd) {
    const p = this.getPlayer(id);
    if (p) p.cmd = cmd || emptyCmd();
  }

  // ---------- события ----------
  emitEffect(e) { e.ttl = e.ttl ?? 0.08; e.id = nextId(); this.effects.push(e); if (this.effects.length > 400) this.effects.splice(0, 100); }
  emitSound(s) { this.sounds.push(s); if (this.sounds.length > 200) this.sounds.splice(0, 50); }
  emitMessage(m) { m.time = this.time; this.messages.push(m); if (this.messages.length > 100) this.messages.splice(0, 40); }
  drainEffects() { const e = this.effects; this.effects = []; return e; }
  drainSounds() { const s = this.sounds; this.sounds = []; return s; }

  // ---------- основной шаг ----------
  step(dt) {
    if (dt <= 0) return;
    // защита от взрывного dt (вкладка была в фоне)
    dt = Math.min(dt, 0.1);
    this.time += dt;
    if (!this.ended) {
      this.remaining -= dt;
      if (this.remaining <= 0) this.endRound('time');
    }

    for (const p of this.players) {
      if (!p.alive) {
        if (this.time >= p.respawnAt) this.spawnPlayer(p);
        continue;
      }
      this.updatePlayer(p, dt);
    }

    this.updateProjectiles(dt);
    this.updateBuildings(dt);
    this.updateCapture(dt);
    this.updateTeleports(dt);

    // очистка эффектов
    for (const e of this.effects) e.ttl -= dt;
    this.effects = this.effects.filter((e) => e.ttl > 0);
  }

  endRound(reason) {
    if (this.ended) return;
    this.ended = true;
    this.endReason = reason;
    const s0 = this.score[0], s1 = this.score[1];
    this.winner = s0 === s1 ? null : s0 > s1 ? TEAM_RED : TEAM_BLU;
    this.emitSound({ kind: 'roundEnd', winner: this.winner });
    this.emitMessage({ kind: 'roundEnd', winner: this.winner, score: { ...this.score } });
  }

  // ---------- игрок за тик ----------
  updatePlayer(p, dt) {
    const cmd = p.cmd;
    const cls = CLASSES[p.classId];
    const wep = currentWeapon(p);

    // взгляд
    p.yaw = cmd.yaw !== undefined ? cmd.yaw : p.yaw;
    p.pitch = cmd.pitch !== undefined ? cmd.pitch : p.pitch;

    // слот оружия
    if (cmd.select >= 0 && cmd.select !== p.selected && weaponInSlot(p, cmd.select)) {
      const nw = weaponInSlot(p, cmd.select);
      if (!nw.spinUpTime || p.spin < 0.1) {
        p.prevSelected = p.selected;
        p.selected = cmd.select;
        p.reload = null;
        p.charge = null;
        p.zoom = false;
        p.spin = p.spin; // сохраняем раскрутку
      }
    }

    if (cmd.suicide && p.hp > 0) { this.applyDamage(p, 9999, { attacker: p, cause: 'suicide' }); }

    // маскировка / невидимость шпиона
    this.updateSpy(p, dt);

    // медик: убер
    if (p.uberActiveUntil > 0 && this.time > p.uberActiveUntil) p.uberActiveUntil = 0;

    // движение
    this.updateMovement(p, dt, wep);

    // оружие
    if (!p.reload || this.time >= p.reload.until) {
      if (p.reload && this.time >= p.reload.until) {
        const w = p.reload.weapon;
        if (w && w.magazine) p.ammo[w.id] = w.magazine;
        p.reload = null;
      }
      this.updateWeapon(p, dt, wep);
    } else if (cmd.attack) {
      // попытка перезарядки во время перезарядки игнорируется
    }

    // раскрутка пулемёта
    if (wep && wep.spinUpTime) {
      const spinning = cmd.attack || cmd.attack2;
      if (spinning && p.ammo[wep.id] > 0) p.spin = Math.min(1, p.spin + dt / wep.spinUpTime);
      else p.spin = Math.max(0, p.spin - dt / wep.spinDownTime);
    }

    // лечение от раздатчиков
    this.applyDispenserAura(p, dt);

    // горящий
    if (p.burning) {
      if (this.time > p.burning.until) p.burning = null;
      else this.applyDamage(p, p.burning.dps * dt, { attacker: this.getPlayer(p.burning.by) || null, cause: 'fire', silent: true });
    }

    // оверхил-распад
    if (p.hp > p.maxHp) p.hp = Math.max(p.maxHp, p.hp - CFG.OVERHEAL_DECAY * dt);

    // вейп-эффекты
    if (p.effects.muzzle > 0) p.effects.muzzle -= dt;
    if (p.effects.swing > 0) p.effects.swing -= dt;

    // аим-нормализация
    if (cmd.attack2 === undefined) cmd.attack2 = false;
  }

  maxSpeed(p) {
    const wep = currentWeapon(p);
    let s = CLASS_SPEED[p.classId] * (p.speedMult || 1);
    if (wep && wep.moveMult && p.spin > 0.35) s *= wep.moveMult;
    if (p.zoom && wep && wep.zoomMoveMult) s *= wep.zoomMoveMult;
    if (wep && wep.id === 'minigun' && p.spin > 0.5) s *= wep.moveMult;
    if (p.crouch) s *= CFG.CROUCH_FACTOR;
    return s;
  }

  updateMovement(p, dt, wep) {
    const cmd = p.cmd;
    const maxSpeed = this.maxSpeed(p);
    const fwd = { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) };
    const right = { x: Math.cos(p.yaw), z: -Math.sin(p.yaw) };
    let wx = fwd.x * cmd.forward + right.x * cmd.right;
    let wz = fwd.z * cmd.forward + right.z * cmd.right;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    const wishLen = Math.min(1, wl);

    // разгон
    const accel = p.onGround ? CFG.STAND_ACCEL : CFG.AIR_ACCEL * 6;
    if (wishLen > 0.01) {
      const nx = wx / wl * 1, nz = wz / wl * 1;
      p.vel.x += nx * accel * dt * wishLen;
      p.vel.z += nz * accel * dt * wishLen;
    }
    // трение на земле
    if (p.onGround) {
      const sp = Math.hypot(p.vel.x, p.vel.z);
      if (sp > 0) {
        const drop = sp * CFG.GROUND_FRICTION * dt;
        const k = Math.max(0, sp - drop) / sp;
        p.vel.x *= k; p.vel.z *= k;
      }
    }
    // ограничение скорости. В воздухе работаем с «растянутым» пределом,
    // чтобы ракетные прыжки сохраняли импульс; на земле лишнее гасим плавно.
    const hsp = Math.hypot(p.vel.x, p.vel.z);
    if (p.onGround && hsp > maxSpeed) {
      const excess = (hsp - maxSpeed) * Math.min(1, 10 * dt);
      const k = Math.max(0, hsp - excess) / hsp;
      p.vel.x *= k; p.vel.z *= k;
    } else if (!p.onGround && hsp > maxSpeed * CFG.AIR_SPEED_MULT) {
      const k = (maxSpeed * CFG.AIR_SPEED_MULT) / hsp;
      p.vel.x *= k; p.vel.z *= k;
    }

    // прыжок
    if (cmd.jump && p.onGround) {
      p.vel.y = CFG.JUMP_VELOCITY;
      p.onGround = false;
      this.emitSound({ kind: 'jump', pos: { ...p.pos } });
    }

    // гравитация
    p.vel.y = Math.max(-70, p.vel.y - CFG.GRAVITY * dt);

    // перемещение с коллизиями
    const wasGround = p.onGround;
    const impactVy = p.vel.y;
    const res = moveHitbox(this.solids, p.pos, CFG.PLAYER_RADIUS, CFG.PLAYER_HEIGHT, {
      x: p.vel.x * dt, y: p.vel.y * dt, z: p.vel.z * dt,
    });
    p.pos = res.pos;
    if (res.hitX) p.vel.x = 0;
    if (res.hitZ) p.vel.z = 0;
    p.onGround = res.onGround;
    if (res.hitCeil) p.vel.y = Math.min(0, p.vel.y);

    if (p.onGround) {
      if (!wasGround && impactVy < 0) {
        const impact = -impactVy;
        if (impact > CFG.FALL_DAMAGE_SPEED) {
          const dmg = (impact - CFG.FALL_DAMAGE_SPEED) * CFG.FALL_DAMAGE_K;
          if (dmg > 2) this.applyDamage(p, dmg, { attacker: null, cause: 'fall' });
        }
        this.emitEffect({ kind: 'land', pos: { ...p.pos } });
      }
      p.vel.y = 0;
      p.airTime = 0;
    } else {
      p.airTime += dt;
      p.vel.y = Math.min(0, p.vel.y) === p.vel.y ? p.vel.y : p.vel.y; // no-op
    }

    // границы мира
    p.pos.x = clamp(p.pos.x, -140, 140);
    p.pos.z = clamp(p.pos.z, -140, 140);
    if (p.pos.y < -30) {
      this.applyDamage(p, 9999, { attacker: null, cause: 'fall' });
    }
  }

  // ---------- шпион ----------
  updateSpy(p, dt) {
    if (p.classId !== 'spy') return;
    const cmd = p.cmd;
    const c = p.cloak;
    if (cmd.cloak && this.time > p.cloakCooldownUntil) {
      c.active = true;
    } else if (!cmd.cloak || c.amount <= 0.02) {
      c.active = false;
    }
    if (c.active) {
      c.amount = Math.max(0, c.amount - dt / CFG.CLOAK_DRAIN);
      c.alpha = lerp(0.12, c.alpha, Math.max(0, 1 - dt * 7));
      if (c.amount <= 0) { c.active = false; p.cloakCooldownUntil = this.time + 0.5; }
    } else {
      c.amount = Math.min(1, c.amount + dt / CFG.CLOAK_REGEN);
      c.alpha = lerp(1, c.alpha, Math.max(0, 1 - dt * 9));
    }
    // маскировка под класс противника
    if (cmd.disguise && CLASSES[cmd.disguise] && this.time >= (p.nextAttack.__disguise || 0)) {
      p.disguised = { classId: cmd.disguise, team: 1 - p.team };
      p.nextAttack.__disguise = this.time + 0.9;
      this.emitSound({ kind: 'disguise', pos: { ...p.pos } });
      this.emitEffect({ kind: 'spawn', pos: { ...p.pos }, team: 1 - p.team });
    }
    // атака раскрывает маскировку
    if (cmd.attack || cmd.attack2) p.disguised = null;
  }

  // ---------- оружие ----------
  updateWeapon(p, dt, wep) {
    const cmd = p.cmd;
    if (!wep) return;

    // заряд снайпера
    if (wep.chargeTime !== undefined) {
      const zoomed = cmd.zoom;
      p.zoom = zoomed;
      if (cmd.attack && !p.charge) {
        p.charge = { value: 0 };
        this.emitSound({ kind: 'charge', pos: { ...p.pos }, on: true });
      }
      if (p.charge) {
        const rate = zoomed ? wep.zoomedCharge : 1;
        p.charge.value = Math.min(1, p.charge.value + dt / wep.chargeTime * rate);
        if (!cmd.attack) {
          this.fireSniper(p, wep, p.charge.value);
          p.charge = null;
          this.emitSound({ kind: 'charge', pos: { ...p.pos }, on: false });
        }
      }
      return;
    }

    if (cmd.reload && !p.reload && wep.magazine && p.ammo[wep.id] < wep.magazine && wep.reloadTime) {
      p.reload = { weapon: wep, until: this.time + wep.reloadTime, id: wep.id };
      return;
    }

    const rl = cmd.reload && p.classId === 'medic' && p.selected === 1; // медган без перезарядки

    // запросы постройки у инженера
    if (p.classId === 'engineer') this.updateEngineer(p, dt, wep, cmd);

    const ready = (p.nextAttack[wep.id] || 0) <= this.time;

    // Убер-заряд активируем ДО обработки оружия: ветка арбалета
    // выходит из функции раньше, иначе убер с арбалетом не включить.
    if (p.classId === 'medic' && cmd.uber && p.uber >= 1) {
      p.uber = 0;
      p.uberActiveUntil = this.time + CLASSES.medic.secondary.uberTime;
      this.emitSound({ kind: 'uber', pos: { ...p.pos } });
      this.emitMessage({ kind: 'uber', player: p.name });
    }

    switch (wep.type) {
      case 'hitscan':
        if (cmd.attack && ready) this.fireHitscanWeapon(p, wep);
        break;

      case 'projectile':
        if (wep.id === 'crossbow') {
          if (cmd.attack && ready) this.fireArrow(p, wep, wep.arrowType || 'heal');
          return; // у медика второй слот — луч
        }
        if (cmd.attack && ready && p.ammo[wep.id] > 0) {
          if (wep.sticky || wep.id === 'grenadelauncher' || wep.id === 'rocketlauncher' || wep.id === 'stickybomb') {
            this.fireProjectileWeapon(p, wep);
          }
        }
        if (wep.detonate && cmd.detonate) this.detonateStickies(p);
        break;

      case 'flame':
        if (cmd.attack) this.fireFlame(p, wep, dt);
        else p.effects.flameOff = this.time;
        if (cmd.attack2 && this.time >= (p.nextAttack.__airblast || 0)) {
          this.airblast(p, wep);
          p.nextAttack.__airblast = this.time + wep.airblastCooldown;
        }
        break;

      case 'beam':
        if (cmd.attack2) this.updateMedigun(p, wep, dt);
        else p.healTargetId = null;
        break;

      case 'melee':
        if (cmd.attack && ready) this.swingMelee(p, wep);
        break;
    }

  }

  // ---- боеприпасы ----
  useAmmo(p, wep, n = 1) {
    if (wep.magazine) p.ammo[wep.id] = Math.max(0, (p.ammo[wep.id] || 0) - n);
  }

  // ---- hitscan ----
  fireHitscanWeapon(p, wep) {
    const rpm = wep.rpm || 60;
    p.nextAttack[wep.id] = this.time + 60 / rpm;
    // разброс с раскруткой
    let spread = wep.spread || 0;
    if (wep.ramp) {
      const r = p.ramp[wep.id] || 0;
      spread *= 1 - Math.min(1, r / wep.ramp.max) * 0.85;
    }
    const pellets = wep.pellets || 1;
    let totalDmg = 0;
    for (let i = 0; i < pellets; i++) {
      totalDmg += this.hitscanRay(p, wep, spread);
    }
    if (wep.ramp) {
      p.ramp[wep.id] = Math.min(wep.ramp.max, (p.ramp[wep.id] || 0) + wep.ramp.perShot * (pellets > 1 ? pellets : 1));
      p.ramp.__last = this.time;
    }
    this.useAmmo(p, wep, 1);
    p.effects.muzzle = 0.06;
    this.emitEffect({ kind: 'muzzle', pos: eyePos(p), dir: dirFromAngles(p.yaw, p.pitch), ownerId: p.id, big: totalDmg > 60 });
    this.emitSound({ kind: 'shot', weapon: wep.sound || wep.id, pos: { ...p.pos }, power: totalDmg });
    if (wep.magazine && p.ammo[wep.id] <= 0) p.reload = { weapon: wep, until: this.time + wep.reloadTime, id: wep.id };
  }

  hitscanRay(p, wep, spread) {
    const origin = eyePos(p);
    const base = dirFromAngles(p.yaw, p.pitch);
    const dir = spreadDir(base, spread);
    const range = wep.range || 40;
    return this.traceShot(p, origin, dir, {
      damage: wep.damage || 20,
      range,
      falloff: wep.falloff ?? 1,
      damageType: 'bullet',
      headMult: wep.headshotMult || 1,
    });
  }

  traceShot(p, origin, dir, opts) {
    const range = opts.range || 40;
    let best = { dist: range, type: null, target: null, head: false };

    // игроки
    for (const q of this.players) {
      if (!q.alive || q.id === p.id) continue;
      if (q.team === p.team && !this.friendlyFire) continue;
      if (q.cloak && q.cloak.alpha < 0.35) continue;
      if (q.uberActiveUntil > this.time) continue;
      const hb = hitbox(q.pos, CFG.PLAYER_RADIUS + 0.05, CFG.PLAYER_HEIGHT);
      const t = rayBox(origin, dir, hb, best.dist);
      if (t !== null) {
        const hitY = origin.y + dir.y * t;
        const head = hitY > q.pos.y + 1.36 && q.crouch === false;
        best = { dist: t, type: 'player', target: q, head };
      }
    }
    // постройки
    for (const b of this.buildings) {
      if (b.team === p.team && !this.friendlyFire) continue;
      const hb = hitbox(b.pos, b.radius, b.height);
      const t = rayBox(origin, dir, hb, best.dist);
      if (t !== null) best = { dist: t, type: 'building', target: b, head: false };
    }
    // геометрия
    const hit = raycastBoxes(this.solids, origin, dir, best.dist);
    if (hit && hit.dist < best.dist) best = { dist: hit.dist, type: 'world', target: hit.box, normal: hit.normal };

    const hitPoint = { x: origin.x + dir.x * best.dist, y: origin.y + dir.y * best.dist, z: origin.z + dir.z * best.dist };

    if (best.type === 'player' || best.type === 'building') {
      // поправка на дальность
      let dmg = opts.damage;
      if (opts.falloff !== 1) {
        const t = clamp((best.dist - range * 0.4) / (range * 0.6), 0, 1);
        dmg *= lerp(1, opts.falloff, t);
      }
      if (best.head && opts.headMult > 1) dmg *= opts.headMult;
      if (opts.crit) dmg *= 2;
      if (best.type === 'player') {
        this.applyDamage(best.target, dmg, { attacker: p, cause: opts.damageType, dist: best.dist, headshot: best.head });
      } else {
        this.damageBuilding(best.target, dmg, p);
      }
      this.emitEffect({ kind: 'impact', pos: hitPoint, blood: best.type === 'player' });
      return dmg;
    }
    this.emitEffect({ kind: 'impact', pos: hitPoint, blood: false, dust: true });
    return 0;
  }

  fireSniper(p, wep, charge) {
    if ((p.nextAttack[wep.id] || 0) > this.time) return;
    p.nextAttack[wep.id] = this.time + 60 / (wep.rpm || 60);
    const origin = eyePos(p);
    const base = dirFromAngles(p.yaw, p.pitch);
    const dir = spreadDir(base, p.zoom ? 0 : 0.03);
    const k = 1 + charge * 1.5; // заряд до 2.5x
    this.emitEffect({ kind: 'tracer', from: origin, to: { x: origin.x + dir.x * 200, y: origin.y + dir.y * 200, z: origin.z + dir.z * 200 }, team: p.team, weapon: 'sniperrifle' });
    this.traceShot(p, origin, dir, {
      damage: (wep.damage || 50) * k, range: 120, falloff: 1, headMult: wep.headshotMult || 3,
      damageType: 'sniper',
    });
    this.useAmmo(p, wep, 1);
    p.effects.muzzle = 0.08;
    this.emitSound({ kind: 'shot', weapon: 'sniperrifle', pos: { ...p.pos } });
    this.emitEffect({ kind: 'muzzle', pos: origin, dir, big: true, ownerId: p.id });
    if (wep.magazine && p.ammo[wep.id] <= 0) p.reload = { weapon: wep, until: this.time + wep.reloadTime, id: wep.id };
  }

  // ---- снаряды ----
  fireProjectileWeapon(p, wep) {
    const rpm = wep.rpm || 60;
    p.nextAttack[wep.id] = this.time + 60 / rpm;
    const origin = eyePos(p);
    const dir = dirFromAngles(p.yaw, p.pitch);
    const speed = wep.speed === 'speed' ? 19 : wep.speed || 20;
    const start = {
      x: origin.x + dir.x * 0.7,
      y: origin.y + dir.y * 0.7 - 0.15,
      z: origin.z + dir.z * 0.7,
    };
    if (wep.sticky) {
      if (p.stickyIds.length >= (wep.maxActive || 8)) {
        const old = p.stickyIds.shift();
        this.removeProjectile(old);
      }
    }
    const proj = {
      id: nextId(),
      kind: wep.sticky ? 'sticky' : wep.id === 'grenadelauncher' ? 'grenade' : 'rocket',
      ownerId: p.id, team: p.team, ownerClass: p.classId,
      pos: start,
      vel: { x: dir.x * speed, y: dir.y * speed + (wep.gravity ? 0.6 : 0), z: dir.z * speed },
      radius: 0.22,
      gravity: wep.gravity || 0,
      damage: wep.damage || 80,
      splash: wep.splash || 60,
      explosion: wep.explosion || 3.2,
      push: wep.push ?? 12,
      selfPush: wep.selfPush ?? wep.push ?? 12,
      selfDamage: wep.selfDamage ?? 0.6,
      sticky: !!wep.sticky,
      manual: !!wep.manual,
      armTime: wep.armTime || 0,
      life: wep.sticky ? 30 : 3.2,
      born: this.time,
      bounces: 0,
      crit: false,
    };
    if (proj.kind === 'grenade') proj.vel.y = dir.y * speed + 3.0;
    this.projectiles.push(proj);
    if (proj.sticky) p.stickyIds.push(proj.id);
    this.useAmmo(p, wep, 1);
    p.effects.muzzle = 0.07;
    this.emitSound({ kind: 'shot', weapon: wep.sound || 'rocket', pos: { ...p.pos } });
    this.emitEffect({ kind: 'muzzle', pos: origin, dir, ownerId: p.id });
    if (wep.magazine && p.ammo[wep.id] <= 0 && !p.reload) p.reload = { weapon: wep, until: this.time + wep.reloadTime, id: wep.id };
    return proj;
  }

  fireArrow(p, wep, type) {
    p.nextAttack[wep.id] = this.time + 60 / (wep.rpm || 60);
    const def = ARROWS[type] || ARROWS.normal;
    const origin = eyePos(p);
    const dir = dirFromAngles(p.yaw, p.pitch);
    const proj = {
      id: nextId(), kind: 'arrow', arrowType: type,
      ownerId: p.id, team: p.team, ownerClass: p.classId,
      pos: { x: origin.x + dir.x * 0.6, y: origin.y + dir.y * 0.6, z: origin.z + dir.z * 0.6 },
      vel: { x: dir.x * def.speedAtMax, y: dir.y * def.speedAtMax, z: dir.z * def.speedAtMax },
      radius: 0.2, gravity: CFG.GRAVITY * def.gravity,
      damage: def.damage || 35, splash: (def.damage || 0) * 0.35, explosion: def.ruin ? 2.4 : 2.0,
      push: def.ruin ? 5 : 3, selfPush: 3, selfDamage: 0.5,
      life: 5, born: this.time, bounces: 0,
      heal: !!def.heal, healHp: 75, deflected: false,
      crit: false,
    };
    this.projectiles.push(proj);
    this.useAmmo(p, wep, 1);
    this.emitSound({ kind: 'shot', weapon: 'crossbow', pos: { ...p.pos } });
    if (wep.magazine && p.ammo[wep.id] <= 0 && !p.reload) p.reload = { weapon: wep, until: this.time + wep.reloadTime, id: wep.id };
    return proj;
  }

  removeProjectile(id) {
    const i = this.projectiles.findIndex((x) => x.id === id);
    if (i >= 0) this.projectiles.splice(i, 1);
    for (const p of this.players) {
      const j = p.stickyIds.indexOf(id);
      if (j >= 0) p.stickyIds.splice(j, 1);
    }
  }

  detonateStickies(p) {
    const ids = [...p.stickyIds];
    let any = false;
    for (const id of ids) {
      const proj = this.projectiles.find((x) => x.id === id);
      if (!proj) continue;
      if (this.time - proj.born < proj.armTime) continue;
      any = true;
      this.removeProjectile(id);
      this.explode(proj.pos, {
        attackerId: proj.ownerId, team: proj.team, damage: proj.splash || proj.damage,
        explosion: proj.explosion, push: proj.push, selfDamage: 0.7, cause: 'explosion',
      });
    }
    if (any) this.emitSound({ kind: 'detonate', pos: { ...p.pos } });
  }

  // ---- огнемёт ----
  fireFlame(p, wep, dt) {
    const id = wep.id;
    if ((p.ammo[id] || 0) <= 0) {
      if (!p.reload) p.reload = { weapon: wep, until: this.time + wep.reloadTime, id };
      return;
    }
    const use = wep.ammoPerSec * dt;
    p.ammo[id] = Math.max(0, p.ammo[id] - use);
    p.nextAttack.__flameTick = (p.nextAttack.__flameTick || 0);
    const eye = eyePos(p);
    const dir = dirFromAngles(p.yaw, p.pitch);
    // визуал (не чаще 20 раз в секунду — партиклы дорогие)
    if (this.time >= (p.nextAttack.__flameFx || 0)) {
      p.nextAttack.__flameFx = this.time + 0.05;
      this.emitEffect({
        kind: 'flame',
        pos: { x: eye.x + dir.x * 0.8, y: eye.y - 0.1 + dir.y * 0.8, z: eye.z + dir.z * 0.8 },
        dir, ownerId: p.id, range: wep.range,
      });
    }
    // урон по конусу (тик раз в 0.2 c)
    if (this.time < (p.nextAttack.__flameDmg || 0)) return;
    p.nextAttack.__flameDmg = this.time + 0.2;
    for (const q of this.players) {
      if (!q.alive || q.id === p.id) continue;
      if (q.team === p.team && !this.friendlyFire) continue;
      const to = { x: q.pos.x - eye.x, y: q.pos.y + 0.9 - eye.y, z: q.pos.z - eye.z };
      const d = len3(to);
      if (d > wep.range) continue;
      const dot = (to.x * dir.x + to.y * dir.y + to.z * dir.z) / (d || 1);
      if (dot < Math.cos(wep.cone)) continue;
      if (!raycastLos(this.solids, eye, { x: q.pos.x, y: q.pos.y + 0.9, z: q.pos.z })) continue;
      const dmg = wep.dps * 0.2 * clamp(1.2 - d / wep.range, 0.4, 1);
      this.applyDamage(q, dmg, { attacker: p, cause: 'fire' });
      q.burning = { until: this.time + 5.5, dps: 9, by: p.id };
    }
    for (const b of this.buildings) {
      if (b.team === p.team) continue;
      const to = { x: b.pos.x - eye.x, y: b.pos.y + 0.5 - eye.y, z: b.pos.z - eye.z };
      const d = len3(to);
      if (d > wep.range) continue;
      const dot = (to.x * dir.x + to.y * dir.y + to.z * dir.z) / (d || 1);
      if (dot < Math.cos(wep.cone)) continue;
      this.damageBuilding(b, wep.dps * 0.2, p);
    }
  }

  airblast(p, wep) {
    const eye = eyePos(p);
    const dir = dirFromAngles(p.yaw, p.pitch);
    this.emitSound({ kind: 'airblast', pos: { ...p.pos } });
    this.emitEffect({ kind: 'airblast', pos: eye, dir });
    // отбрасываем врагов
    for (const q of this.players) {
      if (!q.alive || q.id === p.id) continue;
      const to = { x: q.pos.x - eye.x, y: q.pos.y + 0.9 - eye.y, z: q.pos.z - eye.z };
      const d = len3(to);
      if (d > wep.range + 2) continue;
      const dot = (to.x * dir.x + to.y * dir.y + to.z * dir.z) / (d || 1);
      if (dot < 0.5) continue;
      const f = wep.airblastForce * clamp(1 - d / (wep.range + 2), 0.3, 1);
      q.vel.x += dir.x * f; q.vel.z += dir.z * f;
      q.vel.y = Math.max(q.vel.y, f * 0.55);
      // наносить урон своим нельзя, врагам — немного
      if (q.team !== p.team || this.friendlyFire) this.applyDamage(q, 2, { attacker: p, cause: 'airblast' });
    }
    // отражаем снаряды
    for (const proj of this.projectiles) {
      if (proj.team === p.team) continue;
      const to = { x: proj.pos.x - eye.x, y: proj.pos.y - eye.y, z: proj.pos.z - eye.z };
      const d = len3(to);
      if (d > wep.reflectRange) continue;
      const dot = (to.x * dir.x + to.y * dir.y + to.z * dir.z) / (d || 1);
      if (dot < 0.4) continue;
      proj.ownerId = p.id;
      proj.team = p.team;
      proj.ownerClass = p.classId;
      proj.crit = true;
      const sp = len3(proj.vel) || 20;
      proj.vel = { x: dir.x * sp, y: dir.y * sp + 2, z: dir.z * sp };
      proj.gravity = 0;
      proj.sticky = false;
      if (proj.kind === 'sticky') proj.kind = 'rocket';
      this.emitSound({ kind: 'reflect', pos: { ...proj.pos } });
    }
  }

  // ---- медган ----
  updateMedigun(p, wep, dt) {
    const eye = eyePos(p);
    const dir = dirFromAngles(p.yaw, p.pitch);
    let best = null, bestDot = 0.86;
    for (const q of this.players) {
      if (!q.alive || q.team !== p.team) continue;
      const to = { x: q.pos.x - eye.x, y: q.pos.y + 0.9 - eye.y, z: q.pos.z - eye.z };
      const d = len3(to);
      if (d > wep.range) continue;
      const dot = (to.x * dir.x + to.y * dir.y + to.z * dir.z) / (d || 1);
      if (dot > bestDot) { bestDot = dot; best = q; }
    }
    if (!best) { p.healTargetId = null; return; }
    p.healTargetId = best.id;
    const heal = wep.rate * dt;
    const cap = best.maxHp * (wep.overheal || 1.5);
    best.hp = Math.min(cap, best.hp + heal);
    p.uber = Math.min(1, p.uber + heal * 0.0065);
    // убер распространяется на цель
    if (p.uberActiveUntil > this.time) best.uberActiveUntil = p.uberActiveUntil;
    this.emitEffect({ kind: 'healBeam', from: eye, to: { x: best.pos.x, y: best.pos.y + 0.9, z: best.pos.z }, ownerId: p.id });
  }

  // ---- ближний бой ----
  swingMelee(p, wep) {
    p.nextAttack[wep.id] = this.time + 60 / (wep.rpm || 60);
    p.effects.swing = CFG.MELEE_SWING;
    this.emitSound({ kind: 'swing', pos: { ...p.pos } });
    const eye = eyePos(p);
    const dir = dirFromAngles(p.yaw, p.pitch);
    let best = null, bestScore = -1;
    for (const q of this.players) {
      if (!q.alive || q.id === p.id) continue;
      if (q.team === p.team && !this.friendlyFire) continue;
      if (q.uberActiveUntil > this.time) continue;
      const d = dist3(q.pos, { x: eye.x, y: p.pos.y, z: eye.z });
      if (d > wep.range + 0.6) continue;
      const to = { x: q.pos.x - eye.x, y: 0, z: q.pos.z - eye.z };
      const l = Math.hypot(to.x, to.z) || 1;
      const dot = (to.x / l) * dir.x + (to.z / l) * dir.z;
      if (dot < 0.35) continue;
      if (!raycastLos(this.solids, eye, { x: q.pos.x, y: q.pos.y + 1, z: q.pos.z })) continue;
      if (dot > bestScore) { bestScore = dot; best = q; }
    }
    // постройки врага
    for (const b of this.buildings) {
      if (b.team === p.team) continue;
      const d = dist3(b.pos, p.pos);
      if (d <= wep.range + 0.8) { this.damageBuilding(b, wep.damage, p); this.emitEffect({ kind: 'impact', pos: b.pos, blood: false }); }
    }
    // починка/апгрейд своих построек
    if (wep.repair) {
      for (const b of this.buildings) {
        if (b.team !== p.team || b.ownerId !== p.id) continue;
        if (dist3(b.pos, p.pos) <= wep.range + 0.8) this.repairBuilding(b, p, wep);
      }
    }
    if (!best) return;
    if (wep.backstab && this.isBehind(p, best)) {
      this.applyDamage(best, 9999, { attacker: p, cause: 'backstab' });
      this.emitSound({ kind: 'backstab', pos: { ...best.pos } });
      this.emitMessage({ kind: 'backstab', attacker: p.name, victim: best.name });
      return;
    }
    this.applyDamage(best, wep.damage, { attacker: p, cause: 'melee' });
  }

  isBehind(attacker, victim) {
    const fv = dirFromAngles(victim.yaw, 0);
    const toA = norm3({ x: attacker.pos.x - victim.pos.x, y: 0, z: attacker.pos.z - victim.pos.z });
    const dot = fv.x * toA.x + fv.z * toA.z;
    // взгляд жертвы против направления на атакующего:
    // dot > 0 — атакующий прямо перед жертвой, dot < 0 — за спиной
    return dot < -0.35;
  }

  // ---- постройки инженера ----
  updateEngineer(p, dt, wep, cmd) {
    const builds = CLASSES.engineer.builds;
    if (cmd.build) {
      const def = builds.find((b) => b.id === cmd.build);
      if (def) {
        const cd = p.build.cooldowns[def.id] || 0;
        if (this.time >= cd) {
          const existing = this.buildings.find((b) => b.ownerId === p.id && b.kind === def.id);
          if (existing) {
            cmd.build = null;
            this.emitMessage({ kind: 'buildExists', player: p.name });
          } else {
            p.build.pending = def.id;
            this.emitMessage({ kind: 'buildPending', player: p.name, kind2: def.id });
          }
        }
      }
      cmd.build = null;
    }
    if (cmd.buildCancel) { p.build.pending = null; cmd.buildCancel = false; }

    if (p.build.pending && cmd.buildPlace) {
      cmd.buildPlace = false;
      const def = builds.find((b) => b.id === p.build.pending);
      const origin = eyePos(p);
      const dir = dirFromAngles(p.yaw, 0);
      const hit = raycastBoxes(this.solids, origin, dir, 8);
      let spot;
      if (hit) {
        const n = hit.normal || { x: 0, y: 1, z: 0 };
        spot = { x: origin.x + dir.x * (hit.dist - 0.4) + n.x * 0.6, y: origin.y + dir.y * (hit.dist - 0.4) + n.y * 0.6, z: origin.z + dir.z * (hit.dist - 0.4) + n.z * 0.6 };
      } else {
        spot = { x: p.pos.x + dir.x * 3, y: p.pos.y, z: p.pos.z + dir.z * 3 };
      }
      // ставим на пол
      const ground = this.groundBelow(spot);
      if (ground !== null) spot.y = ground;
      spot.y = Math.max(spot.y, 0);
      this.spawnBuilding(p, def, spot);
      p.build.pending = null;
      p.build.cooldowns[def.id] = this.time + def.cooldown;
      this.emitSound({ kind: 'build', pos: { ...spot } });
    }
  }

  groundBelow(pos) {
    const hit = raycastBoxes(this.solids, { x: pos.x, y: pos.y + 2.5, z: pos.z }, { x: 0, y: -1, z: 0 }, 12);
    if (!hit) return null;
    return pos.y + 2.5 - hit.dist;
  }

  spawnBuilding(p, def, spot) {
    const level = 1;
    const hpByKind = { sentry: 150, dispenser: 150, teleporter: 100 };
    const radius = def.id === 'sentry' ? 0.5 : 0.6;
    const b = {
      id: nextId(), kind: def.id, ownerId: p.id, team: p.team, ownerName: p.name,
      pos: { ...spot }, yaw: p.yaw + Math.PI, level, hp: hpByKind[def.id] || 150,
      maxHp: hpByKind[def.id] || 150, radius, height: def.id === 'sentry' ? 1.7 : 1.1,
      builtAt: this.time, nextFire: this.time + CFG.SENTRY_TURN_SPEED * 0.2, rockets: CFG.SENTRY_ROCKETS,
      ammo: CFG.SENTRY_AMMO, targetId: null, upgrade: 0, sapper: null, rocketAt: this.time + 2,
      teleportCooldown: 0,
    };
    this.buildings.push(b);
    p.buildings.push(b.id);
    this.emitEffect({ kind: 'build', pos: { ...spot }, team: p.team, building: b.kind });
    return b;
  }

  repairBuilding(b, p, wep) {
    const repair = wep.repair || 40;
    b.hp = Math.min(b.maxHp, b.hp + repair);
    if (b.level < 3) {
      b.upgrade += 100 * 0.35;
      if (b.upgrade >= 100) {
        b.upgrade = 0;
        b.level += 1;
        b.hp = b.maxHp = Math.round(b.maxHp * 1.2);
        this.emitSound({ kind: 'upgrade', pos: { ...b.pos } });
        this.emitMessage({ kind: 'buildingUpgraded', player: p.name, level: b.level, building: b.kind });
      }
    }
  }

  damageBuilding(b, amount, attacker) {
    if (!b) return;
    b.hp -= amount;
    if (attacker && attacker.id !== undefined && attacker.buildings && attacker.team !== b.team) {
      attacker.damageDealt += amount;
    }
    if (b.hp <= 0) {
      const owner = this.getPlayer(b.ownerId);
      if (owner) {
        const i = owner.buildings.indexOf(b.id);
        if (i >= 0) owner.buildings.splice(i, 1);
        if (attacker && attacker.id) { attacker.points += 1; }
      }
      const i = this.buildings.indexOf(b);
      if (i >= 0) this.buildings.splice(i, 1);
      this.emitEffect({ kind: 'buildingDestroyed', pos: { ...b.pos }, team: b.team, building: b.kind });
      this.emitSound({ kind: 'buildingDestroyed', pos: { ...b.pos } });
    }
  }

  updateBuildings(dt) {
    for (const b of [...this.buildings]) {
      if (b.kind === 'sentry') this.updateSentry(b, dt);
      else if (b.kind === 'dispenser') {
        // зарядка владельцу при смерти не нужна — лечим рядом стоящих
        b.hp = Math.min(b.maxHp, b.hp + 2 * dt);
      }
    }
  }

  updateSentry(b, dt) {
    if (this.time - b.builtAt < 1.0) return;
    const range = CFG.SENTRY_RANGE;
    const eye = { x: b.pos.x, y: b.pos.y + 1.2, z: b.pos.z };
    // выбор цели
    let target = null, bestD = Infinity;
    for (const q of this.players) {
      if (!q.alive || q.team === b.team) continue;
      if (q.cloak && q.cloak.alpha < 0.3) continue;
      if (q.uberActiveUntil > this.time && b.level < 99) { /* убер-цель всё равно цель */ }
      const d = dist3(q.pos, b.pos);
      if (d > range) continue;
      if (!raycastLos(this.solids, eye, { x: q.pos.x, y: q.pos.y + 1.0, z: q.pos.z })) continue;
      if (d < bestD) { bestD = d; target = q; }
      else if (b.targetId === q.id) { target = q; }
    }
    if (target) b.targetId = target.id;
    else if (b.targetId && (!this.getPlayer(b.targetId) || !this.getPlayer(b.targetId).alive)) b.targetId = null;

    // поворот
    const t = target || null;
    if (t) {
      const desired = Math.atan2(-(t.pos.x - b.pos.x), -(t.pos.z - b.pos.z));
      let diff = ((desired - b.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const maxTurn = CFG.SENTRY_TURN_SPEED * dt * 2;
      b.yaw += clamp(diff, -maxTurn, maxTurn);
    }

    if (!t || b.ammo <= 0) return;
    const aim = { x: t.pos.x, y: t.pos.y + 1.0 * (t.crouch ? 0.7 : 1), z: t.pos.z };
    const dir = norm3({ x: aim.x - eye.x, y: aim.y - eye.y, z: aim.z - eye.z });
    // проверка «смотрит ли» на цель
    const facing = dirFromAngles(b.yaw, 0);
    const dot = facing.x * dir.x + facing.z * dir.z;
    if (dot < 0.85) return;

    const stats = [
      null,
      { dmg: 11, interval: 0.15 },
      { dmg: 12, interval: 0.11 },
      { dmg: 13, interval: 0.09, rockets: true },
    ][b.level] || { dmg: 11, interval: 0.15 };

    if (this.time >= b.nextFire) {
      b.nextFire = this.time + stats.interval;
      b.ammo -= 1;
      // лёгкое рассеивание
      const d2 = spreadDir(dir, 0.02);
      this.traceShot({ id: -b.id, team: b.team, name: b.ownerName || 'Sentry' }, { x: eye.x, y: eye.y, z: eye.z }, d2, {
        damage: stats.dmg, range, falloff: 0.7, damageType: 'sentry', headMult: 1,
      });
      this.emitEffect({ kind: 'sentryShot', from: { x: eye.x, y: eye.y, z: eye.z }, to: { x: eye.x + d2.x * 60, y: eye.y + d2.y * 60, z: eye.z + d2.z * 60 }, level: b.level });
      this.emitSound({ kind: 'sentryShot', pos: { ...b.pos }, level: b.level });
    }
    // ракеты 3-го уровня
    if (stats.rockets && this.time >= b.rocketAt && b.rockets > 0) {
      b.rocketAt = this.time + 3;
      b.rockets -= 1;
      this.projectiles.push({
        id: nextId(), kind: 'rocket', ownerId: -b.id, team: b.team, ownerClass: 'engineer',
        pos: { x: eye.x + dir.x * 0.6, y: eye.y + dir.y * 0.6, z: eye.z + dir.z * 0.6 },
        vel: { x: dir.x * 22, y: dir.y * 22, z: dir.z * 22 },
        radius: 0.22, gravity: 0, damage: 0, splash: 40, explosion: 3.0, push: 8, selfPush: 0,
        selfDamage: 0, life: 3, born: this.time, bounces: 0, crit: false,
      });
      this.emitSound({ kind: 'rocket', pos: { ...b.pos } });
    }
  }

  // раздатчик лечит союзников рядом
  applyDispenserAura(p, dt) {
    for (const b of this.buildings) {
      if (b.kind !== 'dispenser' || b.team !== p.team) continue;
      const d = dist3(b.pos, p.pos);
      const range = 2.5 + b.level * 0.6;
      if (d > range) continue;
      const rate = 8 + b.level * 6;
      p.hp = Math.min(p.maxHp, p.hp + rate * dt);
      if (p.classId === 'engineer' && p !== undefined) { /* аммо-часть */ }
    }
  }

  // телепорты: площадка в тылу ↔ площадка инженера.
  // Важно: после переноса игрок проверяется только один раз за тик,
  // иначе он тут же «телепортируется» обратно с только что покинутой площадки.
  updateTeleports(dt) {
    for (const p of this.players) {
      if (!p.alive) continue;
      if (this.time < (this.teleportCooldown.get(p.id) || 0)) continue;
      const inside = (pos) => distXZ(p.pos, pos) <= 1.5 && Math.abs(p.pos.y - pos.y) <= 2;

      // 1) стоим на базовой площадке → переносим к инженерному телепорту
      const base = this.basePads.find((pad) => pad.team === p.team);
      if (base && inside(base.pos)) {
        const exits = this.buildings.filter((b) => b.kind === 'teleporter' && b.team === p.team);
        if (exits.length) {
          const exit = exits[exits.length - 1];
          this.doTeleport(p, exit.pos);
          continue;
        }
      }
      // 2) стоим на площадке инженера → переносим в тыл
      const pad = this.buildings.find((b) => b.kind === 'teleporter' && b.team === p.team && inside(b.pos));
      if (pad && base) {
        this.doTeleport(p, base.pos);
        continue;
      }
    }
  }

  doTeleport(p, target) {
    p.pos = { x: target.x, y: target.y + 0.2, z: target.z };
    p.vel = vec3();
    this.teleportCooldown.set(p.id, this.time + 3);
    this.emitEffect({ kind: 'teleport', pos: { ...p.pos }, team: p.team });
    this.emitSound({ kind: 'teleport', pos: { ...p.pos } });
  }

  // ---------- захват точек ----------
  updateCapture(dt) {
    if (this.ended) return;
    const CAP_TIME = 14;
    for (const cap of this.caps) {
      let countRed = 0, countBlu = 0;
      for (const p of this.players) {
        if (!p.alive) continue;
        if (p.cloak && p.cloak.alpha < 0.4) continue;
        const inside = distXZ(p.pos, cap.pos) <= cap.radius && Math.abs(p.pos.y - cap.pos.y) < 4;
        if (!inside) continue;
        if (p.team === TEAM_RED) countRed++;
        else countBlu++;
      }
      cap.playersInside = [countRed, countBlu];
      cap.contested = countRed > 0 && countBlu > 0;
      if (cap.contested) continue;
      const team = countRed > 0 ? TEAM_RED : countBlu > 0 ? TEAM_BLU : null;
      if (team === null) {
        cap.progress = Math.max(0, cap.progress - dt * 0.06);
        cap.capTeam = null;
        continue;
      }
      if (cap.owner === team) { cap.progress = 0; cap.capTeam = null; continue; }
      const count = team === TEAM_RED ? countRed : countBlu;
      const mult = Math.min(2, 1 + (count - 1) * 0.5);
      cap.capTeam = team;
      cap.progress = Math.min(CAP_TIME, cap.progress + dt * mult);
      if (cap.progress >= CAP_TIME) {
        cap.owner = team;
        cap.progress = 0;
        cap.capTeam = null;
        this.score[team] += 1;
        this.emitSound({ kind: 'capture', team });
        this.emitMessage({ kind: 'capture', team, cap: cap.name, scorer: this.firstPlayerIn(cap, team) });
        for (const p of this.players) {
          if (p.team === team && p.alive && distXZ(p.pos, cap.pos) <= cap.radius) {
            p.capsCount++; p.points += 5;
          }
        }
        this.emitEffect({ kind: 'capture', pos: { ...cap.pos }, team });
        // мгновенная победа при полном захвате
        const owned = this.caps.filter((c) => c.owner === team).length;
        if (owned === this.caps.length && this.caps.length > 1) this.endRound('capture');
      }
    }
  }

  firstPlayerIn(cap, team) {
    const p = this.players.find((q) => q.alive && q.team === team && distXZ(q.pos, cap.pos) <= cap.radius);
    return p ? p.name : '';
  }

  // ---------- снаряды ----------
  updateProjectiles(dt) {
    for (const proj of [...this.projectiles]) {
      if (this.time - proj.born > proj.life) {
        this.removeProjectile(proj.id);
        if (proj.kind === 'arrow') continue;
        continue;
      }
      if (proj.gravity) proj.vel.y -= proj.gravity * dt;
      if (proj.kind === 'arrow') proj.vel.y -= (proj.gravity ? 0 : 0);
      const speed = len3(proj.vel);
      const stepDist = speed * dt;
      const steps = Math.max(1, Math.ceil(stepDist / 0.3));
      const sd = stepDist / steps;
      let exploded = false;
      for (let i = 0; i < steps && !exploded; i++) {
        const dir = speed > 0 ? { x: proj.vel.x / speed, y: proj.vel.y / speed, z: proj.vel.z / speed } : { x: 0, y: -1, z: 0 };
        // игроки
        let hitPlayer = null, hitDist = sd;
        for (const q of this.players) {
          if (!q.alive) continue;
          if (q.id === proj.ownerId) continue;
          if (q.team === proj.team && !proj.crit && !this.friendlyFire) continue;
          if (q.cloak && q.cloak.alpha < 0.3) continue;
          const hb = hitbox(q.pos, CFG.PLAYER_RADIUS + proj.radius, CFG.PLAYER_HEIGHT);
          const t = rayBox(proj.pos, dir, hb, hitDist);
          if (t !== null && t < hitDist) { hitDist = t; hitPlayer = q; }
        }
        // постройки
        let hitBuilding = null;
        for (const b of this.buildings) {
          if (b.team === proj.team && !this.friendlyFire) continue;
          const hb = hitbox(b.pos, b.radius + proj.radius, b.height);
          const t = rayBox(proj.pos, dir, hb, hitDist);
          if (t !== null && t < hitDist) { hitDist = t; hitPlayer = null; hitBuilding = b; }
        }
        // рельеф
        const worldHit = raycastBoxes(this.solids, proj.pos, dir, hitDist);
        const worldDist = worldHit ? worldHit.dist : Infinity;
        if (worldDist <= hitDist) hitDist = worldDist;

        // перемещение
        const next = { x: proj.pos.x + dir.x * hitDist, y: proj.pos.y + dir.y * hitDist, z: proj.pos.z + dir.z * hitDist };

        if (hitPlayer) {
          proj.pos = next;
          this.projectileHitPlayer(proj, hitPlayer);
          exploded = true;
          break;
        }
        if (hitBuilding) {
          proj.pos = next;
          this.projectileHitBuilding(proj, hitBuilding);
          exploded = true;
          break;
        }
        if (worldDist <= hitDist + EPS) {
          proj.pos = next;
          const n = worldHit && worldHit.box ? normalOf(proj.pos, worldHit.box) : { x: 0, y: 1, z: 0 };
          if (proj.sticky) {
            // липнет к поверхности
            proj.vel = { x: 0, y: 0, z: 0 };
            proj.gravity = 0;
            proj.stuck = true;
            proj.pos = { x: proj.pos.x + n.x * 0.06, y: proj.pos.y + n.y * 0.06, z: proj.pos.z + n.z * 0.06 };
            break;
          }
          if (proj.kind === 'grenade' && proj.bounces < 1) {
            proj.bounces++;
            reflect(proj.vel, n, 0.45);
            break;
          }
          if (proj.kind === 'arrow' && proj.bounces < 1 && !proj.heal) {
            proj.bounces++;
            reflect(proj.vel, n, 0.2);
            break;
          }
          this.projectileExplode(proj);
          exploded = true;
          break;
        }
        proj.pos = next;
      }
      if (exploded) continue;
    }
  }

  projectileHitPlayer(proj, q) {
    if (proj.kind === 'arrow') {
      if (proj.heal) {
        if (q.team === proj.team) {
          const heal = proj.healHp || 75;
          q.hp = Math.min(q.maxHp * 1.1, q.hp + (dist3(proj.pos, proj.pos) < 0 ? 0 : heal));
          this.emitEffect({ kind: 'healBurst', pos: { x: q.pos.x, y: q.pos.y + 1, z: q.pos.z } });
          this.emitSound({ kind: 'healHit', pos: { ...q.pos } });
          this.removeProjectile(proj.id);
          return;
        }
        // врагам — урон от арбалета
        this.applyDamage(q, proj.damage, { attacker: this.getPlayer(proj.ownerId), cause: 'arrow' });
        this.emitEffect({ kind: 'impact', pos: { ...proj.pos }, blood: true });
        this.removeProjectile(proj.id);
        return;
      }
      this.applyDamage(q, proj.damage, { attacker: this.getPlayer(proj.ownerId), cause: 'arrow' });
      this.emitEffect({ kind: 'impact', pos: { ...proj.pos }, blood: true });
      this.removeProjectile(proj.id);
      return;
    }
    // ракеты/гранаты: прямое попадание = полный урон + мини-взрыв без сплеша
    this.projectileExplode(proj, q);
  }

  projectileHitBuilding(proj, b) {
    this.projectileExplode(proj);
  }

  projectileExplode(proj, directTarget) {
    this.removeProjectile(proj.id);
    if (directTarget && proj.kind === 'rocket') {
      const attacker = this.getPlayer(proj.ownerId);
      this.applyDamage(directTarget, proj.damage, { attacker, cause: 'rocket', crit: proj.crit });
      this.emitEffect({ kind: 'impact', pos: { ...proj.pos }, blood: true });
    } else if (directTarget) {
      const attacker = this.getPlayer(proj.ownerId);
      this.applyDamage(directTarget, proj.damage * 0.5, { attacker, cause: proj.kind, crit: proj.crit });
    }
    this.explode(proj.pos, {
      attackerId: proj.ownerId, team: proj.team, damage: proj.splash || proj.damage,
      explosion: proj.explosion || 3, push: proj.push ?? 12, selfPush: proj.selfPush ?? proj.push ?? 12,
      selfDamage: proj.selfDamage ?? 0.6, cause: 'explosion', critical: proj.crit,
    });
  }

  // ---------- урон ----------
  applyDamage(target, amount, opts = {}) {
    if (!target || !target.alive) return;
    if (target.spawnProtectUntil > this.time && opts.cause !== 'suicide') return;
    if (target.uberActiveUntil > this.time && opts.cause !== 'suicide') return;
    if (target.cloak && target.cloak.alpha < 0.3 && opts.cause !== 'suicide' && opts.cause !== 'fall') return;
    const attacker = opts.attacker || null;
    let dmg = amount;
    if (!opts.silent) {
      dmg = Math.round(dmg * 10) / 10;
    }
    target.hp -= dmg;
    target.lastDamageTime = this.time;
    if (attacker && attacker.id !== undefined && attacker.id !== target.id) {
      target.lastAttackerId = attacker.id;
      if (attacker.damageDealt !== undefined) attacker.damageDealt += dmg;
      if (attacker.team !== undefined && attacker.team !== target.team) {
        this.emitMessage({
          kind: 'damage', attackerId: attacker.id, targetId: target.id, amount: dmg,
          crit: !!opts.crit, headshot: !!opts.headshot, cause: opts.cause, attackerName: attacker.name, targetName: target.name,
        });
      }
    }
    if (dmg > 0 && !opts.silent) {
      this.emitSound({ kind: 'hurt', pos: { ...target.pos }, amount: dmg });
      this.emitEffect({ kind: 'blood', pos: { x: target.pos.x, y: target.pos.y + 1, z: target.pos.z } });
    }
    if (target.hp <= 0) this.killPlayer(target, attacker, opts.cause);
  }

  killPlayer(victim, attacker, cause) {
    if (!victim.alive) return;
    victim.alive = false;
    victim.hp = 0;
    victim.deaths++;
    victim.deathTime = this.time;
    victim.respawnAt = this.time + CFG.RESPAWN_TIME;
    victim.burning = null;
    victim.cloak.active = false;
    victim.cmd = emptyCmd();
    this.emitEffect({ kind: 'death', pos: { ...victim.pos }, team: victim.team, classId: victim.classId });
    this.emitSound({ kind: 'death', pos: { ...victim.pos } });

    // «мёртвая» цель больше не держится медганом
    for (const p of this.players) if (p.healTargetId === victim.id) p.healTargetId = null;

    if (attacker && attacker.id !== undefined && attacker.id !== victim.id) {
      attacker.kills++;
      attacker.points += 2;
      if (cause === 'backstab') attacker.points += 3;
    }
    const feed = {
      kind: 'kill',
      attacker: attacker ? attacker.name : 'Мир',
      attackerTeam: attacker ? attacker.team : null,
      attackerClass: attacker ? attacker.classId : null,
      victim: victim.name,
      victimTeam: victim.team,
      victimClass: victim.classId,
      weapon: cause === 'explosion' ? 'explosion' : cause,
      suicide: !attacker || attacker.id === victim.id,
      time: this.time,
    };
    this.killfeed.push(feed);
    if (this.killfeed.length > 6) this.killfeed.shift();
    this.emitMessage(feed);
  }

  // ---------- взрывы ----------
  explode(pos, opts) {
    const radius = opts.explosion || 3;
    const attacker = this.getPlayer(opts.attackerId);
    this.emitEffect({ kind: 'explosion', pos: { ...pos }, radius, team: opts.team, critical: opts.critical });
    this.emitSound({ kind: 'explosion', pos: { ...pos } });
    for (const q of this.players) {
      if (!q.alive) continue;
      if (q.team === opts.team && !this.friendlyFire) {
        // самоподрыв для ракетных прыжков
        if (q.id !== opts.attackerId) continue;
      }
      const center = { x: q.pos.x, y: q.pos.y + 0.9, z: q.pos.z };
      const d = dist3(center, pos);
      if (d > radius) continue;
      if (!raycastLos(this.solids, pos, center)) continue;
      const falloff = clamp(1 - d / radius, 0.35, 1);
      let dmg = (opts.damage || 70) * falloff;
      if (opts.critical) dmg *= 1.35;
      if (q.id === opts.attackerId) dmg *= opts.selfDamage ?? 0.6;
      this.applyDamage(q, dmg, { attacker, cause: opts.cause || 'explosion', crit: opts.critical });
      // толчок
      let push = (opts.push ?? 12) * falloff;
      let dir = norm3({ x: center.x - pos.x, y: center.y - pos.y + 0.25, z: center.z - pos.z });
      if (q.id === opts.attackerId) {
        push = (opts.selfPush ?? opts.push ?? 12) * clamp(1 - d / radius * 0.5, 0.5, 1);
        // для самого себя отбрасывание делаем почти вертикальным:
        // так ракетный прыжок подкидывает, а не «выбивает» разбег назад
        dir = norm3({ x: dir.x * 0.45, y: dir.y, z: dir.z * 0.45 });
      } else {
        push *= 0.85;
      }
      q.vel.x += dir.x * push;
      q.vel.y += dir.y * push * 0.85;
      q.vel.z += dir.z * push;
      q.onGround = false;
      if (q.id === opts.attackerId) this.emitSound({ kind: 'rocketJump', pos: { ...q.pos } });
    }
    for (const b of this.buildings) {
      const d = dist3({ x: b.pos.x, y: b.pos.y + 0.5, z: b.pos.z }, pos);
      if (d > radius) continue;
      const falloff = clamp(1 - d / radius, 0.35, 1);
      if (b.team !== opts.team || this.friendlyFire) this.damageBuilding(b, (opts.damage || 70) * falloff * 0.8, attacker);
    }
  }

  // ---------- статистика ----------
  get scoreboard() {
    return [...this.players].sort((a, b) => b.points - a.points || b.kills - a.kills);
  }
}

// ------------------------------------------------------------
//  Вспомогательные функции
// ------------------------------------------------------------
export function spreadDir(dir, spread) {
  if (!spread) return { ...dir };
  const a = Math.random() * Math.PI * 2;
  const r = Math.random() * spread;
  // строим ортонормированный базис
  const up = Math.abs(dir.y) > 0.95 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const right = norm3({ x: dir.z * up.y - dir.y * up.z, y: dir.x * up.z - dir.z * up.x, z: dir.y * up.x - dir.x * up.y });
  const upv = norm3({ x: dir.y * right.z - dir.z * right.y, y: dir.z * right.x - dir.x * right.z, z: dir.x * right.y - dir.y * right.x });
  const ox = Math.cos(a) * r, oy = Math.sin(a) * r;
  return norm3({
    x: dir.x + right.x * ox + upv.x * oy,
    y: dir.y + right.y * ox + upv.y * oy,
    z: dir.z + right.z * ox + upv.z * oy,
  });
}

export function reflect(vel, n, restitution = 1) {
  const dot = vel.x * n.x + vel.y * n.y + vel.z * n.z;
  vel.x = (vel.x - 2 * dot * n.x) * restitution;
  vel.y = (vel.y - 2 * dot * n.y) * restitution;
  vel.z = (vel.z - 2 * dot * n.z) * restitution;
  return vel;
}

export function normalOf(p, box) {
  const cx = (box.min.x + box.max.x) / 2, cy = (box.min.y + box.max.y) / 2, cz = (box.min.z + box.max.z) / 2;
  const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
  const sx = (box.max.x - box.min.x) / 2, sy = (box.max.y - box.min.y) / 2, sz = (box.max.z - box.min.z) / 2;
  const px = Math.abs(dx) / (sx || 1), py = Math.abs(dy) / (sy || 1), pz = Math.abs(dz) / (sz || 1);
  if (py > px && py > pz) return { x: 0, y: dy > 0 ? 1 : -1, z: 0 };
  if (px > pz) return { x: dx > 0 ? 1 : -1, y: 0, z: 0 };
  return { x: 0, y: 0, z: dz > 0 ? 1 : -1 };
}

export function weaponName(w) {
  if (!w) return '';
  return w.ru || w.name || '';
}

export function aliasFor(id) {
  return WEAPON_ALIASES[id] || id;
}
