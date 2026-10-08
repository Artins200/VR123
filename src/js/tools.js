/* VR123 — инструменты: спавн кубиков, баллончик с краской, сварка,
   плюс простая физика тел и эффекты. */
'use strict';

const GRAV = 9.4;
const MAX_BODIES = 260;

/* Единый луч по миру: пол + блоки + предметы + части нпс.
   Все инструменты пользуются им, чтобы попадания не расходились. */
VR123.rayWorld = function (origin, dir, maxDist) {
  const targets = [floor];
  for (const b of VR123.blocks) targets.push(b.mesh);
  for (const b of VR123.bodies) targets.push(b.mesh);
  for (const n of VR123.npcs) for (const p of n.parts) targets.push(p);
  const rc = new THREE.Raycaster(origin, dir, 0.05, maxDist || 60);
  return rc.intersectObjects(targets, false)[0] || null;
};

/* Какому нпс принадлежит меш (для попадания) */
VR123.npcByMesh = function (mesh) {
  for (const n of VR123.npcs) if (n.parts.indexOf(mesh) >= 0) return n;
  return null;
};


const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
const paintGeo = new THREE.CircleGeometry(1, 12);
const beadGeo = new THREE.SphereGeometry(1, 6, 5);

/* ------------------------------------------------------------------ *
 *  Блоки — статичные ячейки мира, ставятся с привязкой к сетке 0.5 м.
 *  В отличие от «кубиков» они не падают: из них можно строить.
 * ------------------------------------------------------------------ */
const BLOCK = 0.5;
const SNAP = 0.5;
VR123.blocks = [];

const blockGeo = new THREE.BoxGeometry(BLOCK, BLOCK, BLOCK);
const blockEdge = new THREE.EdgesGeometry(blockGeo);

VR123.snap = function (v) {
  return new THREE.Vector3(
    Math.round(v.x / SNAP) * SNAP,
    Math.max(BLOCK / 2, Math.round(v.y / SNAP) * SNAP),
    Math.round(v.z / SNAP) * SNAP
  );
};

VR123.spawnBlock = function (at, color) {
  const pos = VR123.snap(at);
  // не ставим два блока в одну ячейку
  for (const b of VR123.blocks) if (b.mesh.position.distanceToSquared(pos) < 1e-6) return b;
  const mesh = new THREE.Mesh(blockGeo, new THREE.MeshStandardMaterial({
    color: color != null ? color : 0xf0f0f4, roughness: 0.75, metalness: 0.05
  }));
  mesh.position.copy(pos);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.block = true;
  const edge = new THREE.LineSegments(blockEdge,
    new THREE.LineBasicMaterial({ color: 0xb9b9c4, transparent: true, opacity: 0.9 }));
  mesh.add(edge);
  scene.add(mesh);
  const b = { mesh, size: BLOCK, isBlock: true };
  VR123.blocks.push(b);
  Audio.thud();
  VR123.hud();
  return b;
};

VR123.removeBlock = function (b) {
  const i = VR123.blocks.indexOf(b);
  if (i < 0) return;
  scene.remove(b.mesh);
  b.mesh.material.dispose();
  VR123.blocks.splice(i, 1);
  VR123.hud();
};

/* Призрак: куда встанет блок */
VR123.ghost = (function () {
  const g = new THREE.Group();
  const solid = new THREE.Mesh(blockGeo, new THREE.MeshBasicMaterial({
    color: 0x22d3ee, transparent: true, opacity: 0.22, depthWrite: false
  }));
  const wire = new THREE.LineSegments(blockEdge,
    new THREE.LineBasicMaterial({ color: 0x0891b2, transparent: true, opacity: 0.95 }));
  g.add(solid, wire);
  g.visible = false;
  scene.add(g);
  return g;
})();

/* Перенос блока: поднимаем и кладём с привязкой к сетке */
VR123.moveBlock = function (b, at) {
  const to = VR123.snap(at);
  for (const o of VR123.blocks) if (o !== b && o.mesh.position.distanceToSquared(to) < 1e-6) return false;
  b.mesh.position.copy(to);
  return true;
};

/* Удаление того, на что смотрим */
/* Ближайший объект в пределах tol метров от луча. Без этого ластиком
   невозможно попасть по тонкому нпс — луч проходит в 7 см от головы. */
