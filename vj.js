/**
 * FM-80 VJ Display
 * Game Boy-style pixel art visualizer synced to music.
 * 160×144 canvas, three style modes: DIGITAL / SOFT / ART
 */

let vjDisplay = null;

class VJDisplay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.W      = 160;
    this.H      = 144;
    canvas.width  = this.W;
    canvas.height = this.H;

    this.style  = 'digital';
    this.frame  = 0;
    this.beat   = 0;
    this.step   = -1;
    this.kick   = 0;
    this.snare  = 0;
    this._raf   = null;

    // Pixel robot state
    this._robotY   = 0;
    this._robotVY  = 0;
    this._robotX   = 0;

    // Soft mode blob state
    this._blobs = Array.from({ length: 5 }, () => ({
      x: Math.random() * 160, y: Math.random() * 144,
      vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
      r: 18 + Math.random() * 22,
      hue: Math.random() * 360,
    }));

    // Art mode state
    this._artAngle   = 0;
    this._artPalette = 0;
    this._glitch     = 0;

    // Stars for SOFT mode
    this._stars = Array.from({ length: 30 }, () => ({
      x: Math.random() * 160, y: Math.random() * 144,
      t: Math.random() * Math.PI * 2,
    }));
  }

  start() { this._loop(); }
  stop()  { if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; } }

  onStep(step) {
    this.step = step;
    if (step % 4 === 0) this.beat++;
  }
  onKick()  { this.kick  = 10; }
  onSnare() { this.snare = 6;  this._glitch = 4; }
  setStyle(s) { this.style = s; }

  _loop() {
    this._raf = requestAnimationFrame(() => this._loop());
    this.frame++;

    if (this.kick  > 0) this.kick--;
    if (this.snare > 0) this.snare--;
    if (this._glitch > 0) this._glitch--;

    switch (this.style) {
      case 'digital': this._renderDigital(); break;
      case 'soft':    this._renderSoft();    break;
      case 'art':     this._renderArt();     break;
    }
  }

  // ────────────────────────────────────────────────────────
  // DIGITAL — grid world pixel art
  // ────────────────────────────────────────────────────────
  _renderDigital() {
    const { ctx, W, H, step, kick, beat, frame } = this;

    // Background
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, W, H);

    // Scrolling sub-grid lines (thin, slow scroll)
    const scroll = (frame * 0.5) % 8;
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 1;
    for (let x = -8 + scroll; x < W; x += 8) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H - 14); ctx.stroke();
    }
    for (let y = (frame * 0.25) % 8; y < H - 14; y += 8) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // 4×4 macro grid cells (each cell = 40×32.5 px, showing 16 steps)
    const cellW = W / 4;
    const cellH = (H - 14) / 4;
    const activeStep = step < 0 ? 0 : step;

    for (let i = 0; i < 16; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const cx  = col * cellW;
      const cy  = row * cellH;
      const active = i === activeStep;

      // Cell border
      ctx.strokeStyle = active ? '#00ffcc' : '#1e3a5f';
      ctx.lineWidth   = active ? 1.5 : 0.5;
      ctx.strokeRect(cx + 0.5, cy + 0.5, cellW - 1, cellH - 1);

      // Active cell fill
      if (active) {
        ctx.fillStyle = 'rgba(0,255,204,0.07)';
        ctx.fillRect(cx + 1, cy + 1, cellW - 2, cellH - 2);
      }
    }

    // Pixel robot — moves to active step's cell
    const activeCol = activeStep % 4;
    const activeRow = Math.floor(activeStep / 4);
    const targetX   = activeCol * cellW + cellW / 2;
    const targetY   = activeRow * cellH + cellH / 2;

    // Smooth lerp toward target
    this._robotX = this._robotX || targetX;
    this._robotX += (targetX - this._robotX) * 0.25;

    // Jump on kick
    if (kick === 10) { this._robotVY = -3.5; }
    this._robotVY += 0.35;
    this._robotY  += this._robotVY;
    if (this._robotY > 0) { this._robotY = 0; this._robotVY = 0; }

    const rx = Math.round(this._robotX);
    const ry = Math.round(targetY + this._robotY);
    this._drawRobot(rx, ry, kick > 0, beat % 2 === 0);

    // Step indicator bar at bottom
    ctx.fillStyle = '#0d1a2e';
    ctx.fillRect(0, H - 14, W, 14);
    for (let i = 0; i < 16; i++) {
      const bx = i * 10;
      const isActive = i === activeStep;
      const isBeat   = i % 4 === 0;
      ctx.fillStyle = isActive ? '#00ffcc'
                    : isBeat   ? '#1e4a7e'
                               : '#112236';
      ctx.fillRect(bx + 1, H - 13, 8, 12);
      if (isActive) {
        // Bright pip
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(bx + 4, H - 10, 2, 2);
      }
    }

    // Beat counter in top-right
    const beatStr = ('000' + beat).slice(-3);
    this._drawText(beatStr, W - 22, 2, '#00ffcc', 1);
  }

  _drawRobot(cx, cy, jumping, blink) {
    const { ctx } = this;
    const p = (x, y, w, h, c) => {
      ctx.fillStyle = c;
      ctx.fillRect(cx - 4 + x, cy - 12 + y, w, h);
    };

    // Shadow
    ctx.fillStyle = 'rgba(0,255,204,0.15)';
    ctx.fillRect(cx - 5, cy + 1, 10, 2);

    // Body
    p(0, 4, 8, 7, '#00cc99');
    // Head
    p(1, 0, 6, 5, '#00ffcc');
    // Eyes
    p(2, 1, 2, 2, blink ? '#0a0a14' : '#ffffff');
    p(5, 1, 1, 2, blink ? '#0a0a14' : '#ffffff');
    // Antenna
    p(3, -2, 1, 2, '#00ffcc');
    p(2, -3, 3, 1, '#00ffcc');
    // Legs
    if (jumping) {
      p(1, 11, 2, 2, '#009977');
      p(5, 11, 2, 2, '#009977');
    } else {
      const legOff = Math.floor(this.frame / 6) % 2;
      p(1, 11, 2, 3 - legOff, '#009977');
      p(5, 11, 2, 2 + legOff, '#009977');
    }
    // Arms
    p(-1, 5, 2, 3, '#009977');
    p(7, 5, 2, 3, '#009977');
  }

  _drawText(str, x, y, color, scale = 1) {
    // Minimal 3×5 pixel font (digits + letters)
    const { ctx } = this;
    ctx.fillStyle = color;
    const glyphs = {
      '0': [0b111,0b101,0b101,0b101,0b111],
      '1': [0b010,0b110,0b010,0b010,0b111],
      '2': [0b111,0b001,0b111,0b100,0b111],
      '3': [0b111,0b001,0b011,0b001,0b111],
      '4': [0b101,0b101,0b111,0b001,0b001],
      '5': [0b111,0b100,0b111,0b001,0b111],
      '6': [0b111,0b100,0b111,0b101,0b111],
      '7': [0b111,0b001,0b001,0b001,0b001],
      '8': [0b111,0b101,0b111,0b101,0b111],
      '9': [0b111,0b101,0b111,0b001,0b111],
    };
    for (let i = 0; i < str.length; i++) {
      const g = glyphs[str[i]];
      if (!g) continue;
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 3; col++) {
          if (g[row] & (1 << (2 - col))) {
            ctx.fillRect(x + i * (4 * scale) + col * scale, y + row * scale, scale, scale);
          }
        }
      }
    }
  }

  // ────────────────────────────────────────────────────────
  // SOFT — dreamy floating blobs
  // ────────────────────────────────────────────────────────
  _renderSoft() {
    const { ctx, W, H, frame, kick, snare, beat } = this;

    // Fade to dark background
    ctx.fillStyle = 'rgba(5, 3, 18, 0.25)';
    ctx.fillRect(0, 0, W, H);

    // Move blobs
    for (const b of this._blobs) {
      b.x += b.vx + (kick > 0 ? (Math.random() - 0.5) * 1.5 : 0);
      b.y += b.vy + (kick > 0 ? (Math.random() - 0.5) * 1.5 : 0);
      b.hue += 0.3 + (kick > 0 ? 2 : 0);
      if (b.x < -b.r) b.x = W + b.r;
      if (b.x > W + b.r) b.x = -b.r;
      if (b.y < -b.r) b.y = H + b.r;
      if (b.y > H + b.r) b.y = -b.r;

      const pulseMul = 1 + (kick > 0 ? 0.3 : 0) + (snare > 0 ? 0.15 : 0);
      const r = b.r * pulseMul;

      const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
      grad.addColorStop(0, `hsla(${b.hue}, 80%, 70%, 0.4)`);
      grad.addColorStop(1, `hsla(${b.hue + 40}, 60%, 40%, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Stars twinkle
    for (const s of this._stars) {
      s.t += 0.04;
      const alpha = 0.3 + 0.7 * Math.abs(Math.sin(s.t));
      ctx.fillStyle = `rgba(200, 220, 255, ${alpha})`;
      ctx.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
    }

    // Step dots at bottom (soft)
    const activeStep = this.step < 0 ? 0 : this.step;
    for (let i = 0; i < 16; i++) {
      const dotX = 8 + i * 9;
      const dotY = H - 8;
      const active = i === activeStep;
      const hue = (beat * 30 + i * 15) % 360;
      ctx.fillStyle = active
        ? `hsl(${hue}, 90%, 75%)`
        : `rgba(120, 100, 160, 0.4)`;
      const size = active ? 4 : 2;
      ctx.beginPath();
      ctx.arc(dotX, dotY, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ────────────────────────────────────────────────────────
  // ART — abstract geometry + glitch
  // ────────────────────────────────────────────────────────
  _renderArt() {
    const { ctx, W, H, frame, kick, snare, beat, _glitch } = this;

    // Black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);

    this._artAngle += 0.015 + (kick > 0 ? 0.05 : 0);

    // Palette cycles per beat
    const palettes = [
      ['#ff0077', '#00ffff', '#ffff00'],
      ['#ff6600', '#00ff99', '#cc00ff'],
      ['#ff3333', '#3333ff', '#33ff33'],
      ['#ffffff', '#ff0055', '#0055ff'],
    ];
    const pal = palettes[beat % palettes.length];

    // Rotating rectangles
    const cx = W / 2, cy = H / 2 - 4;
    const sizes = [16, 28, 42, 56, 70];
    for (let i = 0; i < sizes.length; i++) {
      const s   = sizes[i];
      const ang = this._artAngle + i * (Math.PI / 5);
      const col = pal[i % pal.length];
      const pulse = kick > 0 ? 1 + kick * 0.06 : 1;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.strokeStyle = col;
      ctx.lineWidth   = 1;
      ctx.globalAlpha = 0.5 + 0.5 * (i / sizes.length);
      ctx.strokeRect(-s * pulse, -s * pulse * 0.618, s * 2 * pulse, s * 1.236 * pulse);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // Centre pixel burst on kick
    if (kick > 0) {
      const spread = kick * 3;
      ctx.fillStyle = pal[0];
      for (let n = 0; n < 30; n++) {
        const ang2 = Math.random() * Math.PI * 2;
        const dist = Math.random() * spread;
        ctx.fillRect(
          Math.round(cx + Math.cos(ang2) * dist),
          Math.round(cy + Math.sin(ang2) * dist),
          1, 1
        );
      }
    }

    // Glitch slices on snare
    if (_glitch > 0) {
      const numSlices = 3 + (_glitch > 2 ? 3 : 0);
      for (let s = 0; s < numSlices; s++) {
        const sy = Math.floor(Math.random() * (H - 8));
        const sh = 1 + Math.floor(Math.random() * 4);
        const dx = Math.round((Math.random() - 0.5) * 20);
        try {
          const imgData = ctx.getImageData(0, sy, W, sh);
          ctx.putImageData(imgData, dx, sy);
        } catch (_) {}
      }
    }

    // Step indicator: pixelated bar top edge
    const activeStep = this.step < 0 ? 0 : this.step;
    for (let i = 0; i < 16; i++) {
      const bx = i * 10;
      const active = i === activeStep;
      ctx.fillStyle = active ? pal[0] : (i % 4 === 0 ? pal[1] : '#111');
      ctx.fillRect(bx, H - 10, 9, active ? 10 : 4);
    }

    // Beat number top-left
    this._drawText(('00' + beat).slice(-3), 2, 2, pal[2], 1);
  }
}

// ── UI 初期化 ──────────────────────────────────────────────
function initVJ() {
  const wrap     = document.getElementById('vj-wrap');
  const section  = document.getElementById('vj-section');
  const toggleBtn = document.getElementById('vj-toggle-btn');
  const canvas   = document.getElementById('vj-canvas');
  const styleBtns = document.querySelectorAll('.vj-style-btn');

  if (!canvas) return;

  vjDisplay = new VJDisplay(canvas);
  vjDisplay.start();

  // Collapsible
  toggleBtn.addEventListener('click', () => {
    const open = section.classList.toggle('open');
    toggleBtn.textContent = open ? 'VJ ▲' : 'VJ ▼';
  });

  // Style selector
  styleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      styleBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      vjDisplay.setStyle(btn.dataset.style);
    });
  });
}
