// ============================================================
//  Fortress Arena — физика: AABB-коллизии, лучи, векторы.
//  Модуль полностью независим от three.js (можно тестировать в Node).
// ============================================================

export const EPS = 1e-4;

export function vec3(x = 0, y = 0, z = 0) {
  return { x, y, z };
}

export function len3(v) {
  return Math.hypot(v.x, v.y, v.z);
}

export function norm3(v) {
  const l = len3(v) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

export function dist3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function distXZ(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function randRange(a, b) {
  return a + Math.random() * (b - a);
}

// ------------------------------------------------------------
//  AABB
// ------------------------------------------------------------

// Колонка-хитбокс игрока/объекта: центр ног + радиус и высота.
export function hitbox(pos, radius, height) {
  return {
    min: { x: pos.x - radius, y: pos.y, z: pos.z - radius },
    max: { x: pos.x + radius, y: pos.y + height, z: pos.z + radius },
  };
}

export function overlaps(a, b) {
  return (
    a.min.x < b.max.x - EPS &&
    a.max.x > b.min.x + EPS &&
    a.min.y < b.max.y - EPS &&
    a.max.y > b.min.y + EPS &&
    a.min.z < b.max.z - EPS &&
    a.max.z > b.min.z + EPS
  );
}

export function boxContains(box, p, pad = 0) {
  return (
    p.x >= box.min.x - pad && p.x <= box.max.x + pad &&
    p.y >= box.min.y - pad && p.y <= box.max.y + pad &&
    p.z >= box.min.z - pad && p.z <= box.max.z + pad
  );
}

// ------------------------------------------------------------
//  Перемещение игрока с коллизиями по статическим боксам.
//  Работает по осям: X → Z → Y (так удобнее ловить «приземление»).
//  Возвращает { pos, onGround, hitX, hitZ, hitCeil }.
// ------------------------------------------------------------
export function moveHitbox(boxes, pos, radius, height, move) {
  const r = Math.max(0.05, radius - EPS);
  const h = height;
  let px = pos.x, py = pos.y, pz = pos.z;
  let onGround = false, hitX = false, hitZ = false, hitCeil = false;

  const overlapsAt = (x, y, z) => {
    const pminx = x - r, pmaxx = x + r;
    const pminy = y, pmaxy = y + h;
    const pminz = z - r, pmaxz = z + r;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (
        pminx < b.max.x - EPS && pmaxx > b.min.x + EPS &&
        pminy < b.max.y - EPS && pmaxy > b.min.y + EPS &&
        pminz < b.max.z - EPS && pmaxz > b.min.z + EPS
      ) return b;
    }
    return null;
  };

  // --- X ---
  if (move.x) {
    let nx = px + move.x;
    if (move.x > 0) {
      for (const b of boxes) {
        if (py + h <= b.min.y + EPS || py >= b.max.y - EPS) continue;
        if (pz + r <= b.min.z + EPS || pz - r >= b.max.z - EPS) continue;
        if (px + r <= b.min.x + EPS && nx + r > b.min.x) { nx = b.min.x - r; hitX = true; }
      }
    } else {
      for (const b of boxes) {
        if (py + h <= b.min.y + EPS || py >= b.max.y - EPS) continue;
        if (pz + r <= b.min.z + EPS || pz - r >= b.max.z - EPS) continue;
        if (px - r >= b.max.x - EPS && nx - r < b.max.x) { nx = b.max.x + r; hitX = true; }
      }
    }
    px = nx;
  }

  // --- Z ---
  if (move.z) {
    let nz = pz + move.z;
    if (move.z > 0) {
      for (const b of boxes) {
        if (py + h <= b.min.y + EPS || py >= b.max.y - EPS) continue;
        if (px + r <= b.min.x + EPS || px - r >= b.max.x - EPS) continue;
        if (pz + r <= b.min.z + EPS && nz + r > b.min.z) { nz = b.min.z - r; hitZ = true; }
      }
    } else {
      for (const b of boxes) {
        if (py + h <= b.min.y + EPS || py >= b.max.y - EPS) continue;
        if (px + r <= b.min.x + EPS || px - r >= b.max.x - EPS) continue;
        if (pz - r >= b.max.z - EPS && nz - r < b.max.z) { nz = b.max.z + r; hitZ = true; }
      }
    }
    pz = nz;
  }

  // --- Y ---
  if (move.y <= 0) {
    let bestTop = -Infinity;
    let ny = py + move.y;
    for (const b of boxes) {
      if (px + r <= b.min.x + EPS || px - r >= b.max.x - EPS) continue;
      if (pz + r <= b.min.z + EPS || pz - r >= b.max.z - EPS) continue;
      // платформа под нами: её верх не выше наших ног (+ допуск)
      if (b.max.y <= py + 0.02 && ny < b.max.y && b.max.y > bestTop) bestTop = b.max.y;
    }
    if (bestTop > -Infinity) {
      py = bestTop;
      onGround = true;
    } else {
      py = ny;
    }
  } else {
    let bestBottom = Infinity;
    const ny = py + move.y;
    for (const b of boxes) {
      if (px + r <= b.min.x + EPS || px - r >= b.max.x - EPS) continue;
      if (pz + r <= b.min.z + EPS || pz - r >= b.max.z - EPS) continue;
      if (b.min.y >= py + h - 0.02 && ny + h > b.min.y && b.min.y < bestBottom) bestBottom = b.min.y;
    }
    if (bestBottom < Infinity) {
      py = bestBottom - h;
      hitCeil = true;
    } else {
      py = ny;
    }
  }

  // --- Разрешение «застреваний» (депенетрация) ---
  for (let iter = 0; iter < 3; iter++) {
    const hit = overlapsAt(px, py, pz);
    if (!hit) break;
    const dxPlus = hit.max.x - (px - r);
    const dxMinus = (px + r) - hit.min.x;
    const dzPlus = hit.max.z - (pz - r);
    const dzMinus = (pz + r) - hit.min.z;
    const dyPlus = hit.max.y - py;
    const dyMinus = (py + h) - hit.min.y;
    const m = Math.min(dxPlus, dxMinus, dzPlus, dzMinus, dyPlus, dyMinus);
    if (m === dyMinus) { py = hit.min.y - h; hitCeil = true; }
    else if (m === dyPlus) { py = hit.max.y; onGround = true; }
    else if (m === dxPlus) { px += m + EPS; }
    else if (m === dxMinus) { px -= m + EPS; }
    else if (m === dzPlus) { pz += m + EPS; }
    else { pz -= m + EPS; }
  }

  return { pos: { x: px, y: py, z: pz }, onGround, hitX, hitZ, hitCeil };
}

// ------------------------------------------------------------
//  Лучи
// ------------------------------------------------------------

// Пересечение луча с AABB (slab method). Возвращает t или null.
export function rayBox(origin, dir, box, maxDist) {
  let tmin = 0, tmax = maxDist;
  for (const axis of ['x', 'y', 'z']) {
    const o = origin[axis], d = dir[axis];
    const mn = box.min[axis], mx = box.max[axis];
    if (Math.abs(d) < 1e-8) {
      if (o < mn || o > mx) return null;
    } else {
      let t1 = (mn - o) / d;
      let t2 = (mx - o) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

// Ближайший статический бокс на пути луча.
export function raycastBoxes(boxes, origin, dir, maxDist) {
  let best = null;
  for (const b of boxes) {
    const t = rayBox(origin, dir, b, maxDist);
    if (t !== null && (!best || t < best.dist)) best = { dist: t, box: b };
  }
  return best;
}

// Есть ли прямая видимость между двумя точками (между ними нет геометрии).
// Особенности:
//  · боксы, внутри которых начинается луч, препятствием не считаются
//    (иначе взрыв на поверхности земли «упирается» в саму землю);
//  · очень близкие касания (< 0.2 м) игнорируются.
export function raycastLos(boxes, from, to, pad = 0.0) {
  const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const dist = len3(d);
  if (dist < 1e-4) return true;
  const dir = { x: d.x / dist, y: d.y / dist, z: d.z / dist };
  const origin = { x: from.x, y: from.y, z: from.z };
  const maxT = Math.max(0, dist - 0.05 - pad);
  for (const b of boxes) {
    if (boxContains(b, origin, 0.03)) continue;
    const t = rayBox(origin, dir, b, maxT);
    if (t !== null && t > 0.2) return false;
  }
  return true;
}
