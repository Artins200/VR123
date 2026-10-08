#!/usr/bin/env node
/* Проверка ЕДИНОГО файла index.html.
   Разбирает сам файл, достаёт из него <style> и оба <script> и исполняет их
   в jsdom — то есть гоняет ровно тот код, который уедет пользователю.
   Заглушены только WebGL-контекст и аудио (в песочнице нет GPU/звука). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('/tmp/node_modules/jsdom');

const FILE = path.join(__dirname, 'index.html');
let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); c ? pass++ : fail++; };

const raw = fs.readFileSync(FILE, 'utf8');

console.log('\n== разбор единого файла ==');
const scripts = [...raw.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const styles = [...raw.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]);
ok(scripts.length === 2, 'inline <script> блоков: ' + scripts.length + ' (three.js + игра)');
ok(styles.length === 1, 'inline <style> блоков: ' + styles.length);
ok(!/(src|href)="[^"#][^"]*"/.test(raw), 'внешних src/href нет — файл автономен');
ok(raw.includes('immersive-vr') && raw.includes('hand-tracking'), 'внутри есть WebXR и трекинг рук');
ok(scripts[0].length > 400000, 'блок three.js: ' + (scripts[0].length / 1024 | 0) + ' КБ');
ok(scripts[1].includes('pointer.js'), 'внутри все модули, включая указку');

/* ---------------- jsdom + заглушки железа ---------------- */
const dom = new JSDOM(raw.replace(/<script>[\s\S]*?<\/script>/g, ''), { url: 'http://localhost/' });
const win = dom.window;
const drawn = { fill: 0, text: 0 };
win.HTMLCanvasElement.prototype.getContext = function () {
  const noop = () => { };
  return {
    canvas: this, fillRect: noop, clearRect: noop, strokeRect: noop, drawImage: noop,
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop, setTransform: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arcTo: noop, arc: noop, quadraticCurveTo: noop,
    fill() { drawn.fill++; }, stroke() { }, fillText() { drawn.text++; }, strokeText: noop,
    measureText: () => ({ width: 10 }), clip: noop, set fillStyle(v) { }, get fillStyle() { return '#000'; },
    set strokeStyle(v) { }, get strokeStyle() { return '#000'; }, set lineWidth(v) { }, set font(v) { },
    set globalAlpha(v) { }, set lineJoin(v) { }, set lineCap(v) { },
    getImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData: noop,
    createLinearGradient: () => ({ addColorStop: noop })
  };
};

/* Единый песочный глобал: UMD three.js пишет в globalThis, поэтому контекст
   должен быть ОБЩИМ для three.js и игрового кода (как в браузере). */
const sandbox = {};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
sandbox.document = win.document;
sandbox.navigator = win.navigator;
sandbox.location = win.location || { protocol: 'http:', hostname: 'localhost' };
sandbox.console = { log() { }, warn() { }, error() { } };
sandbox.setTimeout = setTimeout;
sandbox.clearTimeout = clearTimeout;
sandbox.performance = require('perf_hooks').performance;
sandbox.devicePixelRatio = 1;
sandbox.innerWidth = 1280;
sandbox.innerHeight = 800;
sandbox.__listeners = {};
sandbox.addEventListener = (t, f) => { (sandbox.__listeners[t] = sandbox.__listeners[t] || []).push(f); };
sandbox.removeEventListener = () => { };
sandbox.requestAnimationFrame = cb => { sandbox.__raf = cb; return 1; };
sandbox.cancelAnimationFrame = () => { };
sandbox.AudioContext = function () {
  const p = () => ({ value: 0, setValueAtTime() { }, linearRampToValueAtTime() { }, exponentialRampToValueAtTime() { } });
  return {
    currentTime: 0, sampleRate: 44100, destination: {}, state: 'running',
    createBuffer: (c, l) => ({ getChannelData: () => new Float32Array(l) }),
    createBufferSource: () => ({ buffer: null, loop: false, connect: n => n, start() { }, stop() { } }),
    createBiquadFilter: () => ({ type: '', frequency: p(), Q: p(), connect: n => n }),
    createGain: () => ({ gain: p(), connect: n => n }),
    createOscillator: () => ({ type: '', frequency: p(), connect: n => n, start() { }, stop() { } })
  };
};
sandbox.navigator.mediaDevices = { getUserMedia: async () => { throw new Error('NotAllowedError'); } };