VR123.nearRay = function (origin, dir, tol, maxDist) {
  let best = null, bd = tol;
  const v = new THREE.Vector3();
  const consider = (pos, kind, ref) => {
    v.subVectors(pos, origin);
    const t = v.dot(dir);
    if (t < 0 || t > maxDist) return;
    const perp = v.sub(dir.clone().multiplyScalar(t)).length();
    if (perp < bd) { bd = perp; best = { kind, ref, t }; }
  };
  for (const n of VR123.npcs) consider(n.g.position.clone().setY(1.15), 'npc', n);
  for (const b of VR123.blocks) consider(b.mesh.position, 'block', b);
  for (const b of VR123.bodies) consider(b.mesh.position, 'body', b);
  return best;
};

/* Ближайший объект к ТОЧКЕ НА ЗЕМЛЕ. На дистанции луч проходит ниже нпс,
   поэтому допуск по лучу не спасает — меряем по полу, это и интуитивнее:
   стираешь то, что стоит под перекрестьем. */
VR123.nearestAtGround = function (point, tol) {
  let best = null, bd = tol;
  for (const n of VR123.npcs) {
    const d = Math.hypot(n.g.position.x - point.x, n.g.position.z - point.z);
    if (d < bd) { bd = d; best = { kind: 'npc', ref: n }; }
  }
  for (const b of VR123.blocks) {
    const d = b.mesh.position.distanceTo(point);
    if (d < bd) { bd = d; best = { kind: 'block', ref: b }; }
  }
  for (const b of VR123.bodies) {
    const d = b.mesh.position.distanceTo(point);
    if (d < bd) { bd = d; best = { kind: 'body', ref: b }; }
  }
  return best;
};

VR123.deleteAt = function (origin, dir) {
  // 1) прямое попадание лучом
  const hit = VR123.rayWorld(origin, dir, 12);
  if (hit) {
    if (hit.object.userData.block) {
      const b = VR123.blocks.find(x => x.mesh === hit.object);
      if (b) { VR123.removeBlock(b); VR123.log('блок удалён'); return 'block'; }
    }
    const body = VR123.bodies.find(x => x.mesh === hit.object);
    if (body) {
      scene.remove(body.mesh); body.mesh.material.dispose();
      VR123.bodies.splice(VR123.bodies.indexOf(body), 1);
      VR123.log('предмет удалён');
      return 'body';
    }
    const n = VR123.npcByMesh(hit.object);
    if (n) { n.die(); VR123.log('нпс удалён'); return 'npc'; }
  }
  // 2) не попал точно — берём ближайшее к лучу (пол при этом не трогаем)
  let near = VR123.nearRay(origin, dir, 0.55, 12);
  // 3) и последнее: то, что стоит под точкой прицела на земле
  if (!near && VR123.pointer.has) near = VR123.nearestAtGround(VR123.pointer.point, 0.9);
  if (!near) return null;
  if (near.kind === 'npc') { near.ref.die(); VR123.log('нпс удалён'); return 'npc'; }
  if (near.kind === 'block') { VR123.removeBlock(near.ref); VR123.log('блок удалён'); return 'block'; }
  const b = near.ref;
  scene.remove(b.mesh); b.mesh.material.dispose();
  VR123.bodies.splice(VR123.bodies.indexOf(b), 1);
  VR123.log('предмет удалён');
  return 'body';
};

/* ------------------------------------------------------------------ *
 *  Физика лёгких тел (кубики)
 * ------------------------------------------------------------------ */
VR123.physics = function (dt) {
  const list = VR123.bodies;
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i];
    if (b.held) continue;
    b.vy -= GRAV * dt;
    b.mesh.position.x += b.vx * dt;
    b.mesh.position.y += b.vy * dt;
    b.mesh.position.z += b.vz * dt;
    b.mesh.rotation.x += b.rx * dt;
    b.mesh.rotation.z += b.rz * dt;

    const half = b.size * 0.5;
    // на чём стоим: пол или верх ближайшего блока под нами
    let ground = half;
    for (const bl of VR123.blocks) {
      const p = bl.mesh.position;
      if (Math.abs(b.mesh.position.x - p.x) > BLOCK * 0.5 + half) continue;
      if (Math.abs(b.mesh.position.z - p.z) > BLOCK * 0.5 + half) continue;
      const top = p.y + BLOCK * 0.5 + half;
      // приземляемся только если в прошлый кадр были выше верха
      if (top > ground && b.mesh.position.y - b.vy * dt >= top - 0.02) ground = top;
    }
    if (b.mesh.position.y < ground) {
      b.mesh.position.y = ground;
      if (Math.abs(b.vy) > 1.6) { Audio.thud(); b.mesh.position.y = ground + 0.001; }
      b.vy = -b.vy * 0.32;
      b.vx *= 0.72; b.vz *= 0.72; b.rx *= 0.5; b.rz *= 0.5;
      if (Math.abs(b.vy) < 0.5) b.vy = 0;
    }
    // трение о поверхность
    if (b.mesh.position.y <= ground + 0.001) { b.vx *= 0.94; b.vz *= 0.94; }
    b.life += dt;
  }
};

