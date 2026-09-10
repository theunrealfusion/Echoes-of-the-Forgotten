/**
 * @file main.js
 * @description Game bootstrap and primary engine loop for
 *              "A Gift for the Forgotten City".
 *
 * Architecture overview:
 *   GameEngine orchestrates five sub-systems:
 *     • World           — zone loading, fog, environment
 *     • Player          — first-person movement & input
 *     • EchoSystem      — proximity detection, visual effects, progress
 *     • RestorationSystem — material transitions, grand-reveal animation
 *     • AudioSystem     — Web Audio synthesis, ambient crossfades
 *
 * Three.js r160 is loaded via import-map (see index.html).
 */

import * as THREE from 'three';
import { EffectComposer }   from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }       from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass }  from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass }       from 'three/addons/postprocessing/OutputPass.js';
import { VRButton }         from 'three/addons/webxr/VRButton.js';

import { World }              from './World.js';
import { Player }             from './Player.js';
import { EchoSystem }         from './EchoSystem.js';
import { RestorationSystem }  from './RestorationSystem.js';
import { AudioSystem }        from './AudioSystem.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const canvas          = /** @type {HTMLCanvasElement} */ (document.getElementById('game-canvas'));
const loadingScreen   = document.getElementById('loading-screen');
const loadingBar      = document.getElementById('loading-bar-fill');
const hud             = document.getElementById('hud');
const zoneTitleEl     = document.getElementById('zone-title');
const zoneTitleName   = document.getElementById('zone-title-name');
const zoneTitleFlavor = document.getElementById('zone-title-flavor');
const zoneNameHud     = document.getElementById('zone-name');
const echoMeter       = document.getElementById('echo-meter');
const echoMeterTrack  = document.getElementById('echo-meter-track');
const echoMeterText   = document.getElementById('echo-meter-text');
const hintText        = document.getElementById('hint-text');
const restoreMsg      = document.getElementById('restoration-message');
const restoreZoneName = document.getElementById('restoration-zone-name');
const restoreBodyText = document.getElementById('restoration-body-text');
const restoreContinue = document.getElementById('restoration-continue-btn');

// ─────────────────────────────────────────────────────────────────────────────
// GameEngine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Central orchestrator. Owns the renderer, scene, camera, clock, and all
 * sub-system instances. Call `engine.init()` once the DOM is ready.
 */
class GameEngine {
  constructor() {
    // ── Renderer ─────────────────────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias:   true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled  = false; // Optimized: no shadow maps needed in void, reduces CPU overhead
    this.renderer.toneMapping        = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.outputColorSpace   = THREE.SRGBColorSpace;
    this.renderer.xr.enabled         = true; // WebXR & PICO VR support

    // WebXR session lifecycle listeners
    this.renderer.xr.addEventListener('sessionstart', () => {
      console.log('[WebXR] Session started');
      this.audio.unlock();
    });
    this.renderer.xr.addEventListener('sessionend', () => {
      console.log('[WebXR] Session ended');
    });

    // ── Scene ─────────────────────────────────────────────────────────────────
    this.scene = new THREE.Scene();

    // ── Camera (first-person) ─────────────────────────────────────────────────
    this.camera = new THREE.PerspectiveCamera(
      75,                                   // FOV degrees
      window.innerWidth / window.innerHeight,
      0.05,                                 // near
      2000,                                 // far — large for void vistas
    );
    this.camera.position.set(0, 1.7, 0);   // eye height ~1.7 m

    // ── Clock ─────────────────────────────────────────────────────────────────
    this.clock = new THREE.Clock();

    // ── Post-processing ───────────────────────────────────────────────────────
    this._initComposer();

    // ── Sub-systems (constructed but NOT yet initialised) ─────────────────────
    this.world       = new World(this.scene, '../assets/manifests/zones.json');
    this.player      = new Player(this.camera, this.renderer.domElement);
    this.echoSystem  = new EchoSystem(this.scene, this.camera, this.world);
    this.restoration = new RestorationSystem(this.scene);
    this.audio       = new AudioSystem();

    // ── WebXR VRButton ────────────────────────────────────────────────────────
    const vrBtn = VRButton.createButton(this.renderer);
    vrBtn.id = 'VRButton';
    vrBtn.addEventListener('click', () => this.audio.unlock(), { passive: true });
    document.body.appendChild(vrBtn);

    // Canvas click unlocks audio context
    canvas.addEventListener('click', () => this.audio.unlock(), { passive: true });
    canvas.addEventListener('pointerdown', () => this.audio.unlock(), { passive: true });

    // ── State ─────────────────────────────────────────────────────────────────
    this.currentZoneId   = 'sunken_library';
    this.isRunning       = false;
    this._boundRender    = this._loop.bind(this);
    this._boundResize    = this.onResize.bind(this);

    window.addEventListener('resize', this._boundResize);
  }