const calls = { render: 0 };
const xrStub = {
  enabled: false, setReferenceSpaceType() { }, getReferenceSpace: () => ({}),
  setSession: async () => { }, getSession: () => null, addEventListener() { }, removeEventListener() { }
};

console.log('\n== исполнение кода из файла ==');
try {
  vm.runInNewContext(scripts[0], sandbox, { filename: 'index.html#three' });
  ok(typeof sandbox.THREE === 'object', 'three.js поднял глобал THREE (r' + sandbox.THREE.REVISION + ')');
} catch (e) { ok(false, 'three.js -> ' + e.message); process.exit(1); }

const THREE = sandbox.THREE;
THREE.WebGLRenderer = function () {
  return {
    domElement: sandbox.document.createElement('canvas'),
    capabilities: { getMaxAnisotropy: () => 8 }, shadowMap: {}, xr: xrStub,
    setPixelRatio() { }, setSize() { }, setClearColor() { },
    /* настоящий рендерер каждый кадр обновляет matrixWorld — без этого
       Raycaster работает по единичным матрицам. Воспроизводим то же. */
    render(sc) { calls.render++; if (sc && sc.updateMatrixWorld) sc.updateMatrixWorld(true); },
    setAnimationLoop(cb) { sandbox.__loop = cb; }, getContext: () => ({})
  };
};
THREE.CanvasTexture = function (canvas) { const t = new THREE.Texture(); t.image = canvas; return t; };

/* В браузере соседние <script> делят ОДНУ лексическую область, а
   vm.runInNewContext заводит новую на каждый вызов — поэтому игровой блок
   исполняем одним скриптом. const/let верхнего уровня не попадают в глобал,
   так что эпилогом выкладываем их наружу (на код приложения не влияет). */
const EPILOGUE = `
;window.__exports = { VR123, scene, rig, camera, renderer, Hands, Flat, TOOL_INFO,
  MENU_ITEMS, JOINTS, BONES, drawMenu, menuLayout, menuPick, menuHover: () => menuHover,
  swordSwing, grab, release, updateHeld, nearestBody, nearestBlock, toolCd,
  toggleCamera, holders, handleHand, Audio, rand, clamp, BLOCK, SNAP };`;