/* ------------------------------------------------------------------ *
 *  Кубики
 * ------------------------------------------------------------------ */
VR123.spawnCube = function (pos, vel, color) {
  if (VR123.bodies.length >= MAX_BODIES) {
    const old = VR123.bodies.shift();
    scene.remove(old.mesh);
    old.mesh.geometry.dispose(); old.mesh.material.dispose();
  }
  const size = rand(0.14, 0.3);
  const mat = new THREE.MeshStandardMaterial({
    color: color != null ? color : VR123.COLORS[(Math.random() * VR123.COLORS.length) | 0],
    roughness: 0.55, metalness: 0.05
  });
  const mesh = new THREE.Mesh(cubeGeo, mat);
  mesh.scale.setScalar(size);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.position.copy(pos);
  scene.add(mesh);
  const b = {
    mesh, size, vx: vel ? vel.x : 0, vy: vel ? vel.y : 0.6, vz: vel ? vel.z : 0,
    rx: rand(-2, 2), rz: rand(-2, 2), held: false, life: 0, paint: 0
  };
  VR123.bodies.push(b);
  Audio.thud();
  VR123.hud();
  return b;
};

/* ------------------------------------------------------------------ *
 *  Баллончик с краской
 * ------------------------------------------------------------------ */
const sprayMat = () => new THREE.MeshBasicMaterial({
  color: VR123.state.color, transparent: true, opacity: 0.75, depthWrite: false,
  side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2
});

VR123.spray = function (origin, dir) {
  const hit = VR123.rayWorld(origin, dir, 9);
  if (!hit) {
    // брызги в воздух
    VR123.puff(origin.clone().add(dir.clone().multiplyScalar(1.2)));
    return;
  }
  const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
  const p = hit.point.clone().add(n.multiplyScalar(0.004));
  const r = rand(0.05, 0.13);
  const d = new THREE.Mesh(paintGeo, sprayMat());
  d.scale.setScalar(r);
  d.position.copy(p);
  d.lookAt(p.clone().add(n));
  if (hit.object === floor) d.rotation.z = Math.random() * Math.PI;
  scene.add(d);
  VR123.decals.push({ mesh: d, life: 0 });
  if (VR123.decals.length > 420) {
    const old = VR123.decals.shift();
    scene.remove(old.mesh); old.mesh.geometry.dispose(); old.mesh.material.dispose();
  }
  // если попали в кубик или блок — красим его целиком
  const body = VR123.bodies.find(b => b.mesh === hit.object);
  if (body) { body.mesh.material.color.setHex(VR123.state.color); body.paint = 1; }
  const blk = VR123.blocks.find(b => b.mesh === hit.object);
  if (blk) blk.mesh.material.color.setHex(VR123.state.color);
  VR123.puff(p, 0.5);
};

VR123.puff = function (at, s) {
  const g = new THREE.SphereGeometry(0.05 * (s || 1), 6, 5);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    color: VR123.state.color, transparent: true, opacity: 0.5
  }));
  m.position.copy(at);
  VR123.addFX(m, 0.35);
};

/* ------------------------------------------------------------------ *
 *  Сварка
 * ------------------------------------------------------------------ */
