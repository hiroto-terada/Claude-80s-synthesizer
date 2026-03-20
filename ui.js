/**
 * FM-80 Synthesizer — UI Controller
 */

// ── ピンチズーム無効化（iOS Safari 対策・キャプチャフェーズ）──
// capture: true により stopPropagation で止められた要素でも確実にブロック
// touchstart でも 2 本指を止める（iOS は touchstart 時点でズームを判断するため必須）
const _noZoom = e => { if (e.touches && e.touches.length > 1) e.preventDefault(); };
window.addEventListener('touchstart',  _noZoom, { passive: false, capture: true });
window.addEventListener('touchmove',   _noZoom, { passive: false, capture: true });
window.addEventListener('gesturestart',  e => e.preventDefault(), { passive: false, capture: true });
window.addEventListener('gesturechange', e => e.preventDefault(), { passive: false, capture: true });

let audioCtx   = null;
let synth      = null;
let bassSynth  = null;  // TB-303 bass for step sequencer 1
let bassSynth2 = null;  // TB-303 bass for step sequencer 2
let chordSynth = null;  // FM synth for chord sequencer
let currentOctave = 4;
let recMidi   = null;  // last MIDI note pressed (for record mode)
let activeWriteSeq    = null;  // which sequencer is in step write mode (null = off)
let selectedWriteStep = 0;

function highlightWriteStep(idx) {
  // Clear all write highlights first
  document.querySelectorAll('.seq-step').forEach(el => el.classList.remove('seq-write-current'));
  if (idx < 0 || !activeWriteSeq) return;
  const container = document.getElementById(activeWriteSeq._containerId);
  if (!container) return;
  const steps = container.querySelectorAll('.seq-step');
  if (steps[idx]) steps[idx].classList.add('seq-write-current');
}

function assignWriteStep(midi) {
  const seq = activeWriteSeq;
  if (!seq) return;
  seq.steps[selectedWriteStep].midi   = midi;
  seq.steps[selectedWriteStep].active = true;
  seq._updateStepUI(selectedWriteStep);
  selectedWriteStep = (selectedWriteStep + 1) % 16;
  highlightWriteStep(selectedWriteStep);
}

