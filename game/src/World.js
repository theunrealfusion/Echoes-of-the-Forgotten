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
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

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
      'models/grand_reunion/ceremonial_arch.glb',
      'models/grand_reunion/harmonic_flora.glb',
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
  constructor(scene, tripoManifestPath = 'assets/manifests/zones.json') {
    /** @type {THREE.Scene} */
    this.scene = scene;

    /** @type {string} */
    this.manifestPath = tripoManifestPath;

    /** @type {GLTFLoader} */
    this.loader = new GLTFLoader();

    /** @type {FBXLoader} */
    this.fbxLoader = new FBXLoader();

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

    // Void ambient light — balanced, natural illumination
    this._ambientLight = new THREE.AmbientLight(0x403850, 0.85);
    scene.add(this._ambientLight);
  }

  /**
   * Optionally fetches runtime manifest if available.
   * @param {string} [path]
   * @returns {Promise<void>}
   */
  async loadManifest(path = this.manifestPath) {
    const candidatePaths = [
      path,
      'assets/manifests/zones.json',
      '../assets/manifests/zones.json',
      '/assets/manifests/zones.json',
    ];

    for (const p of candidatePaths) {
      try {
        const resp = await fetch(p);
        if (!resp.ok) continue;
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
          return;
        }
      } catch (_) {
        // Try next candidate
      }
    }
  }

  // ── Environment setup ────────────────────────────────────────────────────

  /**
   * Creates the dark void environment: exponential fog, a hemisphere light,
   * a directional "star" light, and a field of floating ambient particles.
   */
  createVoidEnvironment() {
    // Deep rich void fog — clear enough to view buildings at distance
    this.fog = new THREE.FogExp2(0x06030e, 0.005);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(0x06030e);

    // Balanced ambient light so models and architecture are clearly readable
    this._ambientLight = new THREE.AmbientLight(0x403850, 0.85);
    this.scene.add(this._ambientLight);

    // Soft sky-to-ground contrast
    const hemi = new THREE.HemisphereLight(0x6a6080, 0x1a1525, 0.5);
    this.scene.add(hemi);

    // Key directional light to sculpt 3D models with clean highlights and depth
    const keyLight = new THREE.DirectionalLight(0xfff2df, 1.5);
    keyLight.position.set(45, 80, 50);
    this.scene.add(keyLight);

    // Soft cool directional fill light from opposite angle
    const fillLight = new THREE.DirectionalLight(0x7c9fff, 0.6);
    fillLight.position.set(-45, 50, -50);
    this.scene.add(fillLight);

    // Ambient void particle field
    this._createGlobalParticleField();
  }

  /**
   * Creates a gentle field of floating cosmic dust particles.
   * @private
   */
  _createGlobalParticleField() {
    const COUNT = 1200;
    const positions = new Float32Array(COUNT * 3);
    const colors    = new Float32Array(COUNT * 3);
    const sizes     = new Float32Array(COUNT);
    const spread    = 500;

    for (let i = 0; i < COUNT; i++) {
      const radius = (Math.random() * Math.random()) * spread;
      const angle = Math.random() * Math.PI * 2;
      const height = (Math.random() - 0.5) * (spread * 0.25) * (1.0 - radius / spread);

      positions[i * 3]     = Math.cos(angle) * radius;
      positions[i * 3 + 1] = height;
      positions[i * 3 + 2] = Math.sin(angle) * radius;

      // Soft magical colors (controlled luminance)
      colors[i * 3]     = 0.35 + Math.random() * 0.3; // R
      colors[i * 3 + 1] = 0.20 + Math.random() * 0.2; // G
      colors[i * 3 + 2] = 0.50 + Math.random() * 0.3; // B
      
      sizes[i] = 0.8 + Math.random() * 1.5;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(colors,    3));
    geo.setAttribute('size',     new THREE.BufferAttribute(sizes,     1));

    const mat = new THREE.ShaderMaterial({
      uniforms: { u_time: { value: 0.0 } },
      vertexColors: true, // Fixes Three.js shader compilation error
      vertexShader: `
        uniform float u_time;
        attribute float size;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (200.0 / -mvPosition.z) * (0.6 + 0.4 * sin(u_time * 1.5 + position.x));
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          float alpha = (0.5 - dist) * 1.6;
          gl_FragColor = vec4(vColor * 0.8, alpha * 0.4);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    this._animatedMaterials.push(mat);

    const pts = new THREE.Points(geo, mat);
    pts.name  = 'void_field';
    this.scene.add(pts);
    this._globalParticles = pts;
  }

  // ── Zone loading ──────────────────────────────────────────────────────────

  /**
   * Loads all buildings for a zone. For each model file listed in the zone
   * config, it attempts to load the real 3D model (GLTF or FBX); on failure,
   * a procedural placeholder is placed instead.
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

    // Ethereal dark grid floor with soft accent lines
    const pedestalGeo = new THREE.PlaneGeometry(cfg.radius * 2.4, cfg.radius * 2.4, 32, 32);
    pedestalGeo.rotateX(-Math.PI / 2);
    const pedestalMat = this._makeFloorShaderMaterial(new THREE.Color(cfg.color_theme).getHex(), cfg.radius);
    const pedestalMesh = new THREE.Mesh(pedestalGeo, pedestalMat);
    pedestalMesh.name = `pedestal_${zoneId}`;
    group.add(pedestalMesh);

    const placed = [];

    // Arrangement: spread buildings around the zone centre
    const radiusFactor = zoneId === 'grand_reunion' ? 0.70 : 0.55;
    const slots = this._generateSlots(cfg.model_files.length, cfg.radius * radiusFactor);
    const targetSizes = [24, 20, 16, 12, 10];

    for (let i = 0; i < cfg.model_files.length; i++) {
      const slot = slots[i];
      let obj = null;
      const modelFile = cfg.model_files[i];

      try {
        console.log(`[World] Loading model: ${modelFile}`);
        obj = await this._loadModel(modelFile);
        const targetSize = targetSizes[i % targetSizes.length] || 16.0;
        this._placeLoadedModel(obj, slot, targetSize);
        console.log(`[World] Placed real 3D model: ${modelFile}`);
      } catch (err) {
        console.warn(`[World] Model load fallback for ${modelFile}:`, err);
        obj = null;
      }

      if (!obj) {
        // Fallback: procedural placeholder
        const style = this._styleForIndex(i);
        obj = this.createProceduralBuilding(style, slot.position, slot.scale, cfg.color_theme);
      }
      group.add(obj);
      placed.push(obj);
    }

    // Zone-specific subtle accent point light
    const accentColor = new THREE.Color(cfg.color_theme);
    const pointLight  = new THREE.PointLight(accentColor, 0.8, cfg.radius * 0.8);
    pointLight.decay  = 2.0;
    pointLight.position.set(0, 12, 0);
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
   * Robust model loader that supports both GLTF/GLB and Kaydara FBX formats.
   * Normalizes textures, shadows, and materials.
   * @param {string} path
   * @returns {Promise<THREE.Group>}
   * @private
   */
  async _loadModel(path) {
    const candidatePaths = [
      path,
      path.startsWith('models/') ? `assets/${path}` : `models/${path}`,
      `../assets/${path}`,
      path.startsWith('assets/') ? path.slice(7) : `assets/${path}`,
      `/${path}`,
      `/assets/${path}`,
    ];

    let lastError = null;

    for (const candidate of candidatePaths) {
      try {
        const resp = await fetch(candidate);
        if (!resp.ok) continue;
        const arrayBuffer = await resp.arrayBuffer();

        // Detect format from magic bytes
        const header = new Uint8Array(arrayBuffer.slice(0, 16));
        const isGLTF = header[0] === 0x67 && header[1] === 0x6C && header[2] === 0x54 && header[3] === 0x46; // 'glTF'
        const magicStr = String.fromCharCode(...header.slice(0, 7));
        const isFBX = magicStr === 'Kaydara';

        if (isFBX) {
          const group = this.fbxLoader.parse(arrayBuffer, candidate);
          this._prepareModelMeshes(group);
          return group;
        }

        if (isGLTF) {
          return await new Promise((resolve, reject) => {
            this.loader.parse(
              arrayBuffer,
              candidate,
              gltf => {
                this._prepareModelMeshes(gltf.scene);
                resolve(gltf.scene);
              },
              err => reject(err)
            );
          });
        }

        // Try GLTF first, then FBX fallback
        try {
          return await new Promise((resolve, reject) => {
            this.loader.parse(
              arrayBuffer,
              candidate,
              gltf => {
                this._prepareModelMeshes(gltf.scene);
                resolve(gltf.scene);
              },
              err => {
                try {
                  const group = this.fbxLoader.parse(arrayBuffer, candidate);
                  this._prepareModelMeshes(group);
                  resolve(group);
                } catch (fbxErr) {
                  reject(err || fbxErr);
                }
              }
            );
          });
        } catch (_) {}
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError || new Error(`Could not load model: ${path}`);
  }

  /**
   * Prepares meshes inside a loaded 3D model for rendering.
   * @param {THREE.Object3D} root
   * @private
   */
  _prepareModelMeshes(root) {
    root.traverse(child => {
      if (/** @type {any} */ (child).isMesh) {
        const mesh = /** @type {THREE.Mesh} */ (child);
        mesh.castShadow    = true;
        mesh.receiveShadow = true;
        mesh.userData.isOriginalModel = true;

        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach(mat => {
          if (!mat) return;
          mat.depthWrite = true;
          mat.depthTest  = true;
          mat.transparent = false;

          // Convert Phong/Lambert to StandardMaterial for proper PBR lighting
          if (mat.isMeshPhongMaterial || mat.isMeshLambertMaterial) {
            const standardMat = new THREE.MeshStandardMaterial({
              color: mat.color ? mat.color.clone() : new THREE.Color(0xb0a898),
              map: mat.map || null,
              roughness: 0.65,
              metalness: 0.15,
            });
            mesh.material = standardMat;
          } else if (mat.isMeshStandardMaterial) {
            mat.roughness = Math.max(mat.roughness, 0.4);
            mat.metalness = Math.min(mat.metalness, 0.4);
          }
        });
      }
    });
  }

  /**
   * Normalizes scale and grounds a model at the slot position.
   * @param {THREE.Group|THREE.Object3D} obj
   * @param {{ position: THREE.Vector3, rotation: number, scale: THREE.Vector3 }} slot
   * @param {number} targetSize
   * @private
   */
  _placeLoadedModel(obj, slot, targetSize = 16.0) {
    // Reset transforms to measure raw bounding box
    obj.position.set(0, 0, 0);
    obj.rotation.set(0, 0, 0);
    obj.scale.set(1, 1, 1);
    obj.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    if (maxDim > 0.001) {
      const fitScale = targetSize / maxDim;
      const finalScale = fitScale * (slot.scale?.x || 1.0);
      obj.scale.set(finalScale, finalScale, finalScale);
      obj.updateMatrixWorld(true);

      // Re-measure after scaling to ground the model at y = 0
      const scaledBox = new THREE.Box3().setFromObject(obj);
      obj.position.set(
        slot.position.x,
        slot.position.y - scaledBox.min.y,
        slot.position.z
      );
    } else {
      obj.position.copy(slot.position);
    }

    obj.rotation.y = slot.rotation;
    obj.userData.isLoadedModel = true;
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
        geo = new THREE.OctahedronGeometry(1.5, 0);
        geo.scale(1, 6, 1);
        geo.translate(0, 9, 0);
        
        const ringGeo = new THREE.TorusGeometry(3.5, 0.15, 8, 32);
        ringGeo.rotateX(Math.PI / 2);
        ringGeo.translate(0, 5, 0);
        const ringMesh = new THREE.Mesh(ringGeo, mat);
        group.add(ringMesh);
        break;
      case 'dome':
        geo = new THREE.IcosahedronGeometry(4, 1);
        geo.translate(0, 2, 0);
        
        for(let i=0; i<3; i++) {
           const orb = new THREE.OctahedronGeometry(0.8, 0);
           const angle = (i/3) * Math.PI * 2;
           orb.translate(Math.cos(angle)*6, 4, Math.sin(angle)*6);
           group.add(new THREE.Mesh(orb, mat));
        }
        break;
      case 'arch': {
        geo = new THREE.BoxGeometry(1.5, 12, 2);
        geo.translate(-4, 6, 0);
        geo.rotateZ(0.1);
        
        const pillar2 = new THREE.BoxGeometry(1.5, 12, 2);
        pillar2.translate(4, 6, 0);
        pillar2.rotateZ(-0.1);
        
        const lintel = new THREE.OctahedronGeometry(2, 0);
        lintel.scale(4, 1, 1);
        lintel.translate(0, 11, 0);
        
        group.add(new THREE.Mesh(pillar2, mat));
        group.add(new THREE.Mesh(lintel, mat));
        break;
      }
      case 'cluster': {
        const coreGeo = new THREE.OctahedronGeometry(2.5, 0);
        coreGeo.translate(0, 3, 0);
        group.add(new THREE.Mesh(coreGeo, mat));
        
        for (let k = 0; k < 5; k++) {
          const s = 0.5 + Math.random() * 1.5;
          const cg = new THREE.OctahedronGeometry(s, 0);
          cg.translate(
             (Math.random() - 0.5) * 8, 
             s + Math.random() * 5, 
             (Math.random() - 0.5) * 8
          );
          group.add(new THREE.Mesh(cg, mat));
        }
        return group; 
      }
      case 'slab':
      default:
        geo = new THREE.BoxGeometry(3, 8, 3);
        geo.translate(0, 4, 0);
        const diamond = new THREE.OctahedronGeometry(1.5, 0);
        diamond.translate(0, 10, 0);
        group.add(new THREE.Mesh(diamond, mat));
        break;
    }

    if (geo) {
       const mesh = new THREE.Mesh(geo, mat);
       mesh.castShadow = false;
       group.add(mesh);
    }
    return group;
  }

  _makeVoidShaderMaterial(color) {
    const c = new THREE.Color(color);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        u_color:    { value: c },
        u_progress: { value: 0.0 },
        u_time:     { value: 0.0 },
      },
      vertexShader: `
        uniform float u_time;
        uniform float u_progress;
        varying vec3 v_position;
        varying vec3 v_normal;
        varying vec3 v_worldPosition;

        void main() {
          v_position = position;
          v_normal   = normal;
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          v_worldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3  u_color;
        uniform float u_progress;
        uniform float u_time;
        varying vec3  v_position;
        varying vec3  v_normal;
        varying vec3  v_worldPosition;

        void main() {
          vec3 viewDirection = normalize(cameraPosition - v_worldPosition);
          float fresnelTerm = dot(viewDirection, normalize(v_normal));
          fresnelTerm = clamp(1.0 - abs(fresnelTerm), 0.0, 1.0);
          float fresnelGlow = pow(fresnelTerm, 2.5);
          
          float scanline = sin(v_worldPosition.y * 1.5 - u_time * 1.2) * 0.5 + 0.5;

          // Sophisticated dark obsidian with soft colored edge glow
          vec3 baseStone = vec3(0.08, 0.07, 0.12);
          vec3 edgeGlow  = u_color * 0.75;
          vec3 voidColor = mix(baseStone, edgeGlow, fresnelGlow * 0.6 + scanline * 0.15);
          
          // Restored state: warm architectural stone
          vec3 solidColor = mix(vec3(0.22, 0.20, 0.25), vec3(0.85, 0.75, 0.4), fresnelGlow * 0.4 + 0.1);
          vec3 finalColor = mix(voidColor, solidColor, u_progress);
          
          gl_FragColor = vec4(finalColor, 1.0);
        }
      `,
      transparent:   false,
      side:          THREE.DoubleSide,
      depthWrite:    true,
    });

    this._animatedMaterials.push(mat);
    return mat;
  }

  _makeFloorShaderMaterial(color, radius) {
    const c = new THREE.Color(color);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        u_color:    { value: c },
        u_progress: { value: 0.0 },
        u_time:     { value: 0.0 },
        u_radius:   { value: radius }
      },
      vertexShader: `
        uniform float u_time;
        uniform float u_progress;
        varying vec2 v_localPos;

        void main() {
          // PlaneGeometry has rotateX(-PI/2), so ground coordinates are in X and Z
          v_localPos = vec2(position.x, position.z);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3  u_color;
        uniform float u_progress;
        uniform float u_radius;
        varying vec2  v_localPos;

        void main() {
          float dist = length(v_localPos);
          float fade = 1.0 - smoothstep(u_radius * 0.45, u_radius * 1.05, dist);
          if (fade <= 0.001) discard;

          // Subtle elegant grid pattern
          vec2 grid = abs(fract(v_localPos * 0.15) - 0.5);
          float line = smoothstep(0.46, 0.49, max(grid.x, grid.y));

          // Dark sleek void floor — never blinding
          vec3 baseFloor = vec3(0.03, 0.02, 0.05);
          vec3 gridGlow  = u_color * 0.55;
          vec3 voidColor = mix(baseFloor, gridGlow, line * 0.4);

          // Restored stone plaza with golden grid inlay
          vec3 restoredBase = vec3(0.14, 0.13, 0.16);
          vec3 restoredGrid = mix(vec3(0.85, 0.75, 0.35), u_color, 0.25);
          vec3 solidColor = mix(restoredBase, restoredGrid, line * 0.45);

          vec3 finalColor = mix(voidColor, solidColor, u_progress);
          float finalAlpha = fade * mix(0.8, 0.98, u_progress);

          gl_FragColor = vec4(finalColor, finalAlpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
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
