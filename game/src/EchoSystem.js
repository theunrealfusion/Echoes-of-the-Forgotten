/**
 * @file EchoSystem.js
 * @description Core gameplay mechanic — proximity-based echo detection,
 *              visual effects (pulsing orbs, burst particles, rings), and
 *              per-zone restoration progress tracking.
 *
 * Each echo is a glowing purple orb that pulses with a sine wave. When the
 * player walks within detection range the echo "fires": a particle burst
 * expands outward, a ring ripple fades, and the orb is removed. The echo
 * meter in the HUD then fills proportionally.
 */

import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Metres: how close the player must be to collect an echo. */
const DETECT_RADIUS = 4.0;

/** Metres: the range at which the echo orb starts glowing brighter. */
const PULSE_RADIUS  = 12.0;

/** Echo orb base colour (void purple). */
const ECHO_COLOR  = new THREE.Color(0xc8a2f5);

/** Burst colour when collected. */
const BURST_COLOR = new THREE.Color(0xe0c8ff);

// ─────────────────────────────────────────────────────────────────────────────
// EchoSystem
// ─────────────────────────────────────────────────────────────────────────────

export class EchoSystem {
  /**
   * @param {THREE.Scene}  scene
   * @param {THREE.Camera} camera
   * @param {import('./World.js').World} world
   */
  constructor(scene, camera, world) {
    this.scene  = scene;
    this.camera = camera;
    this.world  = world;

    /**
     * Active (uncollected) echo orb meshes per zone.
     * @type {Map<string, THREE.Mesh[]>}
     */
    this.echoOrbs = new Map();

    /**
     * Number of collected echoes per zone.
     * @type {Map<string, number>}
     */
    this.collectedCounts = new Map();

    /**
     * Total echo counts per zone (read from zone config).
     * @type {Map<string, number>}
     */
    this.totalCounts = new Map();

    /**
     * Active transient visual effects (burst particles, rings).
     * Each entry has a `mesh`, `age` (s), and `maxAge` (s).
     * @type {{ mesh: THREE.Object3D, age: number, maxAge: number }[]}
     */
    this.activeEffects = [];

    /** Elapsed time for sine-wave pulse animation. */
    this._time = 0;

    /** Raycaster for forward-look interaction detection. */
    this._ray = new THREE.Raycaster();
    this._ray.far = DETECT_RADIUS * 1.5;
  }

  // ── Zone initialisation ───────────────────────────────────────────────────

  /**
   * Spawns visible echo orbs for a zone using the trigger positions already
   * placed by World.placeEchoTriggers().
   *
   * @param {string}     zoneId
   * @param {import('./World.js').ZoneConfig} zoneData
   */
  initZone(zoneId, zoneData) {
    const triggers = this.world.getEchoTriggers(zoneId);
    const orbs     = [];

    this.collectedCounts.set(zoneId, 0);
    this.totalCounts.set(zoneId, zoneData.echo_count);

    triggers.forEach((trigger, idx) => {
      const orb = this._createEchoOrb(trigger.position, idx);
      this.scene.add(orb);
      orbs.push(orb);
    });

    this.echoOrbs.set(zoneId, orbs);
  }

  // ── Per-frame update ──────────────────────────────────────────────────────

  /**
   * Checks proximity between the player and all uncollected echo triggers,
   * updates pulsing animations, and collects nearby echoes.
   *
   * @param {number} delta          - seconds since last frame
   * @param {THREE.Vector3} playerPos
   * @returns {{ newEchoCollected: boolean, zoneId: string | null }}
   */
  update(delta, playerPos) {
    this._time += delta;
    let newEchoCollected = false;
    let collectedZone    = null;

    // Iterate over every active orb across all zones
    this.echoOrbs.forEach((orbs, zoneId) => {
      orbs.forEach(orb => {
        if (!orb.visible) return;

        const dist = orb.position.distanceTo(playerPos);

        // Proximity glow boost
        const proximity = 1 - Math.min(dist / PULSE_RADIUS, 1);
        const mat = /** @type {THREE.MeshStandardMaterial} */ (/** @type {THREE.Mesh} */ (orb).material);
        mat.emissiveIntensity = 0.5 + proximity * 1.5 + Math.sin(this._time * 3) * 0.2 * proximity;

        // Pulse scale animation
        const pulse = 1 + Math.sin(this._time * 2.5 + orb.userData.phaseOffset) * 0.08;
        orb.scale.setScalar(pulse);

        // Bob up and down
        orb.position.y = orb.userData.baseY + Math.sin(this._time * 1.2 + orb.userData.phaseOffset) * 0.25;

        // Collection check
        if (dist < DETECT_RADIUS) {
          const result = this.detectEcho(orb, zoneId);
          if (result.collected) {
            newEchoCollected = true;
            collectedZone    = zoneId;
          }
        }
      });
    });

    return { newEchoCollected, zoneId: collectedZone };
  }

  /**
   * Updates all transient visual effects (burst particles, rings).
   * Must be called every frame regardless of echo collection.
   * @param {number} delta
   */
  updateVisuals(delta) {
    for (let i = this.activeEffects.length - 1; i >= 0; i--) {
      const fx  = this.activeEffects[i];
      fx.age   += delta;
      const t   = fx.age / fx.maxAge;

      if (t >= 1) {
        this.scene.remove(fx.mesh);
        // Dispose geometry/material to avoid memory leaks
        const m = /** @type {any} */ (fx.mesh);
        m.geometry?.dispose();
        m.material?.dispose();
        this.activeEffects.splice(i, 1);
        continue;
      }

      // Expand and fade
      const scale = 1 + t * 3;
      fx.mesh.scale.setScalar(scale);
      const mat = /** @type {any} */ (fx.mesh).material;
      if (mat?.opacity !== undefined) mat.opacity = 1 - t;
    }
  }

