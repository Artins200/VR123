/* VR123 — главный цикл: инструменты в руках, захват предметов, стрельба,
   наручное меню, вход в VR. */
'use strict';

rig.add(Hands.left.group);
rig.add(Hands.right.group);
rig.add(Hands.left.holder = holders.left);
rig.add(Hands.right.holder = holders.right);
holders.left.visible = holders.right.visible = false;
Hands.init();
Flat.init();

/* ------------------------------------------------------------------ *
 *  Инструменты
 * ------------------------------------------------------------------ */
const TOOL_INFO = {
  hand: { name: 'рука', desc: 'пинч — взять/перенести/бросить предмет', cd: 0 },
  block: { name: 'блоки', desc: 'пинч — поставить блок по сетке 0.5 м', cd: 0.14 },
  spray: { name: 'баллончик', desc: 'удерживай — рисуй краской', hold: true },
  weld: { name: 'сварка', desc: 'удерживай — дуга, искры, шов', hold: true },
  pistol: { name: 'пистолет', desc: 'нажми — одиночный выстрел', cd: 0.22 },
  rifle: { name: 'винтовка', desc: 'удерживай — автомат', hold: true, cd: 0.085 },
  sword: { name: 'меч', desc: 'резкий взмах — удар' },
  del: { name: 'ластик', desc: 'пинч — убрать блок/предмет/нпс', cd: 0.18 }
};
const toolCd = { left: 0, right: 0 };

VR123.setTool = function (kind, side) {
  VR123.state.tool = kind;
  const s = side || 'right';
  VR123.attachToolModel(s, kind);
  if (s === 'right') VR123.attachToolModel('left', null);
  const info = TOOL_INFO[kind];
  VR123.log(info ? info.name + ' — ' + info.desc : '');
  document.querySelectorAll('.tool[data-tool]').forEach(b =>
    b.classList.toggle('active', b.dataset.tool === kind));
  // перекрасить баллончик под текущий цвет
  if (kind === 'spray') VR123.attachToolModel(s, 'spray');
};

VR123.cycleColor = function () {
  VR123.state.colorIndex = (VR123.state.colorIndex + 1) % VR123.COLORS.length;
  VR123.state.color = VR123.COLORS[VR123.state.colorIndex];
  VR123.log('цвет краски: #' + VR123.state.color.toString(16).padStart(6, '0'));
  if (VR123.state.tool === 'spray') VR123.attachToolModel('right', 'spray');
};

/* ------------------------------------------------------------------ *
 *  Стрельба (hitscan)
 * ------------------------------------------------------------------ */
const tracerGeo = new THREE.CylinderGeometry(0.006, 0.006, 1, 5, 1, true);
tracerGeo.translate(0, 0.5, 0);
tracerGeo.rotateX(Math.PI / 2);

function muzzleFlash(hand) {
  const at = hand.toolOrigin(new THREE.Vector3());
  const f = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95 }));
  f.position.copy(at);
  VR123.addFX(f, 0.06);
  const L = new THREE.PointLight(0xffc46b, 2.4, 3);
  L.position.copy(at);
  VR123.addFX(L, 0.07);
}

function tracer(from, to) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({
    color: 0xffe6a3, transparent: true, opacity: 0.85
  }));
  m.position.copy(from);
  m.scale.set(1, 1, len);
  m.lookAt(to);
  VR123.addFX(m, 0.08);
}

function hitSpark(at) {
  VR123.sparks(at, 6, null);
  const p = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
  p.position.copy(at);
  VR123.addFX(p, 0.12);
}

