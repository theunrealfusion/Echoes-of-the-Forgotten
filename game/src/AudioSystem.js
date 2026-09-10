/**
 * @file AudioSystem.js
 * @description Procedural Web Audio API sound system for
 *              "A Gift for the Forgotten City".
 *
 * ALL sounds are synthesised with oscillators, filters, and gain nodes —
 * no external audio file dependencies.
 *
 * Ambient layers:
 *  • 'void'     — low sub-bass drone + filtered wind noise + tremolo LFO
 *  • 'restored' — ethereal choir pad (stacked detuned oscillators) + gentle
 *                 water-shimmer (high-pass filtered noise bursts)
 *
 * One-shot SFX:
 *  • playEchoDetected()      — rising crystalline chime chord
 *  • playRestorationComplete()— triumphant golden swell (stacked fifths)
 *
 * Crossfade:
 *  • crossfadeAmbient(from, to, duration) — smooth linear gain ramp
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Creates a GainNode, connects it to the destination, and returns it.
 * @param {AudioContext} ctx
 * @param {number}       gain
 * @param {AudioNode}    [destination]
 * @returns {GainNode}
 */
function makeGain(ctx, gain = 1, destination = ctx.destination) {
  const g = ctx.createGain();
  g.gain.value = gain;
  g.connect(destination);
  return g;
}

/**
 * Creates an OscillatorNode and connects it to `destination`.
 * @param {AudioContext} ctx
 * @param {OscillatorType} type
 * @param {number}         frequency
 * @param {AudioNode}      destination
 * @returns {OscillatorNode}
 */
function makeOsc(ctx, type, frequency, destination) {
  const osc = ctx.createOscillator();
  osc.type      = type;
  osc.frequency.value = frequency;
  osc.connect(destination);
  return osc;
}

/**
 * Creates a noise buffer (white noise) of `duration` seconds.
 * @param {AudioContext} ctx
 * @param {number}       duration
 * @returns {AudioBuffer}
 */
