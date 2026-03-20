/**
 * FM-80 Drum Synthesizer + Drum Sequencer UI
 */

class DrumSynth {
  constructor(ctx) {
    this.ctx = ctx;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.7;
    this.masterGain.connect(ctx.destination);
    this._sidechainGains = []; // bass synth gains to duck on kick
  }

  // Call with [bassSynth.masterGain, bassSynth2.masterGain] to enable sidechain
  setSidechain(gains) {
    this._sidechainGains = gains;
  }

  playKick(when) {
    const ctx = this.ctx, now = when !== undefined ? when : ctx.currentTime;

    // Sidechain: briefly duck bass synths so kick punches through
    this._sidechainGains.forEach(g => {
      const v = g.gain.value;
      g.gain.setValueAtTime(v, now);
      g.gain.linearRampToValueAtTime(v * 0.12, now + 0.006);
      g.gain.linearRampToValueAtTime(v, now + 0.10);
    });

    // Sub body: 808-style pitch sweep
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(35, now + 0.35);
    gain.gain.setValueAtTime(2.0, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.5);

    // Click transient: high-freq burst gives attack presence in the mix
    const click     = ctx.createOscillator();
    const clickGain = ctx.createGain();
    click.frequency.setValueAtTime(1400, now);
    click.frequency.exponentialRampToValueAtTime(60, now + 0.02);
    clickGain.gain.setValueAtTime(1.2, now);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.018);
    click.connect(clickGain);
    clickGain.connect(this.masterGain);
    click.start(now);
    click.stop(now + 0.025);
  }

  playSnare(when) {
    const ctx = this.ctx, now = when !== undefined ? when : ctx.currentTime;
    // Noise body: bandpass mid-range
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
    // Snap/crack: hi-freq burst that cuts through the mix
    const snapBuf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.03), ctx.sampleRate);
    const sd = snapBuf.getChannelData(0);
    for (let i = 0; i < sd.length; i++) sd[i] = Math.random() * 2 - 1;
    const snapSrc  = ctx.createBufferSource(); snapSrc.buffer = snapBuf;
    const snapFilt = ctx.createBiquadFilter();
    snapFilt.type = 'highpass'; snapFilt.frequency.value = 7000;
    const snapGain = ctx.createGain();
    snapGain.gain.setValueAtTime(1.5, now);
    snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    snapSrc.connect(snapFilt); snapFilt.connect(snapGain); snapGain.connect(this.masterGain);
    snapSrc.start(now);
    // Tone body
    const osc  = ctx.createOscillator();
    const oGain = ctx.createGain();
    osc.frequency.value = 180;
    oGain.gain.setValueAtTime(0.45, now);
    oGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(oGain); oGain.connect(this.masterGain);
    osc.start(now); osc.stop(now + 0.1);
  }

  playHihat(when) {
    const ctx = this.ctx, now = when !== undefined ? when : ctx.currentTime;
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

  playOpenHihat(when) {
    const ctx = this.ctx, now = when !== undefined ? when : ctx.currentTime;
    const dur = 0.45;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src  = ctx.createBufferSource(); src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'highpass'; filt.frequency.value = 7000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.45, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(filt); filt.connect(gain); gain.connect(this.masterGain);
    src.start(now);
  }

  playCowbell(when) {
    const ctx = this.ctx, now = when !== undefined ? when : ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.55, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    gain.connect(this.masterGain);
    // 808 cowbell: two detuned square oscillators through a bandpass
    [562, 845].forEach(freq => {
      const osc    = ctx.createOscillator();
      const bp     = ctx.createBiquadFilter();
      osc.type     = 'square';
      osc.frequency.value = freq;
      bp.type      = 'bandpass';
      bp.frequency.value  = 700;
      bp.Q.value   = 3.5;
      osc.connect(bp); bp.connect(gain);
      osc.start(now); osc.stop(now + 0.4);
    });
  }

  playClap(when) {
    const ctx = this.ctx, now = when !== undefined ? when : ctx.currentTime;
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

  playAt(type, when) {
    switch (type) {
      case 'kick':    this.playKick(when);    break;
      case 'snare':   this.playSnare(when);   break;
      case 'hihat':   this.playHihat(when);   break;
      case 'openhat': this.playOpenHihat(when); break;
      case 'clap':    this.playClap(when);    break;
      case 'cowbell': this.playCowbell(when); break;
    }
  }

  setMasterVolume(v) { this.masterGain.gain.value = v; }
}

// ── Drum track metadata ────────────────────────────────────
const DRUM_TRACKS = [
  { key: 'kick',    label: 'KICK',  color: '#00e5ff' },
  { key: 'snare',   label: 'SNARE', color: '#ff4da6' },
  { key: 'hihat',   label: 'H.HAT', color: '#aaff44' },
  { key: 'openhat', label: 'O.HAT', color: '#88ffcc' },
  { key: 'clap',    label: 'CLAP',  color: '#ff9900' },
  { key: 'cowbell', label: 'COWBL', color: '#cc88ff' },
];

let drumSynth = null;

// ── Build drum grid UI ─────────────────────────────────────
function initDrums() {
  const container = document.getElementById('drum-grid');
  if (!container) return;

  // ON/OFF toggle
  const toggleBtn = document.getElementById('drum-toggle-btn');
  toggleBtn.addEventListener('click', () => {
    sequencer.drumEnabled = !sequencer.drumEnabled;
    toggleBtn.textContent = sequencer.drumEnabled ? 'ON' : 'OFF';
    toggleBtn.classList.toggle('active', sequencer.drumEnabled);
  });

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
