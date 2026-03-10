/**
 * FM-80 Step Sequencer
 * 16 steps, 1 step = 1/16 note (TB-303 style)
 * Full loop = 1 bar (4/4)
 */

const SEQ_NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

function seqMidiToName(midi) {
  return SEQ_NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}

class Sequencer {
  constructor(opts = {}) {
    this._containerId = opts.containerId || 'seq-steps';
    this._prefix      = opts.prefix      || 'seq';
    this._stepWriteBtn = null; // set by _buildSeqUI
    this._restBtn      = null; // set by _buildSeqUI

    this.bpm = 65;
    this.playing = false;
    this.currentStep = -1;
    this._timerId = null;
    this.recording = false;
    this._recStepsLeft = 0;
    this._metronomeOn = false;
    this.onRecordStop = null;

    // Default steps: opts.defaultActive=true→all on, false→all off, null→alternating
    const da = opts.defaultActive;
    const defaultMidi = opts.defaultMidi !== undefined ? opts.defaultMidi : 35;
    this.steps = Array.from({ length: 16 }, (_, i) => ({
      midi: defaultMidi,
      active: da === true ? true : da === false ? false : i % 2 === 0,
    }));

    this._bassSynth = null; // assigned after construction by init code
    this._pendingPattern = null; // queued pattern applied at next loop start

    this.drumEnabled = false;

    this.drumSteps = {
      kick:  [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0].map(Boolean),
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0].map(Boolean),
      hihat: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0].map(Boolean),
      clap:  new Array(16).fill(false),
    };
  }

  get stepMs() {
    return (60 / this.bpm) / 4 * 1000;
  }

  get beatMs() {
    return this.stepMs * 4;
  }

  _playClick(accent = false) {
    const ctx = (typeof audioCtx !== 'undefined') ? audioCtx : null;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.connect(env);
    env.connect(ctx.destination);
    osc.frequency.value = accent ? 1400 : 900;
    env.gain.setValueAtTime(accent ? 0.4 : 0.22, now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);
    osc.start(now);
    osc.stop(now + 0.03);
  }

  _doCountdown(cb) {
    let beat = 4;
    const fire = () => {
      if (beat > 0) {
        if (typeof this.onCountdown === 'function') this.onCountdown(beat);
        this._playClick(beat === 4);
        beat--;
        this._countdownTimer = setTimeout(fire, this.beatMs);
      } else {
        if (typeof this.onCountdown === 'function') this.onCountdown(0);
        cb();
      }
    };
    fire();
  }

  play() {
    if (this.playing) return;
    this.playing = true;
    this.currentStep = -1;
    this._tick();
  }

  stop() {
    clearTimeout(this._countdownTimer);
    this.recording = false;
    this._recStepsLeft = 0;
    this._metronomeOn = false;
    this.playing = false;
    clearTimeout(this._timerId);
    if (this._bassSynth) this._bassSynth.allNotesOff();
    this._highlightStep(-1);
    this.currentStep = -1;
    if (this._pendingPattern) {
      if (typeof this._pendingPattern.onCancel === 'function') this._pendingPattern.onCancel();
      this._pendingPattern = null;
    }
  }

  startRecord() {
    this.stop();
    this._metronomeOn = true;
    this._doCountdown(() => {
      this._recStepsLeft = 16;
      this.recording = true;
      this.playing = true;
      this.currentStep = -1;
      this._tick();
    });
  }

  _tick() {
    this.currentStep = (this.currentStep + 1) % 16;

    // Apply queued pattern at the top of a new loop
    if (this.currentStep === 0 && this._pendingPattern) {
      this._pendingPattern.steps.forEach((s, i) => {
        this.steps[i].midi   = s.midi;
        this.steps[i].active = s.active;
      });
      if (typeof this._pendingPattern.onApply === 'function') this._pendingPattern.onApply();
      this._pendingPattern = null;
    }

    if (this._metronomeOn && this.currentStep % 4 === 0) {
      this._playClick(this.currentStep === 0);
    }

    if (this.recording) {
      const held = (typeof recMidi !== 'undefined' && recMidi !== null);
      const step = this.steps[this.currentStep];
      if (held) {
        step.midi   = recMidi;
        step.active = true;
      } else {
        step.active = false;
      }
      this._updateStepUI(this.currentStep);
      if (typeof recMidi !== 'undefined') recMidi = null;

      this._recStepsLeft--;
      if (this._recStepsLeft <= 0) {
        this.recording = false;
        if (typeof this.onRecordStop === 'function') this.onRecordStop();
      }
    }

    const step = this.steps[this.currentStep];
    if (this._bassSynth) {
      this._bassSynth.allNotesOff();
      if (step.active) {
        this._bassSynth.noteOn(step.midi);
        const noteOff = step.midi;
        setTimeout(() => {
          if (this._bassSynth) this._bassSynth.noteOff(noteOff);
        }, this.stepMs * 0.8);
      }
    }

    if (this.drumEnabled && typeof drumSynth !== 'undefined' && drumSynth) {
      const ds = this.drumSteps, s = this.currentStep;
      if (ds.kick[s])  drumSynth.playKick();
      if (ds.snare[s]) drumSynth.playSnare();
      if (ds.hihat[s]) drumSynth.playHihat();
      if (ds.clap[s])  drumSynth.playClap();
    }

    this._highlightStep(this.currentStep);

    if (this.playing) {
      this._timerId = setTimeout(() => this._tick(), this.stepMs);
    }
  }

  _highlightStep(idx) {
    const container = document.getElementById(this._containerId);
    if (container) {
      container.querySelectorAll('.seq-step').forEach((el, i) => {
        el.classList.toggle('seq-current', i === idx);
        el.classList.toggle('seq-rec-current', this.recording && i === idx);
      });
    }
    // Drum pad highlights (only meaningful for SEQ 1 which owns the drum grid)
    document.querySelectorAll('.drum-pad').forEach(pad => {
      pad.classList.toggle('drum-current', parseInt(pad.dataset.step) === idx);
    });
  }

  _updateStepUI(idx) {
    const step = this.steps[idx];
    const container = document.getElementById(this._containerId);
    if (!container) return;
    const cell = container.querySelector(`.seq-step[data-step="${idx}"]`);
    if (!cell) return;
    const nameEl = document.getElementById(`${this._prefix}-note-${idx}`);
    if (nameEl) nameEl.textContent = seqMidiToName(step.midi);
    const toggle = cell.querySelector('.seq-toggle');
    if (toggle) {
      toggle.textContent = step.active ? 'ON' : '—';
      toggle.classList.toggle('active', step.active);
    }
    cell.classList.toggle('seq-on', step.active);
  }
}

