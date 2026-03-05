/**
 * FM-80 Synthesizer — UI Controller
 */

let audioCtx = null;
let synth    = null;
let currentOctave = 4;

// PC keyboard → note mapping (relative to currentOctave)
const PC_KEY_MAP = {
  'a':'C',  'w':'C#', 's':'D',  'e':'D#', 'd':'E',
  'f':'F',  't':'F#', 'g':'G',  'y':'G#', 'h':'A',
  'u':'A#', 'j':'B',
  'k':'C+', 'o':'C#+','l':'D+', 'p':'D#+'
};

// ── Boot ──────────────────────────────────────────────────
document.getElementById('start-btn').addEventListener('click', () => {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // iOS: resume context (may be suspended even after user gesture)
  if (audioCtx.state === 'suspended') audioCtx.resume();

  synth = new FMSynth(audioCtx);

  document.getElementById('start-overlay').style.display = 'none';
  setLed('led-power', true);

  buildKeyboard();
  initKnobs();
  initPresets();
  initKeyboardControls();
  initPCKeyboard();
});

// ── Piano Keyboard ────────────────────────────────────────
const WHITE_NOTES  = ['C','D','E','F','G','A','B'];
const BLACK_OFFSETS = { 0:'C#', 1:'D#', 3:'F#', 4:'G#', 5:'A#' };

function buildKeyboard() {
  const kb = document.getElementById('keyboard');
  kb.innerHTML = '';

  // currentOctave を中心に 2オクターブ下から4オクターブ表示
  const startOct = Math.max(0, currentOctave - 2), numOct = 4;
  let wCount = 0;

  // White keys
  for (let oct = startOct; oct < startOct + numOct; oct++) {
    WHITE_NOTES.forEach(note => {
      const midi = noteNameToMidi(note + oct);
      const el = document.createElement('div');
      el.className = 'key-white';
      el.dataset.midi = midi;
      if (note === 'C') {
        const lbl = document.createElement('span');
        lbl.className = 'klabel';
        lbl.textContent = 'C' + oct;
        el.appendChild(lbl);
      }
      addKeyHandlers(el, midi, note + oct);
      kb.appendChild(el);
      wCount++;
    });
  }

  // Black keys (positioned absolutely)
  let w = 0;
  for (let oct = startOct; oct < startOct + numOct; oct++) {
    WHITE_NOTES.forEach((note, idx) => {
      if (BLACK_OFFSETS[idx] !== undefined) {
        const bNote = BLACK_OFFSETS[idx];
        const midi = noteNameToMidi(bNote + oct);
        const el = document.createElement('div');
        el.className = 'key-black';
        el.dataset.midi = midi;
        el.style.left = (w * 36 + 36 - 11) + 'px';
        addKeyHandlers(el, midi, bNote + oct);
        kb.appendChild(el);
      }
      w++;
    });
  }
}

function addKeyHandlers(el, midi, label) {
  const on  = () => {
    if (!synth) return;
    // iOS Safari: context may suspend between user gestures — always resume
    if (audioCtx && audioCtx.state !== 'running') audioCtx.resume();
    el.classList.add('active');
    synth.noteOn(midi);
    document.getElementById('note-display').textContent = label;
    setLed('led-audio', true);
    setTimeout(() => setLed('led-audio', false), 120);
  };
  const off = () => { el.classList.remove('active'); synth && synth.noteOff(midi); };

  el.addEventListener('mousedown',  e => { e.preventDefault(); on(); });
  el.addEventListener('mouseup',    off);
  el.addEventListener('mouseleave', off);
  el.addEventListener('touchstart', e => { e.preventDefault(); on(); }, { passive: false });
  el.addEventListener('touchend',   off);
}

// ── PC Keyboard ───────────────────────────────────────────
function initPCKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.repeat || !synth) return;
    const k = e.key.toLowerCase();
    const map = PC_KEY_MAP[k];
    if (!map) return;
    if (audioCtx && audioCtx.state !== 'running') audioCtx.resume();
    let note = map, oct = currentOctave;
    if (note.endsWith('+')) { note = note.slice(0, -1); oct++; }
    const midi = noteNameToMidi(note + oct);
    synth.noteOn(midi);
    const el = document.querySelector(`[data-midi="${midi}"]`);
    if (el) { el.classList.add('active'); document.getElementById('note-display').textContent = note + oct; }
  });
  document.addEventListener('keyup', e => {
    if (!synth) return;
    const k = e.key.toLowerCase();
    const map = PC_KEY_MAP[k];
    if (!map) return;
    let note = map, oct = currentOctave;
    if (note.endsWith('+')) { note = note.slice(0, -1); oct++; }
    const midi = noteNameToMidi(note + oct);
    synth.noteOff(midi);
    const el = document.querySelector(`[data-midi="${midi}"]`);
    if (el) el.classList.remove('active');
  });
}