function restWriteStep() {
  const seq = activeWriteSeq;
  if (!seq) return;
  seq.steps[selectedWriteStep].active = false;
  seq._updateStepUI(selectedWriteStep);
  selectedWriteStep = (selectedWriteStep + 1) % 16;
  highlightWriteStep(selectedWriteStep);
}


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

  synth      = new FMSynth(audioCtx);
  bassSynth  = new TB303Synth(audioCtx);
  bassSynth2 = new TB303Synth(audioCtx);
  chordSynth = new FMSynth(audioCtx);
  chordSynth.setPatch('STRINGS');
  drumSynth  = new DrumSynth(audioCtx);

  document.getElementById('start-overlay').style.display = 'none';
  setLed('led-power', true);

  buildKeyboard();
  initKnobs();
  initPresets();
  initKeyboardControls();
  initPCKeyboard();
  initSequencer();
  sequencer._bassSynth = bassSynth;
  initSequencer2();
  sequencer2._bassSynth = bassSynth2;
  initChordSection();
  chordSeq._synth   = chordSynth;
  // Chord PLAY button wires into the same all-sequencer start/stop as SEQ1/SEQ2
  const chordPlayBtn = document.getElementById('chord-play-btn');
  chordSeq._playBtn  = chordPlayBtn;
  chordPlayBtn.addEventListener('click', () => {
    const all = [sequencer, sequencer2, chordSeq].filter(Boolean);
    const anyPlaying = all.some(s => s.playing);
    if (anyPlaying) {
      all.forEach(s => s.stop());
      all.forEach(s => {
        if (s._playBtn) { s._playBtn.textContent = '▶ PLAY'; s._playBtn.classList.remove('playing'); }
        if (s._recBtn)  { s._recBtn.classList.remove('recording'); s._recBtn.textContent = '⏺ REC'; }
      });
      // メロディ PLAY ボタン + 録音キャンセル
      const melBtn = document.getElementById('melody-play-btn');
      if (melBtn) { melBtn.textContent = '▶ PLAY'; melBtn.classList.remove('playing'); }
      if (typeof melodyTrack !== 'undefined' && melodyTrack) {
        melodyTrack.stopAll();
        const melRecBtn = document.getElementById('melody-rec-btn');
        if (melRecBtn) { melRecBtn.classList.remove('recording'); melRecBtn.textContent = '⏺ REC'; }
      }
    } else {
      all.forEach(s => s.play());
      all.forEach(s => {
        if (s._playBtn) { s._playBtn.textContent = '■ STOP'; s._playBtn.classList.add('playing'); }
      });
      // メロディ PLAY ボタン
      const melBtn = document.getElementById('melody-play-btn');
      if (melBtn) { melBtn.textContent = '■ STOP'; melBtn.classList.add('playing'); }
    }
  });
  // Link all three pattern banks: loading slot N on any bar loads it on all
  patternBank1.addPeer(patternBank2);
  patternBank1.addPeer(chordPatternBank);
  patternBank2.addPeer(patternBank1);
  patternBank2.addPeer(chordPatternBank);
  chordPatternBank.addPeer(patternBank1);
  chordPatternBank.addPeer(patternBank2);
  // メロディバンクも全バンクと連動
  initMelodyTrack();
  melodyTrack._synth = synth;
  patternBank1.addPeer(melodyPatternBank);
  patternBank2.addPeer(melodyPatternBank);
  chordPatternBank.addPeer(melodyPatternBank);
  melodyPatternBank.addPeer(patternBank1);
  melodyPatternBank.addPeer(patternBank2);
  melodyPatternBank.addPeer(chordPatternBank);
  initSeq2Toggle();
  initDrums();
  drumSynth.setSidechain([bassSynth.masterGain, bassSynth2.masterGain]);
  initRecorder();
  if (typeof initVJ === 'function') initVJ();
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
    if (typeof vjDisplay !== 'undefined' && vjDisplay) vjDisplay.onNote(midi);
    if (typeof vjRelay !== 'undefined') vjRelay.onNote(midi);
    recMidi = midi; // update record buffer
    if (typeof melodyTrack !== 'undefined' && melodyTrack) melodyTrack.recordNoteOn(midi);
    if (activeWriteSeq) assignWriteStep(midi);
    document.getElementById('note-display').textContent = label;
    setLed('led-audio', true);
    setTimeout(() => setLed('led-audio', false), 120);
  };
  const off = () => {
    el.classList.remove('active');
    if (synth) synth.noteOff(midi);
    if (typeof melodyTrack !== 'undefined' && melodyTrack) melodyTrack.recordNoteOff(midi);
  };

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
    if (typeof vjDisplay !== 'undefined' && vjDisplay) vjDisplay.onNote(midi);
    if (typeof vjRelay !== 'undefined') vjRelay.onNote(midi);
    recMidi = midi; // update record buffer
    if (typeof melodyTrack !== 'undefined' && melodyTrack) melodyTrack.recordNoteOn(midi);
    if (activeWriteSeq) assignWriteStep(midi);
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
    if (typeof melodyTrack !== 'undefined' && melodyTrack) melodyTrack.recordNoteOff(midi);
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
        if (typeof vjRelay !== 'undefined') vjRelay.onPreset(btn.dataset.preset);
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
    case 'filter':    synth.setFilterFreq(val);        break;
    case 'reverb':    synth.setReverbMix(val);         break;
    case 'volume':    synth.setMasterVolume(val);      break;
    case 'dist':      synth.setDistortion(val);    break;
    case 'delayTime': synth.setDelayTime(val);     break;
    case 'delayFb':   synth.setDelayFeedback(val); break;
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

