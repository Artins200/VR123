/* VR123 — руки: трекинг кисти из камеры шлема, зеркальный аватар,
   который повторяет все движения руки и пальцев. Плюс контроллеры и мышь. */
'use strict';

/* Порядок суставов WebXR + из какого сустава «растёт» кость */
const JOINTS = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'
];
const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17]                 // ладонь
];

const HAND_MAT = new THREE.MeshStandardMaterial({ color: 0x1d1d22, roughness: 0.45, metalness: 0.1 });
const HAND_MAT_R = new THREE.MeshStandardMaterial({ color: 0x2a2a33, roughness: 0.45, metalness: 0.1 });
const JOINT_GEO = new THREE.SphereGeometry(1, 8, 6);
const BONE_GEO = new THREE.CylinderGeometry(1, 1, 1, 7, 1, true);
BONE_GEO.translate(0, 0.5, 0);               // растёт от основания вверх +Y

class VirtualHand {
  constructor(side) {
    this.side = side;                        // 'left' | 'right'
    this.group = new THREE.Group();
    this.group.visible = false;
    this.mat = side === 'left' ? HAND_MAT : HAND_MAT_R;

    this.jointPos = [];
    this.jointQuat = [];
    this.jointR = [];
    this.dotJoints = [];
    for (let i = 0; i < JOINTS.length; i++) {
      const p = new THREE.Vector3(); const q = new THREE.Quaternion();
      this.jointPos.push(p); this.jointQuat.push(q);
      this.jointR.push(0.012);
      const dot = new THREE.Mesh(JOINT_GEO, this.mat);
      dot.castShadow = false;
      this.group.add(dot); this.dotJoints.push(dot);
    }

    this.bones = [];
    for (let i = 0; i < BONES.length; i++) {
      const b = new THREE.Mesh(BONE_GEO, this.mat);
      this.group.add(b); this.bones.push(b);
    }
    // «ладонь» — плоская коробка между суставами
    this.palm = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.02), this.mat);
    this.group.add(this.palm);

    this.present = false;
    this.smooth = [];                        // сглаженные позиции (убираем дрожь)
    for (let i = 0; i < JOINTS.length; i++) this.smooth.push(new THREE.Vector3());
    this.smoothed = false;

    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.prevPos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.speed = 0;

    this.pinch = 0; this.pinchOn = false; this.pinchEdge = false; this.pinchRelease = false;
    this.grabbed = null;
    this.trigger = 0; this.triggerOn = false; this.triggerEdge = false;
    this.squeeze = 0; this.squeezeOn = false; this.squeezeEdge = false;
    this.holding = null;
  }

  /* Читает XRBone из руки шлема. Возвращает true если рука видна. */
  updateFromXR(xrHand, refSpace, frame) {
    if (!xrHand) { this.present = false; this.group.visible = false; return false; }
    let got = 0;
    for (let i = 0; i < JOINTS.length; i++) {
      const bone = xrHand.get(JOINTS[i]);
      if (!bone) continue;
      let pose;
      try { pose = frame.getJointPose(bone, refSpace); } catch (e) { pose = null; }
      if (!pose) continue;
      this.jointPos[i].set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
      this.jointQuat[i].set(pose.transform.orientation.x, pose.transform.orientation.y,
        pose.transform.orientation.z, pose.transform.orientation.w);
      this.jointR[i] = Math.max(0.005, pose.radius || 0.01);
      got++;
    }
    if (got < 12) { this.present = false; this.group.visible = false; return false; }

    this.present = true;
    this.group.visible = true;

    // сглаживание: 60% новая поза, 40% старая
    const k = 0.62;
    if (!this.smoothed) {
      for (let i = 0; i < this.jointPos.length; i++) this.smooth[i].copy(this.jointPos[i]);
      this.smoothed = true;
    } else {
      for (let i = 0; i < this.jointPos.length; i++) this.smooth[i].lerp(this.jointPos[i], k);
    }
    this.layout();
    this.updateGestures();
    return true;
  }

  /* Ручная поза (для режима без шлема и для контроллеров) */
  setPoseFromMatrix(pos, quat, pinch, trigger) {
    this.present = true;
    this.group.visible = true;
    const s = this.side === 'left' ? -1 : 1;
    // упрощённый скелет: строим палец из базовой позы + сгиб от pinch/trigger
    const curl = clamp(pinch, 0, 1) * 0.85 + clamp(trigger, 0, 1) * 0.5;
    const wrist = pos;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat).multiplyScalar(s);

    const setJ = (i, v) => this.jointPos[i].copy(v);
    setJ(0, wrist);
    const fingerDefs = [
      { base: 5, len: [0.055, 0.038, 0.026], off: 0.030 },   // index
      { base: 9, len: [0.060, 0.042, 0.028], off: 0.011 },   // middle
      { base: 13, len: [0.055, 0.038, 0.024], off: -0.008 }, // ring
      { base: 17, len: [0.045, 0.030, 0.020], off: -0.026 }  // pinky
    ];
    for (const f of fingerDefs) {
      let p = wrist.clone().add(right.clone().multiplyScalar(f.off)).add(up.clone().multiplyScalar(0.012));
      setJ(f.base, p);
      // 3 фаланги: proximal, distal, tip — ровно 4 сустава на палец
      for (let k = 0; k < f.len.length; k++) {
        const bend = curl * (0.5 + k * 0.3);
        const dir = fwd.clone().applyAxisAngle(right, -bend).add(up.clone().multiplyScalar(0.15 * (1 - curl)));
        p = p.clone().add(dir.normalize().multiplyScalar(f.len[k]));
        setJ(f.base + 1 + k, p);
      }
    }
    // большой палец
    {
      let p = wrist.clone().add(right.clone().multiplyScalar(s * 0.022)).add(up.clone().multiplyScalar(0.008));
      setJ(1, p);
      for (let k = 0; k < 3; k++) {
        const dir = fwd.clone().multiplyScalar(0.5).add(right.clone().multiplyScalar(s * 0.6)).add(up.clone().multiplyScalar(0.35 - curl * 0.5));
        p = p.clone().add(dir.normalize().multiplyScalar(0.026 - k * 0.004));
        setJ(2 + k, p);
      }
    }
    for (let i = 0; i < JOINTS.length; i++) this.jointR[i] = 0.011;
    for (let i = 0; i < JOINTS.length; i++) this.smooth[i].copy(this.jointPos[i]);
    this.smoothed = true;
    this.layout();
    this.pinch = pinch;
    this.trigger = trigger;
    this.updateGestures();
  }

  /* Строит меш из позиций суставов */
  layout() {
    const up = VR123.tmp.v1, dir = VR123.tmp.v2;
    for (let i = 0; i < this.dotJoints.length; i++) {
      const d = this.dotJoints[i];
      d.position.copy(this.smooth[i]);
      d.scale.setScalar(this.jointR[i]);
    }
    const q = VR123.tmp.q1;
    for (let i = 0; i < BONES.length; i++) {
      const [a, b] = BONES[i];
      const pa = this.smooth[a], pb = this.smooth[b];
      dir.subVectors(pb, pa);
      const len = dir.length();
      if (len < 1e-5) { this.bones[i].visible = false; continue; }
      this.bones[i].visible = true;
      this.bones[i].position.copy(pa);
      q.setFromUnitVectors(up.set(0, 1, 0), dir.multiplyScalar(1 / len));
      this.bones[i].quaternion.copy(q);
      const r = Math.min(this.jointR[a], this.jointR[b]) * 0.82;
      this.bones[i].scale.set(r, len, r);
    }
    // ладонь
    const c = this.palm.position;
    c.set(0, 0, 0)
      .add(this.smooth[0]).add(this.smooth[5]).add(this.smooth[17]).add(this.smooth[9])
      .multiplyScalar(0.25);
    const w = this.smooth[5].distanceTo(this.smooth[17]);
    const h = this.smooth[9].distanceTo(this.smooth[0]);
    this.palm.scale.set(w * 0.92, h * 0.85, 1);
    // ориентация ладони по трём точкам
    const m = VR123.tmp.m1;
    const n = new THREE.Vector3().subVectors(this.smooth[5], this.smooth[0]).cross(
      new THREE.Vector3().subVectors(this.smooth[17], this.smooth[0])).normalize();
    const xA = new THREE.Vector3().subVectors(this.smooth[17], this.smooth[5]).normalize();
    const yA = new THREE.Vector3().crossVectors(n, xA).normalize();
    m.makeBasis(xA, yA, n);
    this.palm.quaternion.setFromRotationMatrix(m);

    // сводные pos/quat/speed (для инструментов)
    this.prevPos.copy(this.pos);
    this.pos.copy(this.smooth[0]);
    const tipIdx = 8, tipMid = 12;
    this.quat.setFromRotationMatrix(m);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quat);
    const toTip = this.smooth[tipMid].clone().sub(this.smooth[0]).normalize();
    this.quat.setFromUnitVectors(new THREE.Vector3(0, 0, -1), toTip);
    this.vel.copy(this.pos).sub(this.prevPos);
    this.speed = this.vel.length();
    // точка «дула» для инструментов — чуть впереди указательного
    this.muzzle = this.smooth[tipIdx].clone().add(toTip.clone().multiplyScalar(0.03));
  }

  updateGestures() {
    const d = this.smooth[4].distanceTo(this.smooth[8]);
    // нормируем по размеру кисти
    const scale = Math.max(0.05, this.smooth[0].distanceTo(this.smooth[9]));
    const t = clamp(1 - (d - scale * 0.22) / (scale * 0.55), 0, 1);
    this.pinch = t;
    const was = this.pinchOn;
    this.pinchOn = was ? t > 0.42 : t > 0.62;
    this.pinchEdge = this.pinchOn && !was;
    this.pinchRelease = !this.pinchOn && was;
    this.triggerOn = this.trigger > 0.5;
    this.squeezeOn = this.squeeze > 0.5;
  }

  /* Точка, из которой «стреляет»/«брызгает» инструмент.
     Без шлема — ровно из камеры, тем же лучом, что и лазер указки:
     иначе направление из прицела, а начало из руки, и луч уходит мимо. */
  toolOrigin(out) {
    const o = out || new THREE.Vector3();
    if (VR123.state.mode === 'flat') o.copy(VR123.pointer.origin);
    else o.copy(this.muzzle || this.smooth[8]);
    return o;
  }
  tip(out) { return (out || new THREE.Vector3()).copy(this.muzzle || this.smooth[8]); }
  /* Куда бьёт инструмент. В VR — вдоль пальцев (так честнее),
     а без шлема — ровно из перекрестья: виртуальная рука прикреплена к камере
     со смещением, и её собственное направление уходит мимо прицела. */
  toolAim(out) {
    const d = out || new THREE.Vector3();
    if (VR123.state.mode === 'flat') d.copy(VR123.pointer.dir);
    else d.subVectors(this.smooth[8], this.smooth[0]).normalize();
    return d;
  }
  aimDir(out) {
    const d = out || new THREE.Vector3();
    d.subVectors(this.smooth[8], this.smooth[0]).normalize();
    return d;
  }
}