function makeNoiseBuffer(ctx, duration = 2) {
  const frames  = Math.floor(ctx.sampleRate * duration);
  const buffer  = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data    = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// ─────────────────────────────────────────────────────────────────────────────
// AudioSystem
// ─────────────────────────────────────────────────────────────────────────────

export class AudioSystem {
  constructor() {
    /** @type {AudioContext | null} */
    this.ctx = null;

    /** Master gain (mute control). */
    this._masterGain = null;

    /** Currently active ambient layer nodes. */
    this._ambientNodes = {
      void:     /** @type {AudioNode[]} */ ([]),
      restored: /** @type {AudioNode[]} */ ([]),
    };

    /** Gain nodes for each ambient layer (for crossfade). */
    this._ambientGains = {
      void:     /** @type {GainNode | null} */ (null),
      restored: /** @type {GainNode | null} */ (null),
    };

    /** Whether audio has been started (browser requires user gesture). */
    this._started = false;

    /** Current master volume 0–1. */
    this.volume = 0.7;

    /** Mute flag. */
    this.muted = false;
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  /**
   * Creates the AudioContext. Must be called after a user gesture.
   * Wrapped in try/catch for environments that block Web Audio.
   * @returns {Promise<void>}
   */
  async init() {
    try {
      this.ctx = new (window.AudioContext || /** @type {any} */ (window.webkitAudioContext))();

      // Resume context if suspended (autoplay policy)
      if (this.ctx.state === 'suspended') await this.ctx.resume();

      // Master gain bus
      this._masterGain = makeGain(this.ctx, this.volume);

      // Pre-build both ambient layers (initially silent)
      this._buildVoidAmbient();
      this._buildRestoredAmbient();

      this._started = true;
    } catch (err) {
      console.warn('[AudioSystem] Web Audio not available:', err);
    }
  }

  // ── Ambient playback ──────────────────────────────────────────────────────

  /**
   * Starts an ambient layer immediately at full volume.
   * @param {'void' | 'restored'} type
   */
  playAmbient(type) {
    if (!this._started) return;
    const gainNode = this._ambientGains[type];
    if (!gainNode) return;
    gainNode.gain.setTargetAtTime(1.0, this.ctx.currentTime, 0.5);
  }

  /**
   * Stops an ambient layer (fade to silence).
   * @param {'void' | 'restored'} type
   */
  stopAmbient(type) {
    if (!this._started) return;
    const gainNode = this._ambientGains[type];
    if (!gainNode) return;
    gainNode.gain.setTargetAtTime(0.0, this.ctx.currentTime, 0.5);
  }

  /**
   * Smooth crossfade from one ambient layer to another.
   * @param {'void' | 'restored'} from
   * @param {'void' | 'restored'} to
   * @param {number}              duration  - seconds
   */
  crossfadeAmbient(from, to, duration = 2.0) {
    if (!this._started) return;
    const t = this.ctx.currentTime;
    const gFrom = this._ambientGains[from];
    const gTo   = this._ambientGains[to];

    if (gFrom) {
      gFrom.gain.cancelScheduledValues(t);
      gFrom.gain.setValueAtTime(gFrom.gain.value, t);
      gFrom.gain.linearRampToValueAtTime(0, t + duration);
    }
    if (gTo) {
      gTo.gain.cancelScheduledValues(t);
      gTo.gain.setValueAtTime(gTo.gain.value, t);
      gTo.gain.linearRampToValueAtTime(1, t + duration);
    }
  }

  // ── SFX ───────────────────────────────────────────────────────────────────

  /**
   * Plays a rising crystalline chime — indicates echo collection.
   * Uses three detuned triangle oscillators decaying over 1.2 seconds.
   */
  playEchoDetected() {
    if (!this._started) return;
    const t   = this.ctx.currentTime;

    // Root + major third + perfect fifth = bright triad
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const gainNode = this.ctx.createGain();
      gainNode.gain.setValueAtTime(0, t);
      gainNode.gain.linearRampToValueAtTime(0.12, t + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.001, t + 1.2 + i * 0.1);
      gainNode.connect(this._masterGain);

      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.linearRampToValueAtTime(freq * 1.5, t + 1.0);  // rising shimmer
      osc.connect(gainNode);
      osc.start(t + i * 0.04);   // slight stagger
      osc.stop(t + 1.5);
    });
  }

  /**
   * Plays a triumphant golden swell when a zone is fully restored.
   * Stacked perfect fifths with a slow attack create an orchestral feel.
   */
  playRestorationComplete() {
    if (!this._started) return;
    const t = this.ctx.currentTime;

    // A major chord: A3, E4, A4, C#5 — stacked for fullness
    const notes   = [220, 329.63, 440, 554.37];
    const types   = /** @type {OscillatorType[]} */ (['sawtooth', 'sawtooth', 'sine', 'triangle']);

    notes.forEach((freq, i) => {
      // Low-pass filter for warmth
      const filter = this.ctx.createBiquadFilter();
      filter.type            = 'lowpass';
      filter.frequency.value = 1200 + i * 400;
      filter.connect(this._masterGain);

      const gainNode = this.ctx.createGain();
      gainNode.gain.setValueAtTime(0, t);
      gainNode.gain.linearRampToValueAtTime(0.08, t + 0.6 + i * 0.1); // slow attack
      gainNode.gain.setValueAtTime(0.08, t + 2.0);
      gainNode.gain.exponentialRampToValueAtTime(0.001, t + 4.5);
      gainNode.connect(filter);

      const osc = this.ctx.createOscillator();
      osc.type = types[i];
      osc.frequency.value = freq;
      osc.detune.value    = (i % 2 === 0) ? -3 : 3;  // slight chorus
      osc.connect(gainNode);
      osc.start(t);
      osc.stop(t + 5);
    });

    // Short percussive attack boom
    this._playBoom(t);
  }

  // ── Volume / mute ─────────────────────────────────────────────────────────

  /**
   * Sets the master volume (0–1).
   * @param {number} vol
   */
  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this._masterGain && !this.muted) {
      this._masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.1);
    }
  }

  /** Toggles mute. */
  toggleMute() {
    this.muted = !this.muted;
    if (this._masterGain) {
      this._masterGain.gain.setTargetAtTime(
        this.muted ? 0 : this.volume,
        this.ctx.currentTime,
        0.1,
      );
    }
    return this.muted;
  }

  // ── Ambient builder helpers ───────────────────────────────────────────────

  /**
   * Builds the void ambient layer:
   *  • Sub-bass drone (sine, 55 Hz)
   *  • Filtered wind noise (band-pass, 600 Hz)
   *  • Tremolo LFO applied to both
   *
   * All nodes connect to a dedicated gain bus (initially 0).
   * @private
   */
  _buildVoidAmbient() {
    const ctx   = this.ctx;
    const t     = ctx.currentTime;

    const bus   = makeGain(ctx, 0, this._masterGain);
    this._ambientGains.void = bus;

    // ── Sub-bass drone ─────────────────────────────────────────────────────
    const droneGain = makeGain(ctx, 0.25, bus);
    const drone1    = makeOsc(ctx, 'sine', 55, droneGain);
    const drone2    = makeOsc(ctx, 'sine', 55.3, droneGain);  // slight beating
    drone1.start(t); drone2.start(t);
    this._ambientNodes.void.push(drone1, drone2);

    // ── Tremolo LFO on bass ────────────────────────────────────────────────
    const tremoloLFO = ctx.createOscillator();
    tremoloLFO.type = 'sine';
    tremoloLFO.frequency.value = 0.3;
    const tremoloDepth = ctx.createGain();
    tremoloDepth.gain.value = 0.15;
    tremoloLFO.connect(tremoloDepth);
    tremoloDepth.connect(droneGain.gain);
    tremoloLFO.start(t);
    this._ambientNodes.void.push(tremoloLFO);

    // ── Wind noise ─────────────────────────────────────────────────────────
    const noiseGain    = makeGain(ctx, 0.15, bus);
    const noiseSource  = ctx.createBufferSource();
    noiseSource.buffer = makeNoiseBuffer(ctx, 4);
    noiseSource.loop   = true;

    const bandpass = ctx.createBiquadFilter();
    bandpass.type            = 'bandpass';
    bandpass.frequency.value = 600;
    bandpass.Q.value         = 0.5;

    noiseSource.connect(bandpass);
    bandpass.connect(noiseGain);
    noiseSource.start(t);
    this._ambientNodes.void.push(noiseSource);

    // ── High ethereal tone ─────────────────────────────────────────────────
    const highGain = makeGain(ctx, 0.04, bus);
    const high     = makeOsc(ctx, 'sine', 440, highGain);
    high.start(t);
    this._ambientNodes.void.push(high);

    // Pitch-drift LFO for unsettling movement
    const pitchLFO   = ctx.createOscillator();
    pitchLFO.type = 'sine';
    pitchLFO.frequency.value = 0.07;
    const pitchDepth = ctx.createGain();
    pitchDepth.gain.value = 8;
    pitchLFO.connect(pitchDepth);
    pitchDepth.connect(high.frequency);
    pitchLFO.start(t);
    this._ambientNodes.void.push(pitchLFO);
  }

  /**
   * Builds the restored ambient layer:
   *  • Ethereal choir pad (6 stacked detuned sine/triangle oscillators)
   *  • Water shimmer (periodic filtered noise bursts via ScriptProcessor)
   *
   * All nodes connect to a dedicated gain bus (initially 0).
   * @private
   */
  _buildRestoredAmbient() {
    const ctx   = this.ctx;
    const t     = ctx.currentTime;

    const bus   = makeGain(ctx, 0, this._masterGain);
    this._ambientGains.restored = bus;

    // ── Choir pad — stacked detuned oscillators ────────────────────────────
    // A major voicing across multiple octaves
    const chordFreqs = [110, 165, 220, 277.18, 330, 440];
    chordFreqs.forEach((freq, i) => {
      const gainNode = makeGain(ctx, 0.04 - i * 0.003, bus);

      // Low-pass filter per voice for warmth
      const lp = ctx.createBiquadFilter();
      lp.type            = 'lowpass';
      lp.frequency.value = 900 + i * 300;
      lp.connect(gainNode);

      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.value = freq;
      osc.detune.value    = (i * 7) - 20;  // spread detune for width
      osc.connect(lp);
      osc.start(t);
      this._ambientNodes.restored.push(osc);

      // Vibrato LFO per voice
      const vib = ctx.createOscillator();
      vib.type = 'sine';
      vib.frequency.value = 3.5 + i * 0.3;
      const vibDepth = ctx.createGain();
      vibDepth.gain.value = 3;
      vib.connect(vibDepth);
      vibDepth.connect(osc.frequency);
      vib.start(t);
      this._ambientNodes.restored.push(vib);
    });

    // ── Water shimmer — high-pass filtered periodic noise ──────────────────
    const waterGain   = makeGain(ctx, 0.06, bus);
    const waterNoise  = ctx.createBufferSource();
    waterNoise.buffer = makeNoiseBuffer(ctx, 3);
    waterNoise.loop   = true;

    const hp = ctx.createBiquadFilter();
    hp.type            = 'highpass';
    hp.frequency.value = 4000;
    hp.Q.value         = 1.0;
    waterNoise.connect(hp);
    hp.connect(waterGain);
    waterNoise.start(t);
    this._ambientNodes.restored.push(waterNoise);

    // Amplitude modulation on water — creates a ripple rhythm
    const rippleLFO   = ctx.createOscillator();
    rippleLFO.type = 'sine';
    rippleLFO.frequency.value = 1.2;
    const rippleDepth = ctx.createGain();
    rippleDepth.gain.value = 0.04;
    rippleLFO.connect(rippleDepth);
    rippleDepth.connect(waterGain.gain);
    rippleLFO.start(t);
    this._ambientNodes.restored.push(rippleLFO);
  }

  // ── Private SFX helpers ───────────────────────────────────────────────────

  /**
   * Plays a short tonal boom for dramatic emphasis.
   * @param {number} t - AudioContext start time
   * @private
   */
  _playBoom(t) {
    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(0.2, t);
    gainNode.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    gainNode.connect(this._masterGain);

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.5);
    osc.connect(gainNode);
    osc.start(t);
    osc.stop(t + 0.7);
  }
}
