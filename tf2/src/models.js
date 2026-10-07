// ============================================================
//  Fortress Arena — 3D-модели: бойцы, оружие, постройки, снаряды.
//  Стиль — гранёный «блочный» low-poly в духе Team Fortress 2.
// ============================================================
import * as THREE from 'three';
import { TEAM_INFO, TEAM_RED, TEAM_BLU } from './data.js';

export const PALETTE = {
  red: 0xb8383b,
  redDark: 0x7d2527,
  blu: 0x5885a2,
  bluDark: 0x35566b,
  metal: 0x8a8f98,
  metalDark: 0x4a4e57,
  wood: 0x8a6b43,
  black: 0x23252b,
  skin: 0xd8a37c,
  white: 0xe8e6e1,
};

const materialCache = new Map();
export function mat(color, opts = {}) {
  const key = `${color}|${JSON.stringify(opts)}`;
  if (materialCache.has(key)) return materialCache.get(key);
  const m = new THREE.MeshLambertMaterial({ color, ...opts });
  materialCache.set(key, m);
  return m;
}

function box(w, h, d, color, pos = {}, opts = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts.material));
  mesh.position.set(pos.x || 0, pos.y || 0, pos.z || 0);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cyl(rt, rb, h, color, pos = {}, seg = 10) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color));
  mesh.position.set(pos.x || 0, pos.y || 0, pos.z || 0);
  mesh.castShadow = true;
  return mesh;
}

// цилиндр, лежащий вдоль оси Z (стволы оружия)
function cylZ(rt, rb, h, color, pos = {}, seg = 8) {
  const mesh = cyl(rt, rb, h, color, {}, seg);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(pos.x || 0, pos.y || 0, pos.z || 0);
  return mesh;
}

function sphere(r, color, pos = {}, seg = 10) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, seg, seg), mat(color));
  mesh.position.set(pos.x || 0, pos.y || 0, pos.z || 0);
  mesh.castShadow = true;
  return mesh;
}

export function teamColor(team) {
  return team === TEAM_BLU ? PALETTE.blu : PALETTE.red;
}
export function teamColorDark(team) {
  return team === TEAM_BLU ? PALETTE.bluDark : PALETTE.redDark;
}

// ------------------------------------------------------------
//  Модель бойца
//  Возвращает { group, anim } — части для анимации ходьбы/прицела.
// ------------------------------------------------------------
const CLASS_LOOK = {
  scout: { scale: 0.93, torso: 0.62, hips: 0.42, head: 0.26, pants: 0x53412c, hat: 'cap', speed: 1.5 },
  soldier: { scale: 1.0, torso: 0.72, hips: 0.5, head: 0.28, pants: 0x3d4552, hat: 'helmet', speed: 1.0 },
  pyro: { scale: 0.99, torso: 0.7, hips: 0.48, head: 0.28, pants: 0x8c6b2f, hat: 'mask', speed: 1.0, tank: true },
  demoman: { scale: 1.0, torso: 0.72, hips: 0.5, head: 0.28, pants: 0x4a3c2a, hat: 'eyepatch', speed: 1.0 },
  heavy: { scale: 1.08, torso: 0.92, hips: 0.66, head: 0.3, pants: 0x6b5a3a, hat: 'bald', speed: 0.75, wide: 1.3 },
  engineer: { scale: 0.97, torso: 0.66, hips: 0.46, head: 0.27, pants: 0x39352e, hat: 'hardhat', speed: 1.05 },
  medic: { scale: 0.99, torso: 0.68, hips: 0.47, head: 0.28, pants: 0x2f3238, hat: 'coat', speed: 1.05, coat: true },
  sniper: { scale: 1.0, torso: 0.7, hips: 0.48, head: 0.28, pants: 0x4a4a3c, hat: 'hat', speed: 1.0 },
  spy: { scale: 0.99, torso: 0.68, hips: 0.47, head: 0.28, pants: 0x2a2c33, hat: 'mask2', speed: 1.05, suit: true },
};

