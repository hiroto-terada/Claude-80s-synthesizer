/**
 * FM-80 Chord Sequencer
 * Chord palette + 16-step chord sequencer with pattern bank
 */

const CHORD_TYPES = [
  { id: 'maj',  label: 'MAJ', intervals: [0, 4, 7] },
  { id: 'min',  label: 'MIN', intervals: [0, 3, 7] },
  { id: '7',    label: '7th', intervals: [0, 4, 7, 10] },
  { id: 'm7',   label: 'm7',  intervals: [0, 3, 7, 10] },
  { id: 'maj7', label: 'M7',  intervals: [0, 4, 7, 11] },
  { id: 'dim',  label: 'DIM', intervals: [0, 3, 6] },
  { id: 'sus4', label: 'SUS', intervals: [0, 5, 7] },
];

const CHORD_ROOT_NAMES    = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const CHORD_ROOT_IS_BLACK = [false,true,false,true,false,false,true,false,true,false,true,false];

function chordLabel(root, typeId) {
  const type = CHORD_TYPES.find(t => t.id === typeId);
  return CHORD_ROOT_NAMES[root % 12] + (type ? type.label : typeId);
}

function chordMidis(root, typeId) {
  const type = CHORD_TYPES.find(t => t.id === typeId);
  return (type ? type.intervals : [0, 4, 7]).map(i => root + i);
}

// ── Chord Sequencer ────────────────────────────────────────
class ChordSequencer {
  constructor() {
    this.bpm         = 65;
    this.playing     = false;
    this.currentStep = -1;
    this._timerId    = null;
    this._synth      = null;   // FMSynth instance assigned after boot
    this._playBtn    = null;
    this._pendingPattern  = null;
    this._playingMidis    = [];

    this.steps = Array.from({ length: 16 }, () => ({
      chord:  null,   // { root: midiNote, type: 'maj' } | null
      active: false,
    }));
  }

  get stepMs() { return (60 / this.bpm) / 4 * 1000; }

  play() {
    if (this.playing) return;
    this.playing     = true;
    this.currentStep = -1;
    this._tick();
  }

  stop() {
    this.playing = false;
    clearTimeout(this._timerId);
    this._offAll();
    this._highlightStep(-1);
    this.currentStep = -1;
    if (this._pendingPattern) {
      if (typeof this._pendingPattern.onCancel === 'function') this._pendingPattern.onCancel();
      this._pendingPattern = null;
    }
  }

  _offAll() {
    if (this._synth && this._playingMidis.length) {
      this._playingMidis.forEach(m => this._synth.noteOff(m));
      this._playingMidis = [];
    }
  }

  _tick() {
    this.currentStep = (this.currentStep + 1) % 16;

    if (this.currentStep === 0 && this._pendingPattern) {
      this._pendingPattern.steps.forEach((s, i) => {
        this.steps[i].chord  = s.chord;
        this.steps[i].active = s.active;
      });
      if (typeof this._pendingPattern.onApply === 'function') this._pendingPattern.onApply();
      this._pendingPattern = null;
    }

    const step = this.steps[this.currentStep];
    if (this._synth) {
      if (step.active && step.chord) {
        const midis = chordMidis(step.chord.root, step.chord.type);
        // Keep playing if exact same chord — no retrigger, no stutter
        const same = midis.length === this._playingMidis.length &&
                     midis.every((m, i) => m === this._playingMidis[i]);
        if (!same) {
          this._offAll();
          midis.forEach(m => this._synth.noteOn(m));
          this._playingMidis = [...midis];
        }
      } else {
        // Inactive / empty step — cut notes
        this._offAll();
      }
    }

    this._highlightStep(this.currentStep);

    if (this.playing) {
      this._timerId = setTimeout(() => this._tick(), this.stepMs);
    }
  }

  _highlightStep(idx) {
    const container = document.getElementById('chord-steps');
    if (!container) return;
    container.querySelectorAll('.chord-step').forEach((el, i) => {
      el.classList.toggle('seq-current', i === idx);
    });
  }

