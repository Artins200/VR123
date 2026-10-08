/* VR123 — НПС: боты, которые ходят, атакуют, ловят урон и разваливаются. */
'use strict';

const NPC_BODY = new THREE.CapsuleGeometry(0.22, 0.62, 4, 12);
const NPC_HEAD = new THREE.BoxGeometry(0.26, 0.26, 0.26);
const NPC_ARM = new THREE.BoxGeometry(0.09, 0.46, 0.09);
const NPC_LEG = new THREE.BoxGeometry(0.11, 0.5, 0.11);

class NPC {
  constructor(pos) {
    this.g = new THREE.Group();
    this.hp = 100;
    this.dead = false;
    this.deadT = 0;
    this.speed = rand(1.0, 1.9);
    this.state = 'idle';
    this.t = rand(0, 6);
    this.attackCd = rand(0.5, 1.5);
    this.hitFlash = 0;
    this.vel = new THREE.Vector3();

    const suit = new THREE.Color().setHSL(rand(0, 1), rand(0.15, 0.55), rand(0.35, 0.6));
    this.mat = new THREE.MeshStandardMaterial({ color: suit, roughness: 0.6, metalness: 0.15 });
    this.dark = new THREE.MeshStandardMaterial({ color: 0x1a1a20, roughness: 0.4, metalness: 0.3 });

    this.torso = new THREE.Mesh(NPC_BODY, this.mat);
    this.torso.position.y = 1.0; this.torso.castShadow = true;
    this.head = new THREE.Mesh(NPC_HEAD, this.dark);
    this.head.position.y = 1.56; this.head.castShadow = true;
    this.visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.02),
      new THREE.MeshBasicMaterial({ color: 0xff3355 }));
    this.visor.position.set(0, 1.58, -0.13);

    this.armL = new THREE.Mesh(NPC_ARM, this.mat);
    this.armL.position.set(-0.28, 1.12, 0); this.armL.castShadow = true;
    this.armR = new THREE.Mesh(NPC_ARM, this.mat);
    this.armR.position.set(0.28, 1.12, 0); this.armR.castShadow = true;
    this.legL = new THREE.Mesh(NPC_LEG, this.dark);
    this.legL.position.set(-0.11, 0.42, 0);
    this.legR = new THREE.Mesh(NPC_LEG, this.dark);
    this.legR.position.set(0.11, 0.42, 0);

    this.g.add(this.torso, this.head, this.visor, this.armL, this.armR, this.legL, this.legR);
    this.g.position.copy(pos);

    // хп-бар над головой
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.05),
      new THREE.MeshBasicMaterial({ color: 0x22c55e, side: THREE.DoubleSide }));
    bar.position.y = 1.92;
    this.bar = bar;
    const barBg = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.08),
      new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    barBg.position.y = 1.92; barBg.position.z = 0.001;
    this.barBg = barBg;
    this.g.add(barBg, bar);

    scene.add(this.g);
    // ВАЖНО: визор тоже поражается — иначе выстрел «в лицо» проходил насквозь,
    // потому что Raycaster попадал именно в него, а его не было в списке целей.
    this.parts = [this.torso, this.head, this.visor, this.armL, this.armR, this.legL, this.legR];
    VR123.npcs.push(this);
    VR123.hud();
  }

  damage(dmg, fromDir) {
    if (this.dead) return false;
    this.hp -= dmg;
    this.hitFlash = 0.18;
    this.state = 'chase';
    if (fromDir) { this.vel.add(fromDir.multiplyScalar(2.2)); this.vel.y = Math.max(this.vel.y, 1.2); }
    this.bar.material.color.setHex(this.hp > 55 ? 0x22c55e : this.hp > 25 ? 0xf59e0b : 0xef4444);
    this.bar.scale.x = clamp(this.hp / 100, 0.001, 1);
    if (this.hp <= 0) this.die();
    return true;
  }

  die() {
    this.dead = true;
    VR123.state.score += 100;
    VR123.log('нпс уничтожен · +100');
    Audio.thud();
    // развал на куски
    for (const p of this.parts) {
      const piece = new THREE.Mesh(p.geometry, p.material);
      const wp = new THREE.Vector3(); p.getWorldPosition(wp);
      scene.add(piece);
      piece.position.copy(wp);
      piece.rotation.copy(this.g.rotation);
      VR123.addFX(piece, rand(1.4, 2.4));
      const fx = VR123.fx[VR123.fx.length - 1];
      fx.v = new THREE.Vector3(rand(-1.4, 1.4), rand(1.6, 3.6), rand(-1.4, 1.4));
    }
    VR123.sparks(this.g.position.clone().setY(1.1), 18, null);
    scene.remove(this.g);
    const i = VR123.npcs.indexOf(this);
    if (i >= 0) VR123.npcs.splice(i, 1);
    VR123.hud();
  }

  update(dt, playerPos) {
    if (this.dead) return;
    this.t += dt;
    if (this.hitFlash > 0) {
      this.hitFlash -= dt;
      this.mat.emissive = this.mat.emissive || new THREE.Color();
      this.mat.emissive.setHex(0xff2222);
      this.mat.emissiveIntensity = Math.max(0, this.hitFlash * 5);
    } else if (this.mat.emissiveIntensity) {
      this.mat.emissiveIntensity = 0;
    }

    const to = VR123.tmp.v1.copy(playerPos).sub(this.g.position); to.y = 0;
    const dist = to.length();

    // лёгкая физика отбрасывания
    this.g.position.addScaledVector(this.vel, dt);
    this.vel.multiplyScalar(0.88);
    if (this.g.position.y < 0) { this.g.position.y = 0; this.vel.y = 0; }
    else if (this.g.position.y > 0) this.vel.y -= GRAV * dt;

    if (dist < 26) this.state = 'chase';
    if (this.state === 'chase' && dist > 0.001) {
      const dir = to.clone().normalize();
      if (dist > 1.05) this.g.position.addScaledVector(dir, this.speed * dt);
      this.g.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI;

      this.attackCd -= dt;
      if (dist < 1.6 && this.attackCd <= 0) {
        this.attackCd = 1.1;
        VR123.hurtPlayer(rand(4, 9), this);
      }
    } else {
      // блуждание
      if (Math.random() < 0.01) this.wander = rand(0, Math.PI * 2);
      if (this.wander != null) {
        this.g.position.x += Math.sin(this.wander) * this.speed * 0.35 * dt;
        this.g.position.z += Math.cos(this.wander) * this.speed * 0.35 * dt;
        this.g.rotation.y = this.wander;
      }
    }

    // ходьба — машем руками/ногами
    const moving = this.state === 'chase' && dist > 1.05;
    const sw = moving ? Math.sin(this.t * 9) : Math.sin(this.t * 1.6) * 0.2;
    this.armL.rotation.x = sw * 0.9;
    this.armR.rotation.x = -sw * 0.9;
    this.legL.rotation.x = -sw * 0.7;
    this.legR.rotation.x = sw * 0.7;
    this.g.position.y = Math.abs(Math.sin(this.t * 9)) * (moving ? 0.03 : 0.006);

    // бар смотрит на игрока
    this.bar.lookAt(playerPos);
    this.barBg.lookAt(playerPos);
  }
}

