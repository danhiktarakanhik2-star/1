// ============================================================
//  Fortress Arena — игровые данные: классы, оружие, настройки
//  Чистый модуль без зависимостей (используется и логикой, и UI).
// ============================================================

export const TEAM_RED = 0;
export const TEAM_BLU = 1;

export const TEAM_INFO = [
  { id: TEAM_RED, name: 'RED', ru: 'Красные', color: '#b8383b', light: '#ff6b5e', darker: 0x7d2527 },
  { id: TEAM_BLU, name: 'BLU', ru: 'Синие', color: '#5885a2', light: '#7fc3f0', darker: 0x35566b },
];

// ------------------------------------------------------------
//  Команды физики / тюнинг (единицы — метры, секунды)
// ------------------------------------------------------------
export const CFG = {
  TICK: 1 / 60,
  TICK_MS: 1000 / 60,

  GRAVITY: 20,
  AIR_ACCEL: 8,          // управление в воздухе (воздушный разгон)
  STAND_ACCEL: 150,
  GROUND_FRICTION: 20,

  JUMP_VELOCITY: 8.6,
  AIR_SPEED_MULT: 2.2,   // предел горизонтальной скорости в воздухе (для ракетных прыжков)
  CROUCH_FACTOR: 0.45,

  EYE_HEIGHT: 1.56,
  HEAD_VISUAL: 1.68,
  PLAYER_RADIUS: 0.42,
  PLAYER_HEIGHT: 1.6,
  OBJECT_RADIUS: 0.5,

  RESPAWN_TIME: 4.0,
  OVERHEAL_DECAY: 3.0,   // хп/сек
  MEDIGUN_RATE: 24,      // хп/сек
  MEDIGUN_RANGE: 13,
  CLOAK_DRAIN: 8.33,     // сек на полный заряд
  CLOAK_REGEN: 8.33,

  SENTRY_TURN_SPEED: 4.5,
  SENTRY_RANGE: 32,
  SENTRY_AMMO: 200,
  SENTRY_ROCKETS: 20,
  MELEE_RANGE: 2.6,
  MELEE_SWING: 0.45,
  MELEE_COOLDOWN: 0.85,

  FALL_DAMAGE_SPEED: 14, // скорость, с которой начинается урон от падения
  FALL_DAMAGE_K: 3.2,

  CART_SPEED: 3.4,
  CART_SIZE: { x: 4.0, y: 3.2, z: 3.0 },
};

export const ATTR = {
  scatter: 'scatter',     // разброс, рад
  pellets: 'pellets',     // дробин за выстрел
  ramp: 'ramp',           // урон нарастает при удержании
  falloff: 'falloff',     // множитель урона в конце дистанции
  overheal: 'overheal',   // множитель оверхила
  burn: 'burn',           // время горения, сек
  burnDps: 'burnDps',
  explosion: 'explosion', // радиус взрыва
  push: 'push',           // сила отталкивания взрывом
  selfPush: 'selfPush',   // сила отталкивания для себя (ракетный прыжок)
  selfDamage: 'selfDamage',
  damage: 'damage',       // урон турели
  repairRate: 'repairRate',
  speedMult: 'speedMult',
};

// ------------------------------------------------------------
//  Стрелки (метательное оружие)
// ------------------------------------------------------------
export const ARROWS = {
  normal: { ruin: 0, size: 'M', chargeTime: 1.0, damage: 50, speedAt0: 30, speedAtMax: 65, gravity: 0.55 },
  huntsman: { ruin: 0, size: 'S', chargeTime: 0.46, damage: 45, speedAt0: 40, speedAtMax: 62, gravity: 0.42 },
  fire: { ruin: 0.35, size: 'M', chargeTime: 0.9, damage: 32, burnDps: 9, burnTime: 5, speedAt0: 26, speedAtMax: 50, gravity: 0.5, fire: true },
  heal: { ruin: 0.25, size: 'M', damage: 38, healHp: 75, speedAt0: 50, speedAtMax: 50, gravity: 0.25, heal: true },
};

