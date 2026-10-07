// ============================================================
//  Fortress Arena — HUD (DOM): здоровье, патроны, точки, киллфид,
//  уведомления, таблица счёта, индикаторы способностей.
// ============================================================
import { CLASSES, MELEES, TEAM_INFO, TEAM_RED, TEAM_BLU, CFG } from './data.js';
import { currentWeapon } from './world.js';
import { clamp } from './physics.js';

const $ = (id) => document.getElementById(id);

const WEAPON_ICON = {
  scout: '🔫', soldier: '🚀', pyro: '🔥', demoman: '💣', heavy: '⚙️',
  engineer: '🔧', medic: '✚', sniper: '🎯', spy: '🗡️',
};

export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'),
      scoreRed: $('score-red'),
      scoreBlu: $('score-blu'),
      timer: $('timer'),
      capStatus: $('cap-status'),
      notify: $('notify'),
      killfeed: $('killfeed'),
      crosshair: $('crosshair'),
      hitmarker: $('hitmarker'),
      chargeWrap: $('charge-wrap'),
      chargeBar: $('charge-bar'),
      hp: $('hp'),
      hpFill: $('hp-fill'),
      healthPanel: $('health-panel'),
      classLabel: $('class-label'),
      healTarget: $('heal-target'),
      ammo: $('ammo'),
      ammoMax: $('ammo-max'),
      weaponName: $('weapon-name'),
      spinWrap: $('spin-wrap'),
      spinBar: $('spin-bar'),
      uberWrap: $('uber-wrap'),
      uberBar: $('uber-bar'),
      uberLabel: $('uber-label'),
      cloakWrap: $('cloak-wrap'),
      cloakBar: $('cloak-bar'),
      cloakLabel: $('cloak-label'),
      buildMenu: $('build-menu'),
      buildHint: $('build-hint'),
      vignette: $('vignette'),
      flash: $('flash'),
      damageDirs: $('damage-dirs'),
      scoreboard: $('scoreboard'),
      scoreboardTable: $('scoreboard-table'),
    };
    this.capChips = new Map();
    this.notifications = [];
    this.lastKillTime = 0;
    this.killSnapshot = [];
    this.damageAt = -99;
    this.hitmarkerAt = -99;
    this.lastLethal = 0;
  }

  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }

  notify(text, cls = '', ttl = 3.5) {
    this.notifications.push({ text, cls, ttl, born: performance.now() / 1000 });
    if (this.notifications.length > 4) this.notifications.shift();
  }

  hitmarker(crit = false) {
    this.el.hitmarker.classList.remove('show');
    void this.el.hitmarker.offsetWidth;
    this.el.hitmarker.classList.add('show');
  }

  damage(fromDir, amount) {
    const now = performance.now() / 1000;
    this.damageAt = now;
    const lvl = clamp(amount / 60, 0.15, 1);
    this.el.vignette.style.boxShadow = `inset 0 0 170px rgba(190,25,25,${0.55 * lvl})`;
    this.el.flash.style.background = `rgba(255,40,40,${0.16 * lvl})`;
    setTimeout(() => {
      this.el.vignette.style.boxShadow = 'inset 0 0 160px rgba(180,20,20,0)';
      this.el.flash.style.background = 'rgba(255,40,40,0)';
    }, 110);
    if (fromDir) {
      const angle = Math.atan2(fromDir.x, fromDir.z) * 180 / Math.PI;
      const div = document.createElement('div');
      div.className = 'dmg-arrow';
      div.style.transform = `translate(-50%, -50%) rotate(${angle}deg) translateY(-150px)`;
      this.el.damageDirs.appendChild(div);
      setTimeout(() => div.remove(), 1000);
    }
  }

  updateCaps(world) {
    for (const cap of world.caps) {
      let chip = this.capChips.get(cap.id);
      if (!chip) {
        const div = document.createElement('div');
        div.className = 'cap-chip';
        div.innerHTML = `<span>${cap.name}</span><div class="fill"></div>`;
        this.el.capStatus.appendChild(div);
        chip = { div, fill: div.querySelector('.fill') };
        this.capChips.set(cap.id, chip);
      }
      chip.div.className = 'cap-chip'
        + (cap.owner === TEAM_RED ? ' owned-red' : cap.owner === TEAM_BLU ? ' owned-blu' : '')
        + (cap.contested ? ' contested' : '');
      const team = cap.capTeam;
      chip.fill.className = 'fill' + (team === TEAM_BLU ? ' blu' : team === TEAM_RED ? ' red' : '');
      chip.fill.style.width = `${clamp(cap.progress / 14, 0, 1) * 100}%`;
      chip.fill.style.background = cap.contested ? '#ffd166' : (team === TEAM_BLU ? TEAM_INFO[1].light : TEAM_INFO[0].light);
    }
  }

  updateKillfeed(world, localId) {
    const now = world.time;
    const recent = world.killfeed.filter((k) => now - k.time < 7);
    const key = recent.map((k) => `${k.attacker}>${k.victim}`).join('|');
    if (key === this.killKey) return;
    this.killKey = key;
    this.el.killfeed.innerHTML = recent.slice(-6).map((k) => {
      const aTeam = k.attackerTeam === TEAM_BLU ? 'blu' : 'red';
      const vTeam = k.victimTeam === TEAM_BLU ? 'blu' : 'red';
      const wname = this.weaponRu(k.weapon);
      return `<div class="kf"><span class="${aTeam}">${escapeHtml(k.attacker)}</span>`
        + ` <span class="w">[${wname}]</span> `
        + `<span class="${vTeam}">${escapeHtml(k.victim)}</span></div>`;
    }).join('');
  }

  weaponRu(id) {
    const map = {
      explosion: 'взрыв', melee: 'ближний бой', backstab: 'в спину', fire: 'огонь',
      rocket: 'ракета', arrow: 'стрела', sniper: 'винтовка', sentry: 'турель',
      fall: 'падение', suicide: 'самоубийство', crossbow: 'арбалет', airblast: 'сжатый воздух',
      grenade: 'граната', sticky: 'липучка', bullet: 'пуля', scatter: 'дробь', shotgun: 'дробовик',
      minigun: 'пулемёт', revolver: 'револьвер', smg: 'ПП',
    };
    return map[id] || 'оружие';
  }

  update(world, local, dt) {
    // верхняя панель
    this.el.scoreRed.textContent = world.score[TEAM_RED];
    this.el.scoreBlu.textContent = world.score[TEAM_BLU];
    const t = Math.max(0, world.remaining);
    this.el.timer.textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    this.el.timer.style.color = t < 30 ? '#ff6a5e' : '';
    this.updateCaps(world);
    this.updateKillfeed(world, local ? local.id : -1);

    // уведомления
    const now = performance.now() / 1000;
    this.notifications = this.notifications.filter((n) => now - n.born < n.ttl);
    const html = this.notifications.map((n) => `<div class="item ${n.cls}">${escapeHtml(n.text)}</div>`).join('');
    if (html !== this.notifyHtml) { this.el.notify.innerHTML = html; this.notifyHtml = html; }

    if (!local) return;

    // здоровье
    const hp = Math.max(0, Math.round(local.hp));
    this.el.hp.textContent = hp;
    const hpFrac = clamp(local.hp / local.maxHp, 0, 1);
    this.el.hpFill.style.width = `${hpFrac * 100}%`;
    this.el.hpFill.style.background = local.hp > local.maxHp ? '#e8b558' : hpFrac < 0.35 ? '#e04b4b' : '#4fd06b';
    this.el.healthPanel.classList.toggle('hp-low', hpFrac < 0.3);
    this.el.classLabel.textContent = `${WEAPON_ICON[local.classId] || ''} ${CLASSES[local.classId].ru}`;

    // оружие
    const wep = currentWeapon(local);
    const isMelee = wep && wep.type === 'melee';
    const mag = wep && wep.magazine ? local.ammo[wep.id] ?? 0 : null;
    this.el.ammo.textContent = isMelee ? '∞' : mag !== null ? Math.floor(mag) : '∞';
    this.el.ammoMax.textContent = isMelee || mag === null ? '' : `/${wep.magazine}`;
    let wname = '';
    if (wep) {
      if (wep.id === 'medigun') wname = 'Медган';
      else if (wep.id === 'stickybomb') wname = 'Липкие бомбы';
      else wname = wep.ru || wep.name;
    }
    this.el.weaponName.textContent = wname;
    if (local.reload) this.el.ammo.style.color = '#e8b558';
    else this.el.ammo.style.color = '';

    // разброс прицела
    const speed = Math.hypot(local.vel.x, local.vel.z);
    let spread = wep && wep.baseSpread ? wep.baseSpread : (wep && wep.spread ? wep.spread : 0.01);
    if (wep && wep.ramp) {
      const r = local.ramp[wep.id] || 0;
      spread *= 1 - Math.min(1, r / wep.ramp.max) * 0.8;
    }
    spread += speed * 0.004 + (local.onGround ? 0 : 0.02);
    this.el.crosshair.style.transform = `scale(${clamp(0.8 + spread * 22, 0.8, 2.6)})`;
    this.el.crosshair.classList.toggle('zoom', !!local.zoom);

    // заряд снайпера
    const charging = local.charge && wep && wep.chargeTime !== undefined;
    this.el.chargeWrap.classList.toggle('on', !!charging);
    this.el.chargeBar.style.width = `${charging ? local.charge.value * 100 : 0}%`;

    // раскрутка пулемёта
    const spinning = wep && wep.spinUpTime;
    this.el.spinWrap.classList.toggle('on', !!spinning);
    this.el.spinBar.style.width = `${local.spin * 100}%`;

    // способности
    const showUber = local.classId === 'medic';
    const showCloak = local.classId === 'spy';
    this.el.uberWrap.style.display = showUber ? '' : 'none';
    this.el.cloakWrap.style.display = showCloak ? '' : 'none';
    if (showUber) {
      this.el.uberBar.style.width = `${local.uber * 100}%`;
      this.el.uberWrap.classList.toggle('full', local.uber >= 1);
      this.el.uberLabel.textContent = local.uberActiveUntil > world.time ? 'УБЕР АКТИВЕН' : local.uber >= 1 ? 'УБЕР ГОТОВ (E)' : `УБЕР ${Math.floor(local.uber * 100)}%`;
    }
    if (showCloak) {
      this.el.cloakBar.style.width = `${local.cloak.amount * 100}%`;
      this.el.cloakWrap.classList.toggle('full', local.cloak.amount > 0.99);
      this.el.cloakLabel.textContent = local.cloak.active ? 'НЕВИДИМОСТЬ (C)' : local.disguised ? `МАСКИРОВКА: ${CLASSES[local.disguised.classId].ru}` : 'НЕВИДИМОСТЬ (C)';
    }
    // лечение цели
    const target = local.healTargetId ? world.getPlayer(local.healTargetId) : null;
    this.el.healTarget.textContent = target ? `→ ${target.name} ${Math.round(target.hp)} HP` : '';

    // постройки инженера
    if (local.classId === 'engineer') {
      this.el.buildMenu.style.display = '';
      this.updateBuildMenu(world, local);
    } else {
      this.el.buildMenu.style.display = 'none';
    }
    this.el.buildHint.classList.toggle('hidden', !(local.build && local.build.pending));

    // смерть
    if (!local.alive) {
      this.el.crosshair.style.opacity = '0';
    } else {
      this.el.crosshair.style.opacity = '';
    }
  }

  updateBuildMenu(world, local) {
    const defs = CLASSES.engineer.builds;
    let html = '';
    for (let i = 0; i < defs.length; i++) {
      const def = defs[i];
      const built = world.buildings.find((b) => b.ownerId === local.id && b.kind === def.id);
      const cd = (local.build.cooldowns[def.id] || 0) - world.time;
      const cls = built ? 'build-slot' : cd > 0 ? 'build-slot' : 'build-slot ready';
      const status = built ? `ур. ${built.level} · ${Math.round(built.hp)}` : cd > 0 ? `${cd.toFixed(0)} c` : 'готово';
      html += `<div class="${cls}"><b>${i + 4}</b>${def.ru}<br>${status}</div>`;
    }
    if (html !== this.buildHtml) { this.el.buildMenu.innerHTML = html; this.buildHtml = html; }
  }

  showScoreboard(world, localId) {
    this.el.scoreboardTable.innerHTML = this.boardHtml(world, localId);
    this.el.scoreboard.classList.remove('hidden');
  }

  hideScoreboard() { this.el.scoreboard.classList.add('hidden'); }

  boardHtml(world, localId) {
    const rows = [...world.players].sort((a, b) => b.points - a.points);
    let html = '<thead><tr><th>Игрок</th><th>Класс</th><th>У</th><th>С</th><th>Очки</th></tr></thead><tbody>';
    for (const p of rows) {
      const teamCls = p.team === TEAM_BLU ? 'team-blu' : 'team-red';
      const nameCls = p.team === TEAM_BLU ? 'name-blu' : 'name-red';
      html += `<tr class="${teamCls}${p.id === localId ? ' me' : ''}">`
        + `<td class="${nameCls}">${escapeHtml(p.name)}${p.isBot ? ' <small>(бот)</small>' : ''}</td>`
        + `<td>${CLASSES[p.classId].ru}</td><td>${p.kills}</td><td>${p.deaths}</td><td>${p.points}</td></tr>`;
    }
    return html + '</tbody>';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
