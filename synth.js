/**
 * FM Synthesizer - 80s style (DX7-inspired)
 * 2-operator FM synthesis using Web Audio API
 */

class FMSynth {
  constructor(audioContext) {
    this.ctx = audioContext;
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.7;

    // Reverb
    this.reverb = this._createReverb();
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.25;

    // Chorus
    this.chorus = this._createChorus();
    this.chorusGain = this.ctx.createGain();
    this.chorusGain.gain.value = 0.4;

    // Filter
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 8000;
    this.filter.Q.value = 1.5;

    // Signal chain: filter -> chorus -> reverb -> master -> destination
    this.filter.connect(this.chorus.input);
    this.chorus.output.connect(this.masterGain);
    this.chorus.output.connect(this.reverbGain);
    this.reverbGain.connect(this.reverb);
    this.reverb.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);

    // Active voices
    this.voices = {};

    // Default patch
    this.patch = { ...PRESETS['E.PIANO'] };
  }

  setPatch(presetName) {
    if (PRESETS[presetName]) {
      this.patch = { ...PRESETS[presetName] };
    }
  }

  setParam(key, value) {
    this.patch[key] = value;
  }

  noteOn(noteNumber, velocity = 0.8) {
    if (this.voices[noteNumber]) this.noteOff(noteNumber);

    const freq = midiToFreq(noteNumber);
    const now = this.ctx.currentTime;
    const p = this.patch;

    // --- Modulator ---
    const modFreq = freq * p.modRatio;
    const modulator = this.ctx.createOscillator();
    modulator.type = p.modWaveform || 'sine';
    modulator.frequency.value = modFreq;

    // Modulator envelope (affects FM index over time)
    const modEnvGain = this.ctx.createGain();
    modEnvGain.gain.setValueAtTime(0, now);
    modEnvGain.gain.linearRampToValueAtTime(
      p.modIndex * freq * velocity,
      now + p.modAttack
    );
    modEnvGain.gain.exponentialRampToValueAtTime(
      Math.max(0.001, p.modIndex * freq * velocity * p.modSustain),
      now + p.modAttack + p.modDecay
    );

    modulator.connect(modEnvGain);

    // --- Carrier ---
    const carrier = this.ctx.createOscillator();
    carrier.type = p.carWaveform || 'sine';
    carrier.frequency.value = freq;

    // Modulator -> carrier frequency (FM!)
    modEnvGain.connect(carrier.frequency);

    // Carrier amplitude envelope
    const carEnvGain = this.ctx.createGain();
    carEnvGain.gain.setValueAtTime(0, now);
    carEnvGain.gain.linearRampToValueAtTime(velocity, now + p.attack);
    carEnvGain.gain.exponentialRampToValueAtTime(
      Math.max(0.001, velocity * p.sustain),
      now + p.attack + p.decay
    );

    carrier.connect(carEnvGain);
    carEnvGain.connect(this.filter);

    // Feedback oscillator (operator self-feedback for metallic/organ tones)
    let feedbackDelay = null;
    if (p.feedback > 0) {
      feedbackDelay = this.ctx.createDelay(0.001);
      feedbackDelay.delayTime.value = 0.0005;
      const feedbackGain = this.ctx.createGain();
      feedbackGain.gain.value = p.feedback * 200;
      carrier.connect(feedbackDelay);
      feedbackDelay.connect(feedbackGain);
      feedbackGain.connect(carrier.frequency);
    }

    modulator.start(now);
    carrier.start(now);

    this.voices[noteNumber] = {
      carrier, modulator, carEnvGain, modEnvGain, feedbackDelay,
      freq, velocity
    };
  }

  noteOff(noteNumber) {
    const voice = this.voices[noteNumber];
    if (!voice) return;

    const now = this.ctx.currentTime;
    const p = this.patch;

    voice.carEnvGain.gain.cancelScheduledValues(now);
    voice.carEnvGain.gain.setValueAtTime(voice.carEnvGain.gain.value, now);
    voice.carEnvGain.gain.exponentialRampToValueAtTime(0.0001, now + p.release);

    voice.modEnvGain.gain.cancelScheduledValues(now);
    voice.modEnvGain.gain.setValueAtTime(voice.modEnvGain.gain.value, now);
    voice.modEnvGain.gain.exponentialRampToValueAtTime(0.0001, now + p.modRelease);

    voice.carrier.stop(now + p.release + 0.05);
    voice.modulator.stop(now + p.modRelease + 0.05);

    delete this.voices[noteNumber];
  }

  allNotesOff() {
    Object.keys(this.voices).forEach(n => this.noteOff(parseInt(n)));
  }

  setMasterVolume(v) { this.masterGain.gain.value = v; }
  setReverbMix(v) { this.reverbGain.gain.value = v; }
  setChorusMix(v) { this.chorusGain.gain.value = v; }
  setFilterFreq(v) { this.filter.frequency.value = v; }

  _createReverb() {
    const convolver = this.ctx.createConvolver();
    const sampleRate = this.ctx.sampleRate;
    const length = sampleRate * 2.5;
    const impulse = this.ctx.createBuffer(2, length, sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = impulse.getChannelData(c);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
      }
    }
    convolver.buffer = impulse;
    return convolver;
  }

  _createChorus() {
    const input = this.ctx.createGain();
    const output = this.ctx.createGain();
    const delays = [0.02, 0.025, 0.03];
    const rates = [0.5, 0.7, 0.9];
    const depths = [0.003, 0.004, 0.002];

    delays.forEach((d, i) => {
      const delay = this.ctx.createDelay(0.1);
      delay.delayTime.value = d;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = rates[i];
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = depths[i];
      lfo.connect(lfoGain);
      lfoGain.connect(delay.delayTime);
      lfo.start();
      const g = this.ctx.createGain();
      g.gain.value = 0.3;
      input.connect(delay);
      delay.connect(g);
      g.connect(output);
    });

    input.connect(output); // dry signal
    return { input, output };
  }
}

