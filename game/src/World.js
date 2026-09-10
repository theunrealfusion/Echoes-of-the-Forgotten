/**
 * @file World.js
 * @description Zone management: loading, environment setup, procedural fallback
 *              geometry, echo trigger placement, and void→restored transitions.
 *
 * Zone lifecycle:
 *   loadZone() → places buildings (GLB or procedural fallback)
 *   placeEchoTriggers() → invisible sphere sentinels
 *   restoreZone()  → called each time a new echo is collected (0→1 progress)
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ─────────────────────────────────────────────────────────────────────────────
// Zone configuration constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ZoneConfig
 * @property {string}   id
 * @property {string}   name
 * @property {string}   flavor           - Lore blurb shown on zone entry
 * @property {string}   restoration_message
 * @property {number[]} position         - [x, y, z] world-space center
 * @property {number}   radius           - Zone boundary radius (metres)
 * @property {number}   echo_count       - Number of echoes to restore the zone
 * @property {string}   color_theme      - Hex accent colour for this zone
 * @property {string[]} model_files      - Relative paths to GLB assets
 */

/** @type {Record<string, ZoneConfig>} */
export const ZONE_CONFIGS = {
  sunken_library: {
    id:     'sunken_library',
    name:   'The Sunken Library',
    flavor: 'Tomes older than memory lie half-submerged in silence.',
    restoration_message: 'Ancient pages unfurl once more, and long-forgotten words drift through restored halls.',
    position:   [0, 0, 0],
    radius:     60,
    echo_count: 7,
    color_theme:'#6366f1',
    model_files: [
      'models/sunken_library/library_main.glb',
      'models/sunken_library/reading_alcove.glb',
      'models/sunken_library/archive_tower.glb',
    ],
  },
  sky_nomads: {
    id:     'sky_nomads',
    name:   'Sky Nomads Quarter',
    flavor: 'Wind-worn platforms drift above the void, carrying the last of their songs.',
    restoration_message: 'The wind-ships anchor again, and music returns on the upper currents.',
    position:   [200, 80, -100],
    radius:     50,
    echo_count: 6,
    color_theme:'#22d3ee',
    model_files: [
      'models/sky_nomads/floating_platform.glb',
      'models/sky_nomads/wind_shrine.glb',
    ],
  },
  deep_forge: {
    id:     'deep_forge',
    name:   'The Deep Forge',
    flavor: 'Hammers fell silent long ago, but the embers still remember the shape of things made.',
    restoration_message: 'Bellows breathe again; the forge sings its iron song into the dark.',
    position:   [-150, -30, 120],
    radius:     55,
    echo_count: 8,
    color_theme:'#f97316',
    model_files: [
      'models/deep_forge/forge_central.glb',
      'models/deep_forge/cooling_vats.glb',
      'models/deep_forge/smith_quarters.glb',
    ],
  },
  memory_gardens: {
    id:     'memory_gardens',
    name:   'Memory Gardens',
    flavor: 'Every petal holds the face of someone who once walked here.',
    restoration_message: 'Blossoms return with impossible colours, and the air carries names aloud.',
    position:   [80, 0, 200],
    radius:     45,
    echo_count: 5,
    color_theme:'#34d399',
    model_files: [
      'models/memory_gardens/pavilion.glb',
      'models/memory_gardens/fountain_of_names.glb',
    ],
  },
  grand_reunion: {
    id:     'grand_reunion',
    name:   'Grand Reunion Hall',
    flavor: 'The last gathering place — where all roads of the forgotten city converged.',
    restoration_message: 'Every restored zone pulses in unison. The city breathes again, whole and remembered.',
    position:   [0, 0, -300],
    radius:     80,
    echo_count: 10,
    color_theme:'#f5c842',
    model_files: [
      'models/grand_reunion/great_hall.glb',
      'models/grand_reunion/ceremonial_arch.glb',
      'models/grand_reunion/bell_tower.glb',
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Procedural building styles used as GLB fallbacks
// ─────────────────────────────────────────────────────────────────────────────

/** @typedef {'tower'|'dome'|'arch'|'slab'|'cluster'} BuildingStyle */

// ─────────────────────────────────────────────────────────────────────────────
// World class
// ─────────────────────────────────────────────────────────────────────────────

export class World {
  /**
   * @param {THREE.Scene}  scene
   * @param {string}       tripoManifestPath  - Path to asset manifest JSON
   */
  constructor(scene, tripoManifestPath) {
    /** @type {THREE.Scene} */
    this.scene = scene;

    /** @type {string} */
    this.manifestPath = tripoManifestPath;

    /** @type {GLTFLoader} */
    this.loader = new GLTFLoader();

    /**
     * Tracks all THREE.Group objects placed per zone.
     * @type {Map<string, THREE.Group[]>}
     */
    this.zoneObjects = new Map();

    /**
     * Invisible sphere meshes used as echo proximity triggers.
     * @type {Map<string, THREE.Mesh[]>}
     */
    this.echoTriggers = new Map();

    /**
     * Ambient particle systems per zone.
     * @type {Map<string, THREE.Points>}
     */
    this.zoneParticles = new Map();

    /** @type {THREE.FogExp2 | null} */
    this.fog = null;

    // Void ambient light — very dim, colour-tinted
    this._ambientLight = new THREE.AmbientLight(0x1a0830, 0.4);
    scene.add(this._ambientLight);
  }

  // ── Environment setup ────────────────────────────────────────────────────

  /**
   * Creates the dark void environment: exponential fog, a hemisphere light,
   * a directional "star" light, and a field of floating ambient particles.
   */
  createVoidEnvironment() {
    // Deep purple-black exponential fog
    this.fog = new THREE.FogExp2(0x05020d, 0.008);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(0x05020d);

    // Dim hemisphere light — sky slightly lighter than ground
    const hemi = new THREE.HemisphereLight(0x200840, 0x080310, 0.3);
    this.scene.add(hemi);

    // Faint directional "starlight"
    const star = new THREE.DirectionalLight(0xc8a2f5, 0.5);
    star.position.set(0.3, 1, 0.5).normalize();
    star.castShadow = false;
    this.scene.add(star);

    // Ambient void particle field
    this._createGlobalParticleField();
  }

  /**
   * Creates a large field of slowly drifting void particles for atmosphere.
   * @private
   */
  _createGlobalParticleField() {
    const COUNT = 3000;
    const positions = new Float32Array(COUNT * 3);
    const colors    = new Float32Array(COUNT * 3);
    const spread    = 800;

    for (let i = 0; i < COUNT; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * spread;
      positions[i * 3 + 1] = (Math.random() - 0.5) * spread;
      positions[i * 3 + 2] = (Math.random() - 0.5) * spread;

      // Subtle purple tint with variation
      colors[i * 3]     = 0.3 + Math.random() * 0.3;
      colors[i * 3 + 1] = 0.1 + Math.random() * 0.15;
      colors[i * 3 + 2] = 0.5 + Math.random() * 0.4;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(colors,    3));

    const mat = new THREE.PointsMaterial({
      size:         0.8,
      vertexColors: true,
      transparent:  true,
      opacity:      0.4,
      sizeAttenuation: true,
    });

    const pts = new THREE.Points(geo, mat);
    pts.name  = 'void_field';
    this.scene.add(pts);
    this._globalParticles = pts;
  }

  // ── Zone loading ──────────────────────────────────────────────────────────

  /**
   * Loads all buildings for a zone. For each model file listed in the zone
   * config, it attempts a GLB load; on failure, a procedural placeholder is
   * placed instead.
   *
   * @param {string} zoneId
   * @returns {Promise<void>}
   */
  async loadZone(zoneId) {
    const cfg = ZONE_CONFIGS[zoneId];
    if (!cfg) throw new Error(`Unknown zone: ${zoneId}`);

    const group = new THREE.Group();
    group.name  = `zone_${zoneId}`;
    const [cx, cy, cz] = cfg.position;
    group.position.set(cx, cy, cz);

    const placed = [];

    // Arrangement: spread buildings around the zone centre
    const slots = this._generateSlots(cfg.model_files.length, cfg.radius * 0.6);

    for (let i = 0; i < cfg.model_files.length; i++) {
      const slot = slots[i];
      let obj;
      try {
        obj = await this._loadGLB(cfg.model_files[i]);
        obj.position.copy(slot.position);
        obj.rotation.y = slot.rotation;
      } catch (_) {
        // Fallback: procedural placeholder
        const style = this._styleForIndex(i);
        obj = this.createProceduralBuilding(style, slot.position, slot.scale);
      }
      group.add(obj);
      placed.push(obj);
    }

    // Zone-specific accent lighting
    const accentColor = new THREE.Color(cfg.color_theme);
    const pointLight  = new THREE.PointLight(accentColor, 2, cfg.radius * 1.5);
    pointLight.position.set(0, 15, 0);
    group.add(pointLight);

    this.scene.add(group);
    this.zoneObjects.set(zoneId, placed);

    // Place echo triggers
    this.placeEchoTriggers(zoneId, this._generateEchoPositions(cfg));
  }

  /**
   * Attempts to load a GLB file.
   * @param {string} path
   * @returns {Promise<THREE.Group>}
   * @private
   */
  _loadGLB(path) {
    return new Promise((resolve, reject) => {
      this.loader.load(
        path,
        gltf => {
          const root = gltf.scene;
          root.traverse(child => {
            if (/** @type {any} */ (child).isMesh) {
              child.castShadow    = true;
              child.receiveShadow = true;
            }
          });
          resolve(root);
        },
        undefined,
        err => reject(err),
      );
    });
  }

  /**
   * Returns an array of {position, rotation, scale} slots arranged in a ring.
   * @param {number} count
   * @param {number} radius
   * @returns {{ position: THREE.Vector3, rotation: number, scale: THREE.Vector3 }[]}
   * @private
   */
  _generateSlots(count, radius) {
    return Array.from({ length: count }, (_, i) => {
      const angle    = (i / count) * Math.PI * 2;
      const jitter   = (Math.random() - 0.5) * radius * 0.3;
      const dist     = radius * (0.5 + Math.random() * 0.5);
      const scaleFac = 0.8 + Math.random() * 0.6;
      return {
        position: new THREE.Vector3(
          Math.cos(angle) * dist + jitter,
          0,
          Math.sin(angle) * dist + jitter,
        ),
        rotation: angle + Math.PI,
        scale: new THREE.Vector3(scaleFac, scaleFac, scaleFac),
      };
    });
  }

  /** @param {number} i @returns {BuildingStyle} @private */
  _styleForIndex(i) {
    const styles = /** @type {BuildingStyle[]} */ (['tower','dome','arch','slab','cluster']);
    return styles[i % styles.length];
  }

  /**
   * Generates candidate echo positions scattered within the zone.
   * @param {ZoneConfig} cfg
   * @returns {THREE.Vector3[]}
   * @private
   */
  _generateEchoPositions(cfg) {
    return Array.from({ length: cfg.echo_count }, () => {
      const angle = Math.random() * Math.PI * 2;
      const dist  = cfg.radius * (0.2 + Math.random() * 0.7);
      return new THREE.Vector3(
        Math.cos(angle) * dist,
        Math.random() * 4,
        Math.sin(angle) * dist,
      );
    });
  }

  // ── Procedural building generator ─────────────────────────────────────────

  /**
   * Creates a Three.js geometry stand-in for a missing GLB model.
   * The material is a custom ShaderMaterial that starts as a glowing wireframe
   * and can be transitioned to a solid opaque surface via the `u_progress`
   * uniform.
   *
   * @param {BuildingStyle} style
   * @param {THREE.Vector3} position
   * @param {THREE.Vector3} [scale]
   * @returns {THREE.Group}
   */
  createProceduralBuilding(style, position, scale) {
    const group = new THREE.Group();
    group.position.copy(position);
    if (scale) group.scale.copy(scale);

    const mat = this._makeVoidShaderMaterial(0xc8a2f5);

    let geo;
    switch (style) {
      case 'tower':
        geo = new THREE.CylinderGeometry(1, 1.5, 12, 8);
        break;
      case 'dome':
        geo = new THREE.SphereGeometry(5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
        break;
      case 'arch': {
        // Simple arch approximation: two pillars + lintel box
        const pillar   = new THREE.BoxGeometry(1, 8, 1);
        const lintel   = new THREE.BoxGeometry(6, 1, 1);
        const mL = new THREE.Mesh(pillar, mat.clone()); mL.position.set(-2.5, 4, 0);
        const mR = new THREE.Mesh(pillar, mat.clone()); mR.position.set( 2.5, 4, 0);
        const mT = new THREE.Mesh(lintel, mat.clone()); mT.position.set(0, 8.5, 0);
        group.add(mL, mR, mT);
        return group;
      }
      case 'cluster': {
        // Small cluster of boxes at random offsets
        for (let k = 0; k < 4; k++) {
          const cg = new THREE.BoxGeometry(
            1 + Math.random() * 2,
            2 + Math.random() * 6,
            1 + Math.random() * 2,
          );
          const cm = new THREE.Mesh(cg, mat.clone());
          cm.position.set((Math.random()-0.5)*6, 0, (Math.random()-0.5)*6);
          group.add(cm);
        }
        return group;
      }
      case 'slab':
      default:
        geo = new THREE.BoxGeometry(8, 5, 4);
        break;
    }

    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    group.add(mesh);
    return group;
  }

  /**
   * Creates the void wireframe+glow ShaderMaterial.
   * @param {number} color  - hex colour integer
   * @returns {THREE.ShaderMaterial}
   * @private
   */
  _makeVoidShaderMaterial(color) {
    const c = new THREE.Color(color);
    return new THREE.ShaderMaterial({
      uniforms: {
        u_color:    { value: c },
        u_progress: { value: 0.0 },   // 0 = full void wireframe, 1 = solid
        u_time:     { value: 0.0 },
      },
      vertexShader: /* glsl */`
        uniform float u_time;
        uniform float u_progress;
        varying vec3 v_position;
        varying vec3 v_normal;

        // Cheap pseudo-random
        float hash(vec3 p) {
          return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
        }

        void main() {
          v_position = position;
          v_normal   = normal;

          // Void-state: slight noise displacement
          float noise = (hash(position + u_time * 0.3) - 0.5) * (1.0 - u_progress) * 0.3;
          vec3  displaced = position + normal * noise;

          gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec3  u_color;
        uniform float u_progress;
        uniform float u_time;
        varying vec3  v_position;
        varying vec3  v_normal;

        // Edge detection approximation via derivative
        float wireframe(vec3 pos) {
          vec3 fw = abs(dFdx(pos)) + abs(dFdy(pos));
          vec3 val = smoothstep(vec3(0.0), fw * 1.5, fract(pos));
          return min(val.x, min(val.y, val.z));
        }

        void main() {
          float edge   = 1.0 - wireframe(v_position);
          float pulse  = 0.5 + 0.5 * sin(u_time * 2.0 + v_position.y);
          float voidM  = edge * pulse * (1.0 - u_progress);
          float solidM = u_progress;

          vec3 voidColor    = u_color * (0.8 + 0.4 * pulse);
          vec3 solidColor   = mix(u_color * 0.3, vec3(0.85, 0.8, 0.7), u_progress);

          vec3 finalColor = mix(voidColor, solidColor, u_progress);
          float alpha     = mix(voidM, 1.0, u_progress);

          gl_FragColor = vec4(finalColor, max(alpha, 0.05));
        }
      `,
      transparent:   true,
      side:          THREE.DoubleSide,
      depthWrite:    false,
    });
  }

  // ── Echo triggers ─────────────────────────────────────────────────────────

  /**
   * Places invisible sphere meshes that EchoSystem queries for proximity.
   * @param {string}           zoneId
   * @param {THREE.Vector3[]}  positions  - Local to zone group
   */
  placeEchoTriggers(zoneId, positions) {
    const cfg      = ZONE_CONFIGS[zoneId];
    const [cx,cy,cz] = cfg.position;
    const triggers = [];

    const geo = new THREE.SphereGeometry(2.5, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ visible: false });

    positions.forEach((pos, idx) => {
      const mesh        = new THREE.Mesh(geo, mat);
      mesh.position.set(cx + pos.x, cy + pos.y, cz + pos.z);
      mesh.userData     = { zoneId, echoIndex: idx, collected: false };
      mesh.name         = `echo_trigger_${zoneId}_${idx}`;
      this.scene.add(mesh);
      triggers.push(mesh);
    });

    this.echoTriggers.set(zoneId, triggers);
  }

  // ── Zone restoration transition ───────────────────────────────────────────

  /**
   * Called whenever a new echo is collected. Lerps zone atmosphere
   * (fog density, ambient light colour, particle opacity) from void to restored.
   *
   * @param {string} zoneId
   * @param {number} progress  0.0 → 1.0
   */
  restoreZone(zoneId, progress) {
    // Fog: thin out as city is restored
    if (this.fog) {
      this.fog.density = THREE.MathUtils.lerp(0.008, 0.002, progress);
    }

    // Ambient light: purple → warm golden
    this._ambientLight.color.lerpColors(
      new THREE.Color(0x1a0830),
      new THREE.Color(0x3d2810),
      progress,
    );
    this._ambientLight.intensity = THREE.MathUtils.lerp(0.4, 1.0, progress);

    // Scene background: dark void → warmer indigo
    this.scene.background = new THREE.Color(0x05020d).lerp(new THREE.Color(0x1a1020), progress);

    // Update shader uniforms on all procedural buildings in this zone
    const objs = this.zoneObjects.get(zoneId) ?? [];
    objs.forEach(obj => {
      obj.traverse(child => {
        const mesh = /** @type {any} */ (child);
        if (mesh.isMesh && mesh.material?.uniforms?.u_progress) {
          mesh.material.uniforms.u_progress.value = progress;
        }
      });
    });
  }

  // ── Tick (called by GameEngine) ───────────────────────────────────────────

  /**
   * Update animated shader time uniforms each frame.
   * @param {number} time  - total elapsed time (seconds)
   */
  tick(time) {
    this.scene.traverse(child => {
      const mesh = /** @type {any} */ (child);
      if (mesh.isMesh && mesh.material?.uniforms?.u_time !== undefined) {
        mesh.material.uniforms.u_time.value = time;
      }
    });
    // Slowly rotate the global void particle field
    if (this._globalParticles) {
      this._globalParticles.rotation.y += 0.00005;
    }
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  /**
   * @param {string} zoneId
   * @returns {ZoneConfig}
   */
  getZoneData(zoneId) {
    const cfg = ZONE_CONFIGS[zoneId];
    if (!cfg) throw new Error(`No zone config for: ${zoneId}`);
    return cfg;
  }

  /**
   * @param {string} zoneId
   * @returns {THREE.Mesh[]}
   */
  getEchoTriggers(zoneId) {
    return this.echoTriggers.get(zoneId) ?? [];
  }
}