/* ------------------------------------------------------------------ *
 *  Менеджер рук: XR-руки → XR-контроллеры → мышь
 * ------------------------------------------------------------------ */
const Hands = {
  left: new VirtualHand('left'),
  right: new VirtualHand('right'),
  sources: new Map(),
  mode: 'none',          // hands | controllers | mouse
  refSpace: null,

  init() {
    rig.add(this.left.group);
    rig.add(this.right.group);

    const xr = renderer.xr;
    xr.addEventListener('sessionstart', () => {
      const s = xr.getSession();
      this.mode = s.enabledFeatures && s.enabledFeatures.includes('hand-tracking') ? 'hands' : 'controllers';
      s.addEventListener('inputsourceschange', (e) => {
        for (const src of e.added) this.attach(src);
        for (const src of e.removed) this.detach(src);
      });
      for (const src of s.inputSources) this.attach(src);
    });
    xr.addEventListener('sessionend', () => {
      this.sources.clear();
      this.left.present = this.right.present = false;
      this.left.group.visible = this.right.group.visible = false;
    });
  },

  attach(src) {
    this.sources.set(src, { src });
    if (src.hand) this.mode = 'hands';
  },
  detach(src) {
    const rec = this.sources.get(src);
    if (rec && rec.holder) scene.remove(rec.holder);
    this.sources.delete(src);
  },

  handFor(src) {
    return src.handedness === 'left' ? this.left : this.right;
  },

  update(frame) {
    this.refSpace = renderer.xr.getReferenceSpace();
    let anyHand = false;
    for (const [src] of this.sources) {
      const h = this.handFor(src);
      if (src.hand && frame) {
        if (h.updateFromXR(src.hand, this.refSpace, frame)) anyHand = true;
        continue;
      }
      // контроллер
      if (src.targetRaySpace && frame && this.refSpace) {
        let pose = null;
        try { pose = frame.getPose(src.targetRaySpace, this.refSpace); } catch (e) { }
        if (pose) {
          const p = pose.transform.position, o = pose.transform.orientation;
          VR123.tmp.v3.set(p.x, p.y, p.z);
          VR123.tmp.q1.set(o.x, o.y, o.z, o.w);
          const gp = src.gamepad;
          let trig = 0, sq = 0;
          if (gp && gp.buttons) {
            trig = (gp.buttons[0] && gp.buttons[0].value) || 0;
            sq = (gp.buttons[1] && gp.buttons[1].value) || (gp.buttons[2] && gp.buttons[2].value) || 0;
          }
          h.trigger = trig; h.squeeze = sq;
          h.setPoseFromMatrix(VR123.tmp.v3, VR123.tmp.q1, trig, trig);
          anyHand = true;
        }
      }
    }
    if (this.mode === 'hands' && anyHand) {
      this.left.group.visible = this.left.present;
      this.right.group.visible = this.right.present;
    }
  }
};

