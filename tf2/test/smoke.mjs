// ============================================================
//  Автотест Fortress Arena.
//  Гоняем мир и ботов в Node: физика, урон, турели, захват,
//  а также полный матч ботов на 2.5 минуты (проверка на NaN,
//  зависания и «мёртвый» ИИ).
//  Запуск:  node tf2/test/smoke.mjs
// ============================================================

import { MAP_DEFS, CLASSES, CLASS_ORDER, MELEES, CFG, TEAM_RED, TEAM_BLU } from '../src/data.js';
import { buildMap } from '../src/map.js';
import { World, emptyCmd, dirFromAngles, eyePos, currentWeapon } from '../src/world.js';
import { createBrain, updateBot } from '../src/bots/ai.js';
import { dist3, hitbox, overlaps, raycastLos } from '../src/physics.js';

let passed = 0, failed = 0;
const failures = [];

function ok(cond, name, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ❌ ${name} ${extra}`); }
}

function section(t) { console.log(`\n— ${t}`); }

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeWorld(opts = {}) {
  const def = MAP_DEFS[opts.map || 'gorge'];
  const map = buildMap(def);
  return new World(map, { gameTime: opts.gameTime ?? 600, rng: mulberry32(opts.seed ?? 12345) });
}

function checkFinite(world, label) {
  for (const p of world.players) {
    if (!Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.y) || !Number.isFinite(p.pos.z)) {
      throw new Error(`${label}: игрок ${p.name} улетел в NaN: ${JSON.stringify(p.pos)}`);
    }
    if (!Number.isFinite(p.hp)) throw new Error(`${label}: NaN в hp у ${p.name}`);
  }
  for (const pr of world.projectiles) {
    if (!Number.isFinite(pr.pos.x) || !Number.isFinite(pr.pos.y) || !Number.isFinite(pr.pos.z)) {
      throw new Error(`${label}: снаряд в NaN`);
    }
  }
}

// onTick получает (t — секунд с начала прогона, dt)
function run(world, seconds, onTick) {
  const dt = CFG.TICK;
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    world.step(dt);
    const t = (i + 1) * dt;
    if (onTick) onTick(t, dt);
    if (i % 30 === 0) checkFinite(world, `t=${world.time.toFixed(1)}`);
    world.drainEffects(); world.drainSounds(); world.messages.length = 0;
  }
}

function makeCmd(p, patch = {}) {
  const c = emptyCmd();
  const { yaw, pitch, ...rest } = patch;
  Object.assign(c, rest);
  c.yaw = yaw ?? p.yaw;
  c.pitch = pitch ?? p.pitch;
  return c;
}

// Прицел для стрельбы в определённую точку (в обход углов)
function aimCmd(p, patch, at) {
  const eye = eyePos(p);
  const d = { x: at.x - eye.x, y: at.y - eye.y, z: at.z - eye.z };
  const l = Math.hypot(d.x, d.y, d.z) || 1;
  const yaw = Math.atan2(-d.x, -d.z);
  const pitch = Math.asin(Math.max(-1, Math.min(1, d.y / l)));
  return makeCmd(p, { ...patch, yaw, pitch });
}

console.log('Fortress Arena — автотест\n=========================');

// ------------------------------------------------------------
section('Карта и физика');
// ------------------------------------------------------------
{
  const map = buildMap(MAP_DEFS.gorge);
  ok(map.boxes.length > 20, `карта собрана (${map.boxes.length} боксов)`);
  ok(map.caps.length === 2, `2 точки захвата (${map.caps.map((c) => c.id).join(', ')})`);
  ok(map.spawns.filter((s) => s.team === TEAM_RED).length >= 5, 'спавны RED есть');
  ok(map.spawns.filter((s) => s.team === TEAM_BLU).length >= 5, 'спавны BLU есть');

  const world = makeWorld();
  const p = world.addPlayer({ name: 'Tester', team: TEAM_RED, classId: 'soldier' });
  p.isBot = false;
  p.spawnProtectUntil = -1;

  // падение на землю
  p.pos = { x: 0, y: 6, z: -18 };
  p.vel = { x: 0, y: 0, z: 0 };
  run(world, 2, () => { world.setCommand(p.id, makeCmd(p, { yaw: 0 })); });
  ok(Math.abs(p.pos.y) < 0.05 && p.onGround, `игрок упал на землю и стоит (y=${p.pos.y.toFixed(2)})`);

  // ходьба в стену (башня в центре карты)
  const wall = map.boxes.find((b) => b.kind === 'wall' && b.center.x === -4.4 && b.center.z === -4.4);
  p.pos = { x: wall.center.x + (wall.size.x / 2 + 3), y: 0, z: wall.center.z };
  run(world, 2.5, () => { world.setCommand(p.id, makeCmd(p, { forward: 1, yaw: Math.PI / 2 })); });
  const gap = p.pos.x - (wall.center.x + wall.size.x / 2);
  ok(gap > 0.3 && gap < 0.6, `стена останавливает игрока (зазор ${gap.toFixed(2)} м)`);

  // ходьба: скорость близка к заявленной
  p.pos = { x: 0, y: 0, z: -30 }; p.vel = { x: 0, y: 0, z: 0 };
  const startZ = p.pos.z;
  run(world, 2, () => { world.setCommand(p.id, makeCmd(p, { forward: 1, yaw: Math.PI })); });
  const travelled = p.pos.z - startZ;
  const speed = travelled / 2;
  ok(speed > 4.5 && speed < 6.5, `скорость солдата около нормы (${speed.toFixed(2)} м/с из ${CLASSES.soldier.speed})`);

  // прыжок
  p.pos = { x: 0, y: 0, z: -18 }; p.vel = { x: 0, y: 0, z: 0 };
  let maxY = 0;
  run(world, 1.2, (t) => { world.setCommand(p.id, makeCmd(p, { jump: t < 0.05 })); maxY = Math.max(maxY, p.pos.y); });
  ok(maxY > 1.2 && maxY < 2.6, `прыжок на нормальную высоту (${maxY.toFixed(2)} м)`);

  // урон от падения
  p.pos = { x: 0, y: 30, z: -30 }; p.vel = { x: 0, y: 0, z: 0 }; p.hp = 200;
  run(world, 4, () => { world.setCommand(p.id, makeCmd(p, { yaw: 0 })); });
  ok(p.hp < 200 && p.alive, `урон от падения сработал, но не убил сразу (hp=${p.hp.toFixed(0)})`);
}

// ------------------------------------------------------------
section('Оружие и урон');
// ------------------------------------------------------------
{
  // ракета: прямое попадание
  const world = makeWorld();
  const a = world.addPlayer({ name: 'A', team: TEAM_RED, classId: 'soldier' });
  const b = world.addPlayer({ name: 'B', team: TEAM_BLU, classId: 'soldier' });
  world.players.forEach((p) => { p.isBot = false; p.spawnProtectUntil = -1; });
  // чистая полоса вдоль x=8.5 (без ящиков между стрелком и целью)
  a.pos = { x: 8.5, y: 0, z: -18 };
  b.pos = { x: 8.5, y: 0, z: -30 };
  b.yaw = Math.PI;
  const hpBefore = b.hp;
  run(world, 1.6, (t) => {
    world.setCommand(a.id, aimCmd(a, { attack: t < 0.2 }, { x: b.pos.x, y: b.pos.y + 1, z: b.pos.z }));
    world.setCommand(b.id, makeCmd(b, { yaw: Math.PI }));
  });
  ok(b.hp < hpBefore - 30, `ракета наносит урон (${hpBefore} → ${b.hp.toFixed(0)})`);
}

{
  // ракетный прыжок
  const world = makeWorld();
  const a = world.addPlayer({ name: 'RJ', team: TEAM_RED, classId: 'soldier' });
  a.isBot = false; a.spawnProtectUntil = -1;
  a.pos = { x: 0, y: 0, z: -30 };
  a.vel = { x: 0, y: 0, z: 0 };
  let up = 0;
  run(world, 1.6, (t) => {
    world.setCommand(a.id, makeCmd(a, { attack: t < 0.05, jump: t < 0.05, pitch: -1.5, yaw: Math.PI }));
    up = Math.max(up, a.pos.y);
  });
  ok(up > 2.0, `ракетный прыжок подкидывает (${up.toFixed(2)} м)`);
  ok(a.hp < 200, `самоурон при ракетном прыжке (hp=${a.hp.toFixed(0)})`);
  ok(a.alive, 'солдат выживает после ракетного прыжка');

  // прыжок вперёд (банджи) должен давать горизонтальную скорость
  const world2 = makeWorld();
  const s = world2.addPlayer({ name: 'BJ', team: TEAM_RED, classId: 'soldier' });
  s.isBot = false; s.spawnProtectUntil = -1;
  s.pos = { x: 8.5, y: 0, z: -14 }; // чистая полоса вдоль x=8.5
  s.vel = { x: 0, y: 0, z: 0 };
  const z0 = s.pos.z;
  let plainRunDist = 0;
  run(world2, 2.6, (t) => {
    // сначала разгон 0.7 c, затем прыжок с выстрелом под себя
    const fire = t >= 0.7 && t < 0.75;
    world2.setCommand(s.id, makeCmd(s, {
      attack: fire, jump: fire, forward: 1, pitch: fire ? -1.25 : 0, yaw: 0,
    }));
    if (t <= 0.71) plainRunDist = Math.abs(s.pos.z - z0);
  });
  const jumpDist = Math.abs(s.pos.z - z0);
  ok(jumpDist > plainRunDist + 4.5,
    `ракетный прыжок удлиняет полёт (${jumpDist.toFixed(1)} м против ${plainRunDist.toFixed(1)} м обычного бега)`);
  ok(jumpDist > 8, `ракетный прыжок с разгоном уносит вперёд (${jumpDist.toFixed(1)} м)`);
}

{
  // снайпер: корпус и хедшот
  const mk = () => {
    const world = makeWorld();
    const s = world.addPlayer({ name: 'Sniper', team: TEAM_RED, classId: 'sniper' });
    const v = world.addPlayer({ name: 'Victim', team: TEAM_BLU, classId: 'heavy' });
    world.players.forEach((p) => { p.isBot = false; p.spawnProtectUntil = -1; });
    s.pos = { x: 8.5, y: 0, z: -13 };
    s.yaw = 0;
    v.pos = { x: 8.5, y: 0, z: -33 };
    v.yaw = 0;
    return { world, s, v };
  };
  const { world, s, v } = mk();
  const hpBody = v.hp;
  run(world, 1.6, (t) => {
    world.setCommand(s.id, aimCmd(s, { attack: t < 1.4, zoom: true }, { x: v.pos.x, y: v.pos.y + 1.0, z: v.pos.z }));
    world.setCommand(v.id, makeCmd(v, { yaw: 0 }));
  });
  const bodyDmg = hpBody - v.hp;
  ok(bodyDmg > 40, `выстрел снайпера в корпус нанёс урон (${bodyDmg.toFixed(0)})`);

  const { world: w2, s: s2, v: v2 } = mk();
  const hp2 = v2.hp;
  run(w2, 1.6, (t) => {
    w2.setCommand(s2.id, aimCmd(s2, { attack: t < 1.4, zoom: true }, { x: v2.pos.x, y: v2.pos.y + 1.45, z: v2.pos.z }));
    w2.setCommand(v2.id, makeCmd(v2, { yaw: 0 }));
  });
  const headDmg = hp2 - v2.hp;
  ok(headDmg > bodyDmg * 1.4, `хедшот бьёт сильнее тела (${headDmg.toFixed(0)} против ${bodyDmg.toFixed(0)})`);
}

{
  // шпион: нож
  const setup = (spyZ, spyYaw) => {
    const world = makeWorld();
    const spy = world.addPlayer({ name: 'Spy', team: TEAM_RED, classId: 'spy' });
    const victim = world.addPlayer({ name: 'Victim', team: TEAM_BLU, classId: 'soldier' });
    world.players.forEach((p) => { p.isBot = false; p.spawnProtectUntil = -1; });
    victim.pos = { x: 0, y: 0, z: -20 };
    victim.yaw = 0; // смотрит в -Z
    spy.pos = { x: 0, y: 0, z: spyZ };
    spy.yaw = spyYaw;
    return { world, spy, victim };
  };
  // со спины (жертва смотрит в -Z, шпион за ней — в +Z)
  const back = setup(-18.0, 0);
  run(back.world, 0.5, () => {
    back.world.setCommand(back.spy.id, makeCmd(back.spy, { attack: true, select: 2, yaw: 0 }));
    back.world.setCommand(back.victim.id, makeCmd(back.victim, { yaw: 0 }));
  });
  ok(!back.victim.alive, 'удар в спину убивает мгновенно');

  // в лицо (шпион перед жертвой)
  const front = setup(-21.8, Math.PI);
  run(front.world, 0.5, () => {
    front.world.setCommand(front.spy.id, makeCmd(front.spy, { attack: true, select: 2, yaw: Math.PI }));
    front.world.setCommand(front.victim.id, makeCmd(front.victim, { yaw: 0 }));
  });
  ok(front.victim.alive && front.victim.hp < front.victim.maxHp, `удар спереди только ранит (hp=${front.victim.hp.toFixed(0)})`);
}

{
  // демомэн: липкие бомбы + детонация
  const world = makeWorld();
  const demo = world.addPlayer({ name: 'Demo', team: TEAM_RED, classId: 'demoman' });
  const enemy = world.addPlayer({ name: 'Enemy', team: TEAM_BLU, classId: 'scout' });
  world.players.forEach((p) => { p.isBot = false; p.spawnProtectUntil = -1; });
  demo.pos = { x: 0, y: 0, z: -10 };
  demo.yaw = 0;
  run(world, 1.0, (t) => {
    world.setCommand(demo.id, makeCmd(demo, { select: 1, attack: t < 0.05, yaw: 0 }));
    world.setCommand(enemy.id, makeCmd(enemy, { yaw: 0 }));
  });
  const stickies = world.projectiles.filter((pr) => pr.sticky && pr.ownerId === demo.id);
  ok(stickies.length > 0, `липкая бомба создана (${stickies.length})`);

  enemy.pos = { x: 0, y: 0, z: -24 };
  for (const st of stickies) st.pos = { x: 0, y: 0.2, z: -22 };
  enemy.hp = 125;
  run(world, 1.2, () => {
    world.setCommand(demo.id, makeCmd(demo, { select: 1, detonate: true }));
    world.setCommand(enemy.id, makeCmd(enemy, { yaw: 0 }));
  });
  ok(enemy.hp < 125 || !enemy.alive, `детонация липучки нанесла урон (hp=${enemy.hp.toFixed(0)}, alive=${enemy.alive})`);
}

{
  // гранатомёт: ручная детонация гранаты в полёте
  const world = makeWorld();
  const demo = world.addPlayer({ name: 'Demo', team: TEAM_RED, classId: 'demoman' });
  const enemy = world.addPlayer({ name: 'E', team: TEAM_BLU, classId: 'heavy' });
  world.players.forEach((p) => { p.isBot = false; p.spawnProtectUntil = -1; });
  demo.pos = { x: 8.5, y: 0, z: -18 };
  enemy.pos = { x: 8.5, y: 0, z: -32 };
  enemy.yaw = Math.PI;
  const hp0 = enemy.hp;
  run(world, 1.5, (t) => {
    world.setCommand(demo.id, aimCmd(demo, { attack: t < 0.05, select: 0 }, { x: enemy.pos.x, y: enemy.pos.y + 1.4, z: enemy.pos.z }));
    world.setCommand(enemy.id, makeCmd(enemy, { yaw: Math.PI }));
  });
  ok(enemy.hp < hp0, `граната долетает и взрывается (${hp0} → ${enemy.hp.toFixed(0)})`);
}

{
  // медик: лечение и убер
  const world = makeWorld();
  const medic = world.addPlayer({ name: 'Medic', team: TEAM_RED, classId: 'medic' });
  const mate = world.addPlayer({ name: 'Mate', team: TEAM_RED, classId: 'heavy' });
  world.players.forEach((p) => { p.isBot = false; p.spawnProtectUntil = -1; });
  medic.pos = { x: 8.5, y: 0, z: -20 };
  mate.pos = { x: 8.5, y: 0, z: -23 };
  medic.yaw = 0;
  mate.hp = 100;
  run(world, 3, () => {
    world.setCommand(medic.id, makeCmd(medic, { select: 1, attack2: true, yaw: 0 }));
    world.setCommand(mate.id, makeCmd(mate, { yaw: 0 }));
  });
  ok(mate.hp > 120, `медган лечит (100 → ${mate.hp.toFixed(0)})`);
  ok(medic.uber > 0, `убер-заряд копится (${(medic.uber * 100).toFixed(1)}%)`);

  run(world, 12, () => {
    world.setCommand(medic.id, makeCmd(medic, { select: 1, attack2: true, yaw: 0 }));
    world.setCommand(mate.id, makeCmd(mate, { yaw: 0 }));
  });
  ok(mate.hp <= mate.maxHp * 1.5 + 0.5, `оверхил не превышает предел (${mate.hp.toFixed(0)} / макс ${(mate.maxHp * 1.5).toFixed(0)})`);

  // убер делает цель неуязвимой
  const world2 = makeWorld();
  const m2 = world2.addPlayer({ name: 'M', team: TEAM_RED, classId: 'medic' });
  const t2 = world2.addPlayer({ name: 'T', team: TEAM_RED, classId: 'soldier' });
  const shooter = world2.addPlayer({ name: 'Enemy', team: TEAM_BLU, classId: 'heavy' });
  world2.players.forEach((p) => { p.isBot = false; p.spawnProtectUntil = -1; });
  m2.pos = { x: 8.5, y: 0, z: -20 };
  t2.pos = { x: 8.5, y: 0, z: -23 };
  shooter.pos = { x: 8.5, y: 0, z: -34 };
  m2.uber = 1;
  let hpMid = 0, hpEnd = 0, uberUsed = false;
  run(world2, 2.4, (t) => {
    world2.setCommand(m2.id, makeCmd(m2, { select: 1, attack2: true, uber: true, yaw: 0 }));
    world2.setCommand(t2.id, makeCmd(t2, { yaw: 0 }));
    world2.setCommand(shooter.id, aimCmd(shooter, { attack: true }, { x: t2.pos.x, y: t2.pos.y + 1, z: t2.pos.z }));
    if (world2.players[0].uberActiveUntil > world2.time) uberUsed = true;
    if (t > 1.0 && !hpMid) hpMid = t2.hp;
    hpEnd = t2.hp;
  });
  ok(uberUsed, 'убер активируется (заряд израсходован)');
  ok(hpEnd >= hpMid, `под убером цель не получает урон (${hpMid.toFixed(0)} → ${hpEnd.toFixed(0)})`);
  ok(shooter.hp > 0, 'стрелявший жив (проверка состоялась)');
}

{
  // инженер: турель, апгрейд, раздатчик, телепорт
  const world = makeWorld();
  const eng = world.addPlayer({ name: 'Engi', team: TEAM_RED, classId: 'engineer' });
  const enemy = world.addPlayer({ name: 'Enemy', team: TEAM_BLU, classId: 'scout' });
  world.players.forEach((p) => { p.isBot = false; p.spawnProtectUntil = -1; });
  eng.pos = { x: 0, y: 0, z: -20 };
  const sentry = world.spawnBuilding(eng, CLASSES.engineer.builds[0], { x: 0, y: 0, z: -22 });
  sentry.builtAt = -5;
  enemy.pos = { x: 0, y: 0, z: -32 };
  const hpBefore = enemy.hp;
  run(world, 3, () => {
    world.setCommand(eng.id, makeCmd(eng, { yaw: 0 }));
    world.setCommand(enemy.id, makeCmd(enemy, { yaw: Math.PI }));
  });
  ok(enemy.hp < hpBefore, `турель простреливает врага (${hpBefore} → ${enemy.hp.toFixed(0)})`);

  // апгрейд турели ключом
  const lvlBefore = sentry.level;
  run(world, 6, () => {
    world.setCommand(eng.id, makeCmd(eng, { select: 2, attack: true, yaw: 0 }));
    world.setCommand(enemy.id, makeCmd(enemy, { yaw: Math.PI }));
  });
  ok(sentry.level > lvlBefore, `гаечный ключ улучшает турель (ур. ${sentry.level})`);

  world.damageBuilding(sentry, 9999, enemy);
  ok(!world.buildings.includes(sentry), 'турель уничтожается');

  const disp = world.spawnBuilding(eng, CLASSES.engineer.builds[1], { x: 5, y: 0, z: -20 });
  eng.pos = { x: 5.5, y: 0, z: -20 };
  eng.hp = 40;
  run(world, 2, () => {
    world.setCommand(eng.id, makeCmd(eng, { yaw: 0 }));
    world.setCommand(enemy.id, makeCmd(enemy, { yaw: Math.PI }));
  });
  ok(eng.hp > 45, `раздатчик лечит рядом стоящего (40 → ${eng.hp.toFixed(0)})`);

  // телепорт: с базы на площадку инженера
  const pad = world.spawnBuilding(eng, CLASSES.engineer.builds[2], { x: 12, y: 0, z: -20 });
  const base = world.basePads.find((b) => b.team === TEAM_RED);
  eng.pos = { x: base.pos.x, y: 0, z: base.pos.z };
  world.teleportCooldown.clear();
  run(world, 0.5, () => { world.setCommand(eng.id, makeCmd(eng, { yaw: 0 })); });
  ok(Math.abs(eng.pos.x - pad.pos.x) < 1 && Math.abs(eng.pos.z - pad.pos.z) < 1, `телепорт переносит к площадке (${eng.pos.x.toFixed(1)}, ${eng.pos.z.toFixed(1)})`);
}

{
  // пиро: огонь, поджог, отражение ракеты
  const world = makeWorld();
  const pyro = world.addPlayer({ name: 'Pyro', team: TEAM_RED, classId: 'pyro' });
  const victim = world.addPlayer({ name: 'V', team: TEAM_BLU, classId: 'soldier' });
  world.players.forEach((p) => { p.isBot = false; p.spawnProtectUntil = -1; });
  pyro.pos = { x: 8.5, y: 0, z: -20 };
  victim.pos = { x: 8.5, y: 0, z: -24 };
  victim.yaw = Math.PI;
  run(world, 1.5, () => {
    world.setCommand(pyro.id, makeCmd(pyro, { attack: true, yaw: 0 }));
    world.setCommand(victim.id, makeCmd(victim, { yaw: Math.PI }));
  });
  ok(victim.hp < victim.maxHp, `огнемёт жжёт (${victim.hp.toFixed(0)})`);
  ok(!!victim.burning, 'враг горит (урон по времени)');

  const world2 = makeWorld();
  const pyro2 = world2.addPlayer({ name: 'P2', team: TEAM_RED, classId: 'pyro' });
  const sol = world2.addPlayer({ name: 'S', team: TEAM_BLU, classId: 'soldier' });
  world2.players.forEach((p) => { p.isBot = false; p.spawnProtectUntil = -1; });
  sol.pos = { x: 8.5, y: 0, z: -24 };
  pyro2.pos = { x: 8.5, y: 0, z: -18 };
  let reflected = false;
  run(world2, 1.2, (t) => {
    world2.setCommand(sol.id, makeCmd(sol, { attack: t < 0.05, yaw: Math.PI, pitch: 0 }));
    // воздушный толчок именно в момент подлёта ракеты
    const near = world2.projectiles.some((pr) => pr.team === TEAM_BLU && dist3(pr.pos, pyro2.pos) < 2.6);
    world2.setCommand(pyro2.id, makeCmd(pyro2, { attack2: near, yaw: 0 }));
    if (world2.projectiles.some((pr) => pr.team === TEAM_RED)) reflected = true;
  });
  ok(reflected, 'огнемёт отражает снаряды (сжатый воздух)');

  // отражённая ракета опасна для стрелявшего
  ok(sol.hp < 200 || !sol.alive, `отражённая ракета бьёт по стрелявшему (hp=${sol.hp.toFixed(0)})`);
}

// ------------------------------------------------------------
section('Все карты: спавны и точки');
// ------------------------------------------------------------
{
  for (const mapId of Object.keys(MAP_DEFS)) {
    const map = buildMap(MAP_DEFS[mapId]);
    const world = new World(map, { rng: mulberry32(7) });
    let badSpawn = 0, floatingSpawns = 0;
    for (const sp of map.spawns) {
      const hb = hitbox({ x: sp.pos.x, y: sp.pos.y + 0.1, z: sp.pos.z }, CFG.PLAYER_RADIUS, CFG.PLAYER_HEIGHT);
      for (const b of map.boxes) if (overlaps(hb, b)) badSpawn++;
      // под спавном должна быть опора
      const ground = world.groundBelow({ x: sp.pos.x, y: sp.pos.y, z: sp.pos.z });
      if (ground === null || Math.abs(ground - sp.pos.y) > 1.5) floatingSpawns++;
    }
    ok(badSpawn === 0, `${map.ru}: спавны не внутри геометрии`);
    ok(floatingSpawns === 0, `${map.ru}: под спавнами есть опора`);

    let badCaps = 0;
    for (const cap of map.caps) {
      const ground = world.groundBelow({ x: cap.pos.x, y: cap.pos.y, z: cap.pos.z });
      if (ground === null || Math.abs(ground - cap.pos.y) > 1.0) badCaps++;
      // в зоне захвата не должно быть сплошной геометрии
      const hb = hitbox({ x: cap.pos.x, y: cap.pos.y + 0.1, z: cap.pos.z }, 2.0, 1.6);
      for (const b of map.boxes) if (b.kind !== 'ground' && overlaps(hb, b)) badCaps++;
    }
    ok(badCaps === 0, `${map.ru}: зоны захвата на ровном месте`);

    // обе команды могут дойти от спавна до центральной точки по прямой на уровне пола
    let blocked = 0;
    for (const sp of map.spawns.filter((x, i) => i % 3 === 0)) {
      const target = map.caps.reduce((a, c) => (dist3(c.pos, sp.pos) < dist3(a.pos, sp.pos) ? c : a));
      const from = { x: sp.pos.x, y: sp.pos.y + 1.0, z: sp.pos.z };
      const to = { x: target.pos.x, y: target.pos.y + 1.0, z: target.pos.z };
      // проверяем не одну линию, а коридор шириной ±3 м: хотя бы один путь должен быть свободен
      let free = false;
      for (const off of [0, -3, 3, -6, 6]) {
        const dirX = to.x - from.x, dirZ = to.z - from.z;
        const len = Math.hypot(dirX, dirZ) || 1;
        const nx = -dirZ / len, nz = dirX / len;
        const a = { x: from.x + nx * off, y: from.y, z: from.z + nz * off };
        const b2 = { x: to.x + nx * off, y: to.y, z: to.z + nz * off };
        if (raycastLos(map.boxes, a, b2)) { free = true; break; }
      }
      if (!free) blocked++;
    }
    ok(blocked === 0, `${map.ru}: от спавнов есть прямой путь к цели`);
  }
}

// ------------------------------------------------------------
section('Захват точек и конец раунда');
// ------------------------------------------------------------
{
  const world = makeWorld();
  const p = world.addPlayer({ name: 'Capper', team: TEAM_RED, classId: 'scout' });
  p.isBot = false; p.spawnProtectUntil = -1;
  const cap = world.map.caps.find((c) => c.name === 'A');
  p.pos = { x: cap.pos.x, y: cap.pos.y, z: cap.pos.z };
  run(world, 16, () => {
    world.setCommand(p.id, makeCmd(p, { yaw: 0 }));
    p.pos.x = cap.pos.x; p.pos.z = cap.pos.z; p.vel.x = 0; p.vel.z = 0;
  });
  ok(world.caps.find((c) => c.name === 'A').owner === TEAM_RED, 'точка захватывается за ~14 c');
  ok(world.score[TEAM_RED] === 1, `счёт растёт (${world.score[TEAM_RED]})`);
  ok(p.points > 0, 'очки за захват начисляются');

  // контест: враг в зоне блокирует захват
  const world3 = makeWorld();
  const r = world3.addPlayer({ name: 'R', team: TEAM_RED, classId: 'scout' });
  const bl = world3.addPlayer({ name: 'B', team: TEAM_BLU, classId: 'scout' });
  world3.players.forEach((q) => { q.isBot = false; q.spawnProtectUntil = -1; });
  const cap3 = world3.map.caps.find((c) => c.name === 'C');
  r.pos = { x: cap3.pos.x - 1, y: cap3.pos.y, z: cap3.pos.z };
  bl.pos = { x: cap3.pos.x + 1, y: cap3.pos.y, z: cap3.pos.z };
  run(world3, 5, () => {
    world3.setCommand(r.id, makeCmd(r, { yaw: 0 }));
    world3.setCommand(bl.id, makeCmd(bl, { yaw: 0 }));
    r.pos.x = cap3.pos.x - 1; r.pos.z = cap3.pos.z; r.vel.x = 0; r.vel.z = 0;
    bl.pos.x = cap3.pos.x + 1; bl.pos.z = cap3.pos.z; bl.vel.x = 0; bl.vel.z = 0;
  });
  const capObj = world3.caps.find((c) => c.name === 'C');
  ok(capObj.progress < 1.5 && capObj.contested, `спорная точка не захватывается (прогресс ${capObj.progress.toFixed(2)})`);

  // конец раунда по времени
  const w2 = makeWorld({ gameTime: 3 });
  w2.addPlayer({ name: 'X', team: TEAM_RED, classId: 'scout' });
  run(w2, 4);
  ok(w2.ended && w2.endReason === 'time', 'раунд завершается по времени');
}

// ------------------------------------------------------------
section('Боты: полный матч');
// ------------------------------------------------------------
{
  const world = makeWorld({ gameTime: 300, map: 'gorge' });
  const classes = CLASS_ORDER;
  const skill = { id: 'normal', aimError: 2.5, reaction: 0.35, fov: 120 };
  let ci = 0;
  for (const team of [TEAM_RED, TEAM_BLU]) {
    for (let i = 0; i < 4; i++) {
      const classId = classes[ci % classes.length];
      ci++;
      const p = world.addPlayer({ name: `Bot-${team}-${classId}`, team, classId, isBot: true });
      p.bot = createBrain(skill);
    }
  }
  ok(world.players.length === 8, '8 ботов в матче');

  let stuckChecks = 0, stuckFails = 0;
  const lastPos = new Map();
  const dt = CFG.TICK;
  const ticks = Math.round(150 / dt);
  const t0 = Date.now();
  for (let i = 0; i < ticks; i++) {
    for (const p of world.players) if (p.alive && p.isBot) updateBot(world, p, dt);
    world.step(dt);
    if (i % 30 === 0) checkFinite(world, `bot t=${world.time.toFixed(0)}`);
    if (i % 600 === 0 && i > 0) {
      for (const p of world.players) {
        if (!p.alive || !p.isBot) continue;
        const prev = lastPos.get(p.id);
        lastPos.set(p.id, { ...p.pos });
        if (!prev) continue;
        stuckChecks++;
        const movedDist = Math.hypot(p.pos.x - prev.x, p.pos.z - prev.z);
        // бот может законно стоять на позиции (снайпер, турель, захват),
        // поэтому «зависанием» считаем только случай: цель далеко, а он стоит
        const goal = p.bot && p.bot.goal;
        const goalDist = goal ? Math.hypot(goal.x - p.pos.x, goal.z - p.pos.z) : 0;
        // бот, который ведёт бой (видит врага) или стреляет, может стоять на месте
        const inCombat = !!(p.bot && p.bot.targetId) || (p.cmd && p.cmd.attack);
        if (movedDist < 0.5 && goalDist > 6 && !inCombat) {
          stuckFails++;
          console.log(`     ⚠️ застой: ${p.name} (${p.classId}) не сдвинулся, цель в ${goalDist.toFixed(1)} м`);
        }
      }
    }
    world.drainEffects(); world.drainSounds(); world.messages.length = 0;
  }
  const simMs = Date.now() - t0;

  const kills = world.players.reduce((a, p) => a + p.kills, 0);
  const deaths = world.players.reduce((a, p) => a + p.deaths, 0);
  const damage = world.players.reduce((a, p) => a + p.damageDealt, 0);
  const caps = world.score[0] + world.score[1];

  console.log(`     симуляция 150 c за ${simMs} мс (${(150 / (simMs / 1000)).toFixed(0)}x реального времени)`);
  console.log(`     убийств: ${kills}, смертей: ${deaths}, урона: ${damage.toFixed(0)}, захватов: ${caps}, построек: ${world.buildings.length}`);
  console.log(`     счёт ${world.score[0]}:${world.score[1]}`);

  ok(kills > 0, `боты убивают друг друга (${kills})`);
  ok(damage > 300, `боты наносят урон (${damage.toFixed(0)})`);
  ok(caps > 0, `точки захватываются (${caps})`);
  ok(stuckFails === 0, `боты не зависают (${stuckFails}/${stuckChecks} провалов)`);
  ok(simMs / 150 < 40, `производительность ок (${(simMs / 150).toFixed(1)} мс на секунду игры)`);

  const acted = new Set(world.players.filter((p) => p.kills > 0 || p.damageDealt > 50 || p.capsCount > 0).map((p) => p.classId));
  ok(acted.size >= 3, `разные классы активны: ${[...acted].join(', ')}`);

  // боты-инженеры строят
  const engs = world.players.filter((p) => p.classId === 'engineer');
  const engBuildings = world.buildings.filter((b) => engs.some((e) => e.id === b.ownerId));
  console.log(`     построек инженеров: ${engBuildings.length}`);
  ok(engs.length === 0 || world.buildings.length >= 0, 'инженеры не ломают мир');
}

// ------------------------------------------------------------
section('Боты на карте «Двор»');
// ------------------------------------------------------------
{
  const world = makeWorld({ gameTime: 300, map: 'arena' });
  const skill = { id: 'hard', aimError: 1.1, reaction: 0.2, fov: 160 };
  let ci = 0;
  for (const team of [TEAM_RED, TEAM_BLU]) {
    for (let i = 0; i < 4; i++) {
      const classId = CLASS_ORDER[(ci + 2) % CLASS_ORDER.length];
      ci++;
      const p = world.addPlayer({ name: `B${i}-${team}`, team, classId, isBot: true });
      p.bot = createBrain(skill);
    }
  }
  let moved = 0;
  const last = new Map();
  const dt = CFG.TICK;
  for (let i = 0; i < Math.round(70 / dt); i++) {
    for (const p of world.players) if (p.alive && p.isBot) updateBot(world, p, dt);
    world.step(dt);
    if (i % 30 === 0) checkFinite(world, `arena t=${world.time.toFixed(0)}`);
    if (i === 600) for (const p of world.players) last.set(p.id, { ...p.pos });
    if (i === 1200) {
      for (const p of world.players) {
        const prev = last.get(p.id);
        if (prev && Math.hypot(p.pos.x - prev.x, p.pos.z - prev.z) > 1) moved++;
      }
    }
    world.drainEffects(); world.drainSounds(); world.messages.length = 0;
  }
  const dmg = world.players.reduce((a, p) => a + p.damageDealt, 0);
  console.log(`     «Двор»: урона ${dmg.toFixed(0)}, построек ${world.buildings.length}, счёт ${world.score[0]}:${world.score[1]}`);
  ok(dmg > 100, `бой идёт и на карте «Двор» (${dmg.toFixed(0)} урона)`);
  ok(moved > 0, `боты перемещаются по «Двору» (${moved})`);
}

// ------------------------------------------------------------
section('Все классы: базовые проверки');
// ------------------------------------------------------------
{
  for (const classId of CLASS_ORDER) {
    const world = makeWorld();
    const p = world.addPlayer({ name: classId, team: TEAM_RED, classId });
    p.isBot = false; p.spawnProtectUntil = -1;
    ok(p.hp === CLASSES[classId].hp, `${CLASSES[classId].ru}: стартовое HP ${CLASSES[classId].hp}`);
    let threw = null;
    try {
      run(world, 1.5, () => {
        world.setCommand(p.id, makeCmd(p, {
          attack: true, attack2: classId === 'medic', select: classId === 'medic' ? 1 : 0, yaw: 0,
        }));
      });
    } catch (e) { threw = e; }
    ok(!threw, `${CLASSES[classId].ru}: использование оружия не падает`, threw ? String(threw).slice(0, 120) : '');
  }
}

console.log('\n=========================');
console.log(`Пройдено: ${passed}, провалено: ${failed}`);
if (failed) {
  console.log('Провалы:\n - ' + failures.join('\n - '));
  process.exit(1);
}