export function makeCharacter(classId, team) {
  const look = CLASS_LOOK[classId] || CLASS_LOOK.soldier;
  const body = teamColor(team);
  const bodyDark = teamColorDark(team);
  const g = new THREE.Group();
  const anim = { classId };

  const s = look.scale;
  const torsoW = look.torso * (look.wide || 1);
  const hipsW = look.hips * (look.wide || 1);

  // ноги
  const legGeo = new THREE.BoxGeometry(0.22 * (look.wide || 1), 0.8, 0.26);
  const legMat = mat(look.pants);
  const legL = new THREE.Mesh(legGeo, legMat);
  legL.position.set(-0.17 * (look.wide || 1), 0.4, 0);
  const legR = new THREE.Mesh(legGeo, legMat);
  legR.position.set(0.17 * (look.wide || 1), 0.4, 0);
  legL.castShadow = legR.castShadow = true;
  // «ступни»
  const bootL = box(0.26, 0.16, 0.34, PALETTE.black, { y: -0.34, z: 0.04 });
  const bootR = box(0.26, 0.16, 0.34, PALETTE.black, { y: -0.34, z: 0.04 });
  legL.add(bootL); legR.add(bootR);
  g.add(legL, legR);

  // корпус
  const torso = box(torsoW, 0.72, hipsW * 0.75, look.coat ? PALETTE.white : body, { y: 1.16 });
  const hips = box(hipsW, 0.3, hipsW * 0.7, look.suit ? 0x33363d : bodyDark, { y: 0.78 });
  g.add(torso, hips);

  // поясница/детали
  if (look.coat) {
    torso.scale.set(1.05, 1, 1.05);
    const coatTail = box(torsoW * 1.02, 0.5, 0.16, PALETTE.white, { y: 0.85, z: -0.2 });
    g.add(coatTail);
    const crossV = box(0.09, 0.34, 0.03, PALETTE.red, { y: 1.2, z: hipsW * 0.75 / 2 + 0.01 });
    const crossH = box(0.26, 0.09, 0.03, PALETTE.red, { y: 1.2, z: hipsW * 0.75 / 2 + 0.01 });
    g.add(crossV, crossH);
  }
  if (look.tank) {
    const tank = cyl(0.11, 0.11, 0.55, PALETTE.metalDark, { y: 1.25, z: -0.26 }, 8);
    g.add(tank);
  }
  if (look.suit) {
    // галстук
    g.add(box(0.07, 0.4, 0.02, PALETTE.red, { y: 1.1, z: hipsW * 0.75 / 2 + 0.01 }));
  }

  // голова
  const head = new THREE.Group();
  head.position.set(0, 1.68, 0);
  const skull = box(0.32, 0.32, 0.3, look.hat === 'mask' ? 0x3a3d45 : PALETTE.skin, { y: 0.06 });
  head.add(skull);
  if (look.hat === 'cap' || look.hat === 'hardhat') {
    head.add(box(0.36, 0.1, 0.34, look.hat === 'hardhat' ? 0xd8b83a : body, { y: 0.24 }));
    head.add(box(0.34, 0.05, 0.16, look.hat === 'hardhat' ? 0xd8b83a : body, { y: 0.2, z: 0.22 }));
  } else if (look.hat === 'helmet') {
    head.add(box(0.38, 0.2, 0.36, 0x5a5f52, { y: 0.2 }));
    head.add(box(0.4, 0.06, 0.12, 0x5a5f52, { y: 0.12, z: 0.2 }));
  } else if (look.hat === 'mask') {
    const mask = cyl(0.13, 0.15, 0.14, 0x3a3d45, { y: 0.05, z: 0.16 }, 8);
    mask.rotation.x = Math.PI / 2;
    head.add(mask);
    head.add(box(0.34, 0.1, 0.32, 0.2, { y: 0.24 }));      // капюшон
    head.add(box(0.09, 0.02, 0.02, 0xffe08a, { y: 0.07, z: 0.23 }));
  } else if (look.hat === 'hardhat') {
    head.add(box(0.38, 0.14, 0.36, 0xd8b83a, { y: 0.22 }));
  } else if (look.hat === 'hat') {
    head.add(box(0.34, 0.1, 0.32, 0x6b5c33, { y: 0.24 }));
    head.add(box(0.5, 0.04, 0.46, 0x6b5c33, { y: 0.18 }));
  } else if (look.hat === 'eyepatch') {
    head.add(box(0.12, 0.12, 0.02, PALETTE.black, { x: -0.08, y: 0.06, z: 0.16 }));
    head.add(box(0.36, 0.08, 0.34, bodyDark, { y: 0.24 }));
  } else if (look.hat === 'mask2') {
    head.add(box(0.34, 0.3, 0.32, 0x4a4f58, { y: 0.05 }));
    head.add(box(0.36, 0.06, 0.34, PALETTE.black, { y: 0.2 }));
  } else { // bald (heavy)
    head.add(box(0.3, 0.08, 0.2, 0x4a4034, { y: 0.24, z: -0.06 }));
  }
  // глаза
  head.add(box(0.06, 0.05, 0.02, 0x23252b, { x: -0.07, y: 0.07, z: 0.155 }));
  head.add(box(0.06, 0.05, 0.02, 0x23252b, { x: 0.07, y: 0.07, z: 0.155 }));
  head.castShadow = true;
  g.add(head);
  anim.head = head;

  // руки
  const armGeo = new THREE.BoxGeometry(0.19 * (look.wide || 1), 0.6, 0.22);
  const armMat = mat(look.coat ? PALETTE.white : body);
  const armL = new THREE.Mesh(armGeo, armMat);
  armL.position.set(-(torsoW / 2 + 0.11), 1.32, 0);
  const armR = new THREE.Mesh(armGeo, armMat);
  armR.position.set(torsoW / 2 + 0.11, 1.32, 0);
  armL.castShadow = armR.castShadow = true;
  // кисти
  armL.add(box(0.17, 0.14, 0.18, 0x2b2f36, { y: -0.34 }));
  armR.add(box(0.17, 0.14, 0.18, 0x2b2f36, { y: -0.34 }));
  g.add(armL, armR);

  // оружие в правой руке
  const weapon = makeWeaponProp(classId);
  weapon.position.set(0, -0.36, 0.18);
  armR.add(weapon);
  anim.weapon = weapon;

  anim.legL = legL;
  anim.legR = legR;
  anim.armL = armL;
  anim.armR = armR;
  anim.torso = torso;
  anim.group = g;
  anim.look = look;

  g.scale.setScalar(s);
  return { group: g, anim };
}