VR123.shoot = function (hand, kind) {
  const origin = hand.toolOrigin(new THREE.Vector3());
  const dir = hand.toolAim(new THREE.Vector3());
  // чуть разброса
  dir.x += rand(-0.012, 0.012); dir.y += rand(-0.012, 0.012); dir.z += rand(-0.012, 0.012);
  dir.normalize();

  Audio.shot(kind);
  muzzleFlash(hand);

  const ray = new THREE.Raycaster(origin, dir, 0.05, 120);
  const npcMeshes = [];
  const owner = new Map();
  for (const n of VR123.npcs) for (const p of n.parts) { npcMeshes.push(p); owner.set(p, n); }
  const targets = [floor, ...VR123.bodies.map(b => b.mesh), ...npcMeshes];
  const hit = ray.intersectObjects(targets, false)[0];
  const end = hit ? hit.point : origin.clone().add(dir.clone().multiplyScalar(60));
  tracer(origin, end);

  if (hit) {
    hitSpark(hit.point);
    const n = owner.get(hit.object);
    if (n) {
      // попадание в визор/голову — вдвое больнее
      const headshot = hit.object === n.visor || hit.object === n.head;
      const base = kind === 'rifle' ? 22 : 34;
      n.damage(headshot ? base * 2 : base, dir.clone().multiplyScalar(0.6));
      VR123.hud();
    } else {
      const body = VR123.bodies.find(b => b.mesh === hit.object);
      if (body) {
        body.vx += dir.x * 5; body.vy = Math.max(body.vy, 1.6) + dir.y * 4; body.vz += dir.z * 5;
        body.rx = rand(-8, 8); body.rz = rand(-8, 8);
      }
    }
  }
};

/* ------------------------------------------------------------------ *
 *  Меч — удар по дуге взмаха
 * ------------------------------------------------------------------ */
function swordSwing(hand) {
  if (hand.speed < 0.012) return false;   // ~0.7 м/с при 60 Гц
  const origin = hand.smooth[8].clone();
  const dir = hand.toolAim(new THREE.Vector3());
  // широкий конус: проверяем нпс рядом по дистанции до луча
  let any = false;
  for (const n of VR123.npcs.slice()) {
    const c = n.g.position.clone().setY(1.15);
    const to = c.clone().sub(origin);
    const t = to.dot(dir);
    if (t < 0 || t > 1.9) continue;
    const perp = to.clone().sub(dir.clone().multiplyScalar(t)).length();
    if (perp < 0.62) {
      n.damage(58, dir.clone().multiplyScalar(1.4));
      any = true;
    }
  }
  if (any) { Audio.thud(); VR123.sparks(origin.clone().add(dir.multiplyScalar(0.6)), 12, dir); }
  return any;
}

/* ------------------------------------------------------------------ *
 *  Захват предметов
 * ------------------------------------------------------------------ */
