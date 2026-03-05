/**
 * FM-80 Synthesizer — UI Controller
 */

let audioCtx = null;
let synth = null;
let currentOctave = 4;

// ====== Keyboard layout ======
// White keys in order, with their note names relative to an octave
const WHITE_NOTES = ['C','D','E','F','G','A','B'];
const BLACK_NOTES = { 0:'C#', 1:'D#', 3:'F#', 4:'G#', 5:'A#' }; // index among whites

// PC keyboard mapping (2 octaves)
const PC_KEY_MAP = {
  'a': 'C', 'w': 'C#', 's': 'D', 'e': 'D#', 'd': 'E',
  'f': 'F', 't': 'F#', 'g': 'G', 'y': 'G#', 'h': 'A',
  'u': 'A#', 'j': 'B',
  'k': 'C+', 'o': 'C#+', 'l': 'D+', 'p': 'D#+',
};

// ====== Init ======
document.getElementById('start-btn').addEventListener('click', () => {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  synth = new FMSynth(audioCtx);
  document.getElementById('start-overlay').style.display = 'none';
  document.getElementById('led-power').dataset.active = 'true';
  document.getElementById('led-audio').dataset.active = 'true';
  buildKeyboard();
  initKnobs();
  initPresets();
  initKeyboardControls();
  initPCKeyboard();
});

// ====== Build Piano Keyboard ======
function buildKeyboard() {
  const kb = document.getElementById('keyboard');
  kb.innerHTML = '';
  const startOctave = 3;
  const numOctaves = 3;

  let whiteIdx = 0;
  const whiteKeys = [];

  for (let oct = startOctave; oct < startOctave + numOctaves; oct++) {
    WHITE_NOTES.forEach((note, i) => {
      const midi = noteNameToMidi(note + oct);
      const el = document.createElement('div');
      el.className = 'key-white';
      el.dataset.midi = midi;
      el.dataset.note = note + oct;

      const lbl = document.createElement('span');
      lbl.className = 'key-note-label';
      if (note === 'C') lbl.textContent = 'C' + oct;
      el.appendChild(lbl);

      addKeyEvents(el, midi, note + oct);
      kb.appendChild(el);
      whiteKeys.push({ el, whiteIdx: whiteIdx++, note, oct });
    });
  }

  // Black keys — positioned absolutely relative to keyboard
  // We re-iterate to place black keys over the right whites
  let wCount = 0;
  for (let oct = startOctave; oct < startOctave + numOctaves; oct++) {
    WHITE_NOTES.forEach((note, noteIdx) => {
      if (BLACK_NOTES[noteIdx] !== undefined) {
        const bNote = BLACK_NOTES[noteIdx];
        const midi = noteNameToMidi(bNote + oct);
        const el = document.createElement('div');
        el.className = 'key-black';
        el.dataset.midi = midi;
        el.dataset.note = bNote + oct;
        // Position: left edge of white[wCount] + white_width - black_width/2
        el.style.left = (wCount * 36 + 36 - 11) + 'px';
        addKeyEvents(el, midi, bNote + oct);
        kb.appendChild(el);
      }
      wCount++;
    });
  }
}

function addKeyEvents(el, midi, noteName) {
  const activate = () => {
    if (!synth) return;
    el.classList.add('active');
    synth.noteOn(midi);
    document.getElementById('note-display').textContent = noteName;
    document.getElementById('led-audio').dataset.active = 'true';
  };
  const deactivate = () => {
    el.classList.remove('active');
    if (synth) synth.noteOff(midi);
  };

  el.addEventListener('mousedown', e => { e.preventDefault(); activate(); });
  el.addEventListener('mouseup', deactivate);
  el.addEventListener('mouseleave', deactivate);
  el.addEventListener('touchstart', e => { e.preventDefault(); activate(); }, { passive: false });
  el.addEventListener('touchend', deactivate);
}

// ====== PC Keyboard ======
const pressedKeys = new Set();

function initPCKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.repeat || !synth) return;
    const k = e.key.toLowerCase();
    if (!PC_KEY_MAP[k]) return;

    let noteStr = PC_KEY_MAP[k];
    let octave = currentOctave;
    if (noteStr.endsWith('+')) {
      noteStr = noteStr.slice(0, -1);
      octave++;
    }

    const midi = noteNameToMidi(noteStr + octave);
    pressedKeys.add(k);
    synth.noteOn(midi);
    // Highlight key
    const keyEl = document.querySelector(`.key-white[data-midi="${midi}"], .key-black[data-midi="${midi}"]`);
    if (keyEl) {
      keyEl.classList.add('active');
      document.getElementById('note-display').textContent = noteStr + octave;
    }
  });

  document.addEventListener('keyup', e => {
    if (!synth) return;
    const k = e.key.toLowerCase();
    if (!PC_KEY_MAP[k]) return;

    let noteStr = PC_KEY_MAP[k];
    let octave = currentOctave;
    if (noteStr.endsWith('+')) {
      noteStr = noteStr.slice(0, -1);
      octave++;
    }

    const midi = noteNameToMidi(noteStr + octave);
    pressedKeys.delete(k);
    synth.noteOff(midi);
    const keyEl = document.querySelector(`.key-white[data-midi="${midi}"], .key-black[data-midi="${midi}"]`);
    if (keyEl) keyEl.classList.remove('active');
  });
}