// Оружие в руках (упрощённые силуэты)
export function makeWeaponProp(classId) {
  const g = new THREE.Group();
  const dark = PALETTE.metalDark;
  switch (classId) {
    case 'scout':
      g.add(box(0.12, 0.14, 0.5, dark, { z: 0.2 }));
      g.add(box(0.14, 0.1, 0.2, PALETTE.wood, { z: -0.05 }));
      break;
    case 'soldier':
      g.add(cylZ(0.09, 0.09, 0.7, dark, { z: 0.25 }));
      g.add(box(0.14, 0.16, 0.24, PALETTE.metal, { z: -0.05 }));
      break;
    case 'pyro':
      g.add(cylZ(0.05, 0.05, 0.5, dark, { z: 0.2 }));
      g.add(box(0.2, 0.12, 0.2, PALETTE.metalDark, { z: -0.02 }));
      break;
    case 'demoman':
      g.add(cylZ(0.1, 0.1, 0.42, 0x3d4a33, { z: 0.16 }));
      g.add(box(0.12, 0.12, 0.18, PALETTE.wood, { z: -0.1 }));
      break;
    case 'heavy':
      g.add(cylZ(0.11, 0.11, 0.9, dark, { z: 0.34 }));
      g.add(box(0.2, 0.22, 0.3, PALETTE.metalDark, { z: -0.08 }));
      g.add(box(0.1, 0.1, 0.5, 0x3d4149, { y: -0.16, z: 0.2 }));
      break;
    case 'engineer':
      g.add(box(0.12, 0.12, 0.45, dark, { z: 0.18 }));
      g.add(box(0.14, 0.16, 0.16, PALETTE.wood, { z: -0.06 }));
      break;
    case 'medic':
      g.add(box(0.16, 0.16, 0.4, PALETTE.metal, { z: 0.16 }));
      g.add(box(0.1, 0.1, 0.12, 0x9be8ff, { y: 0.06, z: 0.2 }));
      break;
    case 'sniper':
      g.add(box(0.09, 0.09, 0.9, 0x4b3b25, { z: 0.4 }));
      g.add(box(0.08, 0.14, 0.2, PALETTE.wood, { z: -0.05 }));
      g.add(box(0.07, 0.07, 0.22, 0x23252b, { y: 0.1, z: 0.25 }));
      break;
    case 'spy':
      g.add(box(0.1, 0.12, 0.3, 0x2c2f36, { z: 0.12 }));
      break;
    default:
      g.add(box(0.12, 0.12, 0.4, dark, { z: 0.16 }));
  }
  return g;
}

