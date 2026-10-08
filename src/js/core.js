/* VR123 — core: сцена, лиминальное белое пространство, XR-сессия, риг игрока.
   Ноль внешних зависимостей кроме three.js (лежит локально в vendor/). */
'use strict';

const VR123 = {
  // ---- общее состояние ----
  state: {
    mode: 'menu',            // menu | flat | xr
    tool: 'hand',
    color: 0xff3355,
    colorIndex: 0,
    hp: 100, score: 0,
    camOn: false, camHidden: true,
    paused: false
  },
  COLORS: [0xff3355, 0x22d3ee, 0xf59e0b, 0x22c55e, 0xa855f7, 0x111111, 0xffffff],
  bodies: [], decals: [], npcs: [], bullets: [], fx: [],
  tmp: { v1: null, v2: null, v3: null, q1: null, m1: null },
  log: () => {},
};

(function initThree() {
  const t = VR123.tmp;
  t.v1 = new THREE.Vector3(); t.v2 = new THREE.Vector3(); t.v3 = new THREE.Vector3();
  t.q1 = new THREE.Quaternion(); t.m1 = new THREE.Matrix4();
})();

/* ------------------------------------------------------------------ *
 *  Рендерер / сцена
 * ------------------------------------------------------------------ */
const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0xffffff, 1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);
scene.fog = new THREE.Fog(0xffffff, 18, 78);

const rig = new THREE.Group();          // «тело» игрока
rig.position.set(0, 0, 0);
scene.add(rig);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.03, 400);
camera.position.set(0, 1.6, 0);
rig.add(camera);

/* ------------------------------------------------------------------ *
 *  Лиминальное пространство: белый пол в клеточку + сетка-потолок
 * ------------------------------------------------------------------ */
function makeGridTexture(cell, line, px) {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d');
  g.fillStyle = line; g.fillRect(0, 0, px, px);
  g.fillStyle = cell; g.fillRect(2, 2, px - 4, px - 4);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

const CELL = 1.0;                       // 1 метр на клетку
const floorTex = makeGridTexture('#ffffff', '#c9c9cf', 128);
floorTex.repeat.set(220, 220);
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(220, 220),
  new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.92, metalness: 0.0 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// вторая, крупная сетка поверх — даёт «бесконечность»
const grid = new THREE.GridHelper(220, 220, 0x9a9aa4, 0xdcdce2);
grid.position.y = 0.002;
grid.material.transparent = true;
grid.material.opacity = 0.55;
scene.add(grid);

// потолок-сетка на 4 м
const ceil = new THREE.GridHelper(220, 110, 0xd6d6dc, 0xe9e9ee);
ceil.position.y = 4;
ceil.material.transparent = true;
ceil.material.opacity = 0.4;
scene.add(ceil);

// «бесконечность» — белая стена-цилиндр, чтобы туман не рвался
const horizon = new THREE.Mesh(
  new THREE.CylinderGeometry(105, 105, 30, 48, 1, true),
  new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, fog: false })
);
horizon.position.y = 8;
scene.add(horizon);

// колонны — чистая лиминальщина
const colMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f5, roughness: 0.85 });
const colGeo = new THREE.BoxGeometry(0.7, 4, 0.7);
for (let i = 0; i < 14; i++) {
  const a = (i / 14) * Math.PI * 2;
  const r = 22 + (i % 3) * 9;
  const col = new THREE.Mesh(colGeo, colMat);
  col.position.set(Math.cos(a) * r, 2, Math.sin(a) * r);
  col.castShadow = col.receiveShadow = true;
  scene.add(col);
}