// ------------------------------------------------------------
//  Классы
// ------------------------------------------------------------
export const CLASSES = {
  scout: {
    id: 'scout',
    name: 'Scout',
    ru: 'Разведчик',
    tagline: 'Быстрый, но хрупкий. Двухстволка и бейсбольная бита.',
    hp: 125,
    speed: 8.6,
    build: 'Стройный быстрый боец в кепке.',
    weapon: {
      id: 'scattergun', name: 'Scattergun', ru: 'Двухстволка', type: 'hitscan',
      damage: 10, pellets: 8, range: 22, falloff: 0.35, rpm: 90, spread: 0.045,
      reloadTime: 1.5, magazine: 6, baseSpread: 0.012, ramp: { perShot: 0.028, max: 0.10, decay: 0.22 },
      sound: 'scatter',
    },
  },

  soldier: {
    id: 'soldier',
    name: 'Soldier',
    ru: 'Солдат',
    tagline: 'Ракетница и ракетные прыжки. 4 ракеты в обойме.',
    hp: 200,
    speed: 5.6,
    build: 'Крепкий боец в каске.',
    weapon: {
      id: 'rocketlauncher', name: 'Rocket Launcher', ru: 'Ракетница', type: 'projectile',
      damage: 90, splash: 70, range: 38, explosion: 3.2, push: 12, selfPush: 13.5, selfDamage: 0.65,
      rpm: 48, reloadTime: 2.3, magazine: 4, speed: 'speed', laser: false,
      sound: 'rocket',
    },
  },

  pyro: {
    id: 'pyro',
    name: 'Pyro',
    ru: 'Поджигатель',
    tagline: 'Огнемёт: сжигает врагов, отражает снаряды сжатым воздухом.',
    hp: 175,
    speed: 6.4,
    build: 'Боец в противогазе.',
    weapon: {
      id: 'flamethrower', name: 'Flamethrower', ru: 'Огнемёт', type: 'flame',
      dps: 90, range: 8.5, cone: 0.30, magazine: 150, ammoPerSec: 12, reloadTime: 1.6,
      airblastForce: 16, airblastCooldown: 0.8, reflectRange: 3.0,
      sound: 'flame',
    },
  },

  demoman: {
    id: 'demoman',
    name: 'Demoman',
    ru: 'Подрывник',
    tagline: 'Гранатомёт с детонацией по клику и липкие бомбы.',
    hp: 175,
    speed: 6.0,
    build: 'Боец с чёрной повязкой на глазу.',
    weapon: {
      id: 'grenadelauncher', name: 'Grenade Launcher', ru: 'Гранатомёт', type: 'projectile',
      damage: 75, splash: 55, range: 32, explosion: 3.4, speed: 20, gravity: 10,
      rpm: 70, reloadTime: 2.0, magazine: 4, manual: true, sticky: false,
      sound: 'grenade',
    },
    secondary: {
      id: 'stickybomb', name: 'Stickybomb Launcher', ru: 'Липкие бомбы', type: 'projectile',
      damage: 90, splash: 60, speed: 22, gravity: 10, rpm: 45, reloadTime: 2.2, magazine: 8,
      sticky: true, detonate: true, armTime: 0.8, maxActive: 8,
      sound: 'sticky',
    },
  },

  heavy: {
    id: 'heavy',
    name: 'Heavy',
    ru: 'Пулемётчик',
    tagline: 'Пулемёт Sasha: огромный урон, но нужно раскрутить.',
    hp: 300,
    speed: 5.0,
    build: 'Огромный боец с пулемётом.',
    weapon: {
      id: 'minigun', name: 'Minigun', ru: 'Пулемёт', type: 'hitscan',
      damage: 9, pellets: 1, rpm: 600, spread: 0.055, range: 40, falloff: 0.5,
      spinUpTime: 0.9, spinDownTime: 1.2, moveMult: 0.45, magazine: 200, reloadTime: 2.5,
      ramp: { perShot: 0.004, max: 0.5, decay: 0.5 },
      sound: 'minigun',
    },
  },

  engineer: {
    id: 'engineer',
    name: 'Engineer',
    ru: 'Инженер',
    tagline: 'Дробовик, турель и телепорты. Постройте базу.',
    hp: 125,
    speed: 6.6,
    build: 'Боец в каске с инструментами.',
    weapon: {
      id: 'shotgun', name: 'Shotgun', ru: 'Дробовик', type: 'hitscan',
      damage: 8, pellets: 7, range: 20, falloff: 0.4, rpm: 75, spread: 0.055,
      reloadTime: 1.0, magazine: 6, baseSpread: 0.02,
      sound: 'shotgun',
    },
    builds: [
      { id: 'sentry', name: 'Sentry Gun', ru: 'Турель', buildTime: 3.0, cooldown: 8, cost: 0 },
      { id: 'dispenser', name: 'Dispenser', ru: 'Раздатчик', buildTime: 2.5, cooldown: 8, cost: 0 },
      { id: 'teleporter', name: 'Teleporter', ru: 'Телепорт (вход+выход)', buildTime: 2.5, cooldown: 12, cost: 0 },
    ],
  },

  medic: {
    id: 'medic',
    name: 'Medic',
    ru: 'Медик',
    tagline: 'Лучник-целитель и медган с убер-зарядом.',
    hp: 150,
    speed: 7.0,
    build: 'Боец в белом халате и с медганом.',
    weapon: {
      id: 'crossbow', name: 'Crusader\'s Crossbow', ru: 'Арбалет', type: 'projectile',
      arrowType: 'heal', rpm: 60, reloadTime: 1.2, magazine: 1,
      sound: 'crossbow',
    },
    secondary: {
      id: 'medigun', name: 'Medi Gun', ru: 'Медган', type: 'beam',
      rate: 24, range: 13, overheal: 1.5, uberTime: 8,
      sound: 'heal',
    },
  },

  sniper: {
    id: 'sniper',
    name: 'Sniper',
    ru: 'Снайпер',
    tagline: 'Заряжаемая винтовка, стрелы и мгновенный крит в голову.',
    hp: 125,
    speed: 6.6,
    build: 'Боец в шляпе.',
    weapon: {
      id: 'sniperrifle', name: 'Sniper Rifle', ru: 'Снайперская винтовка', type: 'hitscan',
      damage: 50, headshotMult: 3, chargeTime: 1.2, zoomedCharge: 2.5, rpm: 60,
      reloadTime: 1.4, magazine: 1, baseSpread: 0, zoomMoveMult: 0.45,
      sound: 'sniper',
    },
    secondary: {
      id: 'smg', name: 'SMG', ru: 'ПП', type: 'hitscan',
      damage: 8, rpm: 600, spread: 0.05, range: 24, falloff: 0.4,
      reloadTime: 1.1, magazine: 25,
      sound: 'smg',
    },
  },

  spy: {
    id: 'spy',
    name: 'Spy',
    ru: 'Шпион',
    tagline: 'Невидимость, маскировка и смертельный удар в спину.',
    hp: 125,
    speed: 6.8,
    build: 'Боец в маске и костюме.',
    weapon: {
      id: 'revlover', name: 'Revolver', ru: 'Револьвер', type: 'hitscan',
      damage: 40, rpm: 120, spread: 0.012, range: 30, reloadTime: 1.2, magazine: 6,
      sound: 'revolver',
    },
    melee: {
      id: 'knife', name: 'Knife', ru: 'Нож', type: 'melee',
      damage: 40, backstab: 900, range: 2.4, rpm: 60,
      sound: 'knife',
    },
    cloakTime: 0.8, disguiseTime: 0.9,
  },
};

