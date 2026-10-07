// ============================================================
//  Заглушка three.js для интеграционного теста в Node.
//  Повторяет только тот API, который реально использует игра,
//  чтобы прогонять модели/рендер/HUD без браузера.
// ============================================================

export const PCFSoftShadowMap = 1;
export const PCFShadowMap = 2;
export const SRGBColorSpace = 'srgb';
export const AdditiveBlending = 2;
export const NormalBlending = 1;
export const DoubleSide = 2;
export const FrontSide = 0;
export const BackSide = 1;
export const YXZOrder = 'YXZ';
export const RepeatWrapping = 1000;
export const MathUtils = {
  damp: (x, y, lambda, dt) => x + (y - x) * (1 - Math.exp(-lambda * dt)),
  lerp: (a, b, t) => a + (b - a) * t,
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
};

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  setScalar(s) { this.x = this.y = this.z = s; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  normalize() { const l = Math.hypot(this.x, this.y, this.z) || 1; this.x /= l; this.y /= l; this.z /= l; return this; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  lerp(v, t) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; return this; }
}

class Euler extends Vector3 {
  set(x, y, z, order) { this.x = x; this.y = y; this.z = z; this.order = order || this.order; return this; }
}

class Color {
  constructor(c) { this.value = c; }
  setHex(h) { this.value = h; return this; }
  set(c) { this.value = c; return this; }
  clone() { return new Color(this.value); }
}

class Object3D {
  constructor() {
    this.position = new Vector3();
    this.rotation = new Euler();
    this.scale = new Vector3(1, 1, 1);
    this.children = [];
    this.visible = true;
    this.userData = {};
    this.parent = null;
    this.renderOrder = 0;
  }
  add(...objs) { for (const o of objs) { if (o) { o.parent = this; this.children.push(o); } } return this; }
  remove(o) { const i = this.children.indexOf(o); if (i >= 0) { this.children.splice(i, 1); o.parent = null; } return this; }
  clear() { for (const c of this.children) c.parent = null; this.children.length = 0; return this; }
  traverse(cb) { cb(this); for (const c of [...this.children]) c.traverse(cb); }
  getObjectByProperty() { return null; }
  lookAt() {}
  rotateX() { return this; }
  rotateY() { return this; }
  rotateZ() { return this; }
  updateMatrixWorld() {}
  copy(o) { return this; }
}

class Scene extends Object3D {
  constructor() { super(); this.background = null; this.fog = null; this.isScene = true; }
}

class Camera extends Object3D {
  constructor(fov = 75, aspect = 1, near = 0.1, far = 1000) {
    super();
    this.isCamera = true;
    this.fov = fov; this.aspect = aspect; this.near = near; this.far = far;
  }
  updateProjectionMatrix() {}
}

class PerspectiveCamera extends Camera {}

class Mesh extends Object3D {
  constructor(geometry, material) {
    super();
    this.isMesh = true;
    this.geometry = geometry;
    this.material = material;
    this.castShadow = false;
    this.receiveShadow = false;
  }
}

class Line extends Object3D {
  constructor(geometry, material) { super(); this.isLine = true; this.geometry = geometry; this.material = material; }
}

class LineSegments extends Line {}

class Sprite extends Object3D {
  constructor(material) { super(); this.isSprite = true; this.material = material; }
}

class Light extends Object3D {
  constructor(color, intensity) { super(); this.color = new Color(color); this.intensity = intensity; }
}
class PointLight extends Light {}
class AmbientLight extends Light {}
class HemisphereLight extends Light {}
class DirectionalLight extends Light {
  constructor(color, intensity) {
    super(color, intensity);
    this.target = new Object3D();
    this.shadow = { mapSize: { set() {} }, camera: {}, bias: 0 };
  }
}

class Geometry {
  constructor(...args) { this.args = args; this.attributes = {}; }
  dispose() {}
  setFromPoints(points) { this.points = points; return this; }
  rotateX() { return this; }
  translate() { return this; }
  clone() { return new Geometry(...this.args); }
}
class BoxGeometry extends Geometry {}
class SphereGeometry extends Geometry {}
class CylinderGeometry extends Geometry {}
class ConeGeometry extends Geometry {}
class PlaneGeometry extends Geometry {}
class TorusGeometry extends Geometry {}
class RingGeometry extends Geometry {}
class EdgesGeometry extends Geometry {}
class BufferGeometry extends Geometry {}

class Material {
  constructor(params = {}) {
    Object.assign(this, params);
    this.opacity = params.opacity ?? 1;
    this.transparent = !!params.transparent;
    this.color = new Color(params.color ?? 0xffffff);
    this.needsUpdate = false;
  }
  dispose() {}
  clone() { return new Material({ ...this, color: this.color.value }); }
}
class MeshBasicMaterial extends Material {}
class MeshLambertMaterial extends Material {}
class MeshStandardMaterial extends Material {}
class LineBasicMaterial extends Material {}
class SpriteMaterial extends Material {}

class Texture {
  constructor(image) { this.image = image; this.colorSpace = null; }
  dispose() {}
}
class CanvasTexture extends Texture {}

class WebGLRenderer {
  constructor(params = {}) {
    this.domElement = params.canvas || { addEventListener() {}, removeEventListener() {} };
    this.shadowMap = { enabled: false, type: 0 };
    this.renderCalls = 0;
    this.info = { render: { calls: 0 } };
  }
  setPixelRatio() {}
  setSize() {}
  render() { this.renderCalls++; }
  dispose() {}
}

export {
  Vector3, Color, Object3D, Scene, Camera, PerspectiveCamera, Mesh, Line, LineSegments,
  Sprite, PointLight, HemisphereLight, DirectionalLight, AmbientLight, Group, Fog,
  BoxGeometry, SphereGeometry, CylinderGeometry, ConeGeometry, PlaneGeometry,
  TorusGeometry, RingGeometry, EdgesGeometry, BufferGeometry,
  MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, LineBasicMaterial, SpriteMaterial,
  Texture, CanvasTexture, WebGLRenderer,
};

class Group extends Object3D {}

class Fog {
  constructor(color, near, far) { this.color = new Color(color); this.near = near; this.far = far; }
}
