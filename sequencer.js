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

    // Default: B1, every other step ON
    this.steps = [
      { active: true,  midi: 35 },
      { active: false, midi: 35 },
      { active: true,  midi: 35 },
      { active: false, midi: 35 },
      { active: true,  midi: 35 },
      { active: false, midi: 35 },
      { active: true,  midi: 35 },
      { active: false, midi: 35 },
      { active: true,  midi: 35 },
      { active: false, midi: 35 },
      { active: true,  midi: 35 },
      { active: false, midi: 35 },
      { active: true,  midi: 35 },
      { active: false, midi: 35 },
      { active: true,  midi: 35 },
      { active: false, midi: 35 },
    ];

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
    if (typeof bassSynth !== 'undefined' && bassSynth) bassSynth.allNotesOff();
    this._highlightStep(-1);
    this.currentStep = -1;
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
    if (typeof bassSynth !== 'undefined' && bassSynth) {
      bassSynth.allNotesOff();
      if (step.active) {
        bassSynth.noteOn(step.midi);
        const noteOff = step.midi;
        setTimeout(() => {
          if (typeof bassSynth !== 'undefined' && bassSynth) bassSynth.noteOff(noteOff);
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

  // REC button
  const recBtn  = document.getElementById(recBtnId);
  const playBtn = document.getElementById(playBtnId);

  function setPlayBtnState(playing) {
    playBtn.textContent = playing ? '■ STOP' : '▶ PLAY';
    playBtn.classList.toggle('playing', playing);
  }

  recBtn.addEventListener('click', () => {
    if (!bassSynth) return;
    if (seq.recording) return;
    recBtn.classList.add('recording');
    setPlayBtnState(true);

    seq.onCountdown = (beat) => {
      recBtn.textContent = beat > 0 ? `${beat}...` : '⏹ REC';
    };
    seq.onRecordStop = () => {
      recBtn.classList.remove('recording');
      recBtn.textContent = '⏺ REC';
      setPlayBtnState(seq.playing);
    };
    seq.startRecord();
  });

  // PLAY / STOP
  playBtn.addEventListener('click', () => {
    if (!bassSynth) return;
    if (seq.playing) {
      seq.stop();
      recBtn.classList.remove('recording');
      recBtn.textContent = '⏺ REC';
      setPlayBtnState(false);
    } else {
      seq.play();
      setPlayBtnState(true);
    }
  });

  // BPM controls
  const bpmDisplay = document.getElementById(bpmDisplayId);
  document.getElementById(bpmDownId).addEventListener('click', () => {
    seq.bpm = Math.max(40, seq.bpm - 5);
    bpmDisplay.textContent = seq.bpm;
  });
  document.getElementById(bpmUpId).addEventListener('click', () => {
    seq.bpm = Math.min(240, seq.bpm + 5);
    bpmDisplay.textContent = seq.bpm;
  });
}

function initSequencer() {
  sequencer = new Sequencer({ containerId: 'seq-steps', prefix: 'seq' });
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
}

function initSequencer2() {
  sequencer2 = new Sequencer({ containerId: 'seq2-steps', prefix: 'seq2' });
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
}
