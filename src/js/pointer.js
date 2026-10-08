/* VR123 — указка: откуда берётся «взгляд» игрока в обоих режимах,
   луч до точки попадания и призрак блока с привязкой к сетке. */
'use strict';

VR123.pointer = (function () {
  const laser = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0025, 0.0025, 1, 6, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.5 })
  );
  laser.geometry.translate(0, 0.5, 0);      // растёт от основания
  laser.geometry.rotateX(Math.PI / 2);      // вдоль -Z
  laser.frustumCulled = false;
  laser.visible = false;
  scene.add(laser);

  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.022, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0x0891b2 })
  );
  dot.visible = false;
  scene.add(dot);

  const out = {
    origin: new THREE.Vector3(),
    dir: new THREE.Vector3(0, 0, -1),
    hit: null,
    point: new THREE.Vector3(),
    has: false,

    /* из какой руки/точки смотрим */
    update(hand) {
      if (VR123.state.mode === 'flat') {
        camera.getWorldPosition(this.origin);
        this.dir.set(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
      } else if (hand && hand.present) {
        this.origin.copy(hand.smooth[8]);
        this.dir.copy(hand.smooth[8]).sub(hand.smooth[0]).normalize();
      } else {
        camera.getWorldPosition(this.origin);
        this.dir.set(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
      }

      this.hit = VR123.rayWorld(this.origin, this.dir, 30);
      this.grounded = false;
      if (!this.hit && this.dir.y > -0.08) {
        // смотрим почти горизонтально: пробуй наклонённый вниз луч,
        // чтобы блоки можно было ставить и не целясь в пол носом
        const d2 = this.dir.clone();
        d2.y = -0.42;
        d2.normalize();
        const h2 = VR123.rayWorld(this.origin, d2, 30);
        if (h2) { this.hit = h2; this.dir.copy(d2); this.grounded = true; }
      }
      this.has = !!this.hit;
      if (this.hit) {
        this.point.copy(this.hit.point);
        dot.position.copy(this.hit.point);
        dot.visible = true;
        const len = Math.max(0.05, this.origin.distanceTo(this.hit.point));
        laser.position.copy(this.origin);
        laser.scale.set(1, 1, len);
        laser.lookAt(this.hit.point);
        laser.visible = true;
      } else {
        dot.visible = false;
        laser.visible = false;
      }

      // призрак блока — только когда выбран инструмент «блоки»
      if (VR123.state.tool === 'block' && this.has) {
        VR123.ghost.position.copy(VR123.snap(this.point));
        VR123.ghost.visible = true;
      } else {
        VR123.ghost.visible = false;
      }
    },

    /* точка, куда встанет блок */
    blockPos() {
      return this.has ? VR123.snap(this.point) : null;
    },

    setVisible(v) {
      if (!v) { laser.visible = false; dot.visible = false; VR123.ghost.visible = false; }
    }
  };
  return out;
})();