// ── Octave & Pitch Bend ───────────────────────────────────
function initKeyboardControls() {
  document.getElementById('octave-down').addEventListener('click', () => {
    if (currentOctave > 2) {
      currentOctave--;
      document.getElementById('octave-display').textContent = 'OCT ' + currentOctave;
      buildKeyboard();
    }
  });
  document.getElementById('octave-up').addEventListener('click', () => {
    if (currentOctave < 7) {
      currentOctave++;
      document.getElementById('octave-display').textContent = 'OCT ' + currentOctave;
      buildKeyboard();
    }
  });

  const pb = document.getElementById('pitchbend');
  pb.addEventListener('input', () => {
    if (!synth) return;
    const semi = parseFloat(pb.value);
    Object.values(synth.voices).forEach(v => {
      v.car.frequency.setValueAtTime(v.car.frequency.value, audioCtx.currentTime);
      // simple pitch bend via detune
      v.car.detune.setValueAtTime(semi * 100, audioCtx.currentTime);
    });
  });
  pb.addEventListener('pointerup', () => { pb.value = 0; pb.dispatchEvent(new Event('input')); });
}

// ── Presets ───────────────────────────────────────────────
function initPresets() {
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (synth) {
        synth.setPatch(btn.dataset.preset);
        syncKnobsToSynth();
      }
    });
  });
}

// ── Knobs ─────────────────────────────────────────────────
function initKnobs() {
  document.querySelectorAll('.knob').forEach(knob => {
    const min  = parseFloat(knob.dataset.min);
    const max  = parseFloat(knob.dataset.max);
    const def  = parseFloat(knob.dataset.default);
    knob._norm = (def - min) / (max - min);
    rotateKnob(knob, knob._norm);

    let startY = 0, startNorm = 0;

    const onMove = e => {
      const y = e.touches ? e.touches[0].clientY : e.clientY;
      const n = Math.max(0, Math.min(1, startNorm + (startY - y) / 160));
      knob._norm = n;
      rotateKnob(knob, n);
      applyKnobParam(knob.dataset.param, min + (max - min) * n);
    };
    const onUp = () => {
      knob.classList.remove('dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend',  onUp);
    };
    const onDown = e => {
      e.preventDefault();
      startY    = e.touches ? e.touches[0].clientY : e.clientY;
      startNorm = knob._norm;
      knob.classList.add('dragging');
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup',   onUp);
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend',  onUp);
    };

    knob.addEventListener('mousedown',  onDown);
    knob.addEventListener('touchstart', onDown, { passive: false });
    knob.addEventListener('dblclick', () => {
      knob._norm = (def - min) / (max - min);
      rotateKnob(knob, knob._norm);
      applyKnobParam(knob.dataset.param, def);
    });
  });
}

function rotateKnob(knob, norm) {
  const angle = -140 + norm * 280;
  const dot = knob.querySelector('.knob-dot');
  if (dot) dot.style.transform = `translateX(-50%) rotate(${angle}deg)`;
}

function applyKnobParam(param, val) {
  if (!synth) return;
  switch (param) {
    case 'attack':   synth.setParam('attack',   val); break;
    case 'decay':    synth.setParam('decay',    val); break;
    case 'sustain':  synth.setParam('sustain',  val); break;
    case 'release':  synth.setParam('release',  val); break;
    case 'modRatio': synth.setParam('modRatio', val); break;
    case 'modIndex': synth.setParam('modIndex', val); break;
    case 'modDecay': synth.setParam('modDecay', val); break;
    case 'filter':   synth.setFilterFreq(val);        break;
    case 'reverb':   synth.setReverbMix(val);         break;
    case 'volume':   synth.setMasterVolume(val);      break;
  }
}

function syncKnobsToSynth() {
  if (!synth) return;
  document.querySelectorAll('.knob').forEach(knob => {
    const param = knob.dataset.param;
    const min   = parseFloat(knob.dataset.min);
    const max   = parseFloat(knob.dataset.max);
    let val;
    if (param === 'filter')  val = synth.filter.frequency.value;
    else if (param === 'reverb') val = synth.reverbSend.gain.value / 0.35;
    else if (param === 'volume') val = synth.masterGain.gain.value;
    else val = synth.patch[param];
    if (val === undefined) return;
    knob._norm = Math.max(0, Math.min(1, (val - min) / (max - min)));
    rotateKnob(knob, knob._norm);
  });
}

// ── LED helper ────────────────────────────────────────────
function setLed(id, on) {
  const el = document.getElementById(id);
  if (el) el.dataset.on = on ? '1' : '0';
}