  // ── Post-processing setup ──────────────────────────────────────────────────

  /**
   * Creates an EffectComposer with:
   *   1. RenderPass  — scene render
   *   2. UnrealBloomPass — atmospheric void glow (purple bloom, 0.5x res for 60fps)
   *   3. OutputPass  — gamma-correct final output
   * @private
   */
  _initComposer() {
    const size = new THREE.Vector2(
      Math.floor(window.innerWidth / 2),
      Math.floor(window.innerHeight / 2),
    );

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(
      size,
      0.9,   // strength  — visible but not overwhelming
      0.4,   // radius
      0.75,  // threshold — only bright void-glow elements bloom
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
  }

  // ── Initialisation ────────────────────────────────────────────────────────

  /**
   * Async initialisation: wires all systems, loads all 5 zones, then
   * dismisses the loading screen and starts the WebXR animation loop.
   */
  async init() {
    try {
      this._setLoadingProgress(0.1, 'Initialising audio…');
      await this.audio.init();

      this._setLoadingProgress(0.25, 'Building the void…');
      this.world.createVoidEnvironment();
      await this.world.loadManifest();

      this._setLoadingProgress(0.45, 'Materialising civilizations…');
      await this.world.loadAllZones();

      this._setLoadingProgress(0.65, 'Placing echoes…');
      const zoneData = this.world.getZoneData(this.currentZoneId);
      this.player.setZoneBounds(new THREE.Vector3(...zoneData.position), zoneData.radius);
      this.echoSystem.initZone(this.currentZoneId, zoneData);

      this._setLoadingProgress(0.80, 'Calibrating restoration matrix…');
      this.restoration.applyVoidMaterialToScene(this.scene);

      this._setLoadingProgress(1.0, 'Entering the forgotten city…');
      await this._sleep(600);                 // let the bar reach 100 %

      this._dismissLoadingScreen();
      this._showZoneTitle(zoneData);
      this._updateHud(0, zoneData.echo_count);

      this.audio.playAmbient('void');
      this.player.enable();

      this.isRunning = true;
      this.clock.start();
      this.renderer.setAnimationLoop(this._boundRender);

      // Wire "Continue Exploring" button
      restoreContinue.addEventListener('click', () => {
        this.audio.unlock();
        this._hideRestorationMessage();
      });
    } catch (err) {
      console.error('[GameEngine] Initialisation failed:', err);
      this._showError(err);
    }
  }

  // ── Per-frame update ──────────────────────────────────────────────────────

  /**
   * Updates all sub-systems each frame.
   * @param {number} delta - seconds since last frame (capped at 0.1 s)
   */
  update(delta) {
    const dt = Math.min(delta, 0.1);        // cap to avoid spiral-of-death

    // Animate procedural shader uniforms & restoration particles
    this.world.tick(this.clock.getElapsedTime());
    this.restoration.tick(dt);

    this.player.update(dt);
    const playerPos = this.player.getPosition();

    const echoResult = this.echoSystem.update(dt, playerPos);

    if (echoResult.newEchoCollected) {
      this.audio.playEchoDetected();
      const progress = this.echoSystem.getRestorationProgress(this.currentZoneId);
      this._updateHud(progress * this.world.getZoneData(this.currentZoneId).echo_count,
                      this.world.getZoneData(this.currentZoneId).echo_count);

      this.world.restoreZone(this.currentZoneId, progress);
      this.restoration.restore(this.scene, progress);

      // Crossfade ambient depending on restoration level
      if (progress > 0.5) {
        this.audio.crossfadeAmbient('void', 'restored', 3.0);
      }

      // Check full restoration
      if (progress >= 1.0) {
        this._triggerZoneRestoration();
      }
    }

    this.echoSystem.updateVisuals(dt);
  }

  // ── Render loop ───────────────────────────────────────────────────────────

  /**
   * Primary frame callback invoked by renderer.setAnimationLoop.
   * Updates systems and renders via EffectComposer or direct WebXR presenter.
   * @param {number} [time]
   * @param {XRFrame} [frame]
   * @private
   */
  _loop(time, frame) {
    if (!this.isRunning) return;

    const delta = this.clock.getDelta();
    this.update(delta);

    if (this.renderer.xr.isPresenting) {
      this.renderer.render(this.scene, this.camera);
    } else {
      this.composer.render();
    }
  }

  // ── Resize handler ────────────────────────────────────────────────────────

  /**
   * Updates camera aspect, renderer size, and composer size on window resize.
   */
  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloomPass.resolution.set(Math.floor(w / 2), Math.floor(h / 2));
  }