let weldCooldown = 0;
VR123.weld = function (origin, dir, dt) {
  const hit = VR123.rayWorld(origin, dir, 4);
  weldCooldown -= dt;
  if (weldCooldown <= 0) { Audio.zap(); weldCooldown = 0.06; }

  const at = hit ? hit.point.clone() : origin.clone().add(dir.clone().multiplyScalar(0.7));
  // дуга — яркая точка
  const arc = new THREE.Mesh(
    new THREE.SphereGeometry(0.028, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xbfe9ff })
  );
  arc.position.copy(at);
  VR123.addFX(arc, 0.09);
  // свет от дуги
  const L = new THREE.PointLight(0x9fd8ff, 3.2, 4.5);
  L.position.copy(at);
  VR123.addFX(L, 0.09);

  // шов
  if (hit) {
    const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    const bead = new THREE.Mesh(beadGeo, new THREE.MeshStandardMaterial({
      color: 0xd8dde3, roughness: 0.35, metalness: 0.9,
      emissive: 0xff5a1f, emissiveIntensity: 1.4
    }));
    bead.scale.set(rand(0.016, 0.028), rand(0.012, 0.02), rand(0.016, 0.028));
    bead.position.copy(at).add(n.multiplyScalar(0.006));
    scene.add(bead);
    VR123.decals.push({ mesh: bead, life: 0, glow: bead.material });
    if (VR123.decals.length > 500) {
      const old = VR123.decals.shift();
      scene.remove(old.mesh); old.mesh.geometry.dispose(); old.mesh.material.dispose();
    }
  }
  // искры
  VR123.sparks(at, 10, dir);
};

VR123.sparks = function (at, n, dir) {
  for (let i = 0; i < n; i++) {
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(0.008, 4, 3),
      new THREE.MeshBasicMaterial({ color: i % 3 ? 0xffc65c : 0xfff2c4 })
    );
    s.position.copy(at);
    const v = new THREE.Vector3(rand(-1, 1), rand(0.2, 1.6), rand(-1, 1));
    if (dir) v.add(dir.clone().multiplyScalar(-0.6));
    v.multiplyScalar(rand(0.8, 2.6));
    const fx = { obj: s, ttl: rand(0.3, 0.8), age: 0, v };
    scene.add(s);
    VR123.fx.push(fx);
  }
};

VR123.updateFX = function (dt) {
  for (let i = VR123.fx.length - 1; i >= 0; i--) {
    const f = VR123.fx[i];
    f.age += dt;
    if (f.v) {
      f.v.y -= GRAV * 0.55 * dt;
      f.obj.position.addScaledVector(f.v, dt);
      if (f.obj.position.y < 0.01) { f.obj.position.y = 0.01; f.v.set(0, 0, 0); }
    }
    if (f.obj.material && f.obj.material.opacity !== undefined && !f.obj.material.transparent) {
      f.obj.material.transparent = true;
    }
    if (f.obj.material && f.obj.material.opacity !== undefined) {
      f.obj.material.opacity = Math.max(0, 1 - f.age / f.ttl);
    }
    if (f.glow) f.glow.emissiveIntensity = 1.4 * Math.max(0, 1 - f.age * 2);
    if (f.age >= f.ttl) {
      scene.remove(f.obj);
      if (f.obj.geometry) f.obj.geometry.dispose();
      if (f.obj.material && f.obj.material.dispose) f.obj.material.dispose();
      VR123.fx.splice(i, 1);
    }
  }
  // затухание краски/швов — очень медленное
  for (let i = VR123.decals.length - 1; i >= 0; i--) {
    const d = VR123.decals[i];
    d.life += dt;
    if (d.glow) d.glow.emissiveIntensity = Math.max(0, 1.4 - d.life * 1.6);
  }
};

/* ------------------------------------------------------------------ *
 *  Модельки инструментов в руке (простые, из боксов)
 * ------------------------------------------------------------------ */
function box(w, h, d, color, x, y, z, metal, rough) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, metalness: metal || 0.3, roughness: rough == null ? 0.5 : rough })
  );
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