  // ── Echo detection ────────────────────────────────────────────────────────

  /**
   * Marks an echo orb as collected, hides it, and spawns visual effects.
   * @param {THREE.Mesh}  orb
   * @param {string}      zoneId
   * @returns {{ collected: boolean }}
   */
  detectEcho(orb, zoneId) {
    if (orb.userData.collected) return { collected: false };
    orb.userData.collected = true;
    orb.visible = false;

    // Update count
    const prev = this.collectedCounts.get(zoneId) ?? 0;
    this.collectedCounts.set(zoneId, prev + 1);

    // Spawn burst + ring at orb position
    this.createEchoVisual(orb.position, BURST_COLOR);

    return { collected: true };
  }

  // ── Visual effects ────────────────────────────────────────────────────────

  /**
   * Creates a floating particle burst and a ripple ring at `position`.
   * Both are added to the scene and managed via `activeEffects`.
   *
   * @param {THREE.Vector3} position
   * @param {THREE.Color}   color
   */
  createEchoVisual(position, color) {
    // ── Particle burst ───────────────────────────────────────────────────────
    const COUNT     = 80;
    const positions = new Float32Array(COUNT * 3);
    const colours   = new Float32Array(COUNT * 3);

    for (let i = 0; i < COUNT; i++) {
      // Random unit sphere direction
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      positions[i*3]   = Math.sin(phi) * Math.cos(theta);
      positions[i*3+1] = Math.cos(phi);
      positions[i*3+2] = Math.sin(phi) * Math.sin(theta);

      // Slight colour variation
      colours[i*3]   = color.r * (0.8 + Math.random() * 0.2);
      colours[i*3+1] = color.g * (0.8 + Math.random() * 0.2);
      colours[i*3+2] = color.b * (0.8 + Math.random() * 0.4);
    }

    const burstGeo = new THREE.BufferGeometry();
    burstGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    burstGeo.setAttribute('color',    new THREE.BufferAttribute(colours,   3));

    const burstMat = new THREE.PointsMaterial({
      size:         0.25,
      vertexColors: true,
      transparent:  true,
      opacity:      1.0,
      sizeAttenuation: true,
      depthWrite:   false,
    });

    const burst = new THREE.Points(burstGeo, burstMat);
    burst.position.copy(position);
    this.scene.add(burst);
    this.activeEffects.push({ mesh: burst, age: 0, maxAge: 1.2 });

    // ── Ripple ring ──────────────────────────────────────────────────────────
    const ringGeo = new THREE.RingGeometry(0.5, 0.6, 32);
    ringGeo.rotateX(-Math.PI / 2);   // lay flat

    const ringMat = new THREE.MeshBasicMaterial({
      color:       color,
      transparent: true,
      opacity:     0.9,
      side:        THREE.DoubleSide,
      depthWrite:  false,
    });

    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.copy(position);
    this.scene.add(ring);
    this.activeEffects.push({ mesh: ring, age: 0, maxAge: 1.0 });

    // Second larger ring slightly delayed (simulated by smaller initial scale)
    const ring2 = ring.clone();
    ring2.scale.setScalar(0.5);
    this.scene.add(ring2);
    this.activeEffects.push({ mesh: ring2, age: 0, maxAge: 1.4 });
  }

  // ── Progress ──────────────────────────────────────────────────────────────

  /**
   * Returns the restoration fraction for a zone.
   * @param {string} zoneId
   * @returns {number}  0.0 – 1.0
   */
  getRestorationProgress(zoneId) {
    const collected = this.collectedCounts.get(zoneId) ?? 0;
    const total     = this.totalCounts.get(zoneId) ?? 1;
    return Math.min(collected / total, 1);
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Creates a glowing echo orb (sphere mesh) with its own pulsing material.
   * @param {THREE.Vector3} position
   * @param {number}        index       - used to offset the pulse phase
   * @returns {THREE.Mesh}
   * @private
   */
  _createEchoOrb(position, index) {
    const geo = new THREE.SphereGeometry(0.35, 16, 12);
    const mat = new THREE.MeshStandardMaterial({
      color:            ECHO_COLOR,
      emissive:         ECHO_COLOR,
      emissiveIntensity: 0.8,
      transparent:      true,
      opacity:          0.92,
      roughness:        0.1,
      metalness:        0.0,
    });

    const orb       = new THREE.Mesh(geo, mat);
    orb.position.copy(position);
    orb.userData    = {
      collected:   false,
      baseY:       position.y,
      phaseOffset: index * 1.3,    // distinct pulse timing per orb
    };
    orb.name = `echo_orb_${index}`;

    // Outer halo using additive blending
    const haloGeo = new THREE.SphereGeometry(0.7, 10, 8);
    const haloMat = new THREE.MeshBasicMaterial({
      color:       ECHO_COLOR,
      transparent: true,
      opacity:     0.12,
      side:        THREE.BackSide,
      depthWrite:  false,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    orb.add(halo);

    // Point light source so the orb illuminates nearby geometry
    const light = new THREE.PointLight(0xc8a2f5, 1.5, 8);
    orb.add(light);

    return orb;
  }
}