// MIDI note number to frequency
function midiToFreq(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

// Note name to MIDI
const NOTE_MAP = {
  'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
  'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
  'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11
};

function noteNameToMidi(name) {
  const match = name.match(/^([A-G][#b]?)(\d)$/);
  if (!match) return 60;
  return NOTE_MAP[match[1]] + (parseInt(match[2]) + 1) * 12;
}

// ===== 80s PRESETS =====
const PRESETS = {
  'E.PIANO': {
    // DX7 Electric Piano feel
    carWaveform: 'sine',
    modWaveform: 'sine',
    modRatio: 14,
    modIndex: 1.2,
    attack: 0.005,
    decay: 0.4,
    sustain: 0.15,
    release: 0.8,
    modAttack: 0.005,
    modDecay: 0.3,
    modSustain: 0.05,
    modRelease: 0.5,
    feedback: 0.0,
  },
  'BRASS': {
    carWaveform: 'sine',
    modWaveform: 'sine',
    modRatio: 1.0,
    modIndex: 3.5,
    attack: 0.06,
    decay: 0.2,
    sustain: 0.75,
    release: 0.15,
    modAttack: 0.04,
    modDecay: 0.15,
    modSustain: 0.6,
    modRelease: 0.1,
    feedback: 0.1,
  },
  'STRINGS': {
    carWaveform: 'sine',
    modWaveform: 'sine',
    modRatio: 1.0,
    modIndex: 0.8,
    attack: 0.25,
    decay: 0.3,
    sustain: 0.8,
    release: 0.5,
    modAttack: 0.2,
    modDecay: 0.3,
    modSustain: 0.7,
    modRelease: 0.4,
    feedback: 0.05,
  },
  'BASS': {
    carWaveform: 'sine',
    modWaveform: 'sine',
    modRatio: 2.0,
    modIndex: 4.0,
    attack: 0.005,
    decay: 0.15,
    sustain: 0.3,
    release: 0.1,
    modAttack: 0.005,
    modDecay: 0.08,
    modSustain: 0.1,
    modRelease: 0.08,
    feedback: 0.15,
  },
  'BELL': {
    carWaveform: 'sine',
    modWaveform: 'sine',
    modRatio: 3.5,
    modIndex: 5.0,
    attack: 0.002,
    decay: 1.5,
    sustain: 0.0,
    release: 1.0,
    modAttack: 0.002,
    modDecay: 0.8,
    modSustain: 0.0,
    modRelease: 0.8,
    feedback: 0.0,
  },
  'MARIMBA': {
    carWaveform: 'sine',
    modWaveform: 'sine',
    modRatio: 3.0,
    modIndex: 2.5,
    attack: 0.002,
    decay: 0.35,
    sustain: 0.0,
    release: 0.3,
    modAttack: 0.002,
    modDecay: 0.15,
    modSustain: 0.0,
    modRelease: 0.1,
    feedback: 0.0,
  },
  'LEAD': {
    carWaveform: 'sine',
    modWaveform: 'sine',
    modRatio: 2.0,
    modIndex: 2.0,
    attack: 0.01,
    decay: 0.1,
    sustain: 0.85,
    release: 0.2,
    modAttack: 0.01,
    modDecay: 0.08,
    modSustain: 0.7,
    modRelease: 0.15,
    feedback: 0.2,
  },
  'ORGAN': {
    carWaveform: 'sine',
    modWaveform: 'sine',
    modRatio: 2.0,
    modIndex: 1.5,
    attack: 0.005,
    decay: 0.01,
    sustain: 0.95,
    release: 0.05,
    modAttack: 0.005,
    modDecay: 0.01,
    modSustain: 0.9,
    modRelease: 0.05,
    feedback: 0.3,
  },
};
