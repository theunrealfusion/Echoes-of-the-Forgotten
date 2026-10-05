/**
 * @file Player.js
 * @description First-person player controller.
 *
 * Features:
 *  • PointerLockControls for desktop mouse-look (click canvas to lock).
 *  • WASD / Arrow-key movement with smooth acceleration & deceleration.
 *  • Zone-boundary collision (keeps player within the active zone radius).
 *  • Mobile virtual joystick (left half) + look-drag (right half).
 *  • Short forward raycast for echo interaction detection.
 *  • Footstep callback fired at regular intervals when moving.
 */

import * as THREE                from 'three';
import { PointerLockControls }   from 'three/addons/controls/PointerLockControls.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Movement speed in metres per second. */
const MOVE_SPEED      = 6.0;

/** How fast velocity builds up (0-1 lerp factor per frame). */
const ACCEL_FACTOR    = 0.12;

/** How fast velocity decays when no key is pressed. */
const DECEL_FACTOR    = 0.10;

/** Interval between footstep sound callbacks (seconds). */
const FOOTSTEP_INTERVAL = 0.45;

/** Interaction raycast length (metres). */
const INTERACT_REACH  = 3.5;

/** Max joystick displacement in pixels. */
const JOY_RADIUS      = 40;

// ─────────────────────────────────────────────────────────────────────────────
// Player
// ─────────────────────────────────────────────────────────────────────────────

export class Player {
  /**
   * @param {THREE.Camera}     camera
   * @param {HTMLCanvasElement} domElement
   */
  constructor(camera, domElement) {
    this.camera     = camera;
    this.domElement = domElement;

    // ── PointerLockControls ───────────────────────────────────────────────────
    this.controls = new PointerLockControls(camera, domElement);

    // ── Velocity & movement state ─────────────────────────────────────────────
    /** @type {THREE.Vector3} */
    this.velocity = new THREE.Vector3();

    /** @type {THREE.Vector3} */
    this.direction = new THREE.Vector3();

    /** Active key states. */
    this._keys = {
      forward:  false,
      backward: false,
      left:     false,
      right:    false,
    };

    // ── Zone constraint ───────────────────────────────────────────────────────
    /** @type {{ center: THREE.Vector3, radius: number } | null} */
    this.zoneBounds = null;

    // ── Footstep timer ────────────────────────────────────────────────────────
    this._footstepTimer = 0;
    /** @type {(() => void) | null} */
    this.onFootstep = null;

    // ── Interaction raycast ───────────────────────────────────────────────────
    this._raycaster = new THREE.Raycaster();
    this._raycaster.far = INTERACT_REACH;
    this._interactDir = new THREE.Vector3(0, 0, -1);

    // ── Mobile touch state ────────────────────────────────────────────────────
    this._joystickActive = false;
    this._joyTouchId     = null;
    this._joystickCenter = { x: 0, y: 0 };
    this._joystickDelta  = { x: 0, y: 0 };
    this._lookTouchId    = null;
    this._lookLastPos    = { x: 0, y: 0 };
    this._lookSensitivity = 0.003;

    this._enabled = false;
  }

  // ── Enable / disable ──────────────────────────────────────────────────────

  /**
   * Attaches all event listeners and activates the controller.
   */
  enable() {
    if (this._enabled) return;
    this._enabled = true;

    this._bindDesktopEvents();
    this._bindMobileEvents();
  }

  /**
   * Detaches all event listeners.
   */
  disable() {
    this._enabled  = false;
    this._removeDesktopEvents();
    this._removeMobileEvents();
    if (this.controls.isLocked) this.controls.unlock();
  }

  // ── Per-frame update ──────────────────────────────────────────────────────