let sequencer  = null;
let sequencer2 = null;

// ── Generic sequencer UI builder ──────────────────────────
function _buildSeqUI(seq, opts) {
  const {
    stepsId, stepWriteBtnId, restBtnId, recBtnId,
    playBtnId, bpmDisplayId, bpmDownId, bpmUpId,
  } = opts;
  const prefix = seq._prefix;

  // Build step cells
  const container = document.getElementById(stepsId);
  seq.steps.forEach((step, i) => {
    const div = document.createElement('div');
    div.className = 'seq-step' + (step.active ? ' seq-on' : '');
    div.dataset.step = i;
    div.innerHTML =
      `<div class="seq-step-num">${i + 1}</div>` +
      `<button class="seq-note-btn seq-note-up" data-step="${i}">▲</button>` +
      `<div class="seq-note-name" id="${prefix}-note-${i}">${seqMidiToName(step.midi)}</div>` +
      `<button class="seq-note-btn seq-note-dn" data-step="${i}">▼</button>` +
      `<button class="seq-toggle${step.active ? ' active' : ''}" data-step="${i}">${step.active ? 'ON' : '—'}</button>`;
    container.appendChild(div);
  });

  // Step cell events
  container.addEventListener('click', e => {
    const btn = e.target;
    let stepIdx = parseInt(btn.dataset.step);
    if (isNaN(stepIdx)) {
      const cell = btn.closest('.seq-step');
      if (cell) stepIdx = parseInt(cell.dataset.step);
    }
    if (isNaN(stepIdx)) return;

    const step = seq.steps[stepIdx];

    if (btn.classList.contains('seq-note-up')) {
      step.midi = Math.min(72, step.midi + 1);
      document.getElementById(`${prefix}-note-${stepIdx}`).textContent = seqMidiToName(step.midi);
    } else if (btn.classList.contains('seq-note-dn')) {
      step.midi = Math.max(24, step.midi - 1);
      document.getElementById(`${prefix}-note-${stepIdx}`).textContent = seqMidiToName(step.midi);
    } else if (btn.classList.contains('seq-toggle')) {
      step.active = !step.active;
      btn.textContent = step.active ? 'ON' : '—';
      btn.classList.toggle('active', step.active);
      container.children[stepIdx].classList.toggle('seq-on', step.active);
    } else if (typeof activeWriteSeq !== 'undefined' && activeWriteSeq === seq) {
      // Step write mode: tap cell to move write cursor
      if (typeof selectedWriteStep !== 'undefined') {
        selectedWriteStep = stepIdx;
        if (typeof highlightWriteStep === 'function') highlightWriteStep(stepIdx);
      }
    }
  });

  // STEP write button
  const stepWriteBtn = document.getElementById(stepWriteBtnId);
  const restBtn      = document.getElementById(restBtnId);
  seq._stepWriteBtn  = stepWriteBtn;
  seq._restBtn       = restBtn;

  stepWriteBtn.addEventListener('click', () => {
    if (typeof activeWriteSeq === 'undefined') return;

    if (activeWriteSeq === seq) {
      // Turn off
      activeWriteSeq = null;
      stepWriteBtn.classList.remove('active');
      restBtn.style.display = 'none';
      if (typeof highlightWriteStep === 'function') highlightWriteStep(-1);
    } else {
      // Deactivate any currently active write seq
      [sequencer, sequencer2].forEach(s => {
        if (s && s._stepWriteBtn) {
          s._stepWriteBtn.classList.remove('active');
          s._restBtn.style.display = 'none';
        }
      });
      if (typeof highlightWriteStep === 'function') highlightWriteStep(-1);

      activeWriteSeq = seq;
      stepWriteBtn.classList.add('active');
      restBtn.style.display = '';
      if (typeof selectedWriteStep !== 'undefined') selectedWriteStep = 0;
      if (typeof highlightWriteStep === 'function') highlightWriteStep(0);
    }
  });

  restBtn.addEventListener('click', () => {
    if (typeof restWriteStep === 'function') restWriteStep();
  });

  // REC / PLAY buttons (store refs on seq for cross-seq sync)
  const recBtn  = document.getElementById(recBtnId);
  const playBtn = document.getElementById(playBtnId);
  seq._playBtn = playBtn;
  seq._recBtn  = recBtn;

  function setAllPlayBtnState(playing) {
    const all = [sequencer, sequencer2, (typeof chordSeq !== 'undefined' ? chordSeq : null)];
    all.forEach(s => {
      if (!s || !s._playBtn) return;
      s._playBtn.textContent = playing ? '■ STOP' : '▶ PLAY';
      s._playBtn.classList.toggle('playing', playing);
    });
  }

  recBtn.addEventListener('click', () => {
    if (!bassSynth) return;
    if (seq.recording) return;
    recBtn.classList.add('recording');
    setAllPlayBtnState(true);

    seq.onCountdown = (beat) => {
      recBtn.textContent = beat > 0 ? `${beat}...` : '⏹ REC';
    };
    seq.onRecordStop = () => {
      recBtn.classList.remove('recording');
      recBtn.textContent = '⏺ REC';
      setAllPlayBtnState(seq.playing);
    };
    seq.startRecord();
  });

  // PLAY / STOP — all sequencers (SEQ1, SEQ2, CHORD) start/stop together
  playBtn.addEventListener('click', () => {
    if (!bassSynth) return;
    const all = [sequencer, sequencer2, (typeof chordSeq !== 'undefined' ? chordSeq : null)].filter(Boolean);
    if (seq.playing) {
      all.forEach(s => {
        s.stop();
        if (s._recBtn) { s._recBtn.classList.remove('recording'); s._recBtn.textContent = '⏺ REC'; }
      });
      setAllPlayBtnState(false);
    } else {
      all.forEach(s => s.play());
      setAllPlayBtnState(true);
    }
  });

  // BPM controls — all sequencers stay in sync
  function applyBpm(newBpm) {
    const all = [sequencer, sequencer2, (typeof chordSeq !== 'undefined' ? chordSeq : null)];
    all.forEach(s => { if (s) s.bpm = newBpm; });
    ['bpm-display', 'bpm2-display'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = newBpm;
    });
  }
  const bpmDisplay = document.getElementById(bpmDisplayId);
  document.getElementById(bpmDownId).addEventListener('click', () => {
    applyBpm(Math.max(40, seq.bpm - 5));
  });
  document.getElementById(bpmUpId).addEventListener('click', () => {
    applyBpm(Math.min(240, seq.bpm + 5));
  });
}

