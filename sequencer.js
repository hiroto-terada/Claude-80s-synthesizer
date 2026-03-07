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
  constructor() {
    this.bpm = 65;
    this.playing = false;
    this.currentStep = -1;
    this._timerId = null;
    this.recording = false;
    this._recStepsLeft = 0;
    this.onRecordStop = null; // callback when recording finishes

    // Default: B1, every other step ON
    this.steps = [
      { active: true,  midi: 35 },  // B1
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
  }

  // 1 step = 1/16 note
  get stepMs() {
    return (60 / this.bpm) / 4 * 1000;
  }

  play() {
    if (this.playing) return;
    this.playing = true;
    this.currentStep = -1;
    this._tick();
  }

  stop() {
    this.recording = false;
    this._recStepsLeft = 0;
    this.playing = false;
    clearTimeout(this._timerId);
    if (typeof bassSynth !== 'undefined' && bassSynth) bassSynth.allNotesOff();
    this._highlightStep(-1);
    this.currentStep = -1;
  }

  startRecord() {
    this._recStepsLeft = 16;
    this.recording = true;
    if (!this.playing) {
      this.playing = true;
      this.currentStep = -1;
      this._tick();
    }
  }

  _tick() {
    this.currentStep = (this.currentStep + 1) % 16;

    // ── Recording: capture last pressed note into this step ──
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
      // Reset so next step starts fresh
      if (typeof recMidi !== 'undefined') recMidi = null;

      this._recStepsLeft--;
      if (this._recStepsLeft <= 0) {
        this.recording = false;
        if (typeof this.onRecordStop === 'function') this.onRecordStop();
      }
    }

    // ── Playback ──
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

    this._highlightStep(this.currentStep);

    if (this.playing) {
      this._timerId = setTimeout(() => this._tick(), this.stepMs);
    }
  }

  _highlightStep(idx) {
    document.querySelectorAll('.seq-step').forEach((el, i) => {
      el.classList.toggle('seq-current', i === idx);
      el.classList.toggle('seq-rec-current', this.recording && i === idx);
    });
  }

  _updateStepUI(idx) {
    const step = this.steps[idx];
    const cell = document.querySelector(`.seq-step[data-step="${idx}"]`);
    if (!cell) return;
    const nameEl = document.getElementById(`seq-note-${idx}`);
    if (nameEl) nameEl.textContent = seqMidiToName(step.midi);
    const toggle = cell.querySelector('.seq-toggle');
    if (toggle) {
      toggle.textContent = step.active ? 'ON' : '—';
      toggle.classList.toggle('active', step.active);
    }
    cell.classList.toggle('seq-on', step.active);
  }
}

let sequencer = null;

function initSequencer() {
  sequencer = new Sequencer();

  // Build step cells
  const container = document.getElementById('seq-steps');
  sequencer.steps.forEach((step, i) => {
    const div = document.createElement('div');
    div.className = 'seq-step' + (step.active ? ' seq-on' : '');
    div.dataset.step = i;
    div.innerHTML =
      `<div class="seq-step-num">${i + 1}</div>` +
      `<button class="seq-note-btn seq-note-up" data-step="${i}">▲</button>` +
      `<div class="seq-note-name" id="seq-note-${i}">${seqMidiToName(step.midi)}</div>` +
      `<button class="seq-note-btn seq-note-dn" data-step="${i}">▼</button>` +
      `<button class="seq-toggle${step.active ? ' active' : ''}" data-step="${i}">${step.active ? 'ON' : '—'}</button>`;
    container.appendChild(div);
  });

  // Note up / down / toggle
  container.addEventListener('click', e => {
    const btn = e.target;
    const stepIdx = parseInt(btn.dataset.step);
    if (isNaN(stepIdx)) return;

    const step = sequencer.steps[stepIdx];

    if (btn.classList.contains('seq-note-up')) {
      step.midi = Math.min(72, step.midi + 1);
      document.getElementById(`seq-note-${stepIdx}`).textContent = seqMidiToName(step.midi);
    } else if (btn.classList.contains('seq-note-dn')) {
      step.midi = Math.max(24, step.midi - 1);
      document.getElementById(`seq-note-${stepIdx}`).textContent = seqMidiToName(step.midi);
    } else if (btn.classList.contains('seq-toggle')) {
      step.active = !step.active;
      btn.textContent = step.active ? 'ON' : '—';
      btn.classList.toggle('active', step.active);
      container.children[stepIdx].classList.toggle('seq-on', step.active);
    }
  });

  // REC button
  const recBtn  = document.getElementById('seq-rec-btn');
  const playBtn = document.getElementById('seq-play-btn');

  function setPlayBtnState(playing) {
    playBtn.textContent = playing ? '■ STOP' : '▶ PLAY';
    playBtn.classList.toggle('playing', playing);
  }

  recBtn.addEventListener('click', () => {
    if (!bassSynth) return;
    if (sequencer.recording) return; // already recording, ignore
    recBtn.classList.add('recording');
    recBtn.textContent = '⏹ REC';
    setPlayBtnState(true);
    sequencer.onRecordStop = () => {
      recBtn.classList.remove('recording');
      recBtn.textContent = '⏺ REC';
      setPlayBtnState(sequencer.playing);
    };
    sequencer.startRecord();
  });

  // Play / Stop
  playBtn.addEventListener('click', () => {
    if (!bassSynth) return;
    if (sequencer.playing) {
      sequencer.stop();
      recBtn.classList.remove('recording');
      recBtn.textContent = '⏺ REC';
      setPlayBtnState(false);
    } else {
      sequencer.play();
      setPlayBtnState(true);
    }
  });

  // BPM controls (5 BPM per click)
  const bpmDisplay = document.getElementById('bpm-display');
  document.getElementById('bpm-down').addEventListener('click', () => {
    sequencer.bpm = Math.max(40, sequencer.bpm - 5);
    bpmDisplay.textContent = sequencer.bpm;
  });
  document.getElementById('bpm-up').addEventListener('click', () => {
    sequencer.bpm = Math.min(240, sequencer.bpm + 5);
    bpmDisplay.textContent = sequencer.bpm;
  });
}