// ------------------------------------------------------------
//  Снаряды
// ------------------------------------------------------------
export function makeProjectile(kind, team) {
  const g = new THREE.Group();
  if (kind === 'rocket') {
    const body = cyl(0.11, 0.11, 0.42, 0x3f434b, {}, 8);
    body.rotation.x = Math.PI / 2;
    g.add(body);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.2, 8), mat(teamColor(team)));
    tip.rotation.x = Math.PI / 2;
    tip.position.z = 0.3;
    g.add(tip);
    const flame = sphere(0.12, 0xffb35c, { z: -0.28 }, 6);
    g.add(flame);
  } else if (kind === 'sticky') {
    const b = sphere(0.16, 0x2f333a, {}, 10);
    g.add(b);
    const light = sphere(0.06, teamColor(team), { z: 0.14 }, 6);
    g.add(light);
  } else if (kind === 'grenade') {
    const b = sphere(0.15, 0x4a5240, {}, 10);
    g.add(b);
    g.add(cyl(0.03, 0.03, 0.12, 0x2b2f36, { y: 0.16 }, 6));
  } else if (kind === 'arrow') {
    const rod = cyl(0.02, 0.02, 0.7, 0x6b5233, {}, 6);
    rod.rotation.x = Math.PI / 2;
    g.add(rod);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 6), mat(PALETTE.metal));
    head.rotation.x = Math.PI / 2;
    head.position.z = 0.42;
    g.add(head);
  }
  return g;
}

// ------------------------------------------------------------
//  Постройки инженера
// ------------------------------------------------------------
export function makeBuilding(kind, team) {
  const g = new THREE.Group();
  const col = teamColor(team);
  const dark = PALETTE.metalDark;
  if (kind === 'sentry') {
    const legs = box(0.9, 0.12, 0.9, dark, { y: 0.06 });
    g.add(legs);
    for (const [x, z] of [[-0.34, -0.34], [0.34, -0.34], [-0.34, 0.34], [0.34, 0.34]]) {
      const l = cyl(0.05, 0.07, 0.5, 0x363a42, { y: 0.28, x, z }, 6);
      l.rotation.z = x * 0.4; l.rotation.x = -z * 0.4;
      g.add(l);
    }
    const base = box(0.7, 0.4, 0.7, 0x53575f, { y: 0.66 });
    g.add(base);
    const head = new THREE.Group();
    head.position.set(0, 1.0, 0);
    const headBox = box(0.62, 0.44, 0.62, col, {});
    head.add(headBox);
    head.add(box(0.1, 0.1, 0.5, dark, { x: -0.18, z: 0.4 }));
    head.add(box(0.1, 0.1, 0.5, dark, { x: 0.18, z: 0.4 }));
    head.add(box(0.2, 0.16, 0.3, 0x22252b, { z: 0.3 }));
    g.add(head);
    g.userData.head = head;
    // индикатор уровня
    const lamps = new THREE.Group();
    for (let i = 0; i < 3; i++) lamps.add(sphere(0.045, 0xffd166, { x: -0.16 + i * 0.16, y: 1.3, z: 0 }, 6));
    g.add(lamps);
    g.userData.lamps = lamps;
  } else if (kind === 'dispenser') {
    g.add(box(0.8, 0.9, 0.8, 0x5c6169, { y: 0.45 }));
    g.add(box(0.86, 0.16, 0.86, col, { y: 0.98 }));
    const crossV = box(0.12, 0.4, 0.06, 0x2ecc71, { y: 0.5, z: 0.42 });
    const crossH = box(0.34, 0.12, 0.06, 0x2ecc71, { y: 0.5, z: 0.42 });
    g.add(crossV, crossH);
    g.add(cyl(0.14, 0.14, 0.3, dark, { y: 1.1 }, 8));
  } else { // teleporter
    g.add(box(1.1, 0.14, 1.1, 0x54585f, { y: 0.07 }));
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.45, 0.06, 8, 20),
      mat(col)
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.5;
    g.add(ring);
    const glow = sphere(0.35, col, { y: 0.5 }, 10);
    glow.material = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35 });
    g.add(glow);
    g.userData.spin = ring;
  }
  return g;
}

// ------------------------------------------------------------
//  Точка захвата и текстовые таблички
// ------------------------------------------------------------
export function makeTextSprite(text, color = '#ffffff', size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.font = 'bold 96px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(text, 64, 68);
  ctx.fillStyle = color;
  ctx.fillText(text, 64, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false,
  }));
  sprite.scale.set(1.6, 1.6, 1.6);
  return sprite;
}

