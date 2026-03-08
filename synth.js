/**
 * FM Synthesizer - 80s style (DX7-inspired)
 * 2-operator FM synthesis using Web Audio API
 * Signal chain: [carrier → carEnv] → filter → distortion → masterGain → destination
 *                                              ↘ delaySend → delayNode ↔ feedbackGain
 *                                                            delayNode → masterGain
 *                                              ↘ reverbSend → multiTapDelay → masterGain
 */

class FMSynth {
  constructor(ctx) {
    this.ctx = ctx;

    // Master
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.6;
    this.masterGain.connect(ctx.destination);

    // Filter (pre-distortion)
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 8000;
    this.filter.Q.value = 1.5;

    // Distortion (WaveShaper)
    this.distortion = ctx.createWaveShaper();
    this.distortion.curve = this._makeDistortionCurve(0);
    this.distortion.oversample = '4x';
    this.filter.connect(this.distortion);
    this.distortion.connect(this.masterGain);

    // Delay with feedback
    this.delayNode     = ctx.createDelay(2.0);
    this.delayNode.delayTime.value = 0;
    this.delayFeedback = ctx.createGain();
    this.delayFeedback.gain.value = 0;
    this.delaySend     = ctx.createGain();
    this.delaySend.gain.value = 0;
    this.delayWet      = ctx.createGain();
    this.delayWet.gain.value = 0;
    this.distortion.connect(this.delaySend);
    this.delaySend.connect(this.delayNode);
    this.delayNode.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);
    this.delayNode.connect(this.delayWet);
    this.delayWet.connect(this.masterGain);

    // Reverb: multi-tap delay (avoids ConvolverNode iOS issues)
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.18;
    this.distortion.connect(this.reverbSend);
    [0.03, 0.07, 0.13, 0.19, 0.27].forEach((t, i) => {
      const d = ctx.createDelay(0.5);
      d.delayTime.value = t;
      const g = ctx.createGain();
      g.gain.value = 0.4 - i * 0.06;
      this.reverbSend.connect(d);
      d.connect(g);
      g.connect(this.masterGain);
    });

    this.voices = {};
    this.patch = { ...PRESETS['E.PIANO'] };
  }

  _makeDistortionCurve(amount) {
    // amount: 0–1. Uses tanh saturation with pre-boost for musical clipping.
    const n = 256;
    const curve = new Float32Array(n);
    if (amount === 0) {
      for (let i = 0; i < n; i++) curve[i] = (i * 2) / n - 1;
      return curve;
    }
    const k = 1 + amount * 19; // boost: 1x at 0, 20x at 1.0
    const norm = 1 / Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = Math.tanh(k * x) * norm;
    }
    return curve;
  }

  setPatch(name) {
    if (PRESETS[name]) this.patch = { ...PRESETS[name] };
  }

  setParam(key, val) { this.patch[key] = val; }
  setMasterVolume(v) { this.masterGain.gain.value = v; }
  setReverbMix(v)    { this.reverbSend.gain.value = v * 0.35; }
  setFilterFreq(v)   { this.filter.frequency.value = v; }
  setDistortion(v) {
    this.distortion.curve = this._makeDistortionCurve(v);
  }
  setDelayTime(v) {
    this.delayNode.delayTime.value = v;
    const active = v > 0.001 ? 0.45 : 0;
    this.delaySend.gain.value = active;
    this.delayWet.gain.value  = active;
  }
  setDelayFeedback(v) {
    this.delayFeedback.gain.value = Math.min(0.92, v);
  }

  noteOn(noteNumber, velocity = 0.8) {
    if (this.voices[noteNumber]) this.noteOff(noteNumber);

    const freq = midiToFreq(noteNumber);
    const now  = this.ctx.currentTime;
    const p    = this.patch;

    // --- Modulator ---
    const mod = this.ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = freq * p.modRatio;

    const modEnv = this.ctx.createGain();
    const modPeak = Math.max(0.001, p.modIndex * freq * velocity);
    modEnv.gain.setValueAtTime(0.0001, now);
    modEnv.gain.linearRampToValueAtTime(modPeak, now + p.modAttack);
    modEnv.gain.exponentialRampToValueAtTime(
      Math.max(0.001, modPeak * p.modSustain),
      now + p.modAttack + p.modDecay
    );

    // --- Carrier ---
    const car = this.ctx.createOscillator();
    car.type = 'sine';
    car.frequency.value = freq;

    const carEnv = this.ctx.createGain();
    const carPeak = velocity * 0.5;
    carEnv.gain.setValueAtTime(0.0001, now);
    carEnv.gain.linearRampToValueAtTime(carPeak, now + p.attack);
    carEnv.gain.exponentialRampToValueAtTime(
      Math.max(0.001, carPeak * p.sustain),
      now + p.attack + p.decay
    );

    mod.connect(modEnv);
    modEnv.connect(car.frequency); // FM: modulator drives carrier pitch
    car.connect(carEnv);
    carEnv.connect(this.filter);

    mod.start(now);
    car.start(now);

    this.voices[noteNumber] = { car, mod, carEnv, modEnv };
  }

  noteOff(noteNumber) {
    const v = this.voices[noteNumber];
    if (!v) return;

    const now = this.ctx.currentTime;
    const p   = this.patch;

    v.carEnv.gain.cancelScheduledValues(now);
    v.carEnv.gain.setValueAtTime(v.carEnv.gain.value, now);
    v.carEnv.gain.exponentialRampToValueAtTime(0.0001, now + p.release);

    v.modEnv.gain.cancelScheduledValues(now);
    v.modEnv.gain.setValueAtTime(v.modEnv.gain.value, now);
    v.modEnv.gain.exponentialRampToValueAtTime(0.0001, now + p.modRelease);

    v.car.stop(now + p.release + 0.05);
    v.mod.stop(now + p.modRelease + 0.05);

    delete this.voices[noteNumber];
  }

  allNotesOff() {
    Object.keys(this.voices).forEach(n => this.noteOff(parseInt(n)));
  }
}