  _updateStepUI(idx) {
    const container = document.getElementById('chord-steps');
    if (!container) return;
    const cell = container.querySelector(`.chord-step[data-step="${idx}"]`);
    if (!cell) return;
    const step = this.steps[idx];
    const nameEl = cell.querySelector('.chord-step-name');
    if (nameEl) {
      nameEl.textContent = step.chord ? chordLabel(step.chord.root, step.chord.type) : '---';
    }
    const toggle = cell.querySelector('.seq-toggle');
    if (toggle) {
      toggle.textContent = (step.active && step.chord) ? 'ON' : '—';
      toggle.classList.toggle('active', step.active && !!step.chord);
    }
    cell.classList.toggle('seq-on', step.active && !!step.chord);
  }
}

// ── Module-level state ─────────────────────────────────────
let chordSeq         = null;
let chordPatternBank = null;

let chordWriteMode    = false;
let chordWriteStep    = 0;
let selectedChordType = 'maj';
let chordOctave       = 4;

// ── Init ───────────────────────────────────────────────────
function initChordSection() {
  chordSeq = new ChordSequencer();
  _buildChordUI();
  chordPatternBank = _initChordPatternBank();

  // Collapsible toggle
  const toggleBtn = document.getElementById('chord-toggle-btn');
  const section   = document.getElementById('chord-section');
  toggleBtn.addEventListener('click', () => {
    const isOpen = section.classList.toggle('open');
    toggleBtn.textContent = isOpen ? 'CHORD ▲' : 'CHORD ▼';
  });
}