const ToolModels = {
  spray() {
    const g = new THREE.Group();
    g.add(box(0.055, 0.16, 0.055, 0xd9d9de, 0, 0, 0, 0.6, 0.35));
    g.add(box(0.058, 0.035, 0.058, VR123.state.color, 0, 0.01, 0, 0.4, 0.4));
    g.add(box(0.03, 0.03, 0.03, 0x222226, 0, 0.095, 0.012, 0.7, 0.3));
    g.add(box(0.012, 0.012, 0.03, 0x111114, 0, 0.09, -0.02, 0.7, 0.3));
    return g;
  },
  weld() {
    const g = new THREE.Group();
    g.add(box(0.045, 0.15, 0.045, 0x2b2b31, 0, 0, 0, 0.5, 0.6));
    g.add(box(0.03, 0.03, 0.2, 0x44444c, 0, 0.05, -0.1, 0.9, 0.25));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.06, 8),
      new THREE.MeshStandardMaterial({ color: 0xb08d57, metalness: 1, roughness: 0.3 }));
    tip.position.set(0, 0.05, -0.22); tip.rotation.x = -Math.PI / 2;
    g.add(tip);
    g.add(box(0.02, 0.02, 0.14, 0x111114, 0, -0.02, 0.09, 0.2, 0.8)); // кабель
    return g;
  },
  pistol() {
    const g = new THREE.Group();
    g.add(box(0.045, 0.055, 0.2, 0x2a2a30, 0, 0.03, -0.04, 0.85, 0.3));   // затвор
    g.add(box(0.04, 0.11, 0.05, 0x1d1d22, 0, -0.04, 0.03, 0.7, 0.45));   // рукоять
    g.add(box(0.02, 0.02, 0.06, 0x55555e, 0, 0.03, -0.16, 0.95, 0.2));   // ствол
    g.add(box(0.008, 0.012, 0.008, 0xffffff, 0, 0.062, -0.12, 0.2, 0.6)); // мушка
    return g;
  },
  rifle() {
    const g = new THREE.Group();
    g.add(box(0.05, 0.06, 0.44, 0x23232a, 0, 0.03, -0.1, 0.85, 0.35));    // ресивер
    g.add(box(0.028, 0.028, 0.3, 0x3a3a44, 0, 0.03, -0.42, 0.95, 0.2));  // длинный ствол
    g.add(box(0.045, 0.12, 0.05, 0x1a1a1f, 0, -0.04, 0.04, 0.7, 0.45));  // рукоять
    g.add(box(0.038, 0.09, 0.045, 0x2f2f38, 0, -0.05, -0.05, 0.6, 0.5)); // магазин
    g.add(box(0.045, 0.055, 0.12, 0x1a1a1f, 0, 0.02, 0.14, 0.5, 0.6));   // приклад
    g.add(box(0.02, 0.028, 0.09, 0x111114, 0, 0.075, -0.1, 0.9, 0.25));  // планка/прицел
    return g;
  },
  sword() {
    const g = new THREE.Group();
    g.add(box(0.032, 0.13, 0.032, 0x1a1a1f, 0, -0.02, 0, 0.6, 0.5));     // рукоять
    g.add(box(0.1, 0.018, 0.03, 0xb08d57, 0, 0.05, 0, 1, 0.25));         // гарда
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.62, 0.012),
      new THREE.MeshStandardMaterial({ color: 0xdfe6ee, metalness: 1, roughness: 0.12 }));
    blade.position.set(0, 0.37, 0); blade.castShadow = true;
    g.add(blade);
    return g;
  },
  cube() {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09),
      new THREE.MeshStandardMaterial({ color: 0x22d3ee, roughness: 0.4, metalness: 0.15, transparent: true, opacity: 0.85 }));
    m.castShadow = true;
    g.add(m);
    return g;
  }
};

/* Держатели моделей в руках */
const holders = { left: new THREE.Group(), right: new THREE.Group() };
let currentModel = { left: null, right: null };

VR123.attachToolModel = function (side, kind) {
  const h = holders[side];
  if (currentModel[side]) { h.remove(currentModel[side]); currentModel[side] = null; }
  if (!kind || kind === 'hand') return;
  const m = ToolModels[kind] ? ToolModels[kind]() : null;
  if (m) { h.add(m); currentModel[side] = m; }
};

/* Куда прилепить модель: к среднему пальцу, «в ладонь» */
VR123.updateToolModels = function () {
  for (const side of ['left', 'right']) {
    const hand = side === 'left' ? Hands.left : Hands.right;
    const h = holders[side];
    if (!hand.present) { h.visible = false; continue; }
    h.visible = true;
    h.position.copy(hand.smooth[9]).lerp(hand.smooth[0], 0.35);
    h.quaternion.copy(hand.quat);
    h.rotateX(-Math.PI / 2.35);
    h.translateZ(-0.035);
  }
};
