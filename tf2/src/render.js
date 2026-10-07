// ============================================================
//  Fortress Arena — рендер (three.js).
//  Сцена, постройка уровня, модели бойцов, снаряды, постройки,
//  партиклы-эффекты и камера от первого лица.
// ============================================================
import * as THREE from 'three';
import { CFG, TEAM_INFO, TEAM_RED, TEAM_BLU, CLASSES } from './data.js';
import {
  makeCharacter, makeProjectile, makeBuilding, makeCapPoint, makeViewModel,
  makeTextSprite, mat, teamColor, PALETTE,
} from './models.js';
import { eyePos, currentWeapon } from './world.js';

// ------------------------------------------------------------
//  Процедурные текстуры для частиц
// ------------------------------------------------------------
function makeGlowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grd = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSmokeTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grd = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(220,220,220,0.85)');
  grd.addColorStop(0.6, 'rgba(150,150,150,0.35)');
  grd.addColorStop(1, 'rgba(120,120,120,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance', stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.skyColor = new THREE.Color(0x8fb2d4);
    this.scene.background = this.skyColor;
    this.scene.fog = new THREE.Fog(this.skyColor, 80, 260);

    this.camera = new THREE.PerspectiveCamera(78, 1, 0.05, 700);
    this.camera.rotation.order = 'YXZ';

    // Свет
    this.hemi = new THREE.HemisphereLight(0xdff0ff, 0x5b5343, 1.15);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0cf, 1.9);
    this.sun.position.set(40, 70, 25);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 220;
    this.sun.shadow.bias = -0.0009;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    // мягкая засветка теневых сторон, чтобы картинка не была чёрной
    this.ambient = new THREE.AmbientLight(0xffffff, 0.28);
    this.scene.add(this.ambient);

    this.levelGroup = new THREE.Group();
    this.scene.add(this.levelGroup);
    this.fxGroup = new THREE.Group();
    this.scene.add(this.fxGroup);

    this.playerViews = new Map();
    this.projectileViews = new Map();
    this.buildingViews = new Map();
    this.stuck = new Map();      // воткнувшиеся стрелы/ракеты (декор)
    this.fx = [];
    this.texGlow = makeGlowTexture();
    this.texWarm = makeGlowTexture('rgba(255,220,150,1)', 'rgba(255,120,0,0)');
    this.texSmoke = makeSmokeTexture();

    this.viewModelHolder = new THREE.Group();
    this.camera.add(this.viewModelHolder);
    this.scene.add(this.camera);
    this.viewModel = null;
    this.viewModelClass = null;
    this.recoil = 0;
    this.bobPhase = 0;
    this.cameraShake = 0;
    this.zoomT = 0;
    this.fov = 78;

    this.capViews = [];
    this.arenaBounds = null;
    this.maxParticles = 420;
    this.particleCount = 0;
  }

  setQuality({ shadows = true, pixelRatio = null } = {}) {
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    if (pixelRatio) this.renderer.setPixelRatio(pixelRatio);
    this.scene.traverse((o) => { if (o.isMesh) o.material.needsUpdate = true; });
  }

  resize(w, h) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  // ----------------------------------------------------------
  //  Уровень
  // ----------------------------------------------------------
  buildLevel(map) {
    this.levelGroup.clear();
    this.capViews = [];
    this.playerViews.clear();
    this.projectileViews.clear();
    this.buildingViews.clear();
    for (const f of this.fx) this.fxGroup.remove(f.obj);
    this.fx = [];

    const mats = {
      ground: mat(0x585144),
      wall: mat(0x8d8577),
      floor: mat(0x767b83),
    };
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x2c2f35, transparent: true, opacity: 0.35 });

    for (const b of map.boxes) {
      const geo = new THREE.BoxGeometry(b.size.x, b.size.y, b.size.z);
      const mesh = new THREE.Mesh(geo, mats[b.kind] || mats.wall);
      mesh.position.set(b.center.x, b.center.y, b.center.z);
      mesh.castShadow = b.kind !== 'ground';
      mesh.receiveShadow = true;
      this.levelGroup.add(mesh);
      if (b.kind !== 'ground' && b.size.y > 0.3) {
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
        edges.position.copy(mesh.position);
        this.levelGroup.add(edges);
      }
    }

    // «земля» за пределами арены
    const far = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), mat(0x4e5a45));
    far.rotation.x = -Math.PI / 2;
    far.position.y = -0.05;
    far.receiveShadow = true;
    this.levelGroup.add(far);

    // ограждение по периметру арены
    const bnd = map.bounds || { minX: -42, maxX: 42, minZ: -42, maxZ: 42 };
    const bound = { minX: -42, maxX: 42, minZ: -42, maxZ: 42 };
    const fenceH = 2.4;
    const fenceMat = mat(0x6d6357);
    const addFence = (x, z, w, d) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, fenceH, d), fenceMat);
      m.position.set(x, fenceH / 2 - 0.05, z);
      m.castShadow = true;
      this.levelGroup.add(m);
    };
    addFence(0, bound.minZ, (bound.maxX - bound.minX) + 1, 0.6);
    addFence(0, bound.maxZ, (bound.maxX - bound.minX) + 1, 0.6);
    addFence(bound.minX, 0, 0.6, (bound.maxZ - bound.minZ) + 1);
    addFence(bound.maxX, 0, 0.6, (bound.maxZ - bound.minZ) + 1);
    this.arenaBounds = bound;

    // точки захвата
    for (const cap of map.caps) {
      const view = makeCapPoint(cap);
      this.levelGroup.add(view.group);
      this.capViews.push({ cap, view, owner: null });
    }

    // базовые телепорты-площадки команд
    this.basePadViews = [];
    for (const step of [-1, 1]) {
      const team = step === 1 ? TEAM_BLU : TEAM_RED;
      const spawns = map.spawns.filter((s) => s.team === team);
      if (!spawns.length) continue;
      const cx = spawns.reduce((a, s) => a + s.pos.x, 0) / spawns.length;
      const cz = spawns.reduce((a, s) => a + s.pos.z, 0) / spawns.length;
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.16, 2.2), mat(0x54585f));
      base.position.y = 0.08;
      base.receiveShadow = true;
      g.add(base);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.85, 0.09, 8, 22),
        mat(teamColor(team))
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.45;
      g.add(ring);
      const label = makeTextSprite(team === TEAM_BLU ? 'BLU' : 'RED', team === TEAM_BLU ? '#8ecbff' : '#ff9188');
      label.scale.set(2.4, 1.2, 1);
      label.position.y = 1.6;
      g.add(label);
      g.position.set(cx, 0, cz);
      this.levelGroup.add(g);
      this.basePadViews.push({ group: g, ring, team });
    }
  }

  // ----------------------------------------------------------
  //  Бойцы
  // ----------------------------------------------------------
  syncPlayers(world, localId, dt) {
    const alive = new Set();
    for (const p of world.players) {
      if (p.id === localId) { alive.add(p.id); continue; }
      if (!p.alive) { this.hidePlayer(p.id); continue; }
      alive.add(p.id);

      const disguise = p.disguised;
      const viewTeam = disguise ? disguise.team : p.team;
      const viewClass = disguise ? disguise.classId : p.classId;
      const key = `${viewClass}|${viewTeam}|${p.id}`;

      let v = this.playerViews.get(p.id);
      if (v && v.key !== key) { this.disposeView(this.playerViews, p.id); v = null; }
      if (!v) {
        const built = makeCharacter(viewClass, viewTeam);
        // свои материалы, чтобы можно было делать невидимость/подсветку
        built.group.traverse((o) => {
          if (o.isMesh && o.material) {
            o.material = o.material.clone();
            o.material.transparent = true;
            o.material.opacity = 1;
          }
        });
        this.scene.add(built.group);
        v = {
          key, group: built.group, anim: built.anim, phase: 0,
          speedSmooth: 0, lastPos: { ...p.pos },
        };
        this.playerViews.set(p.id, v);
      }

      const speed = Math.hypot(p.vel.x, p.vel.z);
      v.speedSmooth = v.speedSmooth * 0.85 + speed * 0.15;
      v.phase += dt * (2.2 + v.speedSmooth * 1.5) * (v.anim.look.speed || 1);

      // позиция и поворот
      const crouchOffset = p.crouch ? -0.45 : 0;
      v.group.position.set(p.pos.x, p.pos.y + crouchOffset, p.pos.z);
      v.group.rotation.y = p.yaw + Math.PI;

      // анимация
      const walkAmp = Math.min(1, v.speedSmooth / 4.5);
      const sw = Math.sin(v.phase) * 0.7 * walkAmp;
      v.anim.legL.rotation.x = sw;
      v.anim.legR.rotation.x = -sw;
      v.anim.armL.rotation.x = -sw * 0.7;
      v.anim.armR.rotation.x = sw * 0.4 - (p.zoom ? 0.2 : 0);
      v.anim.head.rotation.x = Math.max(-0.6, Math.min(0.6, -p.pitch * 0.6));
      v.anim.head.rotation.y = 0;
      if (p.spin > 0.05 && p.classId === 'heavy') {
        v.anim.weapon.rotation.z -= dt * 22 * p.spin;
      }
      // невидимость шпиона
      const alpha = p.cloak && p.cloak.active ? Math.max(0.06, p.cloak.alpha) : (p.cloak ? p.cloak.alpha : 1);
      const isCloaked = alpha < 0.92;
      v.group.visible = alpha > 0.03 && !(p.cloak && p.cloak.alpha < 0.03);
      if (isCloaked) {
        v.group.traverse((o) => {
          if (o.isMesh && o.material) { o.material.opacity = alpha * 0.9; }
        });
      } else if (v.wasCloaked) {
        v.group.traverse((o) => { if (o.isMesh && o.material) o.material.opacity = 1; });
      }
      v.wasCloaked = isCloaked;

      // мигание при спавн-защите/убере
      const invuln = p.uberActiveUntil > world.time || p.spawnProtectUntil > world.time;
      if (invuln) {
        const t = Math.sin(world.time * 18) * 0.5 + 0.5;
        v.group.visible = t > 0.25;
      } else if (!isCloaked) {
        v.group.visible = true;
      }
    }

    // убираем модели умерших/вышедших
    for (const id of [...this.playerViews.keys()]) {
      if (!alive.has(id)) this.hidePlayer(id);
    }
  }

  hidePlayer(id) {
    const v = this.playerViews.get(id);
    if (v) v.group.visible = false;
  }

  disposeView(map, id) {
    const v = map.get(id);
    if (!v) return;
    this.scene.remove(v.obj || v.group);
    map.delete(id);
  }

  // ----------------------------------------------------------
  //  Снаряды
  // ----------------------------------------------------------
  syncProjectiles(world) {
    const seen = new Set();
    for (const pr of world.projectiles) {
      seen.add(pr.id);
      let v = this.projectileViews.get(pr.id);
      if (!v) {
        const group = makeProjectile(pr.kind, pr.team);
        this.scene.add(group);
        v = { group, kind: pr.kind };
        this.projectileViews.set(pr.id, v);
      }
      v.group.position.set(pr.pos.x, pr.pos.y, pr.pos.z);
      const speed = Math.hypot(pr.vel.x, pr.vel.y, pr.vel.z);
      if (speed > 0.5) {
        const look = new THREE.Vector3(pr.vel.x, pr.vel.y, pr.vel.z).normalize();
        // для обычных объектов lookAt разворачивает ось +Z на цель —
        // у моделей снарядов нос/остриё как раз на +Z
        v.group.lookAt(pr.pos.x + look.x, pr.pos.y + look.y, pr.pos.z + look.z);
      }
    }
    for (const id of [...this.projectileViews.keys()]) {
      if (!seen.has(id)) {
        const v = this.projectileViews.get(id);
        this.scene.remove(v.group);
        this.projectileViews.delete(id);
      }
    }
  }

  // ----------------------------------------------------------
  //  Постройки
  // ----------------------------------------------------------
  syncBuildings(world, dt) {
    const seen = new Set();
    for (const b of world.buildings) {
      seen.add(b.id);
      let v = this.buildingViews.get(b.id);
      if (!v || v.kind !== b.kind) {
        if (v) { this.scene.remove(v.group); this.buildingViews.delete(b.id); }
        const group = makeBuilding(b.kind, b.team);
        group.position.set(b.pos.x, b.pos.y, b.pos.z);
        this.scene.add(group);
        v = { group, kind: b.kind, level: b.level, born: world.time };
        this.buildingViews.set(b.id, v);
      }
      v.group.position.set(b.pos.x, b.pos.y, b.pos.z);
      v.group.rotation.y = (b.yaw || 0) + Math.PI;
      if (b.kind === 'sentry') {
        const head = v.group.userData.head;
        if (head) head.rotation.y = 0;
        if (b.level !== v.level) {
          v.level = b.level;
          const lamps = v.group.userData.lamps;
          if (lamps) lamps.children.forEach((l, i) => { l.visible = i < b.level; });
        }
      }
      if (b.kind === 'teleporter' && v.group.userData.spin) {
        v.group.userData.spin.rotation.z += dt * 1.6;
      }
      // постройка «растёт» первые полсекунды
      const age = world.time - b.builtAt;
      const scale = Math.min(1, 0.35 + age * 1.6);
      v.group.scale.setScalar(scale);
    }
    for (const id of [...this.buildingViews.keys()]) {
      if (!seen.has(id)) {
        const v = this.buildingViews.get(id);
        this.scene.remove(v.group);
        this.buildingViews.delete(id);
      }
    }
  }

  // ----------------------------------------------------------
  //  Точки захвата
  // ----------------------------------------------------------
  syncCaps(world) {
    for (const cv of this.capViews) {
      const cap = world.caps.find((c) => c.id === cv.cap.id);
      if (!cap) continue;
      const ownerColor = cap.owner === null ? 0xdedede : teamColor(cap.owner);
      cv.view.ring.material.color.setHex(ownerColor);
      cv.view.flag.material.color.setHex(ownerColor);
      const capturing = cap.capTeam !== null && cap.capTeam !== cap.owner;
      if (capturing) {
        const c = teamColor(cap.capTeam);
        cv.view.zone.material.color.setHex(c);
        cv.view.zone.material.opacity = 0.10 + 0.10 * Math.abs(Math.sin(world.time * 4));
      } else if (cap.contested) {
        cv.view.zone.material.color.setHex(0xffe066);
        cv.view.zone.material.opacity = 0.16;
      } else {
        cv.view.zone.material.color.setHex(ownerColor);
        cv.view.zone.material.opacity = 0.06;
      }
      cv.view.ring.scale.setScalar(1 + (cap.progress / 14) * 0.12);
      cv.view.label.position.y = 3.9 + Math.sin(world.time * 2 + cap.pos.x) * 0.08;
    }
  }

  // ----------------------------------------------------------
  //  Эффекты (партиклы, вспышки, трассеры)
  // ----------------------------------------------------------
  spawnParticles(pos, opts = {}) {
    const count = opts.count ?? 6;
    if (this.particleCount > this.maxParticles) return;
    const tex = opts.texture || this.texGlow;
    for (let i = 0; i < count; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, color: opts.color ?? 0xffffff, transparent: true,
        opacity: opts.opacity ?? 1, depthWrite: false,
        blending: opts.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
      }));
      const size = (opts.size ?? 0.3) * (0.6 + Math.random() * 0.8);
      sprite.scale.set(size, size, size);
      sprite.position.set(pos.x, pos.y, pos.z);
      const sp = opts.speed ?? 1;
      const dir = opts.dir;
      const vx = dir ? dir.x * sp + (Math.random() - 0.5) * sp : (Math.random() - 0.5) * sp;
      const vy = dir ? dir.y * sp + (Math.random() - 0.5) * sp : (Math.random() - 0.5) * sp + (opts.up ?? 0);
      const vz = dir ? dir.z * sp + (Math.random() - 0.5) * sp : (Math.random() - 0.5) * sp;
      this.fxGroup.add(sprite);
      this.particleCount++;
      this.fx.push({
        obj: sprite, ttl: opts.ttl ?? 0.5, maxTtl: opts.ttl ?? 0.5,
        vel: { x: vx, y: vy, z: vz },
        gravity: opts.gravity ?? 0,
        grow: opts.grow ?? 0,
        initialOpacity: opts.opacity ?? 1,
        kind: 'particle',
      });
    }
  }

  applyEffects(effects, world) {
    for (const e of effects) {
      switch (e.kind) {
        case 'muzzle': {
          const dir = e.dir || { x: 0, y: 0, z: 0 };
          this.spawnParticles({ x: e.pos.x + dir.x * 0.6, y: e.pos.y + dir.y * 0.6, z: e.pos.z + dir.z * 0.6 }, {
            count: e.big ? 8 : 4, color: 0xffd27a, ttl: 0.12, size: e.big ? 0.6 : 0.32,
            speed: 2.5, dir, texture: this.texWarm, gravity: 1,
          });
          break;
        }
        case 'tracer': {
          const geo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(e.from.x, e.from.y, e.from.z),
            new THREE.Vector3(e.to.x, e.to.y, e.to.z),
          ]);
          const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
            color: 0xfff0b0, transparent: true, opacity: 0.85,
            blending: THREE.AdditiveBlending, depthWrite: false,
          }));
          this.fxGroup.add(line);
          this.fx.push({ obj: line, ttl: 0.07, maxTtl: 0.07, kind: 'fade' });
          break;
        }
        case 'sentryShot': {
          const geo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(e.from.x, e.from.y, e.from.z),
            new THREE.Vector3(e.to.x, e.to.y, e.to.z),
          ]);
          const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
            color: 0xffe08a, transparent: true, opacity: 0.7,
            blending: THREE.AdditiveBlending, depthWrite: false,
          }));
          this.fxGroup.add(line);
          this.fx.push({ obj: line, ttl: 0.05, maxTtl: 0.05, kind: 'fade' });
          break;
        }
        case 'impact': {
          this.spawnParticles(e.pos, {
            count: e.blood ? 6 : 5,
            color: e.blood ? 0xd03a3a : 0xd8d2c4,
            ttl: 0.35, size: e.blood ? 0.22 : 0.18, speed: 2.2, gravity: 6,
            texture: this.texGlow, additive: false,
          });
          break;
        }
        case 'blood': {
          this.spawnParticles(e.pos, { count: 4, color: 0xc03030, ttl: 0.4, size: 0.2, speed: 1.6, gravity: 8, additive: false });
          break;
        }
        case 'explosion': {
          const r = e.radius || 3;
          const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(1, 16, 12),
            new THREE.MeshBasicMaterial({
              color: 0xffb14a, transparent: true, opacity: 0.85,
              blending: THREE.AdditiveBlending, depthWrite: false,
            })
          );
          sphere.position.set(e.pos.x, e.pos.y, e.pos.z);
          sphere.scale.setScalar(0.4);
          this.fxGroup.add(sphere);
          this.fx.push({
            obj: sphere, ttl: 0.34, maxTtl: 0.34, kind: 'explosion', targetScale: r * 0.9,
          });
          const light = new THREE.PointLight(0xffa040, 6, r * 6, 2);
          light.position.set(e.pos.x, e.pos.y + 0.4, e.pos.z);
          this.fxGroup.add(light);
          this.fx.push({ obj: light, ttl: 0.22, maxTtl: 0.22, kind: 'light' });
          this.spawnParticles(e.pos, {
            count: 10, color: 0xffc178, ttl: 0.6, size: 0.5, speed: 5, gravity: 4, texture: this.texWarm,
          });
          this.spawnParticles(e.pos, {
            count: 7, color: 0x8a8a8a, ttl: 1.1, size: 0.9, speed: 2.4, gravity: -0.6,
            texture: this.texSmoke, additive: false, opacity: 0.6, grow: 1.4,
          });
          break;
        }
        case 'flame': {
          const dir = e.dir || { x: 0, y: 0, z: 0 };
          this.spawnParticles(e.pos, {
            count: 4, color: Math.random() < 0.5 ? 0xff8b2e : 0xffd06a,
            ttl: 0.42, size: 0.75, speed: 7, dir, gravity: -1.2, texture: this.texWarm, grow: 1.6,
          });
          this.spawnParticles(e.pos, {
            count: 1, color: 0x555555, ttl: 0.8, size: 0.9, speed: 2, dir, gravity: -0.8,
            texture: this.texSmoke, additive: false, opacity: 0.35, grow: 2,
          });
          break;
        }
        case 'airblast': {
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.7, 0.08, 8, 20),
            new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })
          );
          ring.position.set(e.pos.x, e.pos.y, e.pos.z);
          ring.lookAt(e.pos.x + e.dir.x, e.pos.y + e.dir.y, e.pos.z + e.dir.z);
          this.fxGroup.add(ring);
          this.fx.push({
            obj: ring, ttl: 0.3, maxTtl: 0.3, kind: 'ring',
            vel: { x: e.dir.x * 14, y: e.dir.y * 14, z: e.dir.z * 14 }, grow: 3.4,
          });
          break;
        }
        case 'healBeam': {
          const from = new THREE.Vector3(e.from.x, e.from.y, e.from.z);
          const to = new THREE.Vector3(e.to.x, e.to.y, e.to.z);
          const len = from.distanceTo(to);
          const geo = new THREE.CylinderGeometry(0.05, 0.05, len, 6);
          const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
            color: 0x7fe8ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false,
          }));
          mesh.position.copy(from).lerp(to, 0.5);
          mesh.lookAt(to);
          mesh.rotateX(Math.PI / 2);
          this.fxGroup.add(mesh);
          this.fx.push({ obj: mesh, ttl: 0.09, maxTtl: 0.09, kind: 'fade' });
          if (Math.random() < 0.35) {
            this.spawnParticles(e.to, { count: 1, color: 0x9fe8ff, ttl: 0.5, size: 0.4, speed: 1.2, up: 1.6, gravity: -1 });
          }
          break;
        }
        case 'teleport': {
          const col = teamColor(e.team);
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.8, 0.07, 8, 20),
            new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })
          );
          ring.rotation.x = Math.PI / 2;
          ring.position.set(e.pos.x, e.pos.y + 0.1, e.pos.z);
          this.fxGroup.add(ring);
          this.fx.push({ obj: ring, ttl: 0.5, maxTtl: 0.5, kind: 'rise', grow: 1.2 });
          this.spawnParticles({ x: e.pos.x, y: e.pos.y + 0.5, z: e.pos.z }, {
            count: 14, color: col, ttl: 0.7, size: 0.3, speed: 1.2, up: 5, gravity: -2,
          });
          break;
        }
        case 'spawn': {
          this.spawnParticles({ x: e.pos.x, y: e.pos.y + 0.6, z: e.pos.z }, {
            count: 8, color: teamColor(e.team), ttl: 0.6, size: 0.35, speed: 1.2, up: 3.5, gravity: -1,
          });
          break;
        }
        case 'land': {
          this.spawnParticles({ x: e.pos.x, y: e.pos.y + 0.1, z: e.pos.z }, {
            count: 5, color: 0xb6ac97, ttl: 0.45, size: 0.3, speed: 2.4, additive: false, opacity: 0.6, texture: this.texSmoke, grow: 1.5,
          });
          break;
        }
        case 'death': {
          // «гибы» — разлетающиеся кубики цвета команды
          const col = teamColor(e.team);
          for (let i = 0; i < 7; i++) {
            const m = new THREE.Mesh(
              new THREE.BoxGeometry(0.22, 0.22, 0.22),
              mat(i % 3 === 0 ? col : (i % 3 === 1 ? PALETTE.metalDark : 0x7a6a52))
            );
            m.position.set(e.pos.x, e.pos.y + 1, e.pos.z);
            m.castShadow = true;
            this.fxGroup.add(m);
            this.fx.push({
              obj: m, ttl: 3.2, maxTtl: 3.2, kind: 'gib', keepMaterial: true,
              vel: {
                x: (Math.random() - 0.5) * 9,
                y: 4 + Math.random() * 5,
                z: (Math.random() - 0.5) * 9,
              },
              spin: { x: (Math.random() - 0.5) * 12, y: (Math.random() - 0.5) * 12, z: (Math.random() - 0.5) * 12 },
              gravity: 16,
            });
          }
          this.spawnParticles({ x: e.pos.x, y: e.pos.y + 1, z: e.pos.z }, {
            count: 10, color: 0xb02020, ttl: 0.6, size: 0.3, speed: 3, gravity: 9, additive: false,
          });
          break;
        }
        case 'build': {
          this.spawnParticles({ x: e.pos.x, y: e.pos.y + 0.5, z: e.pos.z }, {
            count: 10, color: teamColor(e.team), ttl: 0.7, size: 0.3, speed: 2, up: 2.5, gravity: -1,
          });
          break;
        }
        case 'buildingDestroyed': {
          this.spawnParticles({ x: e.pos.x, y: e.pos.y + 0.6, z: e.pos.z }, {
            count: 12, color: 0xffa040, ttl: 0.5, size: 0.4, speed: 4, gravity: 8, texture: this.texWarm,
          });
          this.spawnParticles({ x: e.pos.x, y: e.pos.y + 0.6, z: e.pos.z }, {
            count: 6, color: 0x8a8a8a, ttl: 1, size: 0.8, speed: 2, gravity: -0.5, texture: this.texSmoke, additive: false, opacity: 0.55, grow: 1.5,
          });
          break;
        }
        case 'capture': {
          this.spawnParticles({ x: e.pos.x, y: e.pos.y + 1.2, z: e.pos.z }, {
            count: 26, color: teamColor(e.team), ttl: 1.4, size: 0.5, speed: 3, up: 9, gravity: -3,
          });
          const light = new THREE.PointLight(teamColor(e.team), 8, 30, 2);
          light.position.set(e.pos.x, e.pos.y + 3, e.pos.z);
          this.fxGroup.add(light);
          this.fx.push({ obj: light, ttl: 1.2, maxTtl: 1.2, kind: 'light' });
          break;
        }
        case 'healBurst': {
          this.spawnParticles(e.pos, { count: 10, color: 0x8fffc0, ttl: 0.6, size: 0.35, speed: 2, gravity: -2 });
          break;
        }
        default:
          break;
      }
    }
  }

  updateFx(dt) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.ttl -= dt;
      const k = Math.max(0, f.ttl / f.maxTtl);
      if (f.vel) {
        f.obj.position.x += f.vel.x * dt;
        f.obj.position.y += f.vel.y * dt;
        f.obj.position.z += f.vel.z * dt;
        if (f.gravity) f.vel.y -= f.gravity * dt;
        if (f.kind === 'gib') {
          // отскок от пола
          if (f.obj.position.y < 0.12) { f.obj.position.y = 0.12; f.vel.y = Math.abs(f.vel.y) * 0.35; f.vel.x *= 0.6; f.vel.z *= 0.6; }
          if (f.spin) {
            f.obj.rotation.x += f.spin.x * dt;
            f.obj.rotation.y += f.spin.y * dt;
            f.obj.rotation.z += f.spin.z * dt;
          }
          if (f.ttl < 0.8) f.obj.scale.setScalar(Math.max(0.01, f.ttl / 0.8));
        }
      }
      if (f.grow) {
        const s = f.obj.scale.x + f.grow * dt;
        f.obj.scale.setScalar(s);
      }
      if (f.kind === 'explosion') {
        const t = 1 - k;
        f.obj.scale.setScalar(0.4 + (f.targetScale - 0.4) * Math.min(1, t * 1.6));
        f.obj.material.opacity = 0.85 * k;
      } else if (f.kind === 'light') {
        f.obj.intensity = f.obj.intensity * Math.max(0, k);
      } else if (f.kind === 'rise') {
        f.obj.position.y += dt * 1.2;
        f.obj.material.opacity = 0.8 * k;
      } else if (f.kind === 'particle') {
        // плавное появление и затухание
        f.obj.material.opacity = (f.initialOpacity ?? 1) * Math.min(1, k * 2.2);
      } else if (f.kind === 'fade') {
        f.obj.material.opacity = k * 0.9;
      }
      if (f.ttl <= 0) {
        this.fxGroup.remove(f.obj);
        if (f.obj.geometry && f.kind !== 'particle') f.obj.geometry.dispose?.();
        if (f.obj.material && !f.keepMaterial) {
          // текстуры частиц общие — их не трогаем, материал одноразовый
          f.obj.material.dispose?.();
        }
        this.fx.splice(i, 1);
        if (f.kind === 'particle') this.particleCount--;
      }
    }
  }

  // ----------------------------------------------------------
  //  Камера и вид от первого лица
  // ----------------------------------------------------------
  setViewModelClass(classId, team, weaponId) {
    const key = `${classId}|${team}|${weaponId || ''}`;
    if (this.viewModelClass === key && !this.forceViewRebuild) return;
    this.viewModelClass = key;
    this.forceViewRebuild = false;
    if (this.viewModel) this.viewModelHolder.remove(this.viewModel);
    this.viewModel = makeViewModel(classId, team);
    this.viewModel.position.set(0, 0, 0);
    this.viewModelHolder.add(this.viewModel);
  }

  onLocalShot() { this.recoil = 1; }

  updateCamera(world, local, dt, opts = {}) {
    const cam = this.camera;
    if (!local) return;
    if (local.alive) {
      const eye = eyePos(local);
      // покачивание при ходьбе
      const speed = Math.hypot(local.vel.x, local.vel.z);
      this.bobPhase += dt * (6 + speed * 1.4);
      const bobAmp = local.onGround ? Math.min(0.055, speed * 0.011) : 0;
      const bobY = Math.sin(this.bobPhase * 2) * bobAmp;
      const bobX = Math.cos(this.bobPhase) * bobAmp * 0.7;
      cam.position.set(eye.x + bobX * 0.3, eye.y + bobY, eye.z);
      cam.rotation.set(local.pitch, local.yaw, 0, 'YXZ');
      // наклон при стрейфе
      const right = Math.cos(local.yaw) * local.vel.x - Math.sin(local.yaw) * local.vel.z;
      cam.rotation.z = -right * 0.004;
      // тряска от взрывов
      if (this.cameraShake > 0) {
        this.cameraShake = Math.max(0, this.cameraShake - dt * 2.2);
        cam.position.x += (Math.random() - 0.5) * this.cameraShake * 0.25;
        cam.position.y += (Math.random() - 0.5) * this.cameraShake * 0.25;
      }
      // прицел снайпера
      const wep = currentWeapon(local);
      const wantZoom = !!(local.zoom && wep && wep.chargeTime !== undefined);
      this.zoomT = THREE.MathUtils.damp(this.zoomT, wantZoom ? 1 : 0, 12, dt);
      const targetFov = 78 - 48 * this.zoomT;
      if (Math.abs(this.fov - targetFov) > 0.01) {
        this.fov = targetFov;
        cam.fov = targetFov;
        cam.updateProjectionMatrix();
      }
      // модель оружия
      if (this.viewModel) {
        const hideVm = wantZoom;
        this.viewModelHolder.visible = !hideVm;
        this.recoil = Math.max(0, this.recoil - dt * 6.5);
        const kick = this.recoil * this.recoil * 0.16;
        const rl = Math.max(0, this.recoil - dt * 9) * 0.5;
        this.viewModelHolder.position.set(-0.02 * kick, -0.03 * kick + bobY * 0.5, kick * 0.9 - rl * 0.1);
        this.viewModelHolder.rotation.set(-kick * 1.6, 0, 0);
      }
    } else {
      // вид «после смерти»: камера плавно поднимается над местом гибели
      const t = Math.min(1, (world.time - local.deathTime) / 0.8);
      const targetY = local.pos.y + 2.5 + t * 2.5;
      cam.position.set(local.pos.x, targetY, local.pos.z + 4);
      cam.lookAt(local.pos.x, local.pos.y + 0.8, local.pos.z);
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
