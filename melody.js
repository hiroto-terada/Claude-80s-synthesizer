/**
 * FM-80 Melody Recorder Track
 * 鍵盤で弾いた音を16ステップ単位で録音・再生するトラック。
 * 8個のパターンバンクで音色ごと保存可能。
 */

let melodyTrack      = null;
let melodyPatternBank = null;

class MelodyTrack {
  constructor() {
    // 各ステップに1音を記録 (midi=null で休符)
    this.steps = Array.from({length: 16}, () => ({ midi: null, active: false }));
    this.timbre = 'E.PIANO'; // 記録時の音色名
    this.enabled  = false;   // 再生ON/OFF
    this.recording = false;
    this._recStepsLeft   = 0;
    this._pendingRecord  = false; // 次のloop先頭で録音開始
    this._pendingPattern = null;  // 次のloop先頭で適用するパターン
    this._lastMidi = null;        // 前ステップで鳴らしたMIDIノート
    this._synth = null;           // FMSynth インスタンス
    this.onRecordStop = null;
  }

  /**
   * sequencer._tick() から各ステップで呼ばれる
   * @param {number} step 0-15
   */
  onTick(step) {
    // ── ループ先頭: pending pattern 適用 ──
    if (step === 0 && this._pendingPattern) {
      const p = this._pendingPattern;
      this._pendingPattern = null;
      p.steps.forEach((s, i) => {
        this.steps[i].midi   = s.midi;
        this.steps[i].active = s.active;
      });
      this.timbre = p.timbre;
      if (typeof p.onApply === 'function') p.onApply();
    }

    // ── ループ先頭: pending 録音を開始 ──
    if (this._pendingRecord && step === 0) {
      this._pendingRecord = false;
      this.recording      = true;
      this._recStepsLeft  = 16;
    }

    // ── 前ステップのノートを解放 ──
    if (this._synth && this._lastMidi !== null) {
      this._synth.noteOff(this._lastMidi);
      this._lastMidi = null;
    }

    // ── 録音: recMidi を取り込む ──
    if (this.recording) {
      const s    = this.steps[step];
      const midi = (typeof recMidi !== 'undefined') ? recMidi : null;
      // recMidi を消費（次ステップで重複しないよう）
      if (typeof recMidi !== 'undefined') recMidi = null;

      if (midi !== null) {
        s.midi   = midi;
        s.active = true;
      } else {
        s.midi   = null;
        s.active = false;
      }
      this._updateStepUI(step);

      if (--this._recStepsLeft <= 0) {
        this.recording = false;
        if (typeof this.onRecordStop === 'function') this.onRecordStop();
      }
    }

    // ── 再生 ──
    if (this.enabled && !this.recording && this._synth) {
      const s = this.steps[step];
      if (s.active && s.midi !== null) {
        this._synth.noteOn(s.midi);
        this._lastMidi = s.midi;
      }
    }

    this._highlightStep(step);
  }

  _highlightStep(idx) {
    const grid = document.getElementById('melody-steps');
    if (!grid) return;
    grid.querySelectorAll('.melody-step').forEach((el, i) => {
      el.classList.toggle('melody-current',     i === idx);
      el.classList.toggle('melody-rec-current', this.recording && i === idx);
    });
  }

  _updateStepUI(idx) {
    const grid = document.getElementById('melody-steps');
    if (!grid) return;
    const cell = grid.querySelector(`.melody-step[data-step="${idx}"]`);
    if (!cell) return;
    const s = this.steps[idx];
    const nameEl = cell.querySelector('.melody-note-name');
    if (nameEl) nameEl.textContent = (s.active && s.midi !== null) ? seqMidiToName(s.midi) : '──';
    cell.classList.toggle('melody-on', s.active);
  }

  _refreshAllUI() {
    this.steps.forEach((_, i) => this._updateStepUI(i));
  }
}

