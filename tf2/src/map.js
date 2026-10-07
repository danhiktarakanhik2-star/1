// ============================================================
//  Построение карты: описание из data.js → боксы/точки/спавны.
// ============================================================
import { TEAM_RED, TEAM_BLU } from './data.js';

export function buildMap(def) {
  const boxes = [];
  const caps = [];
  const spawns = [];

  const makeBox = (x, y, z, sx, sy, sz, kind = 'wall', solid = 0) => {
    boxes.push({
      min: { x: x - sx / 2, y: y - sy / 2, z: z - sz / 2 },
      max: { x: x + sx / 2, y: y + sy / 2, z: z + sz / 2 },
      size: { x: sx, y: sy, z: sz },
      center: { x, y, z },
      kind,
      solid,
    });
  };

  const makeCap = (x, y, z, id, teamLabel) => {
    caps.push({
      id,
      name: id,
      teamLabel,
      pos: { x, y, z },
      radius: 3.4,
      height: 4,
      owner: null,
      progress: 0,
    });
  };

  const makeSpawn = (x, y, z, team) => {
    spawns.push({ team, pos: { x, y, z } });
  };

  def.builder(makeBox, makeCap, makeSpawn);

  return {
    id: def.id,
    name: def.name,
    ru: def.ru,
    desc: def.desc,
    boxes,
    caps,
    spawns,
    bounds: { minX: -150, maxX: 150, minZ: -150, maxZ: 150, maxY: 40 },
  };
}