try {
  vm.runInNewContext(scripts[1] + EPILOGUE, sandbox, { filename: 'index.html#game' });
  ok(true, 'игровой код исполнен без ошибок');
} catch (e) {
  ok(false, 'игровой код -> ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 5).join('\n'));
  process.exit(1);
}

const get = k => sandbox.__exports[k];
const VR123 = get('VR123'), scene = get('scene'), Hands = get('Hands');
const MENU_ITEMS = get('MENU_ITEMS'), JOINTS = get('JOINTS'), BONES = get('BONES');
const drawMenu = get('drawMenu'), swordSwing = get('swordSwing');
const grab = get('grab'), release = get('release'), updateHeld = get('updateHeld');
const toolCd = get('toolCd'), toggleCamera = get('toggleCamera');
const startFlat = () => VR123.startFlat();
const BLOCK = get('BLOCK'), SNAP = get('SNAP');

async function main() {
  console.log('\n== инициализация ==');
  ok(!!VR123 && !!scene && !!Hands, 'VR123 / сцена / руки созданы');
  ok(scene.children.length > 8, 'объектов в сцене: ' + scene.children.length);
  ok(JOINTS.length === 21 && BONES.length === 23, 'скелет кисти: ' + JOINTS.length + ' суставов, ' + BONES.length + ' костей');
  ok(MENU_ITEMS.length === 14, 'пунктов наручного меню: ' + MENU_ITEMS.length);
  ok(Object.keys(get('TOOL_INFO')).length === 8, 'инструментов: ' + Object.keys(get('TOOL_INFO')).length);
  ok(typeof sandbox.__loop === 'function', 'игровой цикл зарегистрирован');

  const now = () => sandbox.performance.now();
  const step = (n) => { let t = now(); for (let i = 0; i < n; i++) { t += 16; sandbox.__loop(t); } };
  step(20);
  ok(calls.render === 20, 'цикл рисует кадры: ' + calls.render + '/20');

  console.log('\n== режимы и инструменты ==');
  startFlat();
  step(10);
  ok(VR123.state.mode === 'flat', 'плоский режим включён');
  for (const t of ['block', 'spray', 'weld', 'pistol', 'rifle', 'sword', 'del', 'hand']) {
    VR123.setTool(t);
    if (VR123.state.tool !== t) { ok(false, 'инструмент «' + t + '»'); break; }
  }
  ok(VR123.state.tool === 'hand', 'все 8 инструментов переключаются');

  console.log('\n== указка: луч и точка попадания ==');
  VR123.setTool('block');
  step(2);
  const P = VR123.pointer;
  ok(P.has === true, 'указка нашла поверхность (has=' + P.has + ')');
  ok(P.point.lengthSq() > 0.01, 'точка попадания действительно посчитана: ' +
    P.point.toArray().map(v => v.toFixed(2)).join(', '));
  ok(Math.abs(P.point.y) < 0.05, 'луч попал в пол: y=' + P.point.y.toFixed(4));
  ok(P.origin.distanceTo(P.point) > 1, 'дистанция до точки: ' + P.origin.distanceTo(P.point).toFixed(2) + ' м');
  ok(VR123.ghost.visible === true, 'призрак блока показан (инструмент «блоки»)');
  VR123.setTool('hand'); step(1);
  ok(VR123.ghost.visible === false, 'призрак скрыт, когда инструмент не «блоки»');

  console.log('\n== блоки: привязка к сетке ==');
  VR123.clearWorld();
  const s1 = VR123.snap(new THREE.Vector3(1.37, 0.1, -2.83));
  ok(Math.abs(s1.x % SNAP) < 1e-9 && Math.abs(s1.z % SNAP) < 1e-9,
    'snap() кратен ' + SNAP + ' м: ' + s1.toArray().map(v => v.toFixed(2)).join(', '));
  ok(s1.y >= BLOCK / 2, 'блок не проваливается ниже пола: y=' + s1.y);
  const b1 = VR123.spawnBlock(new THREE.Vector3(1.37, 0.1, -2.83));
  ok(VR123.blocks.length === 1, 'блок поставлен');
  ok(b1.mesh.position.equals(s1), 'блок встал ровно в ячейку сетки');
  VR123.spawnBlock(new THREE.Vector3(1.4, 0.1, -2.9));
  ok(VR123.blocks.length === 1, 'в ту же ячейку второй блок не встал (защита от дублей)');
  VR123.spawnBlock(new THREE.Vector3(2.0, 0.1, -2.83));
  ok(VR123.blocks.length === 2, 'в соседнюю ячейку встал: ' + VR123.blocks.length);

  console.log('\n== блоки: ставить в точку прицела ==');
  VR123.clearWorld();
  VR123.setTool('block');
  const before = VR123.blocks.length;
  VR123.placeAtPointer();
  ok(VR123.blocks.length === before + 1, 'placeAtPointer() поставил блок');
  const at = VR123.blocks[0].mesh.position;
  ok(Math.abs(at.x % SNAP) < 1e-9 && Math.abs(at.z % SNAP) < 1e-9, 'он на сетке: ' + at.toArray().map(v => v.toFixed(2)).join(', '));
  ok(at.distanceTo(new THREE.Vector3(P.point.x, at.y, P.point.z)) <= SNAP,
    'он рядом с точкой прицела (отклонение ' + at.distanceTo(new THREE.Vector3(P.point.x, at.y, P.point.z)).toFixed(3) + ' м)');

  console.log('\n== строительство: блоки держат предметы ==');
  VR123.clearWorld();
  VR123.spawnBlock(new THREE.Vector3(0, 0, -2));
  step(1);
  const cube = VR123.spawnCube(new THREE.Vector3(0, 3, -2));
  cube.vx = cube.vz = 0;
  step(120);
  const restY = cube.mesh.position.y;
  ok(Math.abs(restY - (BLOCK + cube.size / 2)) < 0.05,
    'кубик лёг НА блок: y=' + restY.toFixed(3) + ', ожидалось ' + (BLOCK + cube.size / 2).toFixed(3));

  console.log('\n== перенос блока рукой ==');
  VR123.clearWorld();
  VR123.spawnBlock(new THREE.Vector3(0, 0, -2));
  const HL = Hands.left; HL.present = true;
  HL.smooth[9].set(0, 0.25, -2);
  grab(HL);
  ok(HL.grabbed && HL.grabbed.isBlock === true, 'блок взят в руку');
  HL.smooth[9].set(1.7, 0.25, -3.4);
  for (let i = 0; i < 40; i++) updateHeld(HL);
  release(HL, true);
  const np = VR123.blocks[0].mesh.position;
  ok(Math.abs(np.x - 1.5) < 1e-9 && Math.abs(np.z + 3.5) < 1e-9,
    'блок перенесён и лёг на сетку: ' + np.toArray().map(v => v.toFixed(2)).join(', '));
  ok(HL.grabbed === null, 'рука отпустила блок');

  console.log('\n== ластик: удаление тем же лучом, что и указка ==');
  // сначала прицеливаемся, потом ставим — иначе блок окажется не там, куда смотрим
  VR123.clearWorld();
  VR123.setTool('block');
  step(1);
  VR123.placeAtPointer();
  step(1);
  VR123.setTool('del');
  const aimO = () => Hands.right.toolOrigin(new THREE.Vector3());
  const aimD = () => Hands.right.toolAim(new THREE.Vector3());
  const removed = VR123.deleteAt(aimO(), aimD());
  ok(removed === 'block' && VR123.blocks.length === 0, 'ластик убрал блок из прицела (вернул ' + removed + ')');
  VR123.setTool('block');
  step(1);
  VR123.spawnNPC();                 // спавн в точку прицела
  step(1);
  VR123.setTool('del');
  const r2 = VR123.deleteAt(aimO(), aimD());
  ok(r2 === 'npc' && VR123.npcs.length === 0, 'ластик убрал нпс из прицела (вернул ' + r2 + ')');
  // и проверка, что ластик не сносит весь мир вокруг
  VR123.setTool('block'); step(1);
  VR123.spawnBlock(new THREE.Vector3(3, 0, -3));
  VR123.setTool('del'); step(1);
  VR123.deleteAt(aimO(), aimD());
  ok(VR123.blocks.length === 1, 'далёкий блок не пострадал: ' + VR123.blocks.length);

  console.log('\n== нпс спавнится в точку прицела ==');
  VR123.clearWorld();
  VR123.setTool('hand');
  step(1);
  const n = VR123.spawnNPC();
  const dxz = Math.hypot(n.g.position.x - VR123.pointer.point.x, n.g.position.z - VR123.pointer.point.z);
  ok(dxz < 0.01, 'нпс появился ровно под прицелом (смещение ' + dxz.toFixed(4) + ' м)');

  console.log('\n== баллончик / сварка ==');
  VR123.clearWorld();
  VR123.state.color = 0x22d3ee;
  const o = new THREE.Vector3(0, 1.5, 0), d = new THREE.Vector3(0.25, -0.6, -0.75).normalize();
  for (let i = 0; i < 20; i++) VR123.spray(o.clone(), d.clone());
  ok(VR123.decals.length > 10, 'краска легла декалями: ' + VR123.decals.length);
  ok(VR123.decals.every(x => x.mesh.material.color.getHex() === 0x22d3ee), 'цвет совпадает с выбранным');
  VR123.spawnBlock(new THREE.Vector3(1, 0, -2));
  step(1);
  VR123.spray(new THREE.Vector3(1, 1.5, 0), new THREE.Vector3(0, -0.5, -1).normalize());
  ok(VR123.blocks[0].mesh.material.color.getHex() === 0x22d3ee, 'блок тоже красится');
  // нпс на старте иногда кидают кубики и дают свои эффекты — убираем,
  // иначе проверка «искры погасли» будет случайно падать
  for (const nn of VR123.npcs.slice()) nn.die();
  VR123.fx.length = 0;
  VR123.weld(o.clone(), d.clone(), 0.016);
  const sparks = VR123.fx.length;
  ok(VR123.decals.length >= 1 && sparks > 5, 'сварка: шов + ' + sparks + ' искр');
  step(70);   // 1.12 с при максимальном времени жизни искры 0.8 с
  ok(VR123.fx.length === 0, 'все ' + sparks + ' искры погасли сами (осталось ' + VR123.fx.length + ')');

  console.log('\n== зеркальная рука повторяет пальцы ==');
  const h = Hands.right;
  h.setPoseFromMatrix(new THREE.Vector3(0.2, 1.3, -0.4), new THREE.Quaternion(), 0, 0);
  const openSpan = h.smooth[4].distanceTo(h.smooth[8]), openMid = h.smooth[9].distanceTo(h.smooth[12]);
  h.setPoseFromMatrix(new THREE.Vector3(0.2, 1.3, -0.4), new THREE.Quaternion(), 1, 1);
  const pinchSpan = h.smooth[4].distanceTo(h.smooth[8]), pinchMid = h.smooth[9].distanceTo(h.smooth[12]);
  ok(openSpan > pinchSpan, 'пинч сводит большой и указательный: ' + openSpan.toFixed(4) + ' -> ' + pinchSpan.toFixed(4) + ' м');
  ok(openMid > pinchMid, 'пальцы сгибаются: ' + openMid.toFixed(4) + ' -> ' + pinchMid.toFixed(4) + ' м');
  ok(h.group.children.length === 45, 'аватар кисти: ' + h.group.children.length + ' мешей');
  for (const side of ['left', 'right']) {
    const hh = side === 'left' ? Hands.left : Hands.right;
    let bad = 0;
    for (const p of [0, 0.5, 1]) {
      hh.setPoseFromMatrix(new THREE.Vector3(0.2, 1.3, -0.4), new THREE.Quaternion(), p, p);
      bad += hh.jointPos.filter(v => !v || !isFinite(v.x) || !isFinite(v.y) || !isFinite(v.z)).length;
    }
    ok(bad === 0, 'кисть ' + side + ': все 21 сустав корректны при пинче 0 / 0.5 / 1');
  }

  console.log('\n== захват и бросок предмета ==');
  VR123.clearWorld();
  const body = VR123.spawnCube(new THREE.Vector3(0, 1, -0.5));
  body.vx = body.vy = body.vz = 0;
  HL.smooth[9].set(0, 1, -0.5);
  grab(HL);
  ok(HL.grabbed === body, 'предмет взят в руку');
  body.mesh.position.set(0.5, 1.4, -0.9);
  for (let i = 0; i < 40; i++) updateHeld(HL);
  ok(body.mesh.position.distanceTo(HL.smooth[9]) < 0.02, 'предмет идёт за кистью');
  HL.vel.set(0.25, 0.1, 0.05); release(HL, true);
  ok(HL.grabbed === null && body.vy > 0, 'брошен с импульсом vy=' + body.vy.toFixed(2));

  console.log('\n== бой ==');
  VR123.clearWorld();
  VR123.spawnNPC(new THREE.Vector3(0, 0, -3));
  step(1);   // render() обновляет matrixWorld — в приложении это каждый кадр
  const HR = Hands.right; HR.present = true;
  HR.smooth[0].set(0, 1.2, 0); HR.smooth[8].set(0, 1.2, -0.1); HR.smooth[9].set(0, 1.2, -0.1);
  HR.toolAim = out => out.set(0, 0, -1); HR.toolOrigin = out => out.copy(HR.smooth[8]);
  const s0 = VR123.state.score;
  VR123.shoot(HR, 'pistol');
  const hp1 = VR123.npcs[0] ? VR123.npcs[0].hp : 0;
  ok(hp1 < 100, 'выстрел в голову (визор) наносит урон: hp 100 -> ' + hp1);
  for (let i = 0; i < 3; i++) { VR123.shoot(HR, 'pistol'); toolCd.right = 0; }
  ok(VR123.npcs.length === 0, 'нпс убит пистолетом и развалился');
  ok(VR123.state.score === s0 + 100, 'счёт +' + (VR123.state.score - s0));

  VR123.clearWorld();
  VR123.spawnNPC(new THREE.Vector3(0.9, 0, -0.9));
  step(1);
  const n3 = VR123.npcs[0];
  HR.smooth[8].set(0.2, 1.2, -0.3); HR.toolAim = out => out.set(1, 0, -1).normalize();
  HR.toolOrigin = out => out.copy(HR.smooth[8]);
  HR.speed = 0.05;
  swordSwing(HR);
  ok(n3.hp < 100, 'меч нанёс урон: hp 100 -> ' + n3.hp);
  VR123.spawnNPC(new THREE.Vector3(6, 0, -6));
  step(1);
  const n4 = VR123.npcs[VR123.npcs.length - 1];
  swordSwing(HR);
  ok(n4.hp === 100, 'дальнего нпс меч не достаёт');

  VR123.clearWorld();
  VR123.spawnNPC(new THREE.Vector3(0, 0, -4));
  step(1);
  const n5 = VR123.npcs[0], dd0 = n5.g.position.length();
  step(90);
  ok(n5.g.position.length() < dd0 - 0.2, 'нпс идёт на игрока: ' + dd0.toFixed(2) + ' -> ' + n5.g.position.length().toFixed(2) + ' м');
  const hp0 = VR123.state.hp; VR123.hurtPlayer(20, n5);
  ok(VR123.state.hp === hp0 - 20, 'урон игроку: ' + hp0 + ' -> ' + VR123.state.hp);
  VR123.state.hp = 5; VR123.hurtPlayer(50, n5);
  ok(VR123.state.hp === 100, 'смерть -> респаун с 100 hp');

  console.log('\n== наручное меню ==');
  const L = get('menuLayout')();
  const rows = Math.ceil(MENU_ITEMS.length / L.cols);
  ok(L.y0 + rows * (L.chh + L.gap) <= 512,
    'все ' + MENU_ITEMS.length + ' кнопок влезают в канвас 512px (низ=' + (L.y0 + rows * (L.chh + L.gap)) + ')');
  let hitOk = 0;
  drawn.fill = 0; drawMenu();
  ok(drawn.fill >= MENU_ITEMS.length + 1, 'отрисовано фигур: ' + drawn.fill + ' (фон + ' + MENU_ITEMS.length + ' кнопок)');
  for (let i = 0; i < MENU_ITEMS.length; i++) {
    const cx = L.x0 + (i % L.cols) * (L.cw + L.gap) + L.cw / 2;
    const cy = L.y0 + Math.floor(i / L.cols) * (L.chh + L.gap) + L.chh / 2;
    if (VR123.menuIndexAt(cx / 512, cy / 512) === i) hitOk++;
  }
  ok(hitOk === MENU_ITEMS.length, 'хит-тест попадает ровно в свою кнопку: ' + hitOk + '/' + MENU_ITEMS.length);
  ok(VR123.menuIndexAt(0.001, 0.002) === -1, 'клик в угол мимо кнопок -> -1');

  console.log('\n== камера / очистка ==');
  const cam = await toggleCamera();
  ok(cam === false && VR123.state.camHidden === true, 'камера: ошибка доступа проглочена, слой скрыт (её не видно)');
  VR123.spawnBlock(new THREE.Vector3(0, 0, -2));
  VR123.spawnCube(new THREE.Vector3(0, 1, 0));
  VR123.clearWorld();
  ok(VR123.bodies.length === 0 && VR123.decals.length === 0 &&
    VR123.npcs.length === 0 && VR123.blocks.length === 0,
    '«очистить» убирает всё: блоки ' + VR123.blocks.length + ', кубы ' + VR123.bodies.length +
    ', декали ' + VR123.decals.length + ', нпс ' + VR123.npcs.length);

  console.log('\n== стабильность ==');
  VR123.setTool('block');
  for (let i = 0; i < 40; i++) VR123.spawnBlock(new THREE.Vector3(i * 0.5 - 10, 0, -4));
  VR123.spawnHorde(4);
  VR123.state.hp = 100;
  step(2);
  let crash = null;
  try { step(900); } catch (e) { crash = e; }
  ok(!crash, '900 кадров (15 с игры) без исключений' + (crash ? ': ' + crash.message + '\n' + (crash.stack || '').split('\n')[1] : ''));
  ok(calls.render > 940, 'всего кадров отрисовано: ' + calls.render);
  ok(VR123.bodies.length <= 260, 'лимит тел не превышен: ' + VR123.bodies.length);

  console.log('\n' + (fail === 0 ? '✅ ВСЁ ЗЕЛЁНОЕ — ' + pass + ' проверок' : '❌ провалов: ' + fail + ' из ' + (pass + fail)));
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error('\nCRASH:', e); process.exit(2); });