// Ближний бой (слот 3) — есть у всех
export const MELEES = {
  scout: { id: 'bat', name: 'Bat', ru: 'Бита', type: 'melee', damage: 35, rpm: 75, range: 2.5 },
  soldier: { id: 'shovel', name: 'Shovel', ru: 'Лопата', type: 'melee', damage: 65, rpm: 55, range: 2.7 },
  pyro: { id: 'fireaxe', name: 'Fire Axe', ru: 'Топор', type: 'melee', damage: 65, rpm: 55, range: 2.7 },
  demoman: { id: 'bottle', name: 'Bottle', ru: 'Бутылка', type: 'melee', damage: 65, rpm: 55, range: 2.7 },
  heavy: { id: 'fists', name: 'Fists', ru: 'Кулаки', type: 'melee', damage: 65, rpm: 55, range: 2.5 },
  engineer: { id: 'wrench', name: 'Wrench', ru: 'Гаечный ключ', type: 'melee', damage: 65, rpm: 60, range: 2.7, repair: 40 },
  medic: { id: 'bonesaw', name: 'Bonesaw', ru: 'Пила', type: 'melee', damage: 65, rpm: 55, range: 2.7 },
  sniper: { id: 'kukri', name: 'Kukri', ru: 'Кукри', type: 'melee', damage: 65, rpm: 55, range: 2.7 },
  spy: { id: 'knife', name: 'Knife', ru: 'Нож', type: 'melee', damage: 40, backstab: 900, rpm: 60, range: 2.5 },
};

