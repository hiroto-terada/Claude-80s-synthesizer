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
    this._glitch = 0;

    // DIGITAL mode: 3D blocks spawned by notes
    this._blocks = [];

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

  // Called when a melody/chord/keyboard note is triggered
  onNote(midi) {
    // Pitch → horizontal world position (C4=60 → center, ±1 octave = ±gSize*1.5)
    const worldX = ((midi - 60) / 12) * 48;
    // Spawn block with slight Z jitter so chords spread
    this._blocks.push({
      x:     worldX + (Math.random() - 0.5) * 6,
      z:     190 + Math.random() * 30,
      size:  5 + (midi % 12) * 0.6,   // semitone within octave → size variation
      speed: 2.2 + Math.random() * 0.8,
      col:   midi % 3,                  // 0=G1 far, 1=G2 mid, 2=G3 near tint
    });
    if (this._blocks.length > 20) this._blocks.shift();
  }

  setStyle(s) { this.style = s; }

  _loop() {
    this._raf = requestAnimationFrame(() => this._loop());
    this.frame++;

    if (this.kick   > 0) this.kick--;
    if (this.snare  > 0) this.snare--;
    if (this._glitch > 0) this._glitch--;

    switch (this.style) {
      case 'digital': this._renderDigital(); break;
      case 'soft':    this._renderSoft();    break;
      case 'art':     this._renderArt();     break;
    }
  }

  // ────────────────────────────────────────────────────────
  // DIGITAL — pseudo-3D Game Boy highway
  // ────────────────────────────────────────────────────────
  _renderDigital() {
    const { ctx, W, H, frame, kick, snare } = this;
    const step = this.step >= 0 ? this.step : Math.floor(frame / 8) % 16;

    // Game Boy 4-color palette
    const G0 = '#0f380f';  // darkest
    const G1 = '#306230';  // dark
    const G2 = '#8bac0f';  // light
    const G3 = '#9bbc0f';  // lightest / highlight

    const hy    = 54;          // horizon Y (≈37% of 144)
    const vpX   = W >> 1;      // vanishing point X = 80
    const fov   = 55;          // perspective focal length
    const gH    = H - 12 - hy; // usable ground height (78px)
    const gSize = 40;           // world grid cell size
    const scrollZ = frame * 1.6;

    // ── CLEAR ──────────────────────────────────────────────
    ctx.fillStyle = G0;
    ctx.fillRect(0, 0, W, H);

    // ── SKY: dithered G0 → G1 bands ───────────────────────
    // Use alternating rows to create 2×2 dither gradient
    for (let y = 0; y < hy; y++) {
      const t = y / hy;  // 0=top, 1=horizon
      // Dither threshold: above 0.5 mix G1 on even rows, above 0.75 always G1
      if (t > 0.75 || (t > 0.45 && (y & 1) === 0)) {
        ctx.fillStyle = G1;
        ctx.fillRect(0, y, W, 1);
      }
    }

    // ── SKYLINE BUILDINGS (slow scroll) ────────────────────
    const bscroll = (frame * 0.25) % 320;
    // Building data: [width, height] pairs repeating
    const bld = [14,14, 10,20, 16,10, 12,18, 8,22, 18,12, 11,16, 14,8, 9,19, 15,14];
    ctx.fillStyle = G1;
    for (let i = 0; i < 20; i++) {
      const d = bld[(i % bld.length >> 1) * 2] !== undefined ? bld : bld;
      const bw = bld[(i * 2) % bld.length];
      const bh = bld[(i * 2 + 1) % bld.length];
      const bx = ((i * 16 - bscroll + 320) % 320) - 16;
      ctx.fillRect(bx, hy - bh, bw, bh);
      // Window lights (G2)
      ctx.fillStyle = G2;
      for (let wy = hy - bh + 3; wy < hy - 2; wy += 5) {
        for (let wx = bx + 2; wx < bx + bw - 1; wx += 4) {
          if (Math.sin(i * 13 + wy * 5 + frame * 0.04) > 0.25) {
            ctx.fillRect(wx, wy, 2, 2);
          }
        }
      }
      ctx.fillStyle = G1;
    }

    // ── HORIZON LINE ───────────────────────────────────────
    ctx.fillStyle = kick > 0 ? G3 : G2;
    ctx.fillRect(0, hy - 1, W, kick > 0 ? 2 : 1);

    // ── 3D GROUND BASE ─────────────────────────────────────
    ctx.fillStyle = G0;
    ctx.fillRect(0, hy, W, gH);

    // Per-scanline: alternating row shading (depth checkerboard)
    for (let y = hy; y < hy + gH; y++) {
      const t = (y - hy + 0.5) / gH;  // 0 horizon, 1 near
      const worldZ = (fov / t) - scrollZ;
      if (Math.floor(worldZ / gSize) & 1) {
        ctx.fillStyle = G1;
        ctx.fillRect(0, y, W, 1);
      }
    }

    // Horizontal grid lines (perspective-correct, scrolling)
    for (let n = 0; n < 30; n++) {
      const wz = n * gSize - (scrollZ % gSize);
      if (wz <= 1) continue;
      const t = fov / wz;
      if (t >= 1.0) continue;
      if (t < 0.02) break;
      const y = Math.round(hy + t * gH);
      if (y < hy || y >= hy + gH) continue;
      ctx.fillStyle = t > 0.5 ? G2 : G1;
      ctx.fillRect(0, y, W, 1);
    }

    // Vertical grid lines (all converge to vanishing point)
    ctx.lineWidth = 1;
    for (let col = -2; col <= 2; col++) {
      const bx = vpX + col * gSize;
      ctx.strokeStyle = col === 0 ? G2 : G1;
      ctx.beginPath();
      ctx.moveTo(vpX, hy);
      ctx.lineTo(bx, hy + gH);
      ctx.stroke();
    }

    // ── 3D BLOCKS (notes flying toward viewer) ──────────────
    const GB = [G1, G2, G3];
    // Draw far-to-near so closer blocks paint over distant ones
    const sorted = this._blocks.slice().sort((a, b) => b.z - a.z);
    for (const b of sorted) {
      b.z -= b.speed;
      if (b.z < 4) continue;

      const t  = Math.min(fov / b.z, 1.0);
      if (t < 0.03) continue;

      const sx  = Math.round(vpX + b.x * t);
      const sy  = Math.round(hy + t * gH);  // ground contact point
      const bw  = Math.max(2, Math.round(t * b.size));
      const bh  = Math.max(2, Math.round(t * b.size * 2.5));
      const lx  = sx - (bw >> 1);

      if (sy > hy + gH + 6 || sx < -bw - 4 || sx > W + bw + 4) continue;

      // Depth-based color: far=col tint, mid=G2, near=G3
      const shade = t > 0.65 ? G3 : t > 0.3 ? G2 : GB[b.col];
      ctx.fillStyle = shade;
      ctx.fillRect(lx, sy - bh, bw, bh);

      // Top highlight edge
      ctx.fillStyle = G3;
      ctx.fillRect(lx, sy - bh, bw, 1);
      // Left edge darker (fake side face)
      ctx.fillStyle = G1;
      ctx.fillRect(lx, sy - bh + 1, 1, bh - 1);

      // Ground shadow
      if (t > 0.25) {
        ctx.fillStyle = G1;
        ctx.fillRect(lx - 1, sy, bw + 2, 1);
      }
    }
    // Remove expired blocks
    for (let i = this._blocks.length - 1; i >= 0; i--) {
      if (this._blocks[i].z < 4) this._blocks.splice(i, 1);
    }

    // ── KICK SHOCKWAVE RINGS ────────────────────────────────
    if (kick > 0) {
      const kt = (10 - kick) / 10;  // expands 0→1 during kick decay
      for (let ring = 0; ring < 3; ring++) {
        const rt = kt - ring * 0.15;
        if (rt < 0 || rt > 1) continue;
        const ry = Math.round(hy + rt * gH);
        if (ry >= hy && ry < hy + gH) {
          ctx.fillStyle = ring === 0 ? G3 : G2;
          ctx.fillRect(0, ry, W, 1);
        }
      }
    }

    // ── SNARE SCANLINE FLASH ────────────────────────────────
    if (snare > 4) {
      const sy2 = Math.floor(Math.random() * (hy - 4));
      ctx.fillStyle = G2;
      ctx.fillRect(0, sy2, W, 1);
    }

    // ── HUD BAR ─────────────────────────────────────────────
    ctx.fillStyle = '#0a1a0a';
    ctx.fillRect(0, H - 12, W, 12);
    for (let i = 0; i < 16; i++) {
      const bx     = i * 10;
      const active = i === step;
      const isBeat = i % 4 === 0;
      ctx.fillStyle = active ? G3 : isBeat ? G2 : G1;
      ctx.fillRect(bx + 1, H - 10, 8, active ? 9 : (isBeat ? 5 : 3));
    }
    this._drawText(('000' + this.beat).slice(-3), W - 22, H - 11, G3, 1);
  }

  _drawText(str, x, y, color, scale = 1) {
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
    const activeStep = this.step >= 0 ? this.step : Math.floor(frame / 8) % 16;
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

    const palettes = [
      ['#ff0077', '#00ffff', '#ffff00'],
      ['#ff6600', '#00ff99', '#cc00ff'],
      ['#ff3333', '#3333ff', '#33ff33'],
      ['#ffffff', '#ff0055', '#0055ff'],
    ];
    const pal = palettes[beat % palettes.length];

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

    if (kick > 0) {
      const spread = kick * 3;
      ctx.fillStyle = pal[0];
      for (let n = 0; n < 30; n++) {
        const ang2 = Math.random() * Math.PI * 2;
        const dist = Math.random() * spread;
        ctx.fillRect(Math.round(cx + Math.cos(ang2) * dist), Math.round(cy + Math.sin(ang2) * dist), 1, 1);
      }
    }

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

    const activeStep = this.step >= 0 ? this.step : Math.floor(frame / 8) % 16;
    for (let i = 0; i < 16; i++) {
      const bx = i * 10;
      const active = i === activeStep;
      ctx.fillStyle = active ? pal[0] : (i % 4 === 0 ? pal[1] : '#111');
      ctx.fillRect(bx, H - 10, 9, active ? 10 : 4);
    }

    this._drawText(('00' + beat).slice(-3), 2, 2, pal[2], 1);
  }
}

// ── UI 初期化 ──────────────────────────────────────────────
function initVJ() {
  const section   = document.getElementById('vj-section');
  const toggleBtn = document.getElementById('vj-toggle-btn');
  const canvas    = document.getElementById('vj-canvas');
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