VR123.spawnNPC = function (at) {
  const pp = VR123.playerPos(VR123.tmp.v2);
  let p;
  if (at) {
    p = at.clone();
  } else {
    // ставим туда, куда смотрит указка — так нпс появляется ровно там, куда ты целишься
    const ptr = VR123.pointer;
    if (ptr && ptr.has && VR123.state.mode !== 'menu') {
      p = new THREE.Vector3(ptr.point.x, 0, ptr.point.z);
    } else {
      const a = rand(0, Math.PI * 2), r = rand(5, 13);
      p = new THREE.Vector3(pp.x + Math.cos(a) * r, 0, pp.z + Math.sin(a) * r);
    }
  }
  // не спавним впритык к игроку
  if (p.distanceTo(new THREE.Vector3(pp.x, 0, pp.z)) < 1.2) {
    const away = p.clone().sub(pp).setY(0);
    if (away.lengthSq() < 1e-6) away.set(0, 0, -1);
    p = new THREE.Vector3(pp.x, 0, pp.z).add(away.normalize().multiplyScalar(1.6));
  }
  const n = new NPC(p);
  VR123.log('нпс заспавнен');
  return n;
};

VR123.spawnHorde = function (n) {
  for (let i = 0; i < (n || 5); i++) VR123.spawnNPC();
  VR123.log('орда: ' + (n || 5) + ' нпс');
};

VR123.hurtPlayer = function (dmg, from) {
  VR123.state.hp = clamp(VR123.state.hp - dmg, 0, 100);
  VR123.hud();
  Audio.thud();
  document.body.style.transition = 'none';
  document.body.style.boxShadow = 'inset 0 0 200px rgba(255,0,0,.55)';
  setTimeout(() => {
    document.body.style.transition = 'box-shadow .35s';
    document.body.style.boxShadow = 'inset 0 0 0 rgba(255,0,0,0)';
  }, 40);
  if (VR123.state.hp <= 0) {
    VR123.state.hp = 100;
    VR123.state.score = Math.max(0, VR123.state.score - 200);
    VR123.log('тебя вырубили · −200 · возрождение');
    rig.position.set(0, 0, 0);
  }
  VR123.hud();
};

VR123.updateNPCs = function (dt) {
  const pp = VR123.playerPos(new THREE.Vector3());
  for (const n of VR123.npcs) n.update(dt, pp);
  // нпс иногда кидают кубики в игрока
  if (VR123.npcs.length && Math.random() < dt * 0.12) {
    const n = VR123.npcs[(Math.random() * VR123.npcs.length) | 0];
    if (n && !n.dead) {
      const from = n.g.position.clone().setY(1.3);
      const b = VR123.spawnCube(from, new THREE.Vector3(0, 3, 0), 0xff3355);
      const d = VR123.tmp.v3.copy(pp).sub(from); d.y += 1.0;
      const t = d.length() / 7;
      b.vx = d.x / t; b.vy = d.y / t + 0.5 * GRAV * t * 0.5; b.vz = d.z / t;
    }
  }
};