export const CLASS_ORDER = ['scout', 'soldier', 'pyro', 'demoman', 'heavy', 'engineer', 'medic', 'sniper', 'spy'];

// ------------------------------------------------------------
//  Константы персонажа / игры
// ------------------------------------------------------------
export const CLASS_HP = Object.fromEntries(CLASS_ORDER.map((id) => [id, CLASSES[id].hp]));
export const CLASS_SPEED = Object.fromEntries(CLASS_ORDER.map((id) => [id, CLASSES[id].speed]));

export const WEAPON_ALIASES = {
  scattergun: 'scatter gun',
  rocketlauncher: 'rocket launcher',
  flamethrower: 'flame thrower',
  grenadelauncher: 'grenade launcher',
  stickybomb: 'sticky bomb launcher',
  minigun: 'minigun',
  shotgun: 'shotgun',
  crossbow: 'crossbow',
  medigun: 'medi gun',
  sniperrifle: 'sniper rifle',
  smg: 'smg',
  revlover: 'revolver',
  knife: 'knife',
};

export const BOT_NAMES = [
  'Boris', 'Clyde', 'Dmitry', 'Egor', 'Fedor', 'Grigori', 'Hank', 'Ivan', 'Josef', 'Kirill',
  'Leonid', 'Maksim', 'Nikita', 'Oleg', 'Pavel', 'Roman', 'Sergei', 'Timur', 'Vadim', 'Yuri',
  'Anton', 'Bogdan', 'Vasily', 'Gennady', 'Denis', 'Zakhar', 'Ilya', 'Konstantin', 'Lev', 'Miron',
  'Pyotr', 'Ruslan', 'Stepan', 'Trofim', 'Ustin', 'Vlad', 'Yakov', 'Zosima', 'Arkady', 'Taras',
];

export const BOT_SKILLS = [
  { id: 'easy', name: 'Easy', ru: 'Лёгкие', aimError: 4.5, reaction: 0.55, fov: 90 },
  { id: 'normal', name: 'Normal', ru: 'Средние', aimError: 2.5, reaction: 0.35, fov: 120 },
  { id: 'hard', name: 'Hard', ru: 'Сложные', aimError: 1.1, reaction: 0.20, fov: 160 },
];