/* ---- свет ---- */
scene.add(new THREE.HemisphereLight(0xffffff, 0xe8e8f0, 1.15));
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(6, 14, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -26; sun.shadow.camera.right = 26;
sun.shadow.camera.top = 26; sun.shadow.camera.bottom = -26;
sun.shadow.camera.far = 60;
sun.shadow.bias = -0.0015;
scene.add(sun);

/* ------------------------------------------------------------------ *
 *  Камера (passthrough). Включается, но в VR не отрисовывается —
 *  мы её literally не видим; она живёт только как невидимый слой.
 * ------------------------------------------------------------------ */
const video = document.getElementById('passthrough');
const camState = { stream: null, err: null };

async function toggleCamera() {
  if (VR123.state.camOn) {
    if (camState.stream) camState.stream.getTracks().forEach(t => t.stop());
    camState.stream = null;
    VR123.state.camOn = false;
    VR123.log('камера выключена');
    return false;
  }
  try {
    camState.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false
    });
    video.srcObject = camState.stream;
    await video.play().catch(() => {});
    VR123.state.camOn = true;
    VR123.log('камера включена (скрытый слой)');
  } catch (e) {
    camState.err = e && e.name;
    VR123.log('камера: ' + (camState.err || 'нет доступа'));
  }
  return VR123.state.camOn;
}

/* ------------------------------------------------------------------ *
 *  Звук — процедурный, без файлов
 * ------------------------------------------------------------------ */
const Audio = {
  ctx: null,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) this.ctx = new AC();
  },
  noiseBuf() {
    if (this._nb) return this._nb;
    const c = this.ctx, b = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return (this._nb = b);
  },
  shot(kind) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const n = c.createBufferSource(); n.buffer = this.noiseBuf();
    const f = c.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(kind === 'rifle' ? 2600 : 1700, t);
    f.frequency.exponentialRampToValueAtTime(220, t + 0.14);
    const g = c.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'rifle' ? 0.1 : 0.16));
    n.connect(f).connect(g).connect(c.destination); n.start(t); n.stop(t + 0.2);
    const o = c.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.09);
    const og = c.createGain(); og.gain.setValueAtTime(0.16, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(og).connect(c.destination); o.start(t); o.stop(t + 0.12);
  },
  zap() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const n = c.createBufferSource(); n.buffer = this.noiseBuf();
    const f = c.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.value = 2400 + Math.random() * 1800; f.Q.value = 6;
    const g = c.createGain(); g.gain.value = 0.05;
    n.connect(f).connect(g).connect(c.destination); n.start(t); n.stop(t + 0.06);
  },
  hiss(dur) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const n = c.createBufferSource(); n.buffer = this.noiseBuf(); n.loop = true;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 4200;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.045, t + 0.02);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    n.connect(f).connect(g).connect(c.destination); n.start(t); n.stop(t + dur + 0.05);
  },
  thud() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.16);
    const g = c.createGain(); g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.22);
  }
};

/* ------------------------------------------------------------------ *
 *  HUD
 * ------------------------------------------------------------------ */
const elHpBar = document.querySelector('#hpBar i');
const elHp = document.getElementById('hpVal');
const elScore = document.getElementById('scoreVal');
const elNpc = document.getElementById('npcVal');
const elCube = document.getElementById('cubeVal');
const elLog = document.getElementById('hudLog');

VR123.log = (msg) => { elLog.textContent = msg; };

VR123.hud = function () {
  const s = VR123.state;
  elHp.textContent = Math.max(0, Math.round(s.hp));
  elHpBar.style.width = Math.max(0, s.hp) + '%';
  elHpBar.style.background = s.hp > 50 ? 'linear-gradient(90deg,#22c55e,#84cc16)'
    : s.hp > 25 ? 'linear-gradient(90deg,#f59e0b,#eab308)' : 'linear-gradient(90deg,#ef4444,#f97316)';
  elScore.textContent = s.score;
  elNpc.textContent = VR123.npcs.length;
  elCube.textContent = VR123.bodies.length;
};

/* ------------------------------------------------------------------ *
 *  Вспомогательное
 * ------------------------------------------------------------------ */
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;

VR123.playerPos = function (out) {
  return rig.getWorldPosition(out || new THREE.Vector3());
};
VR123.addFX = function (obj, ttl) {
  VR123.fx.push({ obj, ttl, age: 0 });
  scene.add(obj);
};

/* ------------------------------------------------------------------ *
 *  Ресайз
 * ------------------------------------------------------------------ */
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