// ── Right Drawer: Volume (top) + SEQ FX (bottom) ──────────
(function initRightDrawer() {
  const drawer       = document.getElementById('fx-drawer');
  const backdrop     = document.getElementById('fx-backdrop');
  const sliderSynth  = document.getElementById('vol-synth');
  const sliderSeq1   = document.getElementById('vol-seq1');
  const sliderSeq2   = document.getElementById('vol-seq2');
  const sliderChord  = document.getElementById('vol-chord');
  const sliderDrum   = document.getElementById('vol-drum');
  const sliderDist   = document.getElementById('fx-dist');
  const sliderComp   = document.getElementById('fx-comp');
  const sliderDelay  = document.getElementById('fx-delay');
  const sliderReverb = document.getElementById('fx-reverb');

  function openDrawer()  { drawer.classList.add('open');    backdrop.classList.add('open'); }
  function closeDrawer() { drawer.classList.remove('open'); backdrop.classList.remove('open'); }
  backdrop.addEventListener('click', closeDrawer);

  // ── PC: キーボードショートカット ──
  // \ でトグル、Escape で閉じる
  document.addEventListener('keydown', e => {
    if (e.key === '\\' || e.key === 'ArrowRight') {
      if (!drawer.classList.contains('open')) openDrawer();
    } else if (e.key === 'Escape' || e.key === 'ArrowLeft') {
      if (drawer.classList.contains('open')) closeDrawer();
    }
  });

  // ── PC: ヘッダーのトグルボタン ──
  document.getElementById('fx-open-btn').addEventListener('click', () => {
    drawer.classList.contains('open') ? closeDrawer() : openDrawer();
  });

  // ── Volume sliders ──
  sliderSynth.addEventListener('input', () => {
    if (synth) synth.setMasterVolume(parseFloat(sliderSynth.value));
  });
  sliderSeq1.addEventListener('input', () => {
    if (bassSynth) bassSynth.setMasterVolume(parseFloat(sliderSeq1.value));
  });
  sliderSeq2.addEventListener('input', () => {
    if (bassSynth2) bassSynth2.setMasterVolume(parseFloat(sliderSeq2.value));
  });
  sliderChord.addEventListener('input', () => {
    if (chordSynth) chordSynth.setMasterVolume(parseFloat(sliderChord.value));
  });
  sliderDrum.addEventListener('input', () => {
    if (drumSynth) drumSynth.setMasterVolume(parseFloat(sliderDrum.value));
  });

  // ── SEQ FX sliders ──
  sliderDist.addEventListener('input',  () => { if (bassSynth) bassSynth.setDistortion(parseFloat(sliderDist.value)); });
  sliderComp.addEventListener('input',  () => { if (bassSynth) bassSynth.setCompressor(parseFloat(sliderComp.value)); });
  sliderDelay.addEventListener('input', () => { if (bassSynth) bassSynth.setDelayTime(parseFloat(sliderDelay.value)); });
  sliderReverb.addEventListener('input',() => { if (bassSynth) bassSynth.setReverbMix(parseFloat(sliderReverb.value)); });

  // ── Swipe: open from right edge, close swipe right ──
  let tx0 = 0, ty0 = 0, tracking = false;
  const EDGE_ZONE = 30;
  const THRESHOLD = 60;

  document.addEventListener('touchstart', e => {
    const t = e.touches[0];
    tx0 = t.clientX;
    ty0 = t.clientY;
    tracking = tx0 > window.innerWidth - EDGE_ZONE || drawer.classList.contains('open');
  }, { passive: true });

  document.addEventListener('touchend', e => {
    if (!tracking) return;
    const t  = e.changedTouches[0];
    const dx = t.clientX - tx0;
    const dy = Math.abs(t.clientY - ty0);
    if (dy > Math.abs(dx)) return;
    if (dx < -THRESHOLD && !drawer.classList.contains('open')) openDrawer();
    else if (dx > THRESHOLD && drawer.classList.contains('open')) closeDrawer();
    tracking = false;
  }, { passive: true });
})();