function nearestBody(hand) {
  let best = null, bd = 0.14;
  const p = hand.smooth[9];
  for (const b of VR123.bodies) {
    if (b.held) continue;
    const d = b.mesh.position.distanceTo(p);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

function nearestBlock(hand) {
  let best = null, bd = 0.34;
  const p = hand.smooth[9];
  for (const b of VR123.blocks) {
    if (b.held) continue;
    const d = b.mesh.position.distanceTo(p);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

function grab(hand) {
  // сначала пробуем лёгкий предмет, потом блок — так удобнее строить
  let b = nearestBody(hand);
  if (b) {
    b.held = true;
    hand.grabbed = b;
    b.mesh.material.emissive = new THREE.Color(0x2244ff);
    b.mesh.material.emissiveIntensity = 0.35;
    VR123.log('взял предмет');
    return;
  }
  const bl = nearestBlock(hand);
  if (bl) {
    bl.held = true;
    hand.grabbed = bl;
    bl.mesh.material.emissive = new THREE.Color(0x0891b2);
    bl.mesh.material.emissiveIntensity = 0.4;
    VR123.log('взял блок — отпусти, чтобы поставить');
  }
}

function release(hand, throwIt) {
  const b = hand.grabbed;
  if (!b) return;
  hand.grabbed = null;
  b.held = false;
  b.mesh.material.emissiveIntensity = 0;
  if (b.isBlock) {
    // блок кладём на сетку, а не швыряем
    VR123.moveBlock(b, b.mesh.position);
    VR123.log('блок поставлен');
    return;
  }
  if (throwIt) {
    const v = hand.vel.clone().multiplyScalar(26);
    b.vx = clamp(v.x, -14, 14); b.vy = clamp(v.y + 1.2, -10, 14); b.vz = clamp(v.z, -14, 14);
    b.rx = rand(-9, 9); b.rz = rand(-9, 9);
  } else { b.vx = b.vy = b.vz = 0; }
  VR123.log('бросил предмет');
}

function updateHeld(hand) {
  const b = hand.grabbed;
  if (!b) return;
  const target = hand.smooth[9].clone();
  if (b.isBlock) {
    // блок липнет к сетке прямо в руке — видно, куда встанет
    target.copy(VR123.snap(target));
    b.mesh.position.lerp(target, 0.35);
  } else {
    b.mesh.position.lerp(target, 0.55);
    b.mesh.rotation.x += hand.speed * 2;
    b.mesh.rotation.y += hand.speed * 2;
    b.vx = b.vy = b.vz = 0;
  }
}

/* ------------------------------------------------------------------ *
 *  Обработка действий одной руки
 * ------------------------------------------------------------------ */
function handleHand(hand, dt, side) {
  if (!hand.present) {
    if (hand.grabbed) release(hand, false);
    return;
  }
  const tool = side === 'right' ? VR123.state.tool : 'hand';
  toolCd[side] -= dt;

  if (tool === 'hand') {
    if (hand.pinchEdge && !hand.grabbed) grab(hand);
    if (hand.pinchRelease && hand.grabbed) release(hand, true);
    updateHeld(hand);
    return;
  }

  const held = hand.pinchOn || hand.triggerOn;
  const info = TOOL_INFO[tool];
  const canFire = toolCd[side] <= 0;

  switch (tool) {
    case 'block': {
      // ставим блок туда, куда смотрит указка, с привязкой к сетке
      if (hand.pinchEdge && canFire) {
        const at = (side === 'right' ? VR123.pointer.blockPos() : null);
        if (at) {
          // не ставим блок внутрь своей руки
          const nearHand = at.distanceTo(hand.smooth[9]) < 0.25;
          if (!nearHand) { toolCd[side] = info.cd; VR123.spawnBlock(at); }
          else VR123.log('слишком близко к руке');
        } else VR123.log('некуда ставить — нет поверхности');
      }
      break;
    }
    case 'del':
      if (hand.pinchEdge && canFire) {
        toolCd[side] = info.cd;
        VR123.deleteAt(hand.toolOrigin(new THREE.Vector3()), hand.toolAim(new THREE.Vector3()));
      }
      break;
    case 'spray':
      if (held) {
        VR123.spray(hand.toolOrigin(new THREE.Vector3()), hand.toolAim(new THREE.Vector3()));
        if (Math.random() < dt * 18) Audio.hiss(0.12);
      }
      break;
    case 'weld':
      if (held) VR123.weld(hand.toolOrigin(new THREE.Vector3()), hand.toolAim(new THREE.Vector3()), dt);
      break;
    case 'pistol':
      if ((hand.pinchEdge || hand.triggerEdge || (hand.triggerOn && canFire)) && canFire) {
        toolCd[side] = info.cd;
        VR123.shoot(hand, 'pistol');
      }
      break;
    case 'rifle':
      if (held && canFire) {
        toolCd[side] = info.cd;
        VR123.shoot(hand, 'rifle');
      }
      break;
    case 'sword':
      if (hand.speed > 0.011) {
        if (toolCd[side] <= 0) { toolCd[side] = 0.16; swordSwing(hand); }
      }
      break;
  }
  if (hand.grabbed) updateHeld(hand);
}

/* ------------------------------------------------------------------ *
 *  Наручное меню (VR) — панель на левой руке
 * ------------------------------------------------------------------ */
const MENU_ITEMS = [
  { id: 'hand', label: '✋ Рука' },
  { id: 'block', label: '🧱 Блоки' },
  { id: 'spray', label: '🎨 Баллон' },
  { id: 'weld', label: '⚡ Сварка' },
  { id: 'pistol', label: '🔫 Пистолет' },
  { id: 'rifle', label: '💥 Винтовка' },
  { id: 'sword', label: '🗡 Меч' },
  { id: 'del', label: '🧽 Ластик' },
  { id: 'npc', label: '👤 НПС сюда' },
  { id: 'horde', label: '👥 Орда' },
  { id: 'cube', label: '🧊 Кубик' },
  { id: 'color', label: '🌈 Цвет' },
  { id: 'cam', label: '📷 Камера' },
  { id: 'clear', label: '🧹 Очистить' },
];
/* раскладка наручного меню: одна функция на отрисовку и на хит-тест */
function menuLayout() {
  const cols = 2, gap = 8, x0 = 22, y0 = 104;
  const rows = Math.ceil(MENU_ITEMS.length / cols);
  const cw = Math.floor((512 - x0 * 2 - gap) / cols);
  const chh = Math.floor((512 - y0 - 18 - gap * (rows - 1)) / rows);
  return { cols, gap, x0, y0, cw, chh };
}
const menuCanvas = document.createElement('canvas');
menuCanvas.width = 512; menuCanvas.height = 512;
const mctx = menuCanvas.getContext('2d');
const menuTex = new THREE.CanvasTexture(menuCanvas);
const menuPanel = new THREE.Mesh(
  new THREE.PlaneGeometry(0.24, 0.24),
  new THREE.MeshBasicMaterial({ map: menuTex, transparent: true, side: THREE.DoubleSide })
);
menuPanel.visible = false;
rig.add(menuPanel);
let menuHover = -1;

function drawMenu() {
  const g = mctx, W = 512, H = 512;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,.92)';
  g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 4;
  roundRect(g, 6, 6, W - 12, H - 12, 26); g.fill(); g.stroke();
  g.fillStyle = '#111'; g.font = '700 34px system-ui, sans-serif';
  g.fillText('VR123 · меню', 34, 62);
  g.fillStyle = '#888'; g.font = '500 20px system-ui, sans-serif';
  g.fillText('HP ' + Math.round(VR123.state.hp) + '   счёт ' + VR123.state.score, 34, 92);

  const L = menuLayout();
  MENU_ITEMS.forEach((it, i) => {
    const cx = L.x0 + (i % L.cols) * (L.cw + L.gap);
    const cy = L.y0 + Math.floor(i / L.cols) * (L.chh + L.gap);
    const active = (it.id === VR123.state.tool) ||
      (it.id === 'cam' && VR123.state.camOn);
    g.fillStyle = i === menuHover ? '#dbeafe' : active ? '#111' : '#f4f4f5';
    roundRect(g, cx, cy, L.cw, L.chh, 12); g.fill();
    g.fillStyle = active ? '#fff' : '#111';
    g.font = '600 24px system-ui, sans-serif';
    g.fillText(it.label, cx + 14, cy + 33);
  });
  menuTex.needsUpdate = true;
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
/* (u,v) в пределах 0..1 по панели -> индекс кнопки. Одна математика
   и для хит-теста, и для проверки раскладки. */
VR123.menuIndexAt = function (u, v) {
  const L = menuLayout();
  const px = u * 512, py = v * 512;
  const cix = Math.floor((px - L.x0) / (L.cw + L.gap));
  const ciy = Math.floor((py - L.y0) / (L.chh + L.gap));
  if (cix < 0 || cix >= L.cols) return -1;
  const idx = ciy * L.cols + cix;
  if (idx < 0 || idx >= MENU_ITEMS.length) return -1;
  return ((px - L.x0) % (L.cw + L.gap) < L.cw && (py - L.y0) % (L.chh + L.gap) < L.chh) ? idx : -1;
};
function menuPick(hand) {
  // луч из указательного пальца в плоскость меню
  const o = hand.smooth[8].clone();
  const d = hand.toolAim(new THREE.Vector3());
  const plane = new THREE.Plane();
  const n = new THREE.Vector3(0, 0, 1).applyQuaternion(menuPanel.quaternion);
  plane.setFromNormalAndCoplanarPoint(n, menuPanel.getWorldPosition(new THREE.Vector3()));
  const hit = new THREE.Vector3();
  if (!new THREE.Ray(o, d).intersectPlane(plane, hit)) { menuHover = -1; return; }
  const local = menuPanel.worldToLocal(hit);
  const u = (local.x / 0.24) + 0.5, v = 0.5 - (local.y / 0.24);
  if (u < 0 || u > 1 || v < 0 || v > 1) { menuHover = -1; return; }
  menuHover = VR123.menuIndexAt(u, v);
}
function menuActivate() {
  if (menuHover < 0) return;
  const it = MENU_ITEMS[menuHover];
  if (TOOL_INFO[it.id]) VR123.setTool(it.id);
  else if (it.id === 'npc') VR123.spawnNPC();
  else if (it.id === 'horde') VR123.spawnHorde(5);
  else if (it.id === 'cube') VR123.spawnCube(VR123.pointer.has ? VR123.pointer.point.clone().setY(1.2) : new THREE.Vector3(0, 1.2, -1));
  else if (it.id === 'color') VR123.cycleColor();
  else if (it.id === 'cam') toggleCamera();
  else if (it.id === 'clear') VR123.clearWorld();
  Audio.thud();
}

/* Поставить блок в точку прицела (для мыши и горячей клавиши B) */
VR123.placeAtPointer = function () {
  const at = VR123.pointer.blockPos();
  if (!at) { VR123.log('некуда ставить — нет поверхности'); return null; }
  return VR123.spawnBlock(at);
};

VR123.clearWorld = function () {
  for (const b of VR123.bodies) {
    scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose();
  }
  for (const d of VR123.decals) {
    scene.remove(d.mesh); d.mesh.geometry.dispose(); d.mesh.material.dispose();
  }
  for (const b of VR123.blocks) {
    scene.remove(b.mesh); b.mesh.material.dispose();
  }
  for (const n of VR123.npcs.slice()) { scene.remove(n.g); }
  VR123.bodies.length = 0; VR123.decals.length = 0; VR123.npcs.length = 0; VR123.blocks.length = 0;
  Hands.left.grabbed = Hands.right.grabbed = null;
  VR123.hud();
  VR123.log('мир очищен');
};

/* ------------------------------------------------------------------ *
 *  «Невидимая камера» — индикатор, что она работает, но её не видно
 * ------------------------------------------------------------------ */
function updateCameraLayer() {
  const s = VR123.state;
  video.style.display = s.camOn && s.mode === 'flat' && !s.camHidden ? 'block' : 'none';
  if (s.camOn && s.mode === 'flat' && !s.camHidden) {
    video.style.cssText = 'position:fixed;right:10px;bottom:96px;width:170px;height:auto;' +
      'opacity:.9;border-radius:12px;border:2px solid #111;z-index:5';
  }
}

/* ------------------------------------------------------------------ *
 *  Главный цикл
 * ------------------------------------------------------------------ */
let last = performance.now();
let menuWasPinch = false;

function tick(now, frame) {
  // защита от «времени назад» (смена вкладки, сброс rAF): dt только в диапазоне 0..0.05
  let dt = (now - last) / 1000;
  if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
  dt = Math.min(dt, 0.05);
  last = now;
  const s = VR123.state;

  if (s.mode === 'xr') {
    Hands.update(frame);
  } else if (s.mode === 'flat') {
    Flat.update(dt);
  }

  // наручное меню (VR): подними левую руку ладонью к себе
  if (s.mode === 'xr') {
    const L = Hands.left, R = Hands.right;
    let showMenu = false;
    if (L.present && R.present) {
      const palmUp = new THREE.Vector3(0, 1, 0).applyQuaternion(L.quat);
      const toHead = camera.getWorldPosition(new THREE.Vector3()).sub(L.smooth[0]).normalize();
      showMenu = L.smooth[0].distanceTo(camera.getWorldPosition(new THREE.Vector3())) < 0.42
        && palmUp.dot(toHead) > 0.35;
    }
    menuPanel.visible = showMenu;
    if (showMenu) {
      const wp = L.smooth[9].clone().lerp(L.smooth[0], 0.5);
      menuPanel.position.copy(wp).add(new THREE.Vector3(0, 0.06, 0));
      menuPanel.lookAt(camera.getWorldPosition(new THREE.Vector3()));
      menuPick(L);
      drawMenu();
      if (L.pinchOn && !menuWasPinch) menuActivate();
    }
    menuWasPinch = L.present && L.pinchOn;
  } else {
    menuPanel.visible = false;
  }

  const activeTool = s.mode === 'flat' ? s.tool : s.tool;
  holders.right.visible = !!(activeTool && activeTool !== 'hand');
  holders.left.visible = false;
  VR123.updateToolModels();

  // указка: луч из руки (VR) или из камеры (без шлема)
  if (s.mode !== 'menu') {
    VR123.pointer.update(s.mode === 'xr' ? Hands.right : null);
  } else {
    VR123.pointer.setVisible(false);
  }

  // действия рук
  if (s.mode === 'xr') {
    handleHand(Hands.right, dt, 'right');
    handleHand(Hands.left, dt, 'left');
  } else {
    handleHand(Hands.right, dt, 'right');
  }

  VR123.physics(dt);
  VR123.updateNPCs(dt);
  VR123.updateFX(dt);
  updateCameraLayer();
  VR123.hud();

  renderer.render(scene, camera);
}

renderer.setAnimationLoop((now, frame) => tick(now, frame));

/* ------------------------------------------------------------------ *
 *  UI: кнопки, вход в VR
 * ------------------------------------------------------------------ */
VR123.fire = function (down) {
  const h = Hands.right;
  // в плоском режиме клик = действие инструмента: блок ставим сразу в точку прицела
  if (down && VR123.state.mode === 'flat' && VR123.state.tool === 'block') VR123.placeAtPointer();
  if (down) { h.trigger = 1; h.triggerEdge = true; h.pinch = 1; h.pinchOn = true; h.pinchEdge = true; }
  else { h.trigger = 0; h.triggerOn = false; h.pinch = 0; h.pinchOn = false; h.pinchRelease = true; }
};

document.querySelectorAll('.tool[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => VR123.setTool(btn.dataset.tool));
});
document.querySelectorAll('.tool[data-act]').forEach(btn => {
  btn.addEventListener('click', () => {
    const a = btn.dataset.act;
    if (a === 'npc') VR123.spawnNPC();
    if (a === 'horde') VR123.spawnHorde(5);
    if (a === 'cam') { toggleCamera().then(() => { btn.classList.toggle('on', VR123.state.camOn); }); }
    if (a === 'clear') VR123.clearWorld();
    if (a === 'color') VR123.cycleColor();
    if (a === 'cube') VR123.spawnCube(
      VR123.pointer.has ? VR123.pointer.point.clone() : new THREE.Vector3(0, 1.2, -1),
      new THREE.Vector3(0, 1.5, 0));
  });
});

const elEnter = document.getElementById('enter');
const btnVR = document.getElementById('btnVR');
const btnFlat = document.getElementById('btnFlat');
const elCaps = document.getElementById('caps');

function startFlat() {
  Audio.init();
  VR123.state.mode = 'flat';
  document.body.classList.add('flat');
  elEnter.classList.add('hidden');
  VR123.setTool('hand');
  VR123.spawnHorde(3);
  VR123.log('режим без шлема · ПКМ — осмотр · WASD · 1–7 инструменты');
}
btnFlat.addEventListener('click', startFlat);
VR123.startFlat = startFlat;        // доступен из консоли и тестам

async function enterVR() {
  Audio.init();
  if (!navigator.xr) { VR123.log('WebXR недоступен в этом браузере'); return; }
  const base = {
    requiredFeatures: ['local-floor'],
    optionalFeatures: ['hand-tracking', 'bounded-floor', 'layers']
  };
  // 1) пробуем с доступом к камере (passthrough)
  const attempts = [
    { ...base, optionalFeatures: [...base.optionalFeatures, 'camera-access'] },
    base
  ];
  let session = null, err = null;
  for (const init of attempts) {
    try { session = await navigator.xr.requestSession('immersive-vr', init); break; }
    catch (e) { err = e; }
  }
  if (!session) { VR123.log('не удалось войти в VR: ' + (err && err.message || err)); return; }
  await renderer.xr.setSession(session);
  VR123.state.mode = 'xr';
  elEnter.classList.add('hidden');
  document.body.classList.remove('flat');
  VR123.setTool('hand');
  VR123.spawnHorde(3);
  // «включить камеру, но не показывать» — включаем слой passthrough
  toggleCamera();
  const feats = session.enabledFeatures || [];
  VR123.log('VR · руки: ' + (feats.includes('hand-tracking') ? 'да' : 'нет (контроллеры)') +
    ' · камера-слой: ' + (feats.includes('camera-access') ? 'да' : 'нет'));
  session.addEventListener('end', () => {
    VR123.state.mode = 'menu';
    elEnter.classList.remove('hidden');
  });
}
btnVR.addEventListener('click', enterVR);

/* Диагностика возможностей */
(async function caps() {
  const lines = [];
  lines.push('WebXR: ' + (navigator.xr ? '<b>есть</b>' : 'нет'));
  if (navigator.xr) {
    try { lines.push('immersive-vr: ' + (await navigator.xr.isSessionSupported('immersive-vr') ? '<b>поддерживается</b>' : 'нет')); }
    catch (e) { lines.push('immersive-vr: ?'); }
  }
  lines.push('getUserMedia (камера): ' + (navigator.mediaDevices && navigator.mediaDevices.getUserMedia ? '<b>есть</b>' : 'нет'));
  lines.push('HTTPS: ' + (location.protocol === 'https:' || location.hostname === 'localhost' ? '<b>да</b>' : 'нет — без него VR и камера не работают'));
  elCaps.innerHTML = lines.join(' · ');
})();

VR123.setTool('hand');
VR123.hud();
drawMenu();