// ── UI Builder ─────────────────────────────────────────────
function _buildChordUI() {
  // Chord type selector
  document.querySelectorAll('.chord-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedChordType = btn.dataset.type;
      document.querySelectorAll('.chord-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Chord palette: click plays chord (and assigns in write mode)
  document.getElementById('chord-palette').addEventListener('click', e => {
    const btn = e.target.closest('.chord-root-btn');
    if (!btn) return;
    const root = parseInt(btn.dataset.semitone) + chordOctave * 12;
    _playChordPreview(root, selectedChordType);
    if (chordWriteMode) {
      _assignChordStep(chordWriteStep, root, selectedChordType);
      chordWriteStep = (chordWriteStep + 1) % 16;
      _highlightChordWriteStep(chordWriteStep);
    }
  });

  // Octave controls
  document.getElementById('chord-oct-down').addEventListener('click', () => {
    chordOctave = Math.max(2, chordOctave - 1);
    document.getElementById('chord-oct-display').textContent = 'OCT ' + chordOctave;
  });
  document.getElementById('chord-oct-up').addEventListener('click', () => {
    chordOctave = Math.min(6, chordOctave + 1);
    document.getElementById('chord-oct-display').textContent = 'OCT ' + chordOctave;
  });

  // Build step cells
  const container = document.getElementById('chord-steps');
  chordSeq.steps.forEach((_, i) => {
    const div = document.createElement('div');
    div.className  = 'chord-step';
    div.dataset.step = i;
    div.innerHTML =
      `<div class="seq-step-num">${i + 1}</div>` +
      `<div class="chord-step-name">---</div>` +
      `<button class="seq-toggle" data-step="${i}">—</button>`;
    container.appendChild(div);
  });

  // Step cell interaction
  container.addEventListener('click', e => {
    const cell = e.target.closest('.chord-step');
    if (!cell) return;
    const idx = parseInt(cell.dataset.step);
    if (e.target.classList.contains('seq-toggle')) {
      const step = chordSeq.steps[idx];
      if (step.chord) {
        step.active = !step.active;
        chordSeq._updateStepUI(idx);
      }
    } else if (chordWriteMode) {
      chordWriteStep = idx;
      _highlightChordWriteStep(idx);
    }
  });

  // STEP write button
  const stepWriteBtn = document.getElementById('chord-step-write-btn');
  const restBtn      = document.getElementById('chord-rest-btn');
  stepWriteBtn.addEventListener('click', () => {
    chordWriteMode = !chordWriteMode;
    stepWriteBtn.classList.toggle('active', chordWriteMode);
    restBtn.style.display = chordWriteMode ? '' : 'none';
    _highlightChordWriteStep(chordWriteMode ? chordWriteStep : -1);
  });

  // REST button: clear current step and advance
  restBtn.addEventListener('click', () => {
    if (!chordWriteMode) return;
    chordSeq.steps[chordWriteStep].chord  = null;
    chordSeq.steps[chordWriteStep].active = false;
    chordSeq._updateStepUI(chordWriteStep);
    chordWriteStep = (chordWriteStep + 1) % 16;
    _highlightChordWriteStep(chordWriteStep);
  });
}

function _playChordPreview(root, typeId) {
  if (!chordSeq || !chordSeq._synth) return;
  const midis = chordMidis(root, typeId);
  midis.forEach(m => chordSeq._synth.noteOn(m));
  setTimeout(() => midis.forEach(m => chordSeq._synth.noteOff(m)), 2000);
}

function _assignChordStep(idx, root, typeId) {
  chordSeq.steps[idx].chord  = { root, type: typeId };
  chordSeq.steps[idx].active = true;
  chordSeq._updateStepUI(idx);
}

function _highlightChordWriteStep(idx) {
  const container = document.getElementById('chord-steps');
  if (!container) return;
  container.querySelectorAll('.chord-step').forEach((el, i) => {
    el.classList.toggle('seq-write-current', i === idx);
  });
}

// ── Chord Pattern Bank ──────────────────────────────────────
function _initChordPatternBank() {
  const bar     = document.getElementById('chord-pattern-bar');
  const saveBtn = document.getElementById('chord-pattern-save-btn');
  const seq     = chordSeq;

  let patterns = Array(8).fill(null);
  try {
    const saved = JSON.parse(localStorage.getItem('fm80-chord-patterns'));
    if (Array.isArray(saved) && saved.length === 8) patterns = saved;
  } catch (_) {}

  let saveMode = false;
  let peers    = [];

  function getSlotBtns() { return bar.querySelectorAll('.seq-pattern-slot'); }
  getSlotBtns().forEach(btn => {
    if (patterns[parseInt(btn.dataset.slot)]) btn.classList.add('filled');
  });

  function enterSaveMode() { saveMode = true;  saveBtn.classList.add('active');    bar.classList.add('save-mode'); }
  function exitSaveMode()  { saveMode = false; saveBtn.classList.remove('active'); bar.classList.remove('save-mode'); }

  function doLoad(slot) {
    if (!patterns[slot]) return;
    const slotBtns = getSlotBtns();
    const slotBtn  = bar.querySelector(`.seq-pattern-slot[data-slot="${slot}"]`);

    const applyPattern = () => {
      patterns[slot].steps.forEach((s, i) => {
        seq.steps[i].chord  = s.chord ? { ...s.chord } : null;
        seq.steps[i].active = s.active;
        seq._updateStepUI(i);
      });
      slotBtns.forEach(b => b.classList.remove('loaded', 'pending'));
      if (slotBtn) slotBtn.classList.add('loaded');
    };

    if (seq.playing) {
      slotBtns.forEach(b => b.classList.remove('pending'));
      if (slotBtn) slotBtn.classList.add('pending');
      seq._pendingPattern = {
        steps: patterns[slot].steps.map(s => ({ chord: s.chord ? { ...s.chord } : null, active: s.active })),
        onApply:  applyPattern,
        onCancel: () => { getSlotBtns().forEach(b => b.classList.remove('pending')); },
      };
    } else {
      applyPattern();
    }
  }

  bar.addEventListener('click', e => {
    if (e.target === saveBtn) { saveMode ? exitSaveMode() : enterSaveMode(); return; }
    const slotBtn = e.target.closest('.seq-pattern-slot');
    if (!slotBtn) return;
    const slot     = parseInt(slotBtn.dataset.slot);
    const slotBtns = getSlotBtns();
    if (saveMode) {
      patterns[slot] = {
        steps: seq.steps.map(s => ({ chord: s.chord ? { ...s.chord } : null, active: s.active })),
      };
      try { localStorage.setItem('fm80-chord-patterns', JSON.stringify(patterns)); } catch (_) {}
      slotBtns.forEach(b => b.classList.remove('loaded'));
      slotBtn.classList.add('filled', 'loaded');
      exitSaveMode();
    } else {
      doLoad(slot);
      peers.forEach(p => p.doLoad(slot));
    }
  });

  return { doLoad, addPeer(p) { peers.push(p); } };
}