// ── TB-303-style Bass Synth ───────────────────────────────
/**
 * Mono bass synthesizer inspired by Roland TB-303.
 * Sawtooth oscillator → resonant lowpass filter with envelope → amp envelope.
 * Separate audio graph from FMSynth so it plays independently of the keyboard.
 */
class TB303Synth {
  constructor(ctx) {
    this.ctx = ctx;

    // Master gain (independent from FMSynth master)
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.55;
    this.masterGain.connect(ctx.destination);

    // Distortion
    this.distortion = ctx.createWaveShaper();
    this.distortion.curve = this._makeDistortionCurve(0);
    this.distortion.oversample = '4x';

    // Compressor (after distortion)
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = 0;   // bypass by default
    this.compressor.knee.value      = 40;
    this.compressor.ratio.value     = 1;
    this.compressor.attack.value    = 0.003;
    this.compressor.release.value   = 0.25;
    this.distortion.connect(this.compressor);
    this.compressor.connect(this.masterGain);

    // Delay with feedback
    this.delayNode     = ctx.createDelay(2.0);
    this.delayNode.delayTime.value = 0;
    this.delayFeedback = ctx.createGain();
    this.delayFeedback.gain.value = 0;
    this.delaySend     = ctx.createGain();
    this.delaySend.gain.value = 0;
    this.delayWet      = ctx.createGain();
    this.delayWet.gain.value = 0;
    this.compressor.connect(this.delaySend);
    this.delaySend.connect(this.delayNode);
    this.delayNode.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);
    this.delayNode.connect(this.delayWet);
    this.delayWet.connect(this.masterGain);

    // Reverb send
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.06;
    this.compressor.connect(this.reverbSend);
    [0.04, 0.09, 0.16].forEach((t, i) => {
      const d = ctx.createDelay(0.5);
      d.delayTime.value = t;
      const g = ctx.createGain();
      g.gain.value = 0.35 - i * 0.08;
      this.reverbSend.connect(d);
      d.connect(g);
      g.connect(this.masterGain);
    });

