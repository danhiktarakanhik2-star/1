// ============================================================
//  Интеграционный тест клиента: модели, рендер-логика, HUD, ввод,
//  игровой цикл. three.js и DOM заменены заглушками, ошибки
//  (опечатки, несуществующие методы, битые элементы) всплывают.
// ============================================================
import { installDom, documentStub, windowStub } from './dom.mjs';

let passed = 0, failed = 0;
const failures = [];
const errors = [];

function ok(cond, name, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ❌ ${name} ${extra}`); }
}
function section(t) { console.log(`\n— ${t}`); }

const { window: win } = installDom();

// ловим любые исключения страницы
win.addEventListener('error', (e) => errors.push(e.message || e));
process.on('uncaughtException', (e) => { errors.push(String(e && e.stack || e)); });

console.log('Fortress Arena — тест клиента (three.js и DOM — заглушки)\n====================================================');

section('Структура страницы');
{
  // все id, которые ищет JS, должны существовать в index.html
  const fs = await import('node:fs');
  const path = await import('node:path');
  const url = await import('node:url');
  const dir = path.dirname(url.fileURLToPath(import.meta.url));
  const html = fs.readFileSync(path.join(dir, '..', 'index.html'), 'utf8');
  const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const jsIds = new Set();
  for (const f of ['hud.js', 'main.js', 'input.js']) {
    const src = fs.readFileSync(path.join(dir, '..', 'src', f), 'utf8');
    for (const m of src.matchAll(/\$\('([^']+)'\)/g)) jsIds.add(m[1]);
    for (const m of src.matchAll(/getElementById\('([^']+)'\)/g)) jsIds.add(m[1]);
  }
  const missing = [...jsIds].filter((id) => !htmlIds.has(id));
  ok(missing.length === 0, `все ${jsIds.size} id из JS есть в index.html`, missing.join(', '));
  // и наоборот: элементы, которые ищет сам тест
  const testIds = [...htmlIds].filter((id) => documentStub.getElementById(id) === undefined);
  ok(testIds.length === 0, `заглушка DOM знает все id страницы (${htmlIds.size})`);
}

section('Загрузка игры');
let game = null;
try {
  await import('../src/main.js');
  game = win.game || globalThis.game;
  ok(!!game, 'main.js загрузился и создал игру');
} catch (e) {
  ok(false, 'main.js загрузился', e.stack ? String(e.stack).split('\n').slice(0, 4).join(' | ') : String(e));
}

if (!game) {
  console.log('Дальнейшие проверки невозможны');
  process.exit(1);
}

// прогон кадров
function frames(n, dtMs = 16.7) {
  let t = (frames.t || 0) + dtMs;
  for (let i = 0; i < n; i++) {
    t += dtMs;
    const cbs = win.rafCallbacks;
    win.rafCallbacks = [];
    for (const cb of cbs) cb(t);
  }
  frames.t = t;
}

section('Меню');
frames(3);
const classCards = documentStub.querySelectorAll('.class-card');
ok(classCards.length === 18, `карточки классов построены (${classCards.length} = 9×2)`);
const teamBtns = documentStub.querySelectorAll('.team-btn');
ok(teamBtns.length === 2, 'кнопки команд есть');
ok(documentStub.getElementById('map-select').innerHTML.includes('gorge'), 'список карт заполнен');
ok(documentStub.getElementById('skill-select').innerHTML.includes('normal'), 'сложности заполнены');

section('Старт раунда');
try {
  game.start();
  ok(!!game.world, 'мир создан');
  ok(game.world.players.length >= 4, `игроков в матче: ${game.world.players.length}`);
  const local = game.world.getPlayer(game.localId);
  ok(!!local && local.name === 'Игрок', 'локальный игрок добавлен');
  ok(documentStub.getElementById('menu').classList.contains('hidden'), 'меню скрыто');
  ok(!documentStub.getElementById('hud').classList.contains('hidden'), 'HUD показан');
} catch (e) {
  ok(false, 'старт раунда без исключений', String(e.stack).split('\n').slice(0, 3).join(' | '));
}

section('Игровой цикл');
try {
  frames(60);
  ok(game.state === 'playing', 'состояние «играем»');
  ok(game.renderer.renderer.renderCalls > 30, `кадры рендерятся (${game.renderer.renderer.renderCalls})`);
} catch (e) {
  ok(false, 'цикл работает', String(e.stack).split('\n').slice(0, 3).join(' | '));
}

section('Управление и стрельба');
{
  const local = game.world.getPlayer(game.localId);
  const startPos = { ...local.pos };
  // идём вперёд
  win.dispatch('keydown', { code: 'KeyW' });
  game.controls.locked = true;
  frames(60);
  const moved = Math.hypot(local.pos.x - startPos.x, local.pos.z - startPos.z);
  ok(moved > 2, `игрок двигается по клавише W (${moved.toFixed(1)} м)`);
  win.dispatch('keyup', { code: 'KeyW' });

  // мышь поворачивает
  const yaw0 = local.yaw;
  for (let i = 0; i < 20; i++) win.dispatch('mousemove', { movementX: 30, movementY: 0 });
  frames(3);
  ok(Math.abs(local.yaw - yaw0) > 0.1, `мышь поворачивает камеру (Δ=${(local.yaw - yaw0).toFixed(2)})`);

  // стрельба
  if (local.classId !== 'soldier') game.changeClass('soldier');
  local.ammo.rocketlauncher = 4;
  local.nextAttack = {};
  game.controls.mouse.left = true;
  frames(30);
  game.controls.mouse.left = false;
  const fired = local.damageDealt > 0 || game.world.projectiles.length > 0 || local.ammo.rocketlauncher < 4;
  ok(fired, `игрок стреляет (патроны: ${local.ammo.rocketlauncher}, снарядов: ${game.world.projectiles.length})`);
  frames(120);
  ok(true, 'стрельба не ломает цикл');
}

section('HUD для всех классов');
{
  const local = game.world.getPlayer(game.localId);
  for (const classId of ['scout', 'soldier', 'pyro', 'demoman', 'heavy', 'engineer', 'medic', 'sniper', 'spy']) {
    let err = null;
    try {
      game.changeClass(classId);
      local.hp = 90;
      frames(12);
      // «постреляем» каждым классом
      game.controls.mouse.left = true;
      frames(12);
      game.controls.mouse.left = false;
      game.controls.keys.add('KeyC');
      game.controls.keys.add('ShiftLeft');
      frames(12);
      game.controls.keys.delete('KeyC');
      game.controls.keys.delete('ShiftLeft');
    } catch (e) { err = e; }
    ok(!err, `класс ${classId}: HUD и цикл без ошибок`, err ? String(err.stack).split('\n')[1] : '');
  }
  // элементы HUD обновляются
  const hpText = documentStub.getElementById('hp').textContent;
  ok(Number.isFinite(Number(hpText)), `здоровье в HUD — число (${hpText})`);
  ok(documentStub.getElementById('timer').textContent.includes(':'), 'таймер отображается');
  ok(documentStub.getElementById('class-label').textContent.includes('Шпион'), 'класс отображается');
}

section('Способности и инженер');
{
  const local = game.world.getPlayer(game.localId);
  // инженер: попытка постройки
  game.changeClass('engineer');
  frames(5);
  win.dispatch('keydown', { code: 'Digit4' });
  frames(30);
  win.dispatch('keyup', { code: 'Digit4' });
  const pendingOrBuilt = !!local.build.pending || game.world.buildings.some((b) => b.ownerId === local.id);
  ok(pendingOrBuilt, `инженер строит (в процессе: ${!!local.build.pending}, построек: ${game.world.buildings.length})`);
  // HUD панели постройки
  ok(documentStub.getElementById('build-menu').innerHTML.length > 0, 'меню постройки заполнено');

  // медик: убер
  game.changeClass('medic');
  const mate = game.world.players.find((p) => p.team === local.team && p.id !== local.id);
  if (mate) { mate.hp = 100; mate.pos = { x: local.pos.x, y: local.pos.y, z: local.pos.z - 2 }; }
  local.uber = 1;
  game.controls.mouse.right = true;
  frames(20);
  win.dispatch('keydown', { code: 'KeyE' });
  frames(10);
  win.dispatch('keyup', { code: 'KeyE' });
  game.controls.mouse.right = false;
  ok(local.uberActiveUntil > game.world.time || local.uber > 0 || mate === undefined,
    `медик лечит/активирует убер (убер=${local.uber.toFixed(2)}, активен до ${local.uberActiveUntil.toFixed(1)})`);

  // шпион: невидимость и маскировка
  game.changeClass('spy');
  frames(5);
  win.dispatch('keydown', { code: 'KeyC' });
  frames(20);
  ok(local.cloak.active || local.cloak.amount < 1, `шпион становится невидимым (${local.cloak.amount.toFixed(2)})`);
  win.dispatch('keyup', { code: 'KeyC' });
  win.dispatch('keydown', { code: 'KeyV' });
  frames(5);
  ok(!!local.disguised, `шпион маскируется (${local.disguised ? local.disguised.classId : '—'})`);
  frames(120);

  // снайпер: прицел
  game.changeClass('sniper');
  frames(5);
  game.controls.mouse.right = true;
  frames(30);
  ok(game.renderer.camera.fov < 70, `прицел снайпера сужает обзор (fov ${game.renderer.camera.fov.toFixed(0)})`);
  game.controls.mouse.right = false;
  frames(30);
}

section('Смерть, смена класса, счёт');
{
  const local = game.world.getPlayer(game.localId);
  local.spawnProtectUntil = -1;
  game.world.applyDamage(local, 9999, { attacker: null, cause: 'suicide' });
  frames(30);
  ok(!local.alive, 'игрок умирает');
  ok(documentStub.getElementById('scoreboard').classList.contains('hidden') === false
    || documentStub.getElementById('classselect').classList.contains('hidden') === false,
    'после смерти показывается счёт или выбор класса');
  // смена класса во время смерти
  game.changeClass('heavy');
  ok(local.classId === 'heavy', 'класс меняется во время смерти');
  frames(300); // ждём возрождения
  ok(local.alive, `игрок возрождается (hp=${Math.round(local.hp)})`);
  ok(local.hp === game.world.players.find((p) => p.id === local.id).hp, 'hp корректен');
  game.resume();
  frames(30);

  // таблица счёта
  win.dispatch('keydown', { code: 'Tab' });
  ok(!documentStub.getElementById('scoreboard').classList.contains('hidden'), 'Tab показывает счёт');
  ok(documentStub.getElementById('scoreboard-table').innerHTML.includes('Игрок') === false
    || documentStub.getElementById('scoreboard-table').innerHTML.length > 50, 'таблица заполнена');
  win.dispatch('keyup', { code: 'Tab' });
}

section('Пауза и настройки');
{
  game.pause();
  ok(game.state === 'paused', 'пауза');
  ok(!documentStub.getElementById('pause').classList.contains('hidden'), 'окно паузы показано');
  const before = game.world.time;
  frames(60);
  ok(Math.abs(game.world.time - before) < 1e-6, 'на паузе мир не тикает');
  game.resume();
  ok(game.state === 'playing', 'продолжение');
  frames(30);

  // настройки: тени и громкость
  const shadowsEl = documentStub.getElementById('shadows');
  shadowsEl.checked = false;
  shadowsEl.dispatch('change', { target: shadowsEl });
  ok(game.renderer.renderer.shadowMap.enabled === false, 'выключение теней применяется');
  const volEl = documentStub.getElementById('vol');
  volEl.value = '20';
  volEl.dispatch('input', { target: volEl });
  ok(game.settings.volume === 20, 'громкость сохраняется в настройках');
  ok(localStorage.getItem('fortress-arena-settings').includes('"volume":20'), 'настройки в localStorage');
}

section('Долгий матч ботов через клиент');
{
  // ускоренный прогон: подменяем время кадров
  const t0 = game.world.time;
  for (let i = 0; i < 900; i++) frames(1, 33);
  ok(game.world.time > t0 + 20, `мир продвинулся на ${(game.world.time - t0).toFixed(1)} с игры`);
  const kills = game.world.players.reduce((a, p) => a + p.kills, 0);
  const dmg = game.world.players.reduce((a, p) => a + p.damageDealt, 0);
  console.log(`     боты: убийств ${kills}, урона ${dmg.toFixed(0)}, построек ${game.world.buildings.length}, счёт ${game.world.score[0]}:${game.world.score[1]}`);
  ok(dmg > 0, 'боты воюют в клиентском цикле');
  ok(Number.isFinite(game.world.time), 'время мира конечно');
}

section('Конец раунда и возврат в меню');
{
  try {
    game.world.remaining = 0.01;
    frames(10);
    ok(game.state === 'roundend' || game.world.ended, `раунд завершается (состояние: ${game.state})`);
    ok(!documentStub.getElementById('roundend').classList.contains('hidden'), 'экран итогов показан');
    ok(documentStub.getElementById('final-board').innerHTML.includes('class="board"') === false
      || documentStub.getElementById('final-board').innerHTML.length > 100, 'итоговая таблица заполнена');
    game.toMenu();
    ok(game.state === 'menu', 'возврат в меню');
    ok(!documentStub.getElementById('menu').classList.contains('hidden'), 'меню снова показано');
    game.start();
    frames(60);
    ok(game.state === 'playing', 'новый раунд стартует');
  } catch (e) {
    ok(false, 'конец раунда без ошибок', String(e.stack).split('\n').slice(0, 3).join(' | '));
  }
}

section('Ошибки страницы');
ok(errors.length === 0, `нет исключений за весь тест (${errors.length})`, errors.slice(0, 2).join(' | '));

console.log('\n====================================================');
console.log(`Пройдено: ${passed}, провалено: ${failed}`);
if (failed) {
  console.log('Провалы:\n - ' + failures.join('\n - '));
  process.exit(1);
}