  // ── Zone restoration trigger ───────────────────────────────────────────────

  /**
   * Called when all echoes in the current zone are collected.
   * Runs the grand reveal animation and shows the restoration message.
   * @private
   */
  async _triggerZoneRestoration() {
    const zoneData = this.world.getZoneData(this.currentZoneId);
    this.audio.playRestorationComplete();
    await this.restoration.playRestorationAnimation(this.currentZoneId, this.scene);
    this._showRestorationMessage(zoneData);
  }

  // ── HUD helpers ───────────────────────────────────────────────────────────

  /**
   * @param {number} collected
   * @param {number} total
   */
  _updateHud(collected, total) {
    const pct = total > 0 ? (collected / total) * 100 : 0;
    echoMeter.style.width       = `${pct.toFixed(1)}%`;
    echoMeterText.textContent   = `${Math.round(collected)} / ${total}`;
    echoMeterTrack.setAttribute('aria-valuenow', String(Math.round(pct)));
  }

  /**
   * Briefly shows the zone-title overlay, then fades it out after 3 s.
   * @param {{ name: string, flavor: string }} zoneData
   */
  _showZoneTitle(zoneData) {
    zoneTitleName.textContent   = zoneData.name;
    zoneTitleFlavor.textContent = zoneData.flavor;
    zoneNameHud.textContent     = zoneData.name;

    zoneTitleEl.classList.remove('hidden');
    setTimeout(() => zoneTitleEl.classList.add('hidden'), 3500);
  }

  /** @param {{ name: string, restoration_message: string }} zoneData */
  _showRestorationMessage(zoneData) {
    restoreZoneName.textContent = zoneData.name;
    restoreBodyText.textContent = zoneData.restoration_message ??
      'The echoes have gathered. Memory returns to the forgotten city.';
    restoreMsg.classList.remove('hidden');
  }

  _hideRestorationMessage() {
    restoreMsg.classList.add('hidden');
    hintText.textContent = 'Seek the next zone — more echoes await.';
  }

  // ── Loading screen helpers ────────────────────────────────────────────────

  /**
   * Advances the progress bar and subtitle text.
   * @param {number} fraction  0.0 → 1.0
   * @param {string} message
   */
  _setLoadingProgress(fraction, message) {
    if (loadingBar) loadingBar.style.width = `${Math.round(fraction * 100)}%`;
    const sub = document.querySelector('.loading-subtitle');
    if (sub) sub.textContent = message;
  }

  _dismissLoadingScreen() {
    if (!loadingScreen) return;
    loadingScreen.classList.add('fade-out');
    hud.classList.remove('hidden');

    // Show mobile controls on touch devices
    if (navigator.maxTouchPoints > 0) {
      document.getElementById('mobile-controls').classList.remove('hidden');
    }

    setTimeout(() => loadingScreen.classList.add('hidden'), 1000);
  }

  _showError(err) {
    const sub = document.querySelector('.loading-subtitle');
    if (sub) {
      sub.textContent = `Error: ${err.message}. Check console.`;
      sub.style.color = '#f87171';
    }
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  /** @param {number} ms */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry-point
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const engine = new GameEngine();
  engine.init();

  // Expose for debugging from the browser console
  /** @type {any} */ (window).__game = engine;
});