/* ------------------------------------------------------------------ *
 *  Мышиный/тач-режим (без шлема)
 * ------------------------------------------------------------------ */
const Flat = {
  yaw: 0, pitch: -0.34, dragging: false, lastX: 0, lastY: 0, down: false,
  keys: {}, speed: 3.4,

  init() {
    const c = renderer.domElement;
    c.addEventListener('mousedown', e => { this.down = true; this.dragging = e.button === 2; this.lastX = e.clientX; this.lastY = e.clientY; VR123.fire(true); });
    window.addEventListener('mouseup', e => { this.down = false; this.dragging = false; VR123.fire(false); });
    window.addEventListener('mousemove', e => {
      if (this.dragging) {
        this.yaw -= (e.clientX - this.lastX) * 0.0035;
        this.pitch = clamp(this.pitch - (e.clientY - this.lastY) * 0.0035, -1.45, 0.9);
      }
      this.lastX = e.clientX; this.lastY = e.clientY;
    });
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('touchstart', e => {
      const t = e.touches[0]; this.lastX = t.clientX; this.lastY = t.clientY;
      this.dragging = true; this.down = true; VR123.fire(true);
    }, { passive: true });
    c.addEventListener('touchmove', e => {
      const t = e.touches[0];
      this.yaw -= (t.clientX - this.lastX) * 0.005;
      this.pitch = clamp(this.pitch - (t.clientY - this.lastY) * 0.005, -1.45, 0.9);
      this.lastX = t.clientX; this.lastY = t.clientY;
    }, { passive: true });
    c.addEventListener('touchend', () => { this.dragging = false; this.down = false; VR123.fire(false); });
    window.addEventListener('keydown', e => {
      this.keys[e.code] = true;
      const map = { Digit1: 'hand', Digit2: 'block', Digit3: 'spray', Digit4: 'weld',
        Digit5: 'pistol', Digit6: 'rifle', Digit7: 'sword', Digit8: 'del' };
      if (map[e.code]) VR123.setTool(map[e.code]);
      if (e.code === 'KeyN') VR123.spawnNPC();
      if (e.code === 'KeyC') toggleCamera();
      if (e.code === 'KeyB') VR123.placeAtPointer();
      if (e.code === 'KeyX') VR123.deleteAt(VR123.pointer.origin, VR123.pointer.dir);
    });
    window.addEventListener('keyup', e => this.keys[e.code] = false);
  },

  update(dt) {
    camera.rotation.set(0, 0, 0);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = this.yaw;
    camera.rotation.x = this.pitch;
    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const mv = new THREE.Vector3();
    if (this.keys['KeyW'] || this.keys['ArrowUp']) mv.add(f);
    if (this.keys['KeyS'] || this.keys['ArrowDown']) mv.sub(f);
    if (this.keys['KeyD'] || this.keys['ArrowRight']) mv.add(r);
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) mv.sub(r);
    if (mv.lengthSq() > 0) {
      mv.normalize().multiplyScalar(this.speed * dt);
      rig.position.add(mv);
    }
    camera.position.set(0, 1.6, 0);

    // виртуальная правая рука следует за прицелом
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
    const hp = new THREE.Vector3().copy(camera.position).add(dir.clone().multiplyScalar(0.35))
      .add(new THREE.Vector3(0.16, -0.18, 0)).add(rig.position).sub(rig.position);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    const h = Hands.right;
    h.setPoseFromMatrix(hp, q, this.down ? 1 : 0, this.down ? 1 : 0);
    const hl = Hands.left;
    const lp = new THREE.Vector3(-0.2, -0.22, 0.3);
    hl.setPoseFromMatrix(lp, new THREE.Quaternion(), 0, 0);
  }
};