// ------------------------------------------------------------
//  Карта.  Каждая арена — компактная «крепость» двух баз.
//  Всё в метрах, +Z — в сторону базы BLU, −Z — в сторону базы RED.
// ------------------------------------------------------------
export const MAP_DEFS = {
  gorge: {
    id: 'gorge',
    name: 'Gorge',
    ru: 'Ущелье',
    desc: 'Открытая арена с мостом, центральной башней и двумя базами.',
    builder(makeBox, makeCap, makeSpawn) {
      makeBox(0, -1, 0, 80, 2, 80, 'ground');
      // центральная башня-мост
      makeBox(0, 4, 0, 10, 0.6, 10, 'floor');           // платформа
      for (const [x, z] of [[-4.4, -4.4], [4.4, -4.4], [-4.4, 4.4], [4.4, 4.4]]) {
        makeBox(x, 1.8, z, 0.8, 4.6, 0.8, 'wall');
      }
      makeBox(0, 6.4, 0, 10.5, 0.6, 10.5, 'floor');     // второй этаж
      makeBox(0, 12.2, 0, 1.2, 11, 1.2, 'wall');        // шпиль
      // пандусы к башне
      makeBox(0, 2.1, -7.4, 3.4, 0.5, 5.6, 'floor');
      makeBox(0, 2.1, 7.4, 3.4, 0.5, 5.6, 'floor');

      for (const s of [1, -1]) {
        const zb = s * 26; // база
        // главный корпус базы (с проёмом в центре)
        makeBox(-13, 3.5, zb + s * 1, 6, 7, 12, 'wall', 1);
        makeBox(13, 3.5, zb + s * 1, 6, 7, 12, 'wall', 1);
        makeBox(0, 6.6, zb + s * 1, 20, 0.7, 12, 'floor');  // крыша (доступна с земли сбоку)
        makeBox(0, 9, zb + s * 1, 20.5, 0.5, 12.5, 'floor'); // верх крыши
        // боковые башни
        makeBox(s * 21, 5, zb, 7, 10, 9, 'wall', 1);
        makeBox(s * 21, 10.5, zb, 7.5, 0.7, 9.5, 'floor');
        // укрытия и ящики
        makeBox(-16, 1.5, zb - s * 9, 4, 4, 4, 'wall', 1);
        makeBox(16, 1.5, zb - s * 9, 4, 4, 4, 'wall', 1);
        makeBox(0, 1.2, zb - s * 12, 3, 3.2, 3, 'wall', 1);
        makeBox(-6, 1.1, zb - s * 5, 2, 3, 2, 'wall', 1);
        makeBox(6, 1.1, zb - s * 5, 2, 3, 2, 'wall', 1);
        // бункер
        makeBox(0, 2.2, zb + s * 12, 12, 5, 8, 'wall', 1);
        makeBox(0, 4.9, zb + s * 12, 13, 0.6, 9, 'floor');
        // точка захвата
        makeCap(0, 0, zb - s * 6, s === 1 ? 'C' : 'A', s === 1 ? 'BLU' : 'RED');
        // точки спавна
        for (let i = -2; i <= 2; i++) {
          makeSpawn(i * 3.2, 0, zb + s * 5, s === 1 ? TEAM_BLU : TEAM_RED);
        }
        // лестницы на крышу
        makeBox(s * 8, 2.4, zb + s * 4, 2, 5.5, 2, 'wall', 1);
        makeBox(s * 11, 4.4, zb + s * 2, 2, 9.5, 2, 'wall', 1);
      }
    },
  },

  arena: {
    id: 'arena',
    name: 'Dustyard',
    ru: 'Двор',
    desc: 'Тесный симметричный двор: ящики, крыши, узкий мостик.',
    builder(makeBox, makeCap, makeSpawn) {
      makeBox(0, -1, 0, 56, 2, 64, 'ground');
      for (const s of [1, -1]) {
        const zb = s * 22;
        makeBox(-10, 3, zb, 12, 6, 6, 'wall', 1);
        makeBox(10, 3, zb, 12, 6, 6, 'wall', 1);
        makeBox(0, 5.4, zb, 14, 0.6, 7, 'floor');
        makeBox(s * 12, 8, zb + s * 4, 6, 16, 6, 'wall', 1);
        makeBox(-8, 1.5, zb - s * 6, 3, 3, 3, 'wall', 1);
        makeBox(8, 1.5, zb - s * 6, 3, 3, 3, 'wall', 1);
        makeCap(0, 0, zb - s * 5, s === 1 ? 'C' : 'A', s === 1 ? 'BLU' : 'RED');
        for (let i = -1; i <= 1; i++) makeSpawn(i * 4, 0, zb + s * 4, s === 1 ? TEAM_BLU : TEAM_RED);
      }
      makeBox(0, 3.2, 0, 4, 0.6, 20, 'floor'); // мост
      makeBox(-4.5, 1.6, 0, 1, 3.2, 20, 'wall', 1);
      makeBox(4.5, 1.6, 0, 1, 3.2, 20, 'wall', 1);
      for (const s of [1, -1]) {
        makeBox(s * 12, 1.5, 0, 5, 3, 5, 'wall', 1);
        makeBox(s * 12, 3.2, 0, 5.6, 0.6, 5.6, 'floor');
        makeBox(s * 5, 1.2, s * 10, 3, 2.4, 3, 'wall', 1);
      }
    },
  },
};
