/**
 * FM-80 Melody Recorder Track (イベントベース)
 * 鍵盤の noteOn/noteOff をタイムスタンプ付きで録音し、
 * シーケンサーの1ループに合わせてそのまま再生する。
 * 8個のパターンバンクで音色ごと保存可能。
 */

let melodyTrack       = null;
let melodyPatternBank = null;

class MelodyTrack {
  constructor() {
    // { type: 'on'|'off', midi: number, time: number(ms from loop start) }
    this.events  = [];
    this.timbre  = 'E.PIANO';
    this.enabled  = false;
    this.recording = false;

    this._stepMs        = 0;    // 直近の stepMs (表示用)
    this._loopMs        = 0;    // ループ全体の長さ
    this._recStartTime  = 0;    // 録音開始の Date.now()
    this._recTimer      = null; // 録音終了タイマー
    this._pendingRecord  = false;
    this._pendingPattern = null;
    this._playbackTimers = [];
    this._synth          = null;
    this.onRecordStop    = null;
  }

  // ── 鍵盤イベントを外部から受け取る ─────────────────────
  recordNoteOn(midi) {
    if (!this.recording) return;
    const t = Date.now() - this._recStartTime;
    this.events.push({ type: 'on', midi, time: t });
    // 録音中もリアルタイムでセル表示を更新
    if (this._stepMs > 0) {
      const step = Math.min(15, Math.floor(t / this._stepMs));
      this._updateStepUI(step);
    }
  }

  recordNoteOff(midi) {
    if (!this.recording) return;
    this.events.push({ type: 'off', midi, time: Date.now() - this._recStartTime });
  }

  // ── sequencer._tick() から毎ステップ呼ばれる ───────────
  onTick(step, stepMs) {
    this._stepMs = stepMs;

    if (step === 0) {
      this._loopMs = 16 * stepMs;

      // pending パターンをループ先頭で適用
      if (this._pendingPattern) {
        const p = this._pendingPattern;
        this._pendingPattern = null;
        this.events  = p.events.slice();
        this._stepMs = p.stepMs || stepMs;
        this._loopMs = p.loopMs || 16 * stepMs;
        this.timbre  = p.timbre;
        if (typeof p.onApply === 'function') p.onApply();
      }

      // pending 録音をループ先頭で開始
      if (this._pendingRecord) {
        this._pendingRecord = false;
        this.events        = [];
        this._recStartTime = Date.now();
        this.recording     = true;
        this._refreshAllUI();

        this._recTimer = setTimeout(() => {
          this.recording = false;
          // 末尾に全noteOffを補完（録音中に離し忘れた音を閉じる）
          this._closeOpenNotes(this._loopMs);
          this._refreshAllUI();
          if (typeof this.onRecordStop === 'function') this.onRecordStop();
        }, this._loopMs);
      }

      // 再生: ループ先頭でタイマーをスケジュール
      if (this.enabled && !this.recording) {
        this._schedulePlayback();
      }
    }

    this._highlightStep(step);
  }

  // ── 再生スケジューリング ───────────────────────────────
  _schedulePlayback() {
    this._clearPlayback();
    if (!this._synth || this.events.length === 0) return;
    this._playbackTimers = this.events.map(ev =>
      setTimeout(() => {
        if (!this.enabled || !this._synth) return;
        if (ev.type === 'on') this._synth.noteOn(ev.midi);
        else                  this._synth.noteOff(ev.midi);
      }, ev.time)
    );
  }

  _clearPlayback() {
    this._playbackTimers.forEach(t => clearTimeout(t));
    this._playbackTimers = [];
    // 保険として全音解放
    if (this._synth) {
      const played = new Set(
        this.events.filter(e => e.type === 'on').map(e => e.midi)
      );
      played.forEach(midi => this._synth.noteOff(midi));
    }
  }

  // 録音終了時: 閉じていない noteOn に対して noteOff を補完
  _closeOpenNotes(endTime) {
    const held = new Map();
    this.events.forEach(ev => {
      if (ev.type === 'on') {
        held.set(ev.midi, (held.get(ev.midi) || 0) + 1);
      } else {
        const n = held.get(ev.midi) || 0;
        if (n <= 1) held.delete(ev.midi);
        else held.set(ev.midi, n - 1);
      }
    });
    held.forEach((_, midi) =>
      this.events.push({ type: 'off', midi, time: endTime - 10 })
    );
  }

  // 外部からの停止 (シーケンサー停止 / ON→OFF)
  stopAll() {
    this._clearPlayback();
    if (this._recTimer) { clearTimeout(this._recTimer); this._recTimer = null; }
    this.recording      = false;
    this._pendingRecord = false;
  }

  // ── UI ────────────────────────────────────────────────
  _highlightStep(idx) {
    const grid = document.getElementById('melody-steps');
    if (!grid) return;
    grid.querySelectorAll('.melody-step').forEach((el, i) => {
      el.classList.toggle('melody-current',     i === idx);
      el.classList.toggle('melody-rec-current', this.recording && i === idx);
    });
  }