// ====== Octave / Pitch Controls ======
function initKeyboardControls() {
  document.getElementById('octave-down').addEventListener('click', () => {
    if (currentOctave > 1) currentOctave--;
    document.getElementById('octave-display').textContent = 'OCT ' + currentOctave;
  });
  document.getElementById('octave-up').addEventListener('click', () => {
    if (currentOctave < 7) currentOctave++;
    document.getElementById('octave-display').textContent = 'OCT ' + currentOctave;
  });

  const pb = document.getElementById('pitchbend');
  pb.addEventListener('input', () => {
    const semitones = parseFloat(pb.value);
    // Apply pitch bend to all voices (simplistic: adjusts filter offset)
    if (synth) {
      Object.values(synth.voices).forEach(v => {
        const bent = v.freq * Math.pow(2, semitones / 12);
        v.carrier.frequency.setValueAtTime(bent, audioCtx.currentTime);
      });
    }
  });
  pb.addEventListener('change', () => {
    pb.value = 0;
    const event = new Event('input');
    pb.dispatchEvent(event);
  });
}

// ====== Preset buttons ======
function initPresets() {
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (synth) {
        synth.setPatch(btn.dataset.preset);
        // Refresh knobs from new patch
        refreshKnobsFromPatch(synth.patch);
      }
    });
  });
}

// ====== Knobs ======
function initKnobs() {
  document.querySelectorAll('.knob').forEach(knob => {
    const param = knob.dataset.param;
    const min = parseFloat(knob.dataset.min);
    const max = parseFloat(knob.dataset.max);
    const def = parseFloat(knob.dataset.default);
    const norm = (def - min) / (max - min);
    setKnobAngle(knob, norm);

    let startY = 0;
    let startNorm = norm;
    knob._norm = norm;

    const onMove = e => {
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const delta = (startY - clientY) / 150;
      const newNorm = Math.max(0, Math.min(1, startNorm + delta));
      knob._norm = newNorm;
      setKnobAngle(knob, newNorm);
      const value = min + (max - min) * newNorm;
      applyParam(param, value);
    };

    const onUp = () => {
      knob.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
    };

    knob.addEventListener('mousedown', e => {
      e.preventDefault();
      startY = e.clientY;
      startNorm = knob._norm;
      knob.classList.add('dragging');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    knob.addEventListener('touchstart', e => {
      e.preventDefault();
      startY = e.touches[0].clientY;
      startNorm = knob._norm;
      knob.classList.add('dragging');
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onUp);
    }, { passive: false });

    // Double-click to reset
    knob.addEventListener('dblclick', () => {
      const n = (def - min) / (max - min);
      knob._norm = n;
      setKnobAngle(knob, n);
      applyParam(param, def);
    });
  });
}

function setKnobAngle(knob, norm) {
  // Range: -140deg to +140deg (280deg total)
  const angle = -140 + norm * 280;
  const dot = knob.querySelector('.knob-dot');
  if (dot) dot.style.transform = `translateX(-50%) rotate(${angle}deg)`;
}

function refreshKnobsFromPatch(patch) {
  document.querySelectorAll('.knob').forEach(knob => {
    const param = knob.dataset.param;
    const min = parseFloat(knob.dataset.min);
    const max = parseFloat(knob.dataset.max);

    let value;
    if (param === 'filter') value = synth.filter.frequency.value;
    else if (param === 'reverb') value = synth.reverbGain.gain.value;
    else if (param === 'chorus') value = synth.chorusGain.gain.value;
    else if (param === 'volume') value = synth.masterGain.gain.value;
    else value = patch[param];

    if (value === undefined) return;
    const norm = Math.max(0, Math.min(1, (value - min) / (max - min)));
    knob._norm = norm;
    setKnobAngle(knob, norm);
  });
}

function applyParam(param, value) {
  if (!synth) return;
  switch (param) {
    case 'attack':      synth.setParam('attack', value); break;
    case 'decay':       synth.setParam('decay', value); break;
    case 'sustain':     synth.setParam('sustain', value); break;
    case 'release':     synth.setParam('release', value); break;
    case 'modRatio':    synth.setParam('modRatio', value); break;
    case 'modIndex':    synth.setParam('modIndex', value); break;
    case 'modDecay':    synth.setParam('modDecay', value); break;
    case 'feedback':    synth.setParam('feedback', value); break;
    case 'filter':      synth.setFilterFreq(value); break;
    case 'reverb':      synth.setReverbMix(value); break;
    case 'chorus':      synth.setChorusMix(value); break;
    case 'volume':      synth.setMasterVolume(value); break;
  }
}
