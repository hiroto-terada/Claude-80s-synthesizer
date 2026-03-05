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
    this.bpm = 120;
    this.playing = false;
    this.currentStep = -1;
    this._timerId = null;

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
    this.playing = false;
    clearTimeout(this._timerId);
    if (typeof bassSynth !== 'undefined' && bassSynth) bassSynth.allNotesOff();
    this._highlightStep(-1);
    this.currentStep = -1;
  }

  _tick() {
    this.currentStep = (this.currentStep + 1) % 16;
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
    });
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

  // Play / Stop
  const playBtn = document.getElementById('seq-play-btn');
  playBtn.addEventListener('click', () => {
    if (!bassSynth) return;
    if (sequencer.playing) {
      sequencer.stop();
      playBtn.textContent = '▶ PLAY';
      playBtn.classList.remove('playing');
    } else {
      sequencer.play();
      playBtn.textContent = '■ STOP';
      playBtn.classList.add('playing');
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