  /**
   * Integrates velocity, applies movement via PointerLockControls,
   * constrains to zone bounds, and fires footstep callbacks.
   *
   * @param {number} delta - seconds since last frame
   */
  update(delta) {
    if (!this._enabled) return;

    // Resolve movement direction from keys + joystick
    this.direction.set(0, 0, 0);

    const fwd  = this._keys.forward  || this._joystickDelta.y < -0.3;
    const back = this._keys.backward || this._joystickDelta.y >  0.3;
    const lft  = this._keys.left     || this._joystickDelta.x < -0.3;
    const rgt  = this._keys.right    || this._joystickDelta.x >  0.3;

    if (fwd)  this.direction.z -= 1;
    if (back) this.direction.z += 1;
    if (lft)  this.direction.x -= 1;
    if (rgt)  this.direction.x += 1;

    const isMoving = this.direction.lengthSq() > 0;
    if (isMoving) this.direction.normalize();

    // Smooth acceleration / deceleration
    const targetVx = this.direction.x * MOVE_SPEED;
    const targetVz = this.direction.z * MOVE_SPEED;

    const accel = isMoving ? ACCEL_FACTOR : DECEL_FACTOR;
    this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, targetVx, accel);
    this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, targetVz, accel);

    // Apply via PointerLockControls helper methods (respects camera yaw)
    if (this.controls.isLocked || navigator.maxTouchPoints > 0) {
      this.controls.moveRight(this.velocity.x * delta);
      this.controls.moveForward(-this.velocity.z * delta);
    }

    // Clamp to zone boundary
    if (this.zoneBounds) {
      const pos   = this.camera.position;
      const dxz   = new THREE.Vector2(
        pos.x - this.zoneBounds.center.x,
        pos.z - this.zoneBounds.center.z,
      );
      const dist  = dxz.length();
      if (dist > this.zoneBounds.radius) {
        dxz.normalize().multiplyScalar(this.zoneBounds.radius);
        pos.x = this.zoneBounds.center.x + dxz.x;
        pos.z = this.zoneBounds.center.z + dxz.y;
      }
      // Keep player at eye height
      pos.y = 1.7;
    }

    // Footstep callback
    if (isMoving) {
      this._footstepTimer += delta;
      if (this._footstepTimer >= FOOTSTEP_INTERVAL) {
        this._footstepTimer = 0;
        this.onFootstep?.();
      }
    } else {
      this._footstepTimer = 0;
    }
  }

  // ── Zone bounds ───────────────────────────────────────────────────────────

  /**
   * Sets the active zone collision boundary.
   * @param {THREE.Vector3} center
   * @param {number}        radius
   */
  setZoneBounds(center, radius) {
    this.zoneBounds = { center: center.clone(), radius };
  }

  // ── Position accessor ─────────────────────────────────────────────────────

  /**
   * @returns {THREE.Vector3} current world position (camera position)
   */
  getPosition() {
    return this.camera.position;
  }

  /**
   * Teleports player to a specific world position and resets velocity.
   * @param {THREE.Vector3 | [number, number, number]} pos
   */
  setPosition(pos) {
    if (Array.isArray(pos)) {
      this.camera.position.set(pos[0], pos[1], pos[2]);
    } else {
      this.camera.position.copy(pos);
    }
    this.velocity.set(0, 0, 0);
  }

  // ── Interaction raycast ───────────────────────────────────────────────────

  /**
   * Casts a short ray forward and returns any intersected objects from the list.
   * @param {THREE.Object3D[]} candidates
   * @returns {THREE.Intersection[]}
   */
  getInteractionRayHits(candidates) {
    this._raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
    return this._raycaster.intersectObjects(candidates, false);
  }

  // ── Desktop event wiring ──────────────────────────────────────────────────

  _bindDesktopEvents() {
    this._onKeyDown = (e) => this._handleKey(e.code, true);
    this._onKeyUp   = (e) => this._handleKey(e.code, false);
    this._onClick   = () => {
      if (!this.controls.isLocked) this.controls.lock();
    };

    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup',   this._onKeyUp);
    this.domElement.addEventListener('click', this._onClick);

    // Update hint when pointer lock changes
    this.controls.addEventListener('lock',   () => this._onLockChange(true));
    this.controls.addEventListener('unlock', () => this._onLockChange(false));
  }

  _removeDesktopEvents() {
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup',   this._onKeyUp);
    this.domElement.removeEventListener('click', this._onClick);
  }

  /**
   * @param {string}  code
   * @param {boolean} state
   * @private
   */
  _handleKey(code, state) {
    switch (code) {
      case 'KeyW': case 'ArrowUp':    this._keys.forward  = state; break;
      case 'KeyS': case 'ArrowDown':  this._keys.backward = state; break;
      case 'KeyA': case 'ArrowLeft':  this._keys.left     = state; break;
      case 'KeyD': case 'ArrowRight': this._keys.right    = state; break;
    }
  }

  /** @param {boolean} locked @private */
  _onLockChange(locked) {
    const hint = document.getElementById('hint-text');
    if (!hint) return;
    hint.innerHTML = locked
      ? 'WASD to move • Keys <kbd>1</kbd>-<kbd>4</kbd> switch zones • ESC to release cursor'
      : 'Click to explore the void • Keys <kbd>1</kbd>-<kbd>4</kbd> switch zones';
  }

  // ── Mobile touch event wiring ─────────────────────────────────────────────

  _bindMobileEvents() {
    const joystickEl = document.getElementById('virtual-joystick');
    const lookPadEl  = document.getElementById('look-pad');
    if (!joystickEl || !lookPadEl) return;

    this._onJoyStart  = (e) => this._joyStart(e);
    this._onJoyMove   = (e) => this._joyMove(e);
    this._onJoyEnd    = (e) => this._joyEnd(e);
    this._onLookStart = (e) => this._lookStart(e);
    this._onLookMove  = (e) => this._lookMove(e);
    this._onLookEnd   = (e) => this._lookEnd(e);

    joystickEl.addEventListener('touchstart', this._onJoyStart, { passive: false });
    joystickEl.addEventListener('touchmove',  this._onJoyMove,  { passive: false });
    joystickEl.addEventListener('touchend',   this._onJoyEnd,   { passive: false });
    joystickEl.addEventListener('touchcancel',this._onJoyEnd,   { passive: false });

    lookPadEl.addEventListener('touchstart', this._onLookStart, { passive: false });
    lookPadEl.addEventListener('touchmove',  this._onLookMove,  { passive: false });
    lookPadEl.addEventListener('touchend',   this._onLookEnd,   { passive: false });
    lookPadEl.addEventListener('touchcancel',this._onLookEnd,   { passive: false });
  }

  _removeMobileEvents() {
    // Listeners cleaned up when elements are removed from DOM
  }

  // Joystick handlers
  /** @param {TouchEvent} e @private */
  _joyStart(e) {
    e.preventDefault();
    if (this._joyTouchId !== null) return;
    const t = e.changedTouches[0];
    this._joyTouchId = t.identifier;
    this._joystickActive = true;
    this._joystickCenter = { x: t.clientX, y: t.clientY };
    this._joystickDelta  = { x: 0, y: 0 };
  }

  /** @param {TouchEvent} e @private */
  _joyMove(e) {
    e.preventDefault();
    if (!this._joystickActive || this._joyTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier !== this._joyTouchId) continue;
      const dx = t.clientX - this._joystickCenter.x;
      const dy = t.clientY - this._joystickCenter.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const clamped = Math.min(len, JOY_RADIUS);
      const angle   = Math.atan2(dy, dx);

      this._joystickDelta.x = (Math.cos(angle) * clamped) / JOY_RADIUS;
      this._joystickDelta.y = (Math.sin(angle) * clamped) / JOY_RADIUS;

      // Visually move the knob
      const knob = document.getElementById('joystick-knob');
      if (knob) {
        knob.style.transform = `translate(${Math.cos(angle) * clamped}px, ${Math.sin(angle) * clamped}px)`;
      }
      break;
    }
  }

  /** @param {TouchEvent} e @private */
  _joyEnd(e) {
    e.preventDefault();
    if (this._joyTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier !== this._joyTouchId) continue;
      this._joystickActive = false;
      this._joyTouchId = null;
      this._joystickDelta  = { x: 0, y: 0 };
      const knob = document.getElementById('joystick-knob');
      if (knob) knob.style.transform = 'translate(0,0)';
      break;
    }
  }

  // Look-pad handlers
  /** @param {TouchEvent} e @private */
  _lookStart(e) {
    e.preventDefault();
    const t = e.changedTouches[0];
    this._lookTouchId = t.identifier;
    this._lookLastPos = { x: t.clientX, y: t.clientY };
  }

  /** @param {TouchEvent} e @private */
  _lookMove(e) {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== this._lookTouchId) continue;
      const dx = t.clientX - this._lookLastPos.x;
      const dy = t.clientY - this._lookLastPos.y;
      this._lookLastPos = { x: t.clientX, y: t.clientY };

      // Manually rotate camera object (no PointerLockControls on mobile)
      this.camera.rotation.y -= dx * this._lookSensitivity;
      this.camera.rotation.x -= dy * this._lookSensitivity;
      // Clamp vertical look
      this.camera.rotation.x = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, this.camera.rotation.x));
    }
  }

  /** @param {TouchEvent} e @private */
  _lookEnd(e) {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === this._lookTouchId) {
        this._lookTouchId = null;
        break;
      }
    }
  }
}
