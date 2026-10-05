/**
 * @file RestorationSystem.js
 * @description Manages the void → restored city material transition.
 *
 * Key responsibilities:
 *  • VoidMaterial  — custom ShaderMaterial: dark wireframe + purple glow,
 *                    vertex noise displacement, animated pulse.
 *  • RestoredMaterial — MeshStandardMaterial with warm PBR values.
 *  • applyVoidMaterialToScene() — replaces all mesh materials in the scene.
 *  • restore() — per-frame lerp of u_progress uniform and emissive tints.
 *  • playRestorationAnimation() — 3-second grand reveal: golden light sweep,
 *    particle explosion, full material transition.
 */

import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// Vertex shader — shared by VoidMaterial
// Applies a per-vertex noise displacement that fades out as progress → 1.
// ─────────────────────────────────────────────────────────────────────────────

const VOID_VERT = /* glsl */`
  uniform float u_time;
  uniform float u_progress;
  varying vec3  v_normal;
  varying vec3  v_position;

  void main() {
    v_normal   = normal;
    v_position = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Fragment shader — wireframe fades out, solid surface fades in.
// Uses dFdx/dFdy to produce a screen-space wireframe without geometry changes.
// ─────────────────────────────────────────────────────────────────────────────

const VOID_FRAG = /* glsl */`
  uniform vec3  u_voidColor;
  uniform vec3  u_restoreColor;
  uniform float u_progress;
  uniform float u_time;
  varying vec3  v_normal;
  varying vec3  v_position;

  // Edge weight via screen-space derivatives
  float wireframeEdge(vec3 pos) {
    vec3 dx = abs(dFdx(pos));
    vec3 dy = abs(dFdy(pos));
    vec3 fw = dx + dy;
    vec3 val = smoothstep(vec3(0.0), fw * 1.8, fract(pos * 1.5));
    return 1.0 - min(val.x, min(val.y, val.z));
  }

  void main() {
    // Wireframe contribution
    float edge      = wireframeEdge(v_position);
    float pulse     = 0.5 + 0.5 * sin(u_time * 2.0 + v_position.y * 0.5);
    
    // Void base stone with colored edge highlights
    vec3 baseVoid   = vec3(0.09, 0.08, 0.13);
    vec3 edgeCol    = u_voidColor * 0.7;
    vec3 voidCol    = mix(baseVoid, edgeCol, edge * (0.4 + 0.3 * pulse));

    // Restored colour: warm architectural stone with directional lighting
    float nDotL     = max(dot(normalize(v_normal), vec3(0.3, 1.0, 0.5)), 0.0);
    vec3  restCol   = u_restoreColor * (0.6 + 0.4 * nDotL);

    // Blend between void and restored
    vec3  finalCol  = mix(voidCol, restCol, u_progress);

    // Subtle golden highlight during final transition
    float shimmer  = smoothstep(0.85, 1.0, u_progress) * sin(u_time * 4.0 + v_position.x) * 0.1;
    finalCol      += vec3(shimmer * 0.8, shimmer * 0.5, 0.0);

    gl_FragColor = vec4(finalCol, 1.0);
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// RestorationSystem
// ─────────────────────────────────────────────────────────────────────────────

export class RestorationSystem {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;

    /** All tracked void-shader meshes (for bulk u_progress / u_time updates). */
    this._trackedMeshes = /** @type {THREE.Mesh[]} */ ([]);

    /** Elapsed time (fed from GameEngine). */
    this._time = 0;

    /** Promise resolver for playRestorationAnimation(). */
    this._revealResolve = null;
  }

  // ── Material factories ────────────────────────────────────────────────────

  /**
   * Creates a new VoidMaterial (ShaderMaterial).
   * Uniforms can be tweened by calling restore().
   *
   * @param {number} [voidColorHex=0xc8a2f5]
   * @param {number} [restoreColorHex=0xe8d5a3]
   * @returns {THREE.ShaderMaterial}
   */
  static createVoidMaterial(voidColorHex = 0xc8a2f5, restoreColorHex = 0xe8d5a3) {
    return new THREE.ShaderMaterial({
      uniforms: {
        u_voidColor:    { value: new THREE.Color(voidColorHex) },
        u_restoreColor: { value: new THREE.Color(restoreColorHex) },
        u_progress:     { value: 0.0 },
        u_time:         { value: 0.0 },
      },
      vertexShader:   VOID_VERT,
      fragmentShader: VOID_FRAG,
      transparent:    false,
      side:           THREE.DoubleSide,
      depthWrite:     true,
    });
  }

  /**
   * Creates a standard PBR material for the fully-restored state.
   * (Used as a reference; the shader's restored colour is blended in-place.)
   *
   * @param {THREE.Color} color
   * @returns {THREE.MeshStandardMaterial}
   */
  static createRestoredMaterial(color) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness:   0.6,
      metalness:   0.1,
      envMapIntensity: 0.4,
    });
  }

  // ── Scene-wide application ────────────────────────────────────────────────

  /**
   * Traverses meshes that are NOT real 3D models and gives them void shaders.
   *
   * @param {THREE.Scene} scene
   */
  applyVoidMaterialToScene(scene) {
    scene.traverse(node => {
      const mesh = /** @type {any} */ (node);
      if (!mesh.isMesh) return;
      if (mesh.userData?.isOriginalModel) return; // Preserve real 3D models!
      if (mesh.name?.startsWith('echo_trigger')) return; // Trigger spheres must remain invisible
      if (mesh.userData?.collected !== undefined) return; // Echo orbs manage their own materials
      if (mesh.material?.visible === false) return; // Keep invisible helper meshes invisible
      if (mesh.material?.isShaderMaterial) return; // already void

      // Preserve original material for colour reference
      const orig  = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const baseCol = orig?.color ?? new THREE.Color(0xaaaaaa);

      const voidMat = RestorationSystem.createVoidMaterial(
        0xc8a2f5,
        baseCol.getHex(),
      );
      voidMat.userData.restoredColor = baseCol.clone();

      mesh.material = voidMat;
      mesh.userData.originalMaterial = orig;
      this._trackedMeshes.push(mesh);
    });
  }

  // ── Per-frame restoration lerp ────────────────────────────────────────────

  /**
   * Updates u_progress and u_time uniforms for all tracked meshes.
   * Called by GameEngine.update() with the current zone progress.
   *
   * @param {THREE.Scene} scene
   * @param {number}      progress  0.0 → 1.0
   */
  restore(scene, progress) {
    this._time += 0.016;  // approx, real delta applied via tick()

    this._trackedMeshes.forEach(mesh => {
      const mat = /** @type {any} */ (mesh.material);
      if (!mat?.uniforms) return;
      mat.uniforms.u_progress.value = THREE.MathUtils.lerp(
        mat.uniforms.u_progress.value,
        progress,
        0.05,          // smooth easing towards target
      );
      mat.uniforms.u_time.value = this._time;
    });
  }

  /**
   * Advances the time uniform each frame (called separately to keep smooth
   * animation even between echo collections).
   * @param {number} delta
   */
  tick(delta) {
    this._time += delta;
    this._trackedMeshes.forEach(mesh => {
      const mat = /** @type {any} */ (mesh.material);
      if (mat?.uniforms?.u_time !== undefined) {
        mat.uniforms.u_time.value = this._time;
      }
    });
  }

  // ── Grand reveal animation ────────────────────────────────────────────────

  /**
   * Plays the zone-restoration grand reveal:
   *  1. Forces u_progress → 1.0 over 3 seconds with an eased lerp.
   *  2. Expands a golden point-light sphere sweep from zone centre outward.
   *  3. Spawns an omnidirectional particle explosion.
   *  4. Resolves after the animation completes.
   *
   * @param {string}      zoneId
   * @param {THREE.Scene} scene
   * @returns {Promise<void>}
   */
  playRestorationAnimation(zoneId, scene) {
    return new Promise(resolve => {
      const DURATION = 3.0; // seconds
      let   elapsed  = 0;
      const start    = performance.now() / 1000;

      // Golden sweep light
      const sweepLight = new THREE.PointLight(0xf5c842, 0, 200);
      sweepLight.position.set(0, 5, 0);
      scene.add(sweepLight);

      // Particle explosion
      const explosion = this._createExplosionParticles(new THREE.Vector3(0, 2, 0));
      scene.add(explosion);

      const animate = () => {
        const now = performance.now() / 1000;
        elapsed   = now - start;
        const t   = Math.min(elapsed / DURATION, 1);

        // Eased progress: cubic ease-out
        const eased = 1 - Math.pow(1 - t, 3);

        // Sweep light intensity rises then falls (bell curve-ish)
        sweepLight.intensity = Math.sin(t * Math.PI) * 8;
        sweepLight.distance  = eased * 250;

        // Explosion scale grows
        explosion.scale.setScalar(1 + eased * 4);
        const eMat = /** @type {any} */ (explosion.material);
        if (eMat?.opacity !== undefined) eMat.opacity = 1 - t;

        // Force all tracked meshes to full restoration
        this._trackedMeshes.forEach(mesh => {
          const mat = /** @type {any} */ (mesh.material);
          if (mat?.uniforms?.u_progress) {
            mat.uniforms.u_progress.value = eased;
          }
        });

        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          // Cleanup
          scene.remove(sweepLight);
          scene.remove(explosion);
          const geo = /** @type {any} */ (explosion).geometry;
          const mat = /** @type {any} */ (explosion).material;
          geo?.dispose();
          mat?.dispose();
          resolve();
        }
      };

      requestAnimationFrame(animate);
    });
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Creates a spherical burst of golden particles centred at `origin`.
   * @param {THREE.Vector3} origin
   * @returns {THREE.Points}
   * @private
   */
  _createExplosionParticles(origin) {
    const COUNT     = 400;
    const positions = new Float32Array(COUNT * 3);
    const colors    = new Float32Array(COUNT * 3);

    for (let i = 0; i < COUNT; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      const r     = Math.random();

      positions[i*3]   = origin.x + Math.sin(phi) * Math.cos(theta) * r;
      positions[i*3+1] = origin.y + Math.cos(phi) * r;
      positions[i*3+2] = origin.z + Math.sin(phi) * Math.sin(theta) * r;

      // Gold → white gradient based on radius
      colors[i*3]   = 1.0;
      colors[i*3+1] = 0.7 + r * 0.3;
      colors[i*3+2] = 0.1 + r * 0.5;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(colors,    3));

    const mat = new THREE.PointsMaterial({
      size:         0.4,
      vertexColors: true,
      transparent:  true,
      opacity:      1.0,
      depthWrite:   false,
      sizeAttenuation: true,
    });

    return new THREE.Points(geo, mat);
  }
}