  // ステップ幅内に入る noteOn を探して表示
  _updateStepUI(idx) {
    const grid = document.getElementById('melody-steps');
    if (!grid) return;
    const cell = grid.querySelector(`.melody-step[data-step="${idx}"]`);
    if (!cell) return;

    const sw = this._stepMs || (this._loopMs / 16) || 230;
    const t0 = idx * sw, t1 = t0 + sw;
    const ons = this.events.filter(
      ev => ev.type === 'on' && ev.time >= t0 && ev.time < t1
    );
    const nameEl = cell.querySelector('.melody-note-name');
    if (nameEl) {
      if (ons.length > 1)      nameEl.textContent = `×${ons.length}`;
      else if (ons.length === 1) nameEl.textContent = seqMidiToName(ons[0].midi);
      else                       nameEl.textContent = '──';
    }
    cell.classList.toggle('melody-on', ons.length > 0);
  }

  _refreshAllUI() {
    for (let i = 0; i < 16; i++) this._updateStepUI(i);
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
    div.className    = 'melody-step';
    div.dataset.step = i;
    div.innerHTML    =
      `<div class="melody-step-num">${i + 1}</div>` +
      `<div class="melody-note-name">──</div>`;
    grid.appendChild(div);
  }

  // ── ON / OFF ──
  onoffBtn.addEventListener('click', () => {
    melodyTrack.enabled = !melodyTrack.enabled;
    onoffBtn.textContent = melodyTrack.enabled ? 'ON' : 'OFF';
    onoffBtn.classList.toggle('active', melodyTrack.enabled);
    if (!melodyTrack.enabled) melodyTrack._clearPlayback();
  });

  // ── REC ──
  recBtn.addEventListener('click', () => {
    if (!melodyTrack._synth) return;
    if (melodyTrack.recording || melodyTrack._pendingRecord) return;

    // 現在の音色を記録
    const preset = document.querySelector('.preset-btn.active');
    melodyTrack.timbre = preset ? preset.dataset.preset : 'E.PIANO';
    timbreDisplay.textContent = melodyTrack.timbre;

    // 再生も自動 ON
    melodyTrack.enabled = true;
    onoffBtn.textContent = 'ON';
    onoffBtn.classList.add('active');

    melodyTrack._pendingRecord = true;
    recBtn.classList.add('recording');
    recBtn.textContent = '●...';

    if (!sequencer || !sequencer.playing) _startAll();

    melodyTrack.onRecordStop = () => {
      recBtn.classList.remove('recording');
      recBtn.textContent = '⏺ REC';
    };
  });

  // ── PLAY / STOP ──
  playBtn.addEventListener('click', () => {
    const seqs = _allSeqs();
    seqs.some(s => s.playing) ? _stopAll(seqs) : _startAll();
  });

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
    melodyTrack.stopAll();
    recBtn.classList.remove('recording');
    recBtn.textContent = '⏺ REC';
    _syncAllPlayBtns(false);
    seqs.forEach(s => {
      if (s._recBtn) { s._recBtn.classList.remove('recording'); s._recBtn.textContent = '⏺ REC'; }
    });
  }

  function _syncAllPlayBtns(playing) {
    [playBtn, ..._allSeqs().map(s => s._playBtn)].filter(Boolean).forEach(b => {
      b.textContent = playing ? '■ STOP' : '▶ PLAY';
      b.classList.toggle('playing', playing);
    });
  }

  // ── パターンバンク ───────────────────────────────────
  const STORAGE_KEY = 'fm80-melody-patterns-v2'; // v2: event形式
  let patterns = Array(8).fill(null);
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(saved) && saved.length === 8) patterns = saved;
  } catch (_) {}

  let saveMode = false;
  function enterSaveMode() { saveMode = true;  saveBtn.classList.add('active');    patternBar.classList.add('save-mode'); }
  function exitSaveMode()  { saveMode = false; saveBtn.classList.remove('active'); patternBar.classList.remove('save-mode'); }

  patternBar.querySelectorAll('.melody-pattern-slot').forEach(btn => {
    if (patterns[parseInt(btn.dataset.slot)]) btn.classList.add('filled');
  });

  function doLoad(slot) {
    if (!patterns[slot]) return;
    const p = patterns[slot];
    const slotBtns = patternBar.querySelectorAll('.melody-pattern-slot');
    const slotBtn  = patternBar.querySelector(`.melody-pattern-slot[data-slot="${slot}"]`);

    const apply = () => {
      melodyTrack.events  = (p.events || []).slice();
      melodyTrack.timbre  = p.timbre;
      melodyTrack._stepMs = p.stepMs  || melodyTrack._stepMs || 230;
      melodyTrack._loopMs = p.loopMs  || melodyTrack._stepMs * 16;
      timbreDisplay.textContent = p.timbre;
      melodyTrack._refreshAllUI();
      slotBtns.forEach(b => b.classList.remove('loaded', 'pending'));
      if (slotBtn) slotBtn.classList.add('loaded');
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
      melodyTrack._pendingPattern = {
        events: p.events || [], timbre: p.timbre,
        stepMs: p.stepMs, loopMs: p.loopMs,
        onApply: apply,
      };
    } else {
      apply();
    }
  }

  patternBar.addEventListener('click', e => {
    if (e.target === saveBtn) { saveMode ? exitSaveMode() : enterSaveMode(); return; }
    const slotBtn = e.target.closest('.melody-pattern-slot');
    if (!slotBtn) return;
    const slot = parseInt(slotBtn.dataset.slot);
    const slotBtns = patternBar.querySelectorAll('.melody-pattern-slot');
    if (saveMode) {
      patterns[slot] = {
        events: melodyTrack.events.slice(),
        timbre: melodyTrack.timbre,
        stepMs: melodyTrack._stepMs,
        loopMs: melodyTrack._loopMs,
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
