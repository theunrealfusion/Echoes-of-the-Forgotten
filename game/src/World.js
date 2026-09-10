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
    flavor: 'A civilization of scholars lost beneath the waves',
    restoration_message: 'Ancient pages unfurl once more, and long-forgotten words drift through restored halls.',
    position:   [0, 0, 0],
    radius:     80,
    echo_count: 8,
    color_theme:'#40e0d0',
    model_files: [
      'models/sunken_library/main_hall.glb',
      'models/sunken_library/scroll_tower.glb',
      'models/sunken_library/great_lens.glb',
      'models/sunken_library/knowledge_orb.glb',
      'models/sunken_library/coral_growth.glb',
    ],
  },
  sky_nomads: {
    id:     'sky_nomads',
    name:   'The Sky Nomads',
    flavor: 'Cloud cities that drifted away forever',
    restoration_message: 'The wind-ships anchor again, and music returns on the upper currents.',
    position:   [200, 50, 0],
    radius:     70,
    echo_count: 7,
    color_theme:'#7c9fff',
    model_files: [
      'models/sky_nomads/cloud_palace.glb',
      'models/sky_nomads/crystal_spire.glb',
      'models/sky_nomads/wind_altar.glb',
      'models/sky_nomads/navigation_compass.glb',
      'models/sky_nomads/sky_bloom.glb',
    ],
  },
  deep_forge: {
    id:     'deep_forge',
    name:   'The Deep Forge',
    flavor: 'Master craftsmen swallowed by the earth',
    restoration_message: 'Bellows breathe again; the forge sings its iron song into the dark.',
    position:   [-200, -20, 0],
    radius:     90,
    echo_count: 9,
    color_theme:'#ff6b00',
    model_files: [
      'models/deep_forge/forge_cathedral.glb',
      'models/deep_forge/obsidian_tower.glb',
      'models/deep_forge/great_anvil.glb',
      'models/deep_forge/soul_hammer.glb',
      'models/deep_forge/lava_moss.glb',
    ],
  },
  memory_gardens: {
    id:     'memory_gardens',
    name:   'The Memory Gardens',
    flavor: 'Spiritual keepers whose temples were silenced',
    restoration_message: 'Blossoms return with impossible colours, and the air carries names aloud.',
    position:   [0, 0, -250],
    radius:     85,
    echo_count: 10,
    color_theme:'#a8e6a8',
    model_files: [
      'models/memory_gardens/spirit_temple.glb',
      'models/memory_gardens/lantern_gate.glb',
      'models/memory_gardens/memory_tree.glb',
      'models/memory_gardens/spirit_bell.glb',
      'models/memory_gardens/sacred_bloom.glb',
    ],
  },
  grand_reunion: {
    id:     'grand_reunion',
    name:   'The Grand Reunion',
    flavor: 'Where all forgotten people finally meet',
    restoration_message: 'Every restored zone pulses in unison. The city breathes again, whole and remembered.',
    position:   [0, 0, 0],
    radius:     150,
    echo_count: 20,
    color_theme:'#f5c842',
    model_files: [
      'models/grand_reunion/unity_hall.glb',
      'models/grand_reunion/world_tree.glb',
      'models/grand_reunion/gift_monument.glb',
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
   * @param {string}       [tripoManifestPath]  - Path to asset manifest JSON
   */
  constructor(scene, tripoManifestPath = '../assets/manifests/zones.json') {
    /** @type {THREE.Scene} */
    this.scene = scene;

    /** @type {string} */
    this.manifestPath = tripoManifestPath;

    /** @type {GLTFLoader} */
    this.loader = new GLTFLoader();

    /** @type {Record<string, ZoneConfig>} */
    this.zoneConfigs = JSON.parse(JSON.stringify(ZONE_CONFIGS));

    /**
     * Set of available model files verified to exist.
     * @type {Set<string>}
     */
    this.availableModels = new Set();

    /**
     * Fast lookup array for animated shader materials to avoid scene traversal.
     * @type {THREE.ShaderMaterial[]}
     */
    this._animatedMaterials = [];

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

  /**
   * Optionally fetches runtime manifest if available.
   * @param {string} [path]
   * @returns {Promise<void>}
   */
  async loadManifest(path = this.manifestPath) {
    try {
      const resp = await fetch(path);
      if (resp.ok) {
        const data = await resp.json();
        if (data && Array.isArray(data.zones)) {
          for (const z of data.zones) {
            const accent = typeof z.color_theme === 'object' ? z.color_theme.accent : (z.color_theme || '#c8a2f5');
            this.zoneConfigs[z.id] = {
              id: z.id,
              name: z.name,
              flavor: z.subtitle || z.lore || '',
              restoration_message: z.lore || (ZONE_CONFIGS[z.id]?.restoration_message ?? ''),
              position: z.position || [0, 0, 0],
              radius: z.radius || 60,
              echo_count: z.echo_count || 5,
              color_theme: accent,
              model_files: z.models ? Object.values(z.models) : (ZONE_CONFIGS[z.id]?.model_files ?? []),
            };
          }
        }
      }
    } catch (_) {
      // Offline / fallback to static ZONE_CONFIGS
    }
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
    const COUNT = 1500;
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
  /**
   * Loads all buildings for a zone. For each model file listed in the zone
   * config, it attempts a GLB load if registered as available; otherwise, a procedural
   * placeholder is placed instead.
   *
   * @param {string} zoneId
   * @returns {Promise<void>}
   */
  async loadZone(zoneId) {
    const cfg = this.getZoneData(zoneId);
    if (!cfg) throw new Error(`Unknown zone: ${zoneId}`);

    const group = new THREE.Group();
    group.name  = `zone_${zoneId}`;
    const [cx, cy, cz] = cfg.position;
    group.position.set(cx, cy, cz);

    // Subtle dark circular zone pedestal to anchor buildings in the void
    const pedestalGeo = new THREE.CylinderGeometry(cfg.radius * 0.85, cfg.radius * 0.9, 1.5, 32);
    pedestalGeo.translate(0, -0.75, 0);
    const pedestalMat = this._makeVoidShaderMaterial(new THREE.Color(cfg.color_theme).getHex());
    const pedestalMesh = new THREE.Mesh(pedestalGeo, pedestalMat);
    pedestalMesh.name = `pedestal_${zoneId}`;
    group.add(pedestalMesh);

    const placed = [];

    // Arrangement: spread buildings around the zone centre
    const radiusFactor = zoneId === 'grand_reunion' ? 0.75 : 0.6;
    const slots = this._generateSlots(cfg.model_files.length, cfg.radius * radiusFactor);

    for (let i = 0; i < cfg.model_files.length; i++) {
      const slot = slots[i];
      let obj = null;
      const modelFile = cfg.model_files[i];

      if (this.availableModels.has(modelFile)) {
        try {
          obj = await this._loadGLB(modelFile);
          obj.position.copy(slot.position);
          obj.rotation.y = slot.rotation;
        } catch (_) {
          obj = null;
        }
      }

      if (!obj) {
        // Fallback: procedural placeholder
        const style = this._styleForIndex(i);
        obj = this.createProceduralBuilding(style, slot.position, slot.scale, cfg.color_theme);
      }
      group.add(obj);
      placed.push(obj);
    }

    // Zone-specific accent lighting
    const accentColor = new THREE.Color(cfg.color_theme);
    const pointLight  = new THREE.PointLight(accentColor, 1.5, cfg.radius * 1.5);
    pointLight.position.set(0, 15, 0);
    group.add(pointLight);

    this.scene.add(group);
    this.zoneObjects.set(zoneId, placed);

    // Place echo triggers
    this.placeEchoTriggers(zoneId, this._generateEchoPositions(cfg));
  }

  /**
   * Loads all configured zones into the scene graph.
   * Guarantees this.zoneObjects is populated for all 5 zones.
   * @returns {Promise<void>}
   */
  async loadAllZones() {
    const zoneIds = Object.keys(this.zoneConfigs);
    for (const zoneId of zoneIds) {
      await this.loadZone(zoneId);
    }
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
  createProceduralBuilding(style, position, scale, colorTheme = 0xc8a2f5) {
    const group = new THREE.Group();
    group.position.copy(position);
    if (scale) group.scale.copy(scale);

    const mat = this._makeVoidShaderMaterial(colorTheme);

    let geo;
    switch (style) {
      case 'tower':
        geo = new THREE.CylinderGeometry(1.2, 2.0, 14, 8);
        geo.translate(0, 7, 0);
        break;
      case 'dome':
        geo = new THREE.SphereGeometry(5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
        break;
      case 'arch': {
        // Arch approximation: two pillars + lintel box with bases aligned
        const pillar = new THREE.BoxGeometry(1, 8, 1);
        pillar.translate(0, 4, 0);
        const lintel = new THREE.BoxGeometry(6, 1, 1);
        lintel.translate(0, 8.5, 0);
        const mL = new THREE.Mesh(pillar, mat); mL.position.set(-2.5, 0, 0);
        const mR = new THREE.Mesh(pillar, mat); mR.position.set( 2.5, 0, 0);
        const mT = new THREE.Mesh(lintel, mat); mT.position.set(0, 0, 0);
        group.add(mL, mR, mT);
        return group;
      }
      case 'cluster': {
        // Small cluster of boxes with bases aligned
        for (let k = 0; k < 4; k++) {
          const w = 1 + Math.random() * 2;
          const h = 2 + Math.random() * 6;
          const d = 1 + Math.random() * 2;
          const cg = new THREE.BoxGeometry(w, h, d);
          cg.translate(0, h / 2, 0);
          const cm = new THREE.Mesh(cg, mat);
          cm.position.set((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6);
          group.add(cm);
        }
        return group;
      }
      case 'slab':
      default:
        geo = new THREE.BoxGeometry(8, 5, 4);
        geo.translate(0, 2.5, 0);
        break;
    }

    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = false;
    group.add(mesh);
    return group;
  }

  /**
   * Creates the void wireframe+glow ShaderMaterial.
   * Registers material in _animatedMaterials for high-performance tick updates.
   * @param {string|number} color  - hex colour integer or string
   * @returns {THREE.ShaderMaterial}
   * @private
   */
  _makeVoidShaderMaterial(color) {
    const c = new THREE.Color(color);
    const mat = new THREE.ShaderMaterial({
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

    this._animatedMaterials.push(mat);
    return mat;
  }

  // ── Echo triggers ─────────────────────────────────────────────────────────

  /**
   * Places invisible sphere meshes that EchoSystem queries for proximity.
   * @param {string}           zoneId
   * @param {THREE.Vector3[]}  positions  - Local to zone group
   */
  placeEchoTriggers(zoneId, positions) {
    const cfg      = this.getZoneData(zoneId);
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
   * Fast array-based loop avoiding scene graph traversal overhead.
   * @param {number} time  - total elapsed time (seconds)
   */
  tick(time) {
    const mats = this._animatedMaterials;
    for (let i = 0; i < mats.length; i++) {
      if (mats[i].uniforms && mats[i].uniforms.u_time) {
        mats[i].uniforms.u_time.value = time;
      }
    }
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
    const cfg = this.zoneConfigs[zoneId] || ZONE_CONFIGS[zoneId];
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