// ── WAV Recorder ──────────────────────────────────────────
// Captures all synth output in real time via ScriptProcessorNode.
// Encoded as 16-bit PCM stereo WAV for DAW import.
function initRecorder() {
  const toggleBtn  = document.getElementById('rec-toggle-btn');
  const statusEl   = document.getElementById('rec-status');
  const downloadBtn = document.getElementById('rec-download-btn');

  const BUF = 4096;
  // ScriptProcessorNode captures mixed output of all synths.
  // Input = sum of all masterGains connected to it.
  // Output routed to a silent gain so onaudioprocess fires without doubling sound.
  const recNode = audioCtx.createScriptProcessor(BUF, 2, 2);
  const silence = audioCtx.createGain();
  silence.gain.value = 0;
  recNode.connect(silence);
  silence.connect(audioCtx.destination);

  [synth, bassSynth, bassSynth2, chordSynth, drumSynth].forEach(s => {
    if (s && s.masterGain) s.masterGain.connect(recNode);
  });

  let recording  = false;
  let chunksL    = [];
  let chunksR    = [];
  let recBlob    = null;

  recNode.onaudioprocess = e => {
    if (!recording) return;
    chunksL.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    chunksR.push(new Float32Array(e.inputBuffer.getChannelData(1)));
  };

  toggleBtn.addEventListener('click', () => {
    if (!recording) {
      chunksL = [];
      chunksR = [];
      recBlob = null;
      recording = true;
      toggleBtn.textContent = '⏹ STOP';
      toggleBtn.classList.add('active');
      statusEl.textContent = 'REC...';
      downloadBtn.style.display = 'none';
    } else {
      recording = false;
      toggleBtn.textContent = '⏺ REC';
      toggleBtn.classList.remove('active');

      if (chunksL.length === 0) {
        statusEl.textContent = '—';
        return;
      }

      const totalSamples = chunksL.reduce((s, c) => s + c.length, 0);
      const secs = (totalSamples / audioCtx.sampleRate).toFixed(1);
      statusEl.textContent = `${secs}s ready`;

      recBlob = new Blob([_encodeWAV(chunksL, chunksR, audioCtx.sampleRate)],
                         { type: 'audio/wav' });
      downloadBtn.style.display = '';
    }
  });

  downloadBtn.addEventListener('click', () => {
    if (!recBlob) return;
    const url = URL.createObjectURL(recBlob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = `fm80-${Date.now()}.wav`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

function _encodeWAV(chunksL, chunksR, sampleRate) {
  const totalSamples = chunksL.reduce((s, c) => s + c.length, 0);
  const numCh    = 2;
  const bitDepth = 16;
  const dataSize = totalSamples * numCh * (bitDepth / 8);
  const buf = new ArrayBuffer(44 + dataSize);
  const v   = new DataView(buf);

  const str = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  str(0,  'RIFF'); v.setUint32(4,  36 + dataSize, true);
  str(8,  'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true);                           // PCM chunk size
  v.setUint16(20, 1,  true);                           // PCM format
  v.setUint16(22, numCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * numCh * (bitDepth / 8), true); // byte rate
  v.setUint16(32, numCh * (bitDepth / 8), true);       // block align
  v.setUint16(34, bitDepth, true);
  str(36, 'data'); v.setUint32(40, dataSize, true);

  let off = 44;
  for (let c = 0; c < chunksL.length; c++) {
    const L = chunksL[c], R = chunksR[c];
    for (let i = 0; i < L.length; i++) {
      v.setInt16(off, Math.max(-1, Math.min(1, L[i])) * 0x7FFF, true); off += 2;
      v.setInt16(off, Math.max(-1, Math.min(1, R[i])) * 0x7FFF, true); off += 2;
    }
  }
  return buf;
}

// ── SEQ 2 collapsible toggle ───────────────────────────────
function initSeq2Toggle() {
  const btn     = document.getElementById('seq2-toggle-btn');
  const section = document.getElementById('seq2-section');
  btn.addEventListener('click', () => {
    const isOpen = section.classList.toggle('open');
    btn.textContent = isOpen ? 'SEQ 2 ▲' : 'SEQ 2 ▼';
  });
}
