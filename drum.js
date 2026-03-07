/**
 * FM-80 Drum Synthesizer + Drum Sequencer UI
 */

class DrumSynth {
  constructor(ctx) {
    this.ctx = ctx;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.7;
    this.masterGain.connect(ctx.destination);
  }

  playKick() {
    const ctx = this.ctx, now = ctx.currentTime;
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.35);
    gain.gain.setValueAtTime(1.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.5);
  }

  playSnare() {
    const ctx = this.ctx, now = ctx.currentTime;
    // Noise layer
    const dur = 0.22;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src  = ctx.createBufferSource(); src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass'; filt.frequency.value = 1500; filt.Q.value = 0.5;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.85, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(filt); filt.connect(nGain); nGain.connect(this.masterGain);
    src.start(now);
    // Tone body
    const osc  = ctx.createOscillator();
    const oGain = ctx.createGain();
    osc.frequency.value = 180;
    oGain.gain.setValueAtTime(0.45, now);
    oGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(oGain); oGain.connect(this.masterGain);
    osc.start(now); osc.stop(now + 0.1);
  }

  playHihat() {
    const ctx = this.ctx, now = ctx.currentTime;
    const dur = 0.07;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src  = ctx.createBufferSource(); src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'highpass'; filt.frequency.value = 8000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(filt); filt.connect(gain); gain.connect(this.masterGain);
    src.start(now);
  }

  playClap() {
    const ctx = this.ctx, now = ctx.currentTime;
    [0, 0.012, 0.025].forEach(offset => {
      const dur = 0.06;
      const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src  = ctx.createBufferSource(); src.buffer = buf;
      const filt = ctx.createBiquadFilter();
      filt.type = 'bandpass'; filt.frequency.value = 1100; filt.Q.value = 0.7;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.55, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + dur);
      src.connect(filt); filt.connect(gain); gain.connect(this.masterGain);
      src.start(now + offset);
    });
  }

  setMasterVolume(v) { this.masterGain.gain.value = v; }
}

// ── Drum track metadata ────────────────────────────────────
const DRUM_TRACKS = [
  { key: 'kick',  label: 'KICK',  color: '#00e5ff' },
  { key: 'snare', label: 'SNARE', color: '#ff4da6' },
  { key: 'hihat', label: 'H.HAT', color: '#aaff44' },
  { key: 'clap',  label: 'CLAP',  color: '#ff9900' },
];

let drumSynth = null;

// ── Build drum grid UI ─────────────────────────────────────
function initDrums() {
  const container = document.getElementById('drum-grid');
  if (!container) return;

  DRUM_TRACKS.forEach(track => {
    const row = document.createElement('div');
    row.className = 'drum-row';

    const label = document.createElement('div');
    label.className = 'drum-label';
    label.textContent = track.label;
    row.appendChild(label);

    for (let i = 0; i < 16; i++) {
      const btn = document.createElement('button');
      btn.className = 'drum-pad';
      if (sequencer.drumSteps[track.key][i]) btn.classList.add('active');
      if (i % 4 === 3 && i < 15) btn.classList.add('beat-end');
      btn.dataset.drum = track.key;
      btn.dataset.step = i;
      btn.style.setProperty('--pad-color', track.color);
      btn.addEventListener('click', () => {
        const on = sequencer.drumSteps[track.key][i] = !sequencer.drumSteps[track.key][i];
        btn.classList.toggle('active', on);
      });
      row.appendChild(btn);
    }
    container.appendChild(row);
  });
}