let patternBank1 = null; // controller returned by _initPatternBank for SEQ 1
let patternBank2 = null; // controller returned by _initPatternBank for SEQ 2

function initSequencer() {
  sequencer = new Sequencer({ containerId: 'seq-steps', prefix: 'seq', defaultMidi: 47 });
  _buildSeqUI(sequencer, {
    stepsId:        'seq-steps',
    stepWriteBtnId: 'seq-step-write-btn',
    restBtnId:      'seq-rest-btn',
    recBtnId:       'seq-rec-btn',
    playBtnId:      'seq-play-btn',
    bpmDisplayId:   'bpm-display',
    bpmDownId:      'bpm-down',
    bpmUpId:        'bpm-up',
  });
  patternBank1 = _initPatternBank(sequencer, 'seq-pattern-bar', 'seq-pattern-save-btn', 'fm80-seq1-patterns');
}

// ── Pattern Bank ──────────────────────────────────────────
function _initPatternBank(seq, barId, saveBtnId, storageKey) {
  const bar     = document.getElementById(barId);
  const saveBtn = document.getElementById(saveBtnId);

  // Load persisted patterns from localStorage (fallback to nulls)
  let patterns = Array(8).fill(null);
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(saved) && saved.length === 8) patterns = saved;
  } catch (_) {}

  let saveMode = false;
  let peers = []; // linked pattern banks (set after all banks are created)

  function getSlotBtns() { return bar.querySelectorAll('.seq-pattern-slot'); }

  // Reflect loaded state on slot buttons
  getSlotBtns().forEach(btn => {
    if (patterns[parseInt(btn.dataset.slot)]) btn.classList.add('filled');
  });

  function enterSaveMode() {
    saveMode = true;
    saveBtn.classList.add('active');
    bar.classList.add('save-mode');
  }
  function exitSaveMode() {
    saveMode = false;
    saveBtn.classList.remove('active');
    bar.classList.remove('save-mode');
  }

  // Load a slot on this bank (also called by peer for linked switching)
  function doLoad(slot) {
    if (!patterns[slot]) return;
    const slotBtns = getSlotBtns();
    const slotBtn  = bar.querySelector(`.seq-pattern-slot[data-slot="${slot}"]`);

    const applyPattern = () => {
      patterns[slot].steps.forEach((saved, i) => {
        seq.steps[i].midi   = saved.midi;
        seq.steps[i].active = saved.active;
        seq._updateStepUI(i);
      });
      slotBtns.forEach(b => b.classList.remove('loaded', 'pending'));
      if (slotBtn) slotBtn.classList.add('loaded');
    };

    if (seq.playing) {
      slotBtns.forEach(b => b.classList.remove('pending'));
      if (slotBtn) slotBtn.classList.add('pending');
      seq._pendingPattern = {
        steps: patterns[slot].steps,
        onApply:  applyPattern,
        onCancel: () => { getSlotBtns().forEach(b => b.classList.remove('pending')); },
      };
    } else {
      applyPattern();
    }
  }

  // Use event delegation on bar so it works even when section starts hidden
  bar.addEventListener('click', e => {
    // SAVE button
    if (e.target === saveBtn) {
      saveMode ? exitSaveMode() : enterSaveMode();
      return;
    }

    // Slot button (use closest to handle any inner elements)
    const slotBtn = e.target.closest('.seq-pattern-slot');
    if (!slotBtn) return;

    const slot     = parseInt(slotBtn.dataset.slot);
    const slotBtns = getSlotBtns();

    if (saveMode) {
      // ── SAVE (independent per sequencer) ──
      patterns[slot] = { steps: seq.steps.map(s => ({ midi: s.midi, active: s.active })) };
      try { localStorage.setItem(storageKey, JSON.stringify(patterns)); } catch (_) {}
      slotBtns.forEach(b => b.classList.remove('loaded'));
      slotBtn.classList.add('filled', 'loaded');
      exitSaveMode();
    } else {
      // ── LOAD (linked: switch peer banks to same slot) ──
      doLoad(slot);
      peers.forEach(p => p.doLoad(slot));
    }
  });

  return {
    doLoad,
    addPeer(p) { peers.push(p); },
  };
}

function initSequencer2() {
  sequencer2 = new Sequencer({ containerId: 'seq2-steps', prefix: 'seq2', defaultActive: false });
  _buildSeqUI(sequencer2, {
    stepsId:        'seq2-steps',
    stepWriteBtnId: 'seq2-step-write-btn',
    restBtnId:      'seq2-rest-btn',
    recBtnId:       'seq2-rec-btn',
    playBtnId:      'seq2-play-btn',
    bpmDisplayId:   'bpm2-display',
    bpmDownId:      'bpm2-down',
    bpmUpId:        'bpm2-up',
  });
  patternBank2 = _initPatternBank(sequencer2, 'seq2-pattern-bar', 'seq2-pattern-save-btn', 'fm80-seq2-patterns');
}
