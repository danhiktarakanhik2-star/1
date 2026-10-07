// ============================================================
//  Fortress Arena — ИИ ботов.
//  Каждый бот получает команду (как игрок) и мыслит по классу:
//  разведчик лезет в ближний бой, снайпер держит дистанцию,
//  медик лечит, инженер строит турель, шпион бьёт в спину.
// ============================================================

import { CFG, CLASSES, CLASS_SPEED, MELEES, TEAM_RED, TEAM_BLU } from '../data.js';
import { dirFromAngles, anglesFromDir, emptyCmd, eyePos, weaponInSlot } from '../world.js';
import { vec3, len3, norm3, dist3, distXZ, clamp, lerp, raycastLos, raycastBoxes } from '../physics.js';

const TWO_PI = Math.PI * 2;

function normAngle(a) {
  while (a > Math.PI) a -= TWO_PI;
  while (a < -Math.PI) a += TWO_PI;
  return a;
}

export function createBrain(skill) {
  return {
    skill,
    targetId: null,
    targetSeenAt: 0,
    lastSeenPos: null,
    reactionUntil: 0,
    aimOffset: { yaw: 0, pitch: 0 },
    aimOffsetUntil: 0,
    strafeDir: 1,
    strafeUntil: 0,
    stuckTimer: 0,
    lastPos: null,
    route: [],
    goal: null,
    goalKind: null,
    nextGoalThink: 0,
    spyChecks: new Map(),
    revealed: new Map(),
    buildIndex: 0,
    buildSpot: null,
    stuckFlipAt: 0,
    danceUntil: 0,
    jumpAt: 0,
    healTargetId: null,
    sniperSpot: null,
    sniperSpotUntil: 0,
    uncloakAt: 0,
    lastAttackAt: 0,
  };
}

// ------------------------------------------------------------
//  Восприятие
// ------------------------------------------------------------
function canSee(world, p, q) {
  if (!q.alive) return false;
  if (q.cloak && q.cloak.alpha < 0.35) return false;
  const eye = eyePos(p);
  const from = { x: eye.x, y: eye.y, z: eye.z };
  const to = { x: q.pos.x, y: q.pos.y + 1.0, z: q.pos.z };
  return raycastLos(world.solids, from, to);
}

// Замаскированный шпион выглядит как союзник. Иногда боты «проверяют».
function isRevealedEnemy(world, p, q, dt) {
  if (!q.disguised || q.disguised.team !== p.team) return true;
  if (q.burning) return true;
  const brain = p.bot;
  const d = dist3(p.pos, q.pos);
  if (d > 9) {
    return (brain.revealed.get(q.id) || 0) > world.time;
  }
  const last = brain.spyChecks.get(q.id) || 0;
  if (world.time - last > 0.6) {
    brain.spyChecks.set(q.id, world.time);
    const chance = { easy: 0.20, normal: 0.45, hard: 0.8 }[brain.skill.id] ?? 0.4;
    if (world.rng() < chance * (d < 5 ? 1.3 : 1)) {
      brain.revealed.set(q.id, world.time + 6);
    }
  }
  return (brain.revealed.get(q.id) || 0) > world.time;
}

function pickTarget(world, p) {
  const brain = p.bot;
  const current = brain.targetId ? world.getPlayer(brain.targetId) : null;
  if (current && current.alive && canSee(world, p, current) && isRevealedEnemy(world, p, current, 0)) {
    // цель ещё видна — держим, если она не слишком далеко
    if (dist3(current.pos, p.pos) < 55) return current;
  }
  let best = null, bestScore = -Infinity;
  for (const q of world.players) {
    if (!q.alive || q.team === p.team || q.id === p.id) continue;
    const d = dist3(q.pos, p.pos);
    if (d > 60) continue;
    if (!canSee(world, p, q)) continue;
    if (!isRevealedEnemy(world, p, q, 0)) continue;
    // не хотим стрелять через всю карту по турели
    let score = 100 - d;
    if (q.classId === 'medic') score += 12;
    if (q.classId === 'spy') score -= 4;
    if (q.hp < q.maxHp * 0.5) score += 8;
    if (q.id === brain.targetId) score += 10;
    if (score > bestScore) { bestScore = score; best = q; }
  }
  return best;
}