    this.voices = {};
  }

  _makeDistortionCurve(amount) {
    const n = 256;
    const curve = new Float32Array(n);
    if (amount === 0) {
      for (let i = 0; i < n; i++) curve[i] = (i * 2) / n - 1;
      return curve;
    }
    const k = 1 + amount * 19;
    const norm = 1 / Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = Math.tanh(k * x) * norm;
    }
    return curve;
  }

  noteOn(noteNumber) {
    if (this.voices[noteNumber]) this.noteOff(noteNumber);

    const freq = midiToFreq(noteNumber);
    const now  = this.ctx.currentTime;

    // Sawtooth oscillator (classic 303 timbre)
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;

    // Resonant lowpass filter — the signature 303 "squelch"
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 16;
    const baseCutoff = 280;
    const envPeak    = baseCutoff + 2200;
    filter.frequency.setValueAtTime(baseCutoff, now);
    filter.frequency.linearRampToValueAtTime(envPeak, now + 0.004);
    filter.frequency.exponentialRampToValueAtTime(baseCutoff, now + 0.32);

    // Amplitude envelope: punchy attack, short decay, low sustain
    const ampEnv = this.ctx.createGain();
    ampEnv.gain.setValueAtTime(0.0001, now);
    ampEnv.gain.linearRampToValueAtTime(0.6, now + 0.004);
    ampEnv.gain.exponentialRampToValueAtTime(0.18, now + 0.12);

    osc.connect(filter);
    filter.connect(ampEnv);
    ampEnv.connect(this.distortion);
    osc.start(now);

    this.voices[noteNumber] = { osc, filter, ampEnv };
  }

  noteOff(noteNumber) {
    const v = this.voices[noteNumber];
    if (!v) return;
    const now = this.ctx.currentTime;
    v.ampEnv.gain.cancelScheduledValues(now);
    v.ampEnv.gain.setValueAtTime(v.ampEnv.gain.value, now);
    v.ampEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
    v.osc.stop(now + 0.06);
    delete this.voices[noteNumber];
  }

  allNotesOff() {
    Object.keys(this.voices).forEach(n => this.noteOff(parseInt(n)));
  }

  setMasterVolume(v) { this.masterGain.gain.value = v; }
  setDistortion(v) {
    this.distortion.curve = this._makeDistortionCurve(v);
  }
  setCompressor(v) {
    this.compressor.threshold.value = -v * 40;   // 0 → -40 dB
    this.compressor.ratio.value     = 1 + v * 15; // 1 → 16
  }
  setDelayTime(v) {
    this.delayNode.delayTime.value = v;
    const active = v > 0.001 ? 0.45 : 0;
    this.delaySend.gain.value = active;
    this.delayWet.gain.value  = active;
  }
  setDelayFeedback(v) {
    this.delayFeedback.gain.value = Math.min(0.92, v);
  }
  setReverbMix(v) { this.reverbSend.gain.value = v * 0.35; }
}

// ── Helpers ──────────────────────────────────────────────
function midiToFreq(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

const NOTE_MAP = {
  'C':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,
  'E':4,'F':5,'F#':6,'Gb':6,'G':7,'G#':8,
  'Ab':8,'A':9,'A#':10,'Bb':10,'B':11
};

function noteNameToMidi(name) {
  const m = name.match(/^([A-G][#b]?)(\d)$/);
  if (!m) return 60;
  return NOTE_MAP[m[1]] + (parseInt(m[2]) + 1) * 12;
}

// ── 80s Presets ──────────────────────────────────────────
const PRESETS = {
  'E.PIANO': {
    modRatio:0.5, modIndex:5.0,
    attack:0.005, decay:0.5,  sustain:0.1,  release:0.8,
    modAttack:0.005, modDecay:0.4, modSustain:0.05, modRelease:0.6,
  },
  'BRASS': {
    modRatio:1.0, modIndex:3.5,
    attack:0.06,  decay:0.2,  sustain:0.75, release:0.15,
    modAttack:0.04, modDecay:0.15, modSustain:0.6, modRelease:0.12,
  },
  'STRINGS': {
    modRatio:1.0, modIndex:0.8,
    attack:0.25,  decay:0.4,  sustain:0.8,  release:0.6,
    modAttack:0.2, modDecay:0.4, modSustain:0.7, modRelease:0.5,
  },
  'BASS': {
    modRatio:2.0, modIndex:4.0,
    attack:0.005, decay:0.15, sustain:0.2,  release:0.1,
    modAttack:0.005, modDecay:0.08, modSustain:0.1, modRelease:0.08,
  },
  'BELL': {
    modRatio:3.5, modIndex:8.0,
    attack:0.002, decay:1.5,  sustain:0.0,  release:1.2,
    modAttack:0.002, modDecay:0.8, modSustain:0.0, modRelease:1.0,
  },
  'MARIMBA': {
    modRatio:3.0, modIndex:4.0,
    attack:0.002, decay:0.4,  sustain:0.0,  release:0.3,
    modAttack:0.002, modDecay:0.18, modSustain:0.0, modRelease:0.15,
  },
  'LEAD': {
    modRatio:2.0, modIndex:2.0,
    attack:0.01,  decay:0.1,  sustain:0.85, release:0.2,
    modAttack:0.01, modDecay:0.08, modSustain:0.7, modRelease:0.15,
  },
  'ORGAN': {
    modRatio:2.0, modIndex:1.5,
    attack:0.005, decay:0.01, sustain:0.95, release:0.06,
    modAttack:0.005, modDecay:0.01, modSustain:0.9, modRelease:0.05,
  },
};