// ── UI 初期化 ────────────────────────────────────────────
function initMelodyTrack() {
  melodyTrack = new MelodyTrack();

  const onoffBtn      = document.getElementById('melody-onoff-btn');
  const recBtn        = document.getElementById('melody-rec-btn');
  const playBtn       = document.getElementById('melody-play-btn');
  const timbreDisplay = document.getElementById('melody-timbre');
  const grid          = document.getElementById('melody-steps');
  const patternBar    = document.getElementById('melody-pattern-bar');
  const saveBtn       = document.getElementById('melody-pattern-save-btn');

  // ── ステップ表示セルを生成 ──
  for (let i = 0; i < 16; i++) {
    const div = document.createElement('div');
    div.className   = 'melody-step';
    div.dataset.step = i;
    div.innerHTML   =
      `<div class="melody-step-num">${i + 1}</div>` +
      `<div class="melody-note-name">──</div>`;
    grid.appendChild(div);
  }

  // ── ON / OFF ──
  onoffBtn.addEventListener('click', () => {
    melodyTrack.enabled = !melodyTrack.enabled;
    onoffBtn.textContent = melodyTrack.enabled ? 'ON' : 'OFF';
    onoffBtn.classList.toggle('active', melodyTrack.enabled);
    if (!melodyTrack.enabled && melodyTrack._synth && melodyTrack._lastMidi !== null) {
      melodyTrack._synth.noteOff(melodyTrack._lastMidi);
      melodyTrack._lastMidi = null;
    }
  });

  // ── REC ──
  recBtn.addEventListener('click', () => {
    if (!melodyTrack._synth) return;
    if (melodyTrack.recording || melodyTrack._pendingRecord) return;

    // 現在の音色を記録
    const preset = document.querySelector('.preset-btn.active');
    melodyTrack.timbre = preset ? preset.dataset.preset : 'E.PIANO';
    timbreDisplay.textContent = melodyTrack.timbre;

    // 再生も自動ON
    melodyTrack.enabled = true;
    onoffBtn.textContent = 'ON';
    onoffBtn.classList.add('active');

    melodyTrack._pendingRecord = true;
    recBtn.classList.add('recording');
    recBtn.textContent = '●...';

    // シーケンサーが停止中なら全体を起動
    if (!sequencer || !sequencer.playing) _startAll();

    melodyTrack.onRecordStop = () => {
      recBtn.classList.remove('recording');
      recBtn.textContent = '⏺ REC';
    };
  });

  // ── PLAY / STOP (全シーケンサー連動) ──
  playBtn.addEventListener('click', () => {
    const seqs = _allSeqs();
    if (seqs.some(s => s.playing)) {
      _stopAll(seqs);
    } else {
      _startAll();
    }
  });

  // ── ヘルパー ──
  function _allSeqs() {
    return [
      sequencer,
      sequencer2,
      (typeof chordSeq !== 'undefined' ? chordSeq : null),
    ].filter(Boolean);
  }

  function _startAll() {
    _allSeqs().forEach(s => s.play());
    _syncAllPlayBtns(true);
  }

  function _stopAll(seqs) {
    seqs.forEach(s => s.stop());
    melodyTrack._pendingRecord = false;
    melodyTrack.recording      = false;
    recBtn.classList.remove('recording');
    recBtn.textContent = '⏺ REC';
    _syncAllPlayBtns(false);
    // 他のRECボタンもリセット
    seqs.forEach(s => {
      if (s._recBtn) { s._recBtn.classList.remove('recording'); s._recBtn.textContent = '⏺ REC'; }
    });
  }

  function _syncAllPlayBtns(playing) {
    const btns = [
      playBtn,
      ..._allSeqs().map(s => s._playBtn),
    ].filter(Boolean);
    btns.forEach(b => {
      b.textContent = playing ? '■ STOP' : '▶ PLAY';
      b.classList.toggle('playing', playing);
    });
  }

  // ── パターンバンク (8スロット) ──────────────────────────
  const STORAGE_KEY = 'fm80-melody-patterns';
  let patterns = Array(8).fill(null);
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(saved) && saved.length === 8) patterns = saved;
  } catch (_) {}

  let saveMode = false;
  function enterSaveMode() {
    saveMode = true;
    saveBtn.classList.add('active');
    patternBar.classList.add('save-mode');
  }
  function exitSaveMode() {
    saveMode = false;
    saveBtn.classList.remove('active');
    patternBar.classList.remove('save-mode');
  }

  // 保存済みスロットのマーキング
  patternBar.querySelectorAll('.melody-pattern-slot').forEach(btn => {
    if (patterns[parseInt(btn.dataset.slot)]) btn.classList.add('filled');
  });

  function doLoad(slot) {
    if (!patterns[slot]) return;
    const p = patterns[slot];
    const slotBtns = patternBar.querySelectorAll('.melody-pattern-slot');
    const slotBtn  = patternBar.querySelector(`.melody-pattern-slot[data-slot="${slot}"]`);

    const apply = () => {
      p.steps.forEach((s, i) => {
        melodyTrack.steps[i].midi   = s.midi;
        melodyTrack.steps[i].active = s.active;
      });
      melodyTrack.timbre = p.timbre;
      timbreDisplay.textContent = p.timbre;
      melodyTrack._refreshAllUI();
      slotBtns.forEach(b => b.classList.remove('loaded', 'pending'));
      if (slotBtn) slotBtn.classList.add('loaded');
      // 音色をシンセとプリセットボタンに反映
      if (melodyTrack._synth) {
        melodyTrack._synth.setPatch(p.timbre);
        if (typeof syncKnobsToSynth === 'function') syncKnobsToSynth();
      }
      document.querySelectorAll('.preset-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.preset === p.timbre)
      );
    };

    if (sequencer && sequencer.playing) {
      slotBtns.forEach(b => b.classList.remove('pending'));
      if (slotBtn) slotBtn.classList.add('pending');
      melodyTrack._pendingPattern = { steps: p.steps, timbre: p.timbre, onApply: apply };
    } else {
      apply();
    }
  }

  patternBar.addEventListener('click', e => {
    if (e.target === saveBtn) {
      saveMode ? exitSaveMode() : enterSaveMode();
      return;
    }
    const slotBtn = e.target.closest('.melody-pattern-slot');
    if (!slotBtn) return;
    const slot     = parseInt(slotBtn.dataset.slot);
    const slotBtns = patternBar.querySelectorAll('.melody-pattern-slot');

    if (saveMode) {
      patterns[slot] = {
        steps:  melodyTrack.steps.map(s => ({ midi: s.midi, active: s.active })),
        timbre: melodyTrack.timbre,
      };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(patterns)); } catch (_) {}
      slotBtns.forEach(b => b.classList.remove('loaded'));
      slotBtn.classList.add('filled', 'loaded');
      exitSaveMode();
    } else {
      doLoad(slot);
    }
  });

  melodyPatternBank = { doLoad };
}