function findBuildingTarget(world, p) {
  const brain = p.bot;
  let best = null, bestD = Infinity;
  for (const b of world.buildings) {
    if (b.team === p.team) continue;
    const d = dist3(b.pos, p.pos);
    if (d > 32) continue;
    if (!raycastLos(world.solids, eyePos(p), { x: b.pos.x, y: b.pos.y + 0.7, z: b.pos.z })) continue;
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

// ------------------------------------------------------------
//  Прицеливание
// ------------------------------------------------------------
function aimAt(p, brain, targetPos, dt, lead = 0) {
  const eye = eyePos(p);
  let aim = { ...targetPos };
  if (lead !== 0) {
    const d = dist3(aim, eye);
    const speed = Math.max(8, d / Math.max(0.1, lead));
    const flight = d / speed;
    aim.x += (brain.targetVel?.x || 0) * flight * lead;
    aim.y += (brain.targetVel?.y || 0) * flight * lead * 0.6;
    aim.z += (brain.targetVel?.z || 0) * flight * lead;
  }
  const to = { x: aim.x - eye.x, y: aim.y - eye.y, z: aim.z - eye.z };
  let desired = anglesFromDir(norm3(to));

  // ошибка прицела (пересчитывается рывками, а не каждый кадр)
  const now = brain.now || 0;
  if (now > brain.aimOffsetUntil) {
    const err = brain.skill.aimError * Math.PI / 180;
    brain.aimOffset = { yaw: (Math.random() - 0.5) * err * 2, pitch: (Math.random() - 0.5) * err * 2 };
    brain.aimOffsetUntil = now + 0.18 + Math.random() * 0.25;
  }
  desired.yaw += brain.aimOffset.yaw;
  desired.pitch = clamp(desired.pitch + brain.aimOffset.pitch, -1.4, 1.4);

  // скорость поворота ограничена (реакция)
  const turn = brain.skill.reaction > 0.4 ? 5.5 : brain.skill.reaction > 0.25 ? 9 : 14;
  const dyaw = normAngle(desired.yaw - p.yaw);
  const dpitch = desired.pitch - p.pitch;
  p.yaw += clamp(dyaw, -turn * dt, turn * dt);
  p.pitch += clamp(dpitch, -turn * dt, turn * dt);
  return Math.abs(dyaw);
}

function faceDirection(p, brain, dir, dt, turn = 8) {
  const desired = anglesFromDir(norm3(dir));
  const dyaw = normAngle(desired.yaw - p.yaw);
  p.yaw += clamp(dyaw, -turn * dt, turn * dt);
  p.pitch += clamp(desired.pitch - p.pitch, -turn * dt, turn * dt);
}

// ------------------------------------------------------------
//  Навигация
// ------------------------------------------------------------
function setGoal(world, p, pos, kind) {
  const brain = p.bot;
  brain.goal = { x: pos.x, y: pos.y, z: pos.z };
  brain.goalKind = kind;
  brain.route = [];
  // маршрут через центр, если идём на другую сторону карты
  if (Math.sign(pos.z) !== Math.sign(p.pos.z) && Math.abs(pos.z - p.pos.z) > 12) {
    brain.route.push({ x: 0, y: 3.3, z: 0 });
  }
}

function moveTowards(world, p, cmd, dt, goal, allowJump = true) {
  const brain = p.bot;
  let point = goal;
  if (brain.route && brain.route.length) {
    point = brain.route[0];
    if (distXZ(p.pos, point) < 3.5 && Math.abs(p.pos.y - point.y) < 2.5) {
      brain.route.shift();
      point = brain.route[0] || goal;
    }
  }
  const dx = point.x - p.pos.x;
  const dz = point.z - p.pos.z;
  const desired = Math.atan2(-dx, -dz);
  const diff = normAngle(desired - p.yaw);

  cmd.forward = 1;
  cmd.right = clamp(diff * 1.6, -1, 1);

  // застрял?
  if (!brain.lastPos) brain.lastPos = { ...p.pos };
  if (world.time % 0.5 < dt) {
    const moved = distXZ(p.pos, brain.lastPos);
    if (moved < 0.35) brain.stuckTimer += 0.5;
    else brain.stuckTimer = Math.max(0, brain.stuckTimer - 0.5);
    brain.lastPos = { ...p.pos };
  }
  if (allowJump && brain.stuckTimer > 0.5 && world.time > brain.jumpAt) {
    cmd.jump = true;
    brain.jumpAt = world.time + 0.35;
  }
  if (brain.stuckTimer > 2.2 && world.time > brain.stuckFlipAt) {
    // упёрлись — обходим боком
    cmd.forward = 0.2;
    cmd.right = brain.strafeDir * 1.0;
    brain.stuckFlipAt = world.time + 0.9;
    if (Math.random() < 0.5) brain.strafeDir *= -1;
    if (allowJump) cmd.jump = true;
    brain.stuckTimer = 1.2;
  }
  // смотрим примерно туда, куда идём (если нет цели)
  if (!brain.lookTarget) {
    faceDirection(p, brain, { x: dx, y: 0, z: dz }, dt, 6);
  }
}

// ------------------------------------------------------------
//  Главная функция: мышление бота на текущем тике
// ------------------------------------------------------------
export function updateBot(world, p, dt) {
  if (!p.alive || !p.bot) return;
  const brain = p.bot;
  brain.now = world.time;

  const cmd = emptyCmd();
  const cls = CLASSES[p.classId];

  // --- урон по нам: разворачиваемся к обидчику ---
  if (p.lastAttackerId) {
    const atk = world.getPlayer(p.lastAttackerId);
    if (atk && atk.alive && atk.team !== p.team && world.time - p.lastDamageTime < 1.2 && world.rng() < 0.5) {
      brain.revealed.set(atk.id, world.time + 4);
    }
  }

  const enemy = pickTarget(world, p);
  brain.lookTarget = enemy;
  if (enemy) {
    brain.targetVel = { ...enemy.vel };
    if (brain.targetId !== enemy.id) {
      brain.targetId = enemy.id;
      brain.reactionUntil = world.time + brain.skill.reaction * (0.7 + Math.random() * 0.6);
    }
    brain.lastSeenPos = { ...enemy.pos };
  } else if (brain.targetId) {
    const prev = world.getPlayer(brain.targetId);
    const stillThere = prev && prev.alive && brain.lastSeenPos && world.time - p.lastDamageTime < 3;
    if (!stillThere) brain.targetId = null;
  }

  // --- классовая логика ---
  const handler = CLASS_BEHAVIOR[p.classId] || genericBehavior;
  handler(world, p, cmd, dt, enemy, brain, cls);

  // --- не забываем захватывать точки ---
  if (!enemy) objectiveBehavior(world, p, cmd, dt, brain);

  cmd.yaw = p.yaw;
  cmd.pitch = p.pitch;
  world.setCommand(p.id, cmd);
}

// ------------------------------------------------------------
//  Общее поведение без цели: идём к точке захвата
// ------------------------------------------------------------
function objectiveBehavior(world, p, cmd, dt, brain) {
  if (world.ended) return;
  if (world.time < brain.nextGoalThink && brain.goal) {
    // продолжаем идти к цели, если она ещё актуальна
    if (brain.goalKind !== 'cap' || true) moveTowards(world, p, cmd, dt, brain.goal);
    return;
  }
  brain.nextGoalThink = world.time + 1.5 + Math.random();

  // какая точка нужна?
  const caps = world.caps;
  let goalCap = null, bestScore = -Infinity;
  for (const c of caps) {
    let score = 0;
    if (c.owner === p.team) score += 30;
    if (c.owner === null) score += 60;
    if (c.owner !== null && c.owner !== p.team) score += 80;
    if (c.capTeam === p.team && c.progress > 0.1) score += 70;
    score -= dist3(c.pos, p.pos) * 1.5;
    if (score > bestScore) { bestScore = score; goalCap = c; }
  }

  const cls = p.classId;
  let goal = goalCap ? { x: goalCap.pos.x, y: goalCap.pos.y, z: goalCap.pos.z } : { x: 0, y: 0, z: 0 };
  let kind = 'cap';

  if (cls === 'sniper') {
    const spot = pickSniperSpot(world, p, goalCap);
    if (spot) { goal = spot; kind = 'hold'; }
  }
  if (cls === 'medic') {
    const mate = nearestTeammate(world, p, 30, (q) => q.hp < q.maxHp * 0.95 || q.classId !== 'medic');
    if (mate) { goal = { x: mate.pos.x, y: mate.pos.y, z: mate.pos.z }; kind = 'follow'; }
    else {
      goal = { x: goal.x - (p.team === TEAM_RED ? -6 : 6), y: goal.y, z: goal.z };
    }
  }
  if (cls === 'spy') {
    // пробираемся в тыл: к вражескому спавну
    const spawn = world.map.spawns.filter((s) => s.team !== p.team);
    if (spawn.length && (!goalCap || goalCap.owner === p.team)) {
      const far = spawn.reduce((a, s) => (dist3(s.pos, p.pos) > dist3(a.pos, p.pos) ? s : a), spawn[0]);
      goal = { x: far.pos.x, y: far.pos.y, z: far.pos.z };
      kind = 'flank';
    }
  }
  if (cls === 'engineer') {
    const own = world.caps.find((c) => c.owner === p.team) || goalCap;
    const sentry = world.buildings.find((b) => b.ownerId === p.id && b.kind === 'sentry');
    if (sentry) {
      goal = { x: sentry.pos.x + (p.team === TEAM_RED ? -5 : 5), y: sentry.pos.y, z: sentry.pos.z };
      kind = 'guard';
    } else if (own) {
      // место под турель: чуть впереди своей точки
      const dirZ = p.team === TEAM_RED ? 1 : -1;
      const bx = own.pos.x + (Math.random() - 0.5) * 6;
      const bz = own.pos.z + dirZ * (6 + Math.random() * 4);
      const spot = { x: bx, y: own.pos.y, z: bz };
      const g = world.groundBelow(spot);
      if (g !== null) spot.y = g;
      goal = spot;
      kind = 'build';
      brain.buildSpot = spot;
    }
  }

  setGoal(world, p, goal, kind);
  moveTowards(world, p, cmd, dt, goal);

  // инженер ставит постройки, когда дошёл
  if (cls === 'engineer') engineerBuilding(world, p, cmd, dt, brain);
}

function nearestTeammate(world, p, maxDist, filter) {
  let best = null, bestD = maxDist;
  for (const q of world.players) {
    if (!q.alive || q.team !== p.team || q.id === p.id) continue;
    if (filter && !filter(q)) continue;
    const d = dist3(q.pos, p.pos);
    if (d < bestD) { bestD = d; best = q; }
  }
  return best;
}

function pickSniperSpot(world, p, cap) {
  if (!cap) return null;
  const brain = p.bot;
  if (brain.sniperSpot && world.time < (brain.sniperSpotUntil || 0)) return brain.sniperSpot;
  // ищем точку на своей половине с прямой видимостью до точки
  const own = world.caps.find((c) => c.owner === p.team) || world.caps[0];
  const dz = p.team === TEAM_RED ? -1 : 1;
  let best = null, bestScore = -Infinity;
  for (let i = 0; i < 10; i++) {
    const x = (Math.random() - 0.5) * 26;
    const z = own.pos.z + dz * (6 + Math.random() * 14);
    const pos = { x, y: 0, z };
    const g = world.groundBelow(pos);
    if (g === null) continue;
    pos.y = g;
    if (!raycastLos(world.solids, { x: pos.x, y: pos.y + 1.5, z: pos.z }, { x: cap.pos.x, y: cap.pos.y + 1, z: cap.pos.z })) continue;
    const score = 40 - dist3(pos, p.pos) * 0.6 + dist3(pos, cap.pos) * 0.5;
    if (score > bestScore) { bestScore = score; best = pos; }
  }
  if (best) {
    brain.sniperSpot = best;
    brain.sniperSpotUntil = world.time + 25;
  }
  return best;
}

// ------------------------------------------------------------
//  Инженер: постройка
// ------------------------------------------------------------
function engineerBuilding(world, p, cmd, dt, brain) {
  const builds = CLASSES.engineer.builds;
  const plan = ['sentry', 'dispenser', 'teleporter'];
  for (const kind of plan) {
    const own = world.buildings.find((b) => b.ownerId === p.id && b.kind === kind);
    if (own) continue;
    if (p.build.pending) {
      // подтверждаем установку, если смотрим на подходящее место
      cmd.buildPlace = true;
      cmd.select = 2; // с гаечным ключом в руках
      return;
    }
    if (dist3(p.pos, brain.goal || p.pos) < 3.0 || kind !== 'sentry') {
      cmd.build = kind;
      return;
    }
  }
  // всё построено — чиним и апгрейдим турель
  const sentry = world.buildings.find((b) => b.ownerId === p.id && b.kind === 'sentry');
  if (sentry && (sentry.level < 3 || sentry.hp < sentry.maxHp)) {
    const d = dist3(sentry.pos, p.pos);
    if (d > 2.0) {
      moveTowards(world, p, cmd, dt, { x: sentry.pos.x, y: sentry.pos.y, z: sentry.pos.z });
      return;
    }
    cmd.select = 2;
    // смотрим на турель и бьём ключом (ремонт + апгрейд)
    giveFacing(p, sentry.pos);
    cmd.attack = true;
    return;
  }
}

function giveFacing(p, pos) {
  const eye = eyePos(p);
  const d = norm3({ x: pos.x - eye.x, y: pos.y + 0.6 - eye.y, z: pos.z - eye.z });
  const a = anglesFromDir(d);
  p.yaw = a.yaw;
  p.pitch = clamp(a.pitch, -1.2, 1.2);
}

// ------------------------------------------------------------
//  Классовые поведения в бою
// ------------------------------------------------------------
function genericBehavior(world, p, cmd, dt, enemy, brain, cls) {
  if (!enemy) return;
  const d = dist3(enemy.pos, p.pos);
  const eye = eyePos(p);
  aimAt(p, brain, { x: enemy.pos.x, y: enemy.pos.y + 1.0, z: enemy.pos.z }, dt, 0.5);
  if (d > 30) { moveTowards(world, p, cmd, dt, enemy.pos); return; }
  cmd.select = 0;
  if (world.time > brain.reactionUntil) cmd.attack = true;
  if (d < 6) { cmd.forward = -0.4; cmd.right = brain.strafeDir; }
}

const CLASS_BEHAVIOR = {
  scout(world, p, cmd, dt, enemy, brain) {
    if (!enemy) return;
    const d = dist3(enemy.pos, p.pos);
    aimAt(p, brain, { x: enemy.pos.x, y: enemy.pos.y + 0.95, z: enemy.pos.z }, dt, 0.4);
    cmd.select = 0;
    if (d > 14) { moveTowards(world, p, cmd, dt, enemy.pos); return; }
    if (world.time > brain.reactionUntil) cmd.attack = true;
    // кружим вокруг цели
    if (world.time > brain.danceUntil) { brain.strafeDir = Math.random() < 0.5 ? -1 : 1; brain.danceUntil = world.time + 0.8 + Math.random(); }
    cmd.right = brain.strafeDir;
    cmd.forward = d < 8 ? -0.3 : 0.5;
    if (Math.random() < dt * 2) cmd.jump = true;
  },

  soldier(world, p, cmd, dt, enemy, brain) {
    if (!enemy) return;
    const d = dist3(enemy.pos, p.pos);
    // уклоняемся от своих ракет
    if (world.time > brain.reactionUntil) cmd.attack = true;
    if (d > 26) {
      moveTowards(world, p, cmd, dt, enemy.pos);
      // иногда ракетный прыжок на сближение
      if (d > 34 && p.hp > 130 && p.onGround && Math.random() < dt * 0.35) {
        // ракетный прыжок на сближение
        p.yaw = Math.atan2(-(enemy.pos.x - p.pos.x), -(enemy.pos.z - p.pos.z));
        p.pitch = -0.5;
        cmd.jump = true;
        cmd.attack = true;
        cmd.yaw = p.yaw;
        cmd.pitch = p.pitch;
        cmd.select = 0;
        world.setCommand(p.id, cmd);
        return;
      }
    } else if (d < 7) {
      cmd.forward = -0.5; cmd.right = brain.strafeDir;
    } else {
      if (world.time > brain.danceUntil) { brain.strafeDir *= -1; brain.danceUntil = world.time + 1.2; }
      cmd.right = brain.strafeDir * 0.6;
    }
    if (p.pitch === undefined) p.pitch = 0;
    // небольшая компенсация полёта ракеты
    if (d > 12) p.pitch += clamp(d * 0.0025, 0, 0.06);
    aimAt(p, brain, { x: enemy.pos.x, y: enemy.pos.y + 1.0, z: enemy.pos.z }, dt, 0.45);
    // не стреляем в упор, чтобы не убить себя
    if (d < 2.6) cmd.attack = false;
    cmd.select = 0;
  },

  pyro(world, p, cmd, dt, enemy, brain) {
    if (!enemy) return;
    const d = dist3(enemy.pos, p.pos);
    cmd.select = 0;
    if (d > 7) { moveTowards(world, p, cmd, dt, enemy.pos); aimAt(p, brain, { x: enemy.pos.x, y: enemy.pos.y + 0.9, z: enemy.pos.z }, dt, 0); return; }
    aimAt(p, brain, { x: enemy.pos.x, y: enemy.pos.y + 0.9, z: enemy.pos.z }, dt, 0);
    cmd.forward = d > 4.5 ? 0.7 : 0.2;
    if (world.time > brain.reactionUntil) cmd.attack = true;
    // отражаем снаряды вблизи
    const risky = world.projectiles.find((pr) => pr.team !== p.team && dist3(pr.pos, p.pos) < 4);
    if (risky && world.time > (p.nextAttack.__airblast || 0)) cmd.attack2 = true;
  },

  demoman(world, p, cmd, dt, enemy, brain) {
    cmd.select = 0;
    if (!enemy) return;
    const d = dist3(enemy.pos, p.pos);
    if (d < 30 && ownStickiesNear(world, p, enemy, 6)) {
      cmd.select = 1;
      cmd.detonate = true;
      return;
    }
    if (d > 26) { moveTowards(world, p, cmd, dt, enemy.pos); }
    if (d < 10) cmd.forward = -0.5;
    // навесной выстрел с компенсацией дуги
    const arc = clamp(d * 0.011, 0, 0.30);
    aimAt(p, brain, { x: enemy.pos.x, y: enemy.pos.y + 1.0 + d * arc * 3.5, z: enemy.pos.z }, dt, 0.5);
    if (world.time > brain.reactionUntil) {
      if (d < 34) {
        if (world.rng() < 0.55 + 0.3 * (p.ammo.grenadelauncher > 0)) cmd.attack = true;
        else { cmd.select = 1; cmd.attack = true; }
      }
    }
    // ставим липкие у своих подходов
    if (d > 22 && d < 30 && world.rng() < dt * 0.6) { cmd.select = 1; cmd.attack = true; }
  },

  heavy(world, p, cmd, dt, enemy, brain) {
    if (!enemy) {
      // без цели держим пулемёт раскрученным только если рядом кто-то был
      cmd.select = 0;
      return;
    }
    const d = dist3(enemy.pos, p.pos);
    cmd.select = 0;
    aimAt(p, brain, { x: enemy.pos.x, y: enemy.pos.y + 1.0, z: enemy.pos.z }, dt, 0.3);
    if (d > 30) { moveTowards(world, p, cmd, dt, enemy.pos); return; }
    // сначала раскрутка, потом огонь
    cmd.attack2 = true;
    if (p.spin > 0.85 && world.time > brain.reactionUntil) cmd.attack = true;
    if (d > 16) cmd.forward = 0.8;
    else if (d < 8) { cmd.forward = -0.2; cmd.right = brain.strafeDir * 0.5; }
  },

  engineer(world, p, cmd, dt, enemy, brain) {
    const sentry = world.buildings.find((b) => b.ownerId === p.id && b.kind === 'sentry');
    cmd.select = 0;
    if (!enemy) return;
    const d = dist3(enemy.pos, p.pos);
    const building = findBuildingTarget(world, p);
    if (d > 16 || (sentry && dist3(sentry.pos, p.pos) > 20)) {
      if (d < 30) { aimAt(p, brain, { x: enemy.pos.x, y: enemy.pos.y + 1, z: enemy.pos.z }, dt, 0.3); if (d < 18) cmd.attack = true; }
      else if (sentry) moveTowards(world, p, cmd, dt, { x: sentry.pos.x, y: sentry.pos.y, z: sentry.pos.z });
      else moveTowards(world, p, cmd, dt, enemy.pos);
      return;
    }
    if (building && building.kind !== 'sentry' && d < 12) {
      aimAt(p, brain, { x: building.pos.x, y: building.pos.y + 0.6, z: building.pos.z }, dt, 0);
      cmd.attack = true;
      return;
    }
    aimAt(p, brain, { x: enemy.pos.x, y: enemy.pos.y + 1, z: enemy.pos.z }, dt, 0.25);
    if (world.time > brain.reactionUntil) cmd.attack = true;
    if (d < 9) cmd.forward = -0.3;
  },

  medic(world, p, cmd, dt, enemy, brain, cls) {
    // приоритет: лечить раненых / строить убер; убегать от врагов
    const healTarget = world.getPlayer(p.healTargetId) || nearestTeammate(world, p, CFG.MEDIGUN_RANGE, (q) => q.id !== p.id);
    const injured = nearestTeammate(world, p, 12, (q) => q.hp < q.maxHp * 0.75) || (world.time % 20 < 5 ? nearestTeammate(world, p, 8, (q) => q.id !== p.id) : null);
    const d = enemy ? dist3(enemy.pos, p.pos) : Infinity;

    if (d < 22 && enemy) {
      // отступаем к союзникам, работаем арбалетом
      const mate = nearestTeammate(world, p, 25, (q) => q.id !== p.id);
      if (mate && d < 12) moveTowards(world, p, cmd, dt, mate.pos);
      else if (d < 14) { cmd.forward = -0.6; cmd.right = brain.strafeDir; }
      cmd.select = 0;
      if (p.ammo.crossbow > 0 && world.time > brain.reactionUntil && d < 25) {
        aimAt(p, brain, { x: enemy.pos.x, y: enemy.pos.y + 1.0, z: enemy.pos.z }, dt, 0.6);
        cmd.attack = true;
      }
    }

    const mate = injured || healTarget;
    if (mate && (!enemy || d > 14)) {
      cmd.select = 1;
      aimAt(p, brain, { x: mate.pos.x, y: mate.pos.y + 1.0, z: mate.pos.z }, dt, 0);
      cmd.attack2 = true;
      if (dist3(mate.pos, p.pos) > CFG.MEDIGUN_RANGE - 2) {
        moveTowards(world, p, cmd, dt, { x: mate.pos.x, y: mate.pos.y, z: mate.pos.z });
      } else if (mate.hp < mate.maxHp) {
        cmd.forward = 0.1;
      }
      // убер, если мы или цель под огнём
      if (p.uber >= 1 && (mate.hp < mate.maxHp * 0.5 || world.time - mate.lastDamageTime < 1.5)) cmd.uber = true;
      if (p.uberActiveUntil > world.time) cmd.forward = 0.9;
      return;
    }
    cmd.select = 0;
  },

  sniper(world, p, cmd, dt, enemy, brain) {
    if (!enemy) return;
    const d = dist3(enemy.pos, p.pos);
    if (d < 12) {
      // ПП вблизи
      cmd.select = 1;
      aimAt(p, brain, { x: enemy.pos.x, y: enemy.pos.y + 1, z: enemy.pos.z }, dt, 0.2);
      if (world.time > brain.reactionUntil) cmd.attack = true;
      cmd.forward = -0.5; cmd.right = brain.strafeDir;
      return;
    }
    cmd.select = 0;
    // прицеливаемся в голову
    const head = { x: enemy.pos.x, y: enemy.pos.y + 1.45, z: enemy.pos.z };
    const aimErr = aimAt(p, brain, head, dt, 0.3);
    if (d > 20 && world.time > brain.reactionUntil) {
      cmd.attack = true; // держим выстрел = набираем заряд
    }
    if (d < 18) { cmd.forward = -0.4; }
  },

  spy(world, p, cmd, dt, enemy, brain) {
    if (!p.disguised && Math.random() < dt * 0.6) cmd.disguise = 'sniper';
    // маскируемся под чужого, если идём по тылам
    if (!enemy) {
      const enemyClass = CLASSES[(['scout', 'soldier', 'sniper', 'pyro'])[Math.floor(world.rng() * 4)]];
      if (!p.disguised && world.rng() < dt * 0.5) cmd.disguise = enemyClass.id;
      if (world.time > (brain.uncloakAt || 0)) cmd.cloak = true;
      return;
    }
    const d = dist3(enemy.pos, p.pos);
    // в спину — нож
    const behind = isBehindPoint(p, enemy, 0.3);
    if (d < 2.6 && behind) {
      cmd.select = 2;
      giveFacing(p, { x: enemy.pos.x, y: enemy.pos.y + 1.2, z: enemy.pos.z });
      cmd.attack = true;
      cmd.cloak = false;
      return;
    }
    if (behind && d < 18) {
      cmd.cloak = true;
      moveTowards(world, p, cmd, dt, enemy.pos);
      brain.uncloakAt = world.time + 6;
      return;
    }
    // иначе револьвер
    if (d < 26) {
      cmd.select = 0;
      aimAt(p, brain, { x: enemy.pos.x, y: enemy.pos.y + 1.0, z: enemy.pos.z }, dt, 0.5);
      if (world.time > brain.reactionUntil) cmd.attack = true;
      cmd.cloak = false;
      if (d < 10) { cmd.forward = -0.3; cmd.right = brain.strafeDir; }
    } else {
      cmd.cloak = true;
      moveTowards(world, p, cmd, dt, enemy.pos);
    }
  },
};

function isBehindPoint(p, enemy, threshold) {
  const f = dirFromAngles(enemy.yaw, 0);
  const to = norm3({ x: p.pos.x - enemy.pos.x, y: 0, z: p.pos.z - enemy.pos.z });
  // меньше -threshold ⇒ мы за спиной врага
  return f.x * to.x + f.z * to.z < -threshold;
}

function ownStickiesNear(world, p, enemy, radius) {
  for (const pr of world.projectiles) {
    if (!pr.sticky || pr.ownerId !== p.id) continue;
    if (dist3(pr.pos, enemy.pos) < radius) return true;
  }
  return false;
}