export function makeCapPoint(cap) {
  const g = new THREE.Group();
  g.position.set(cap.pos.x, cap.pos.y, cap.pos.z);
  // площадка-круг
  const padGeo = new THREE.CylinderGeometry(3.2, 3.2, 0.12, 24);
  const pad = new THREE.Mesh(padGeo, new THREE.MeshLambertMaterial({ color: 0x6f747c }));
  pad.position.y = 0.06;
  pad.receiveShadow = true;
  g.add(pad);
  // светящееся кольцо (цвет владельца)
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.3, 3.1, 28),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.14;
  g.add(ring);
  // цилиндр зоны
  const zone = new THREE.Mesh(
    new THREE.CylinderGeometry(3.2, 3.2, 4.2, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false })
  );
  zone.position.y = 2.2;
  g.add(zone);
  // столб-указатель с буквой
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.4, 8), mat(0x9aa0a8));
  pole.position.y = 1.8;
  pole.castShadow = true;
  g.add(pole);
  const label = makeTextSprite(cap.name, '#ffffff');
  label.position.y = 3.9;
  g.add(label);
  // флаг
  const flag = box(0.9, 0.55, 0.06, 0xffffff, { x: 0.5, y: 3.2 });
  g.add(flag);
  return { group: g, ring, zone, label, flag, pole };
}

// ------------------------------------------------------------
//  Вид от первого лица (оружие в руках игрока)
// ------------------------------------------------------------
export function makeViewModel(classId, team) {
  const g = new THREE.Group();
  const dark = 0x3a3d45;
  const metal = 0x6a6f78;
  const add = (mesh, pos) => { mesh.position.set(pos[0], pos[1], pos[2]); g.add(mesh); return mesh; };
  const m = (w, h, d, color) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  switch (classId) {
    case 'scout':
      add(m(0.16, 0.18, 0.8, dark), [0.28, -0.26, -0.5]);
      add(m(0.2, 0.3, 0.22, PALETTE.wood), [0.28, -0.32, -0.1]);
      break;
    case 'soldier':
      add(m(0.24, 0.24, 1.2, dark), [0.3, -0.26, -0.6]);
      add(m(0.26, 0.3, 0.34, 0x4e5259), [0.3, -0.3, -0.05]);
      break;
    case 'pyro':
      add(m(0.22, 0.22, 0.9, 0x4a4e3a), [0.3, -0.26, -0.45]);
      add(m(0.2, 0.26, 0.3, dark), [0.3, -0.3, -0.05]);
      break;
    case 'demoman':
      add(m(0.26, 0.26, 0.9, 0x44503a), [0.3, -0.26, -0.45]);
      add(m(0.22, 0.26, 0.3, PALETTE.wood), [0.3, -0.32, -0.05]);
      break;
    case 'heavy':
      add(m(0.32, 0.32, 1.3, dark), [0.28, -0.3, -0.7]);
      add(m(0.4, 0.4, 0.4, 0x4a4e56), [0.28, -0.34, -0.05]);
      break;
    case 'engineer':
      add(m(0.18, 0.2, 0.95, dark), [0.3, -0.26, -0.5]);
      add(m(0.2, 0.26, 0.26, PALETTE.wood), [0.3, -0.34, -0.08]);
      break;
    case 'medic':
      add(m(0.22, 0.22, 0.62, metal), [0.28, -0.26, -0.42]);
      add(m(0.14, 0.14, 0.3, 0x8fe5ff), [0.28, -0.18, -0.6]);
      break;
    case 'sniper':
      add(m(0.14, 0.14, 1.5, 0x5a4629), [0.3, -0.26, -0.8]);
      add(m(0.12, 0.24, 0.34, PALETTE.wood), [0.3, -0.32, -0.1]);
      add(m(0.1, 0.1, 0.4, 0x22252b), [0.3, -0.14, -0.5]);
      break;
    case 'spy':
      add(m(0.16, 0.2, 0.55, 0x2c2f36), [0.3, -0.26, -0.4]);
      break;
    default:
      add(m(0.2, 0.2, 0.8, dark), [0.3, -0.26, -0.4]);
  }
  // «руки» — две коробки-перчатки
  add(m(0.2, 0.2, 0.4, team === TEAM_BLU ? 0x40566a : 0x6a3a3a), [0.3, -0.42, -0.35]);
  if (classId === 'soldier' || classId === 'demoman' || classId === 'heavy') {
    add(m(0.2, 0.2, 0.4, team === TEAM_BLU ? 0x40566a : 0x6a3a3a), [0.16, -0.44, -0.62]);
  }
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9 })
  );
  flash.position.set(0.3, -0.26, -1.2);
  flash.visible = false;
  g.add(flash);
  g.userData.flash = flash;
  return g;
}
