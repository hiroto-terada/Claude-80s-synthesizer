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

    // DIGITAL mode: cars and digital noise
    this._cars      = [];
    this._noises    = [];
    this._carTimer  = 60 + Math.floor(Math.random() * 80);
    this._noiseTimer = 240 + Math.floor(Math.random() * 200);

    // DIGITAL mode: stars + shooting stars
    // Fixed star positions with individual twinkle seeds
    this._dStars = Array.from({ length: 28 }, () => ({
      x:    2 + Math.floor(Math.random() * 156),
      y:    2 + Math.floor(Math.random() * 38),   // upper sky only
      seed: Math.random() * Math.PI * 2,
      rate: 0.04 + Math.random() * 0.06,          // twinkle speed
    }));
    this._shootingStars  = [];
    this._shootTimer     = 180 + Math.floor(Math.random() * 280);

    // DIGITAL mode: background scene cycling (0=city 1=suburb 2=mountain)
    this._digitalBg  = -1;   // -1 forces change detection on first frame
    this._bgFlash    =  0;   // countdown for scene-change flash

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

    // Matrix mode: falling character streams (half-width katakana + digits)
    const MTX_CHARS = 'ｦｧｨｩｪｫｬｭｮｯｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const MTX_CW = 6, MTX_CH = 8;
    const mtxCols = Math.ceil(160 / MTX_CW);
    const mtxRows = Math.ceil(144 / MTX_CH);
    this._mtxChars = MTX_CHARS;
    this._mtxCW = MTX_CW; this._mtxCH = MTX_CH;
    this._mtxRows = mtxRows;
    this._matrixCols = Array.from({ length: mtxCols }, () => ({
      head:  -Math.floor(Math.random() * mtxRows * 2),  // current head row (float)
      speed: 0.08 + Math.random() * 0.14,               // rows per frame
      len:   6 + Math.floor(Math.random() * 10),        // trail length in rows
      chars: Array.from({ length: mtxRows }, () =>
        MTX_CHARS[Math.floor(Math.random() * MTX_CHARS.length)]),
    }));

    // Scope mode: scrolling waveform buffer + last note pitch
    this._scopeWave = new Array(160).fill(0);  // reused as wave buffer
    this._scopeNote = 60;
    this._sPhase = 0;    // phase accumulator
    this._sAmp   = 22;   // smoothed amplitude
    this._sDist  = 0;    // smoothed distortion (kick)
    this._sFm    = 0;    // smoothed FM modulation depth (snare)

    // Matrix mode: note reactivity
    this._mtxNoteFlash = 0;   // countdown frames for note glow
    this._mtxNoteCol   = 13;  // highlighted column (derived from pitch)

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
  onKick()  {
    this.kick = 10;
    // Occasional noise burst on kick
    if (Math.random() < 0.35) this._spawnNoise();
  }
  onSnare() { this.snare = 6;  this._glitch = 4; }

  // Called when a melody/chord/keyboard note is triggered
  onNote(midi) {
    this._scopeNote = midi;
    // Matrix: map pitch to column index and trigger glow
    const numCols = this._matrixCols ? this._matrixCols.length : 26;
    this._mtxNoteCol   = Math.max(0, Math.min(numCols - 1,
      Math.round(((midi - 36) / 48) * (numCols - 1))));
    this._mtxNoteFlash = 40;
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
      case 'matrix':  this._renderMatrix();  break;
      case 'scope':   this._renderScope();   break;
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

    // ── STARS (fixed, twinkling) ────────────────────────────
    for (const s of this._dStars) {
      const bright = Math.sin(frame * s.rate + s.seed);
      if (bright > 0.1) {
        ctx.fillStyle = bright > 0.7 ? G3 : G2;
        ctx.fillRect(s.x, s.y, 1, 1);
      }
    }

    // ── SHOOTING STARS ──────────────────────────────────────
    if (--this._shootTimer <= 0) {
      // Spawn from top-left quadrant, travel toward bottom-right at varying angles
      const side = Math.random() < 0.5;  // left half or right half start
      this._shootingStars.push({
        x:    side ? Math.random() * 60 : 60 + Math.random() * 60,
        y:    1 + Math.random() * 20,
        dx:   1.8 + Math.random() * 2.2,
        dy:   0.4 + Math.random() * 0.8,
        life: 28 + Math.floor(Math.random() * 22),
        maxLife: 0,
      });
      const ss = this._shootingStars[this._shootingStars.length - 1];
      ss.maxLife = ss.life;
      this._shootTimer = 200 + Math.floor(Math.random() * 320);
    }

    for (let i = this._shootingStars.length - 1; i >= 0; i--) {
      const ss = this._shootingStars[i];
      ss.x += ss.dx;
      ss.y += ss.dy;
      ss.life--;

      if (ss.life <= 0 || ss.x > W || ss.y > hy - 2) {
        this._shootingStars.splice(i, 1);
        continue;
      }

      // Trail: draw from head back, fading G3 → G2 → G1
      const trailLen = 7;
      for (let t2 = 0; t2 < trailLen; t2++) {
        const tx = Math.round(ss.x - ss.dx * t2 * 0.7);
        const ty2 = Math.round(ss.y - ss.dy * t2 * 0.7);
        if (tx < 0 || ty2 < 0 || ty2 >= hy) continue;
        ctx.fillStyle = t2 === 0 ? G3 : t2 < 3 ? G2 : G1;
        ctx.fillRect(tx, ty2, 1, 1);
      }
    }

    // ── SKYLINE: cycle every 4 loops (16 beats) ────────────
    const bgScene = Math.floor(this.beat / 16) % 3;
    if (bgScene !== this._digitalBg) {
      this._digitalBg = bgScene;
      if (this.beat > 0) this._bgFlash = 10;  // flash on change (skip first frame)
    }
    if      (bgScene === 0) this._drawBgCity(frame, hy, G1, G2);
    else if (bgScene === 1) this._drawBgSuburb(frame, hy, G1, G2);
    else                    this._drawBgMountain(frame, hy, G0, G1, G2, G3);

    // Brief bright flash on scene change
    if (this._bgFlash > 0) {
      ctx.fillStyle = G3;
      ctx.globalAlpha = (this._bgFlash / 10) * 0.55;
      ctx.fillRect(0, 0, W, hy);
      ctx.globalAlpha = 1;
      this._bgFlash--;
    }

    // ── HORIZON LINE ───────────────────────────────────────
    ctx.fillStyle = kick > 0 ? G3 : G2;
    ctx.fillRect(0, hy - 1, W, kick > 0 ? 2 : 1);

    // ── 3D GROUND BASE ─────────────────────────────────────
    ctx.fillStyle = G0;
    ctx.fillRect(0, hy, W, gH);

    // ── GROUND TEXTURE (scene-dependent) ───────────────────
    const groundCell = bgScene === 1 ? gSize / 2 : gSize;  // rice paddy = finer grid

    // Per-scanline: alternating row shading
    for (let y = hy; y < hy + gH; y++) {
      const t = (y - hy + 0.5) / gH;
      const worldZ = (fov / t) - scrollZ;
      if (Math.floor(worldZ / groundCell) & 1) {
        ctx.fillStyle = G1;
        ctx.fillRect(0, y, W, 1);
      }
    }

    // Horizontal grid lines
    for (let n = 0; n < 60; n++) {
      const wz = n * groundCell - (scrollZ % groundCell);
      if (wz <= 1) continue;
      const t = fov / wz;
      if (t >= 1.0) continue;
      if (t < 0.02) break;
      const y = Math.round(hy + t * gH);
      if (y < hy || y >= hy + gH) continue;
      ctx.fillStyle = t > 0.5 ? G2 : G1;
      ctx.fillRect(0, y, W, 1);
    }

    // Vertical grid lines — city/mountain: converging perspective; rice paddy: wider field dividers
    ctx.lineWidth = 1;
    if (bgScene === 1) {
      // Paddy fields: more vertical dividers spread wider
      for (let col = -4; col <= 4; col++) {
        const bx = vpX + col * gSize;
        ctx.strokeStyle = col === 0 ? G2 : G1;
        ctx.beginPath(); ctx.moveTo(vpX, hy); ctx.lineTo(bx, hy + gH); ctx.stroke();
      }
    } else {
      for (let col = -2; col <= 2; col++) {
        const bx = vpX + col * gSize;
        ctx.strokeStyle = col === 0 ? G2 : G1;
        ctx.beginPath(); ctx.moveTo(vpX, hy); ctx.lineTo(bx, hy + gH); ctx.stroke();
      }
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

    // ── CARS: spawn timer ───────────────────────────────────
    if (--this._carTimer <= 0) {
      this._spawnCar();
      this._carTimer = 70 + Math.floor(Math.random() * 100);
    }

    // ── CARS: draw (far-to-near) ────────────────────────────
    this._cars.sort((a, b) => b.z - a.z);
    for (let i = this._cars.length - 1; i >= 0; i--) {
      const c = this._cars[i];
      c.z -= c.speed;
      if (c.z < 3) { this._cars.splice(i, 1); continue; }
      const ct = Math.min(fov / c.z, 1.0);
      if (ct < 0.03) continue;
      const csx = Math.round(vpX + c.x * ct);
      const csy = Math.round(hy + ct * gH);
      this._drawCar(csx, csy, ct, G0, G1, G2, G3);
    }

    // ── NOISE: spawn timer ──────────────────────────────────
    if (--this._noiseTimer <= 0) {
      this._spawnNoise();
      this._noiseTimer = 280 + Math.floor(Math.random() * 320);
    }
    // Extra occasional noise on beat 0 of every 8 bars
    if (this.beat > 0 && this.beat % 8 === 0 && this.step === 0 && Math.random() < 0.4) {
      this._spawnNoise();
    }

    // ── NOISE: render ───────────────────────────────────────
    for (let i = this._noises.length - 1; i >= 0; i--) {
      const n = this._noises[i];
      this._renderNoise(n, G0, G1, G2, G3);
      n.life--;
      if (n.life <= 0) this._noises.splice(i, 1);
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

  // ── BG SCENE 0: city buildings ──────────────────────────
  _drawBgCity(frame, hy, G1, G2) {
    const { ctx } = this;
    const bscroll = (frame * 0.25) % 320;
    const bld = [14,14, 10,20, 16,10, 12,18, 8,22, 18,12, 11,16, 14,8, 9,19, 15,14];
    ctx.fillStyle = G1;
    for (let i = 0; i < 20; i++) {
      const bw = bld[(i * 2)     % bld.length];
      const bh = bld[(i * 2 + 1) % bld.length];
      const bx = ((i * 16 - bscroll + 320) % 320) - 16;
      ctx.fillRect(bx, hy - bh, bw, bh);
      ctx.fillStyle = G2;
      for (let wy = hy - bh + 3; wy < hy - 2; wy += 5) {
        for (let wx = bx + 2; wx < bx + bw - 1; wx += 4) {
          if (Math.sin(i * 13 + wy * 5 + frame * 0.04) > 0.25) ctx.fillRect(wx, wy, 2, 2);
        }
      }
      ctx.fillStyle = G1;
    }
  }

  // ── BG SCENE 1: suburb — houses + rice paddy ────────────
  _drawBgSuburb(frame, hy, G1, G2) {
    const { ctx, W } = this;
    // House definitions: [bodyW, bodyH, roofH, postGap]
    const houses = [
      [22, 8, 6, 14], [15, 7, 5, 22], [20, 9, 7, 10],
      [17, 6, 5, 18], [12, 7, 5, 28], [24, 8, 6, 8],
    ];
    const totalW = houses.reduce((s, h) => s + h[0] + h[3], 0);  // ≈ 178
    const hscroll = (frame * 0.15) % totalW;

    // Compute x offsets for each house in the tile
    let offsets = [], cx = 0;
    for (const h of houses) { offsets.push(cx); cx += h[0] + h[3]; }

    ctx.fillStyle = G1;
    for (let tile = -1; tile <= 2; tile++) {
      for (let i = 0; i < houses.length; i++) {
        const [bw, bh, rh, gap] = houses[i];
        const hx = Math.floor((offsets[i] + tile * totalW - hscroll % totalW + totalW * 2) % (totalW * 2)) - bw;
        if (hx > W + 2 || hx + bw < -2) continue;

        // Body
        ctx.fillStyle = G1;
        ctx.fillRect(hx, hy - bh, bw, bh);

        // Gabled roof (triangle)
        for (let ry = 0; ry < rh; ry++) {
          const hw = Math.round((ry / rh) * (bw >> 1));
          ctx.fillRect(hx + (bw >> 1) - hw, hy - bh - rh + ry, hw * 2 + 1, 1);
        }

        // Windows (G2)
        ctx.fillStyle = G2;
        if (bw >= 14) {
          ctx.fillRect(hx + 3, hy - bh + 2, 3, 3);
          ctx.fillRect(hx + bw - 6, hy - bh + 2, 3, 3);
        } else {
          ctx.fillRect(hx + (bw >> 1) - 1, hy - bh + 2, 3, 3);
        }

        // Door (center bottom)
        ctx.fillStyle = G1;
        ctx.fillRect(hx + (bw >> 1) - 1, hy - 3, 3, 3);
      }
    }

    // Rice paddy: horizontal shimmer bands just above horizon
    ctx.fillStyle = G2;
    for (let y = hy - 4; y < hy; y++) {
      for (let x = (y % 2) * 3; x < W; x += 6) ctx.fillRect(x, y, 3, 1);
    }
    // Paddy grid lines (vertical dividers every ~16px, dashed)
    ctx.fillStyle = G1;
    for (let x = (Math.floor(frame * 0.15) % 16); x < W; x += 16) {
      ctx.fillRect(x, hy - 4, 1, 4);
    }
  }

  // ── BG SCENE 2: mountains + moon ────────────────────────
  _drawBgMountain(frame, hy, G0, G1, G2, G3) {
    const { ctx, W } = this;

    // Moon (fixed upper-right, radius 9)
    const mx = 118, my = 14, mr = 9;
    ctx.fillStyle = G3;
    for (let dy = -mr; dy <= mr; dy++) {
      const hw = Math.round(Math.sqrt(mr * mr - dy * dy));
      const py = my + dy;
      if (py >= 0 && py < hy) ctx.fillRect(mx - hw, py, hw * 2 + 1, 1);
    }
    // Moon glow ring (1px outline in G2)
    const gr = mr + 2;
    for (let dy = -gr; dy <= gr; dy++) {
      const oHw = Math.round(Math.sqrt(gr * gr - dy * dy));
      const iHw = Math.round(Math.sqrt(Math.max(0, (gr-1)*(gr-1) - dy*dy)));
      const py  = my + dy;
      if (py < 0 || py >= hy) continue;
      ctx.fillStyle = G2;
      if (oHw > iHw) {
        ctx.fillRect(mx - oHw, py, oHw - iHw, 1);       // left arc
        ctx.fillRect(mx + iHw + 1, py, oHw - iHw, 1);   // right arc
      }
    }

    // Mountain silhouettes (back peaks = G0 then front peaks = G1)
    // Slow parallax scroll for distant range
    const mscroll = (frame * 0.06) % 160;
    const peaks = [
      // far range (G0, drawn first): cx, width, height
      { cx: ((20  - mscroll + 320) % 320) - 0,  w: 100, h: 22, col: G0 },
      { cx: ((100 - mscroll + 320) % 320) - 0,  w:  80, h: 18, col: G0 },
      { cx: ((180 - mscroll + 320) % 320) - 0,  w:  90, h: 20, col: G0 },
      // near range (G1): slightly faster
      { cx: ((10  - mscroll * 1.4 + 480) % 480) - 0, w: 110, h: 34, col: G1 },
      { cx: ((120 - mscroll * 1.4 + 480) % 480) - 0, w:  90, h: 38, col: G1 },
      { cx: ((240 - mscroll * 1.4 + 480) % 480) - 0, w: 100, h: 30, col: G1 },
    ];
    for (const pk of peaks) {
      ctx.fillStyle = pk.col;
      for (let dy = 0; dy < pk.h; dy++) {
        const py = hy - pk.h + dy;
        if (py < 0 || py >= hy) continue;
        const hw = Math.round((dy / pk.h) * (pk.w >> 1));
        ctx.fillRect(Math.round(pk.cx) - hw, py, hw * 2 + 1, 1);
      }
    }

    // Snow cap on tallest visible peaks (G2, top 20% of peak)
    for (const pk of peaks.filter(p => p.col === G1)) {
      const snowH = Math.floor(pk.h * 0.22);
      ctx.fillStyle = G2;
      for (let dy = 0; dy < snowH; dy++) {
        const py = hy - pk.h + dy;
        if (py < 0 || py >= hy) continue;
        const hw = Math.round((dy / pk.h) * (pk.w >> 1));
        if (hw > 0) ctx.fillRect(Math.round(pk.cx) - hw + 1, py, hw * 2 - 1, 1);
      }
    }
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
  // Car helpers
  // ────────────────────────────────────────────────────────
  _spawnCar() {
    // Lane positions: ±14 = inner lanes, ±28 = outer lanes
    const lanes = [-28, -14, 14, 28];
    const x = lanes[Math.floor(Math.random() * lanes.length)];
    this._cars.push({
      x,
      z:     210 + Math.random() * 50,
      speed: 4.0 + Math.random() * 2.5,  // faster than road scroll (1.6)
    });
    if (this._cars.length > 5) this._cars.shift();
  }

  // Futuristic pixel-art car viewed slightly from above/behind
  _drawCar(sx, groundY, t, G0, G1, G2, G3) {
    const { ctx } = this;
    // 1 art-unit = ps screen pixels
    const ps  = Math.max(1, Math.round(t * 2.5));
    const CW  = 8;   // car width in art-units
    const CL  = 5;   // car length in art-units (screen Y extent)
    const pw  = CW * ps;
    const ph  = CL * ps;
    const lx  = sx - (pw >> 1);
    const ty  = groundY - ph;

    // ── Body ──
    ctx.fillStyle = G2;
    ctx.fillRect(lx, ty, pw, ph);

    if (ps >= 2) {
      // Cockpit (dark glass dome, centered)
      ctx.fillStyle = G1;
      ctx.fillRect(lx + ps * 2, ty + ps, pw - ps * 4, ps * 2);

      // Side racing stripes
      ctx.fillStyle = G3;
      ctx.fillRect(lx + ps,       ty + ps, ps, ph - ps * 2);
      ctx.fillRect(lx + pw - ps*2, ty + ps, ps, ph - ps * 2);

      // Rear spoiler fins (dark, sticking up behind car)
      ctx.fillStyle = G1;
      ctx.fillRect(lx + ps,        ty - ps, ps, ps);
      ctx.fillRect(lx + pw - ps*2, ty - ps, ps, ps);

      // Exhaust glow (G3 at rear center)
      ctx.fillStyle = G3;
      ctx.fillRect(lx + ps * 3, ty - ps, ps, ps);
      ctx.fillRect(lx + pw - ps*4, ty - ps, ps, ps);

      // Tail lights
      ctx.fillStyle = G3;
      ctx.fillRect(lx,        ty,         ps, ps);
      ctx.fillRect(lx + pw - ps, ty,      ps, ps);

      // Headlights (front = viewer-facing bottom of sprite)
      ctx.fillStyle = G3;
      ctx.fillRect(lx,        groundY - ps, ps * 2, ps);
      ctx.fillRect(lx + pw - ps*2, groundY - ps, ps * 2, ps);

      // Dark undercarriage side panels
      ctx.fillStyle = G1;
      ctx.fillRect(lx,        ty, ps, ph);
      ctx.fillRect(lx + pw - ps, ty, ps, ph);
    } else {
      // Minimal: just headlights at front corners
      ctx.fillStyle = G3;
      ctx.fillRect(lx,       groundY - 1, 1, 1);
      ctx.fillRect(lx + pw - 1, groundY - 1, 1, 1);
    }

    // Ground shadow
    if (t > 0.2) {
      ctx.fillStyle = G1;
      ctx.fillRect(lx - 1, groundY, pw + 2, 1);
    }
  }

  // ────────────────────────────────────────────────────────
  // Digital noise helpers
  // ────────────────────────────────────────────────────────
  _spawnNoise() {
    const types = ['static', 'scanbar', 'tile', 'static'];  // weighted toward static
    const type  = types[Math.floor(Math.random() * types.length)];
    const inSky = Math.random() < 0.3;
    const yMax  = inSky ? 48 : 130;
    const yMin  = inSky ? 2  : 55;
    this._noises.push({
      type,
      x:       Math.floor(Math.random() * 120),
      y:       yMin + Math.floor(Math.random() * (yMax - yMin)),
      w:       type === 'scanbar' ? 160 : 8  + Math.floor(Math.random() * 28),
      h:       type === 'scanbar' ? 1 + Math.floor(Math.random() * 3)
                                  : 4  + Math.floor(Math.random() * 14),
      life:    type === 'scanbar' ? 3 + Math.floor(Math.random() * 5)
                                  : 6  + Math.floor(Math.random() * 10),
      maxLife: 0,  // set below
    });
    const n = this._noises[this._noises.length - 1];
    n.maxLife = n.life;
  }

  _renderNoise(n, G0, G1, G2, G3) {
    const { ctx } = this;
    const alpha = n.life / n.maxLife;  // fade out

    switch (n.type) {
      case 'static': {
        // Random pixel snow
        const density = 0.45 * alpha;
        for (let py = n.y; py < n.y + n.h; py++) {
          for (let px = n.x; px < n.x + n.w; px++) {
            if (Math.random() < density) {
              const v = Math.random();
              ctx.fillStyle = v < 0.25 ? G3 : v < 0.55 ? G2 : v < 0.8 ? G1 : G0;
              ctx.fillRect(px, py, 1, 1);
            }
          }
        }
        break;
      }
      case 'scanbar': {
        // Bright scan-line bar sliding across screen
        const lifeR = alpha;
        ctx.fillStyle = lifeR > 0.6 ? G3 : G2;
        ctx.fillRect(0, n.y, 160, n.h);
        // Static on top of bar
        for (let px = 0; px < 160; px += 2) {
          if (Math.random() > 0.55) {
            ctx.fillStyle = Math.random() > 0.5 ? G2 : G0;
            ctx.fillRect(px, n.y, 2, n.h);
          }
        }
        break;
      }
      case 'tile': {
        // Checkerboard glitch block
        for (let py = n.y; py < n.y + n.h; py++) {
          for (let px = n.x; px < n.x + n.w; px++) {
            ctx.fillStyle = ((px + py) & 1) ? G2 : G0;
            ctx.fillRect(px, py, 1, 1);
          }
        }
        // Bright border
        ctx.fillStyle = G3;
        ctx.fillRect(n.x, n.y, n.w, 1);
        ctx.fillRect(n.x, n.y + n.h - 1, n.w, 1);
        break;
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

  // ────────────────────────────────────────────────────────
  // MATRIX — Game Boy digital rain
  // ────────────────────────────────────────────────────────
  _renderMatrix() {
    const { ctx, W, H, frame, kick, snare } = this;

    // Black background
    ctx.fillStyle = '#000800';
    ctx.fillRect(0, 0, W, H);

    const { _mtxCW: CW, _mtxCH: CH, _mtxRows: ROWS, _mtxChars: CHARS } = this;
    const numCols = this._matrixCols.length;
    const step    = this.step >= 0 ? this.step : Math.floor(frame / 8) % 16;

    // Note reactivity state
    if (this._mtxNoteFlash > 0) this._mtxNoteFlash--;
    const noteFade = this._mtxNoteFlash / 40;   // 1→0 over 40 frames
    const noteCol  = this._mtxNoteCol;

    ctx.font = `bold ${CH - 1}px monospace`;
    ctx.textAlign = 'left';

    for (let c = 0; c < numCols; c++) {
      const col  = this._matrixCols[c];
      const x    = c * CW;

      // Distance from note-highlighted column (0 = exact match)
      const noteDist  = Math.abs(c - noteCol);
      const noteBoost = noteFade > 0 && noteDist <= 3
        ? (1 - noteDist / 4) * noteFade : 0;

      // ── Advance head ───────────────────────────────────
      const speedMul = (kick > 0 ? 2.5 : 1) + noteBoost * 2;
      col.head += col.speed * speedMul;
      if (col.head > ROWS + col.len) {
        col.head  = -(2 + Math.random() * ROWS);
        col.speed = 0.08 + Math.random() * 0.14;
        col.len   = 6 + Math.floor(Math.random() * 10);
      }

      // ── Character mutation ─────────────────────────────
      // Snare: burst-mutate ALL chars in ALL columns
      if (snare > 0) {
        for (let m = 0; m < snare; m++)
          col.chars[Math.floor(Math.random() * ROWS)] =
            CHARS[Math.floor(Math.random() * CHARS.length)];
      } else {
        // Normal: 1 char per 4 frames; note columns flicker 2x faster
        const rate = noteBoost > 0.4 ? 2 : 4;
        if (frame % rate === c % rate) {
          col.chars[Math.floor(Math.random() * ROWS)] =
            CHARS[Math.floor(Math.random() * CHARS.length)];
        }
      }

      // ── Draw trail ─────────────────────────────────────
      const headRow = Math.floor(col.head);
      for (let t = 0; t < col.len; t++) {
        const row = headRow - t;
        if (row < 0 || row >= ROWS) continue;
        const y = row * CH;

        if (t === 0) {
          ctx.fillStyle = '#ffffff';
        } else {
          const ratio = t / col.len;
          if (noteBoost > 0.3) {
            // Note-highlighted: vivid lime pulse
            if      (ratio < 0.15) ctx.fillStyle = '#ccffcc';
            else if (ratio < 0.45) ctx.fillStyle = '#00ff44';
            else if (ratio < 0.75) ctx.fillStyle = '#00aa22';
            else                   ctx.fillStyle = '#005511';
          } else {
            // Default
            if      (ratio < 0.15) ctx.fillStyle = '#9bef9b';
            else if (ratio < 0.45) ctx.fillStyle = '#00cc00';
            else if (ratio < 0.75) ctx.fillStyle = '#008800';
            else                   ctx.fillStyle = '#004400';
          }
        }
        ctx.fillText(col.chars[row], x, y + CH - 2);
      }
    }

    // ── Kick: shockwave line sweeping down ─────────────────
    if (kick > 0) {
      const shockY = Math.floor(((10 - kick) / 10) * (H - 8));
      ctx.fillStyle = kick > 7 ? '#aaffaa' : '#00ff00';
      ctx.globalAlpha = kick / 10;
      ctx.fillRect(0, shockY, W, kick > 7 ? 2 : 1);
      ctx.globalAlpha = 1;
    }

    // ── Snare: random column flash ──────────────────────────
    if (snare > 3) {
      ctx.globalAlpha = (snare - 3) / 3 * 0.5;
      for (let sc = 0; sc < 4; sc++) {
        ctx.fillStyle = sc % 2 === 0 ? '#00ff00' : '#004400';
        ctx.fillRect(Math.floor(Math.random() * numCols) * CW, 0, CW, H);
      }
      ctx.globalAlpha = 1;
    }

    // ── Note: column glow overlay ───────────────────────────
    if (noteFade > 0.05) {
      for (let nc = Math.max(0, noteCol - 3); nc <= Math.min(numCols - 1, noteCol + 3); nc++) {
        const d = Math.abs(nc - noteCol);
        ctx.fillStyle = '#00ff44';
        ctx.globalAlpha = (1 - d / 4) * noteFade * 0.18;
        ctx.fillRect(nc * CW, 0, CW, H);
      }
      ctx.globalAlpha = 1;
    }

    // ── Step dots ──────────────────────────────────────────
    ctx.textAlign = 'left';
    for (let i = 0; i < 16; i++) {
      const active = i === step;
      ctx.fillStyle = active ? '#ffffff' : (i % 4 === 0 ? '#00cc00' : '#004400');
      ctx.fillRect(i * 10, H - 7, 9, active ? 7 : 3);
    }

    this._drawText(('00' + Math.floor(frame / 60)).slice(-3), 2, 2, '#8bac0f', 1);
  }

  // ────────────────────────────────────────────────────────
  // SCOPE — phosphor oscilloscope, fully audio-reactive
  // ────────────────────────────────────────────────────────
  _renderScope() {
    const { ctx, W, H, frame, kick, snare, beat } = this;

    // Phosphor persistence: partial clear → old traces fade like a real CRT
    ctx.fillStyle = '#0f380f';
    ctx.globalAlpha = 0.45;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;

    // Subtle grid
    ctx.fillStyle = '#1f4a1f';
    for (let y = 18; y < H - 12; y += 18) {
      for (let x = 0; x < W; x += 4) ctx.fillRect(x, y, 2, 1);
    }
    for (let x = 0; x < W; x += 32) ctx.fillRect(x, (H >> 1) - 1, 1, 3);

    // ── Smooth reactive parameters ────────────────────────
    // Kick → amplitude surge + hard clipping (→ square wave shape)
    const targetAmp  = 22 + kick * 10 + snare * 4;
    const targetDist = Math.min(1, kick / 10);
    // Snare → FM modulation (metallic warp)
    const targetFm   = Math.min(1, snare / 6);

    this._sAmp  = this._sAmp  * 0.72 + targetAmp  * 0.28;
    this._sDist = this._sDist * 0.68 + targetDist * 0.32;
    this._sFm   = this._sFm   * 0.68 + targetFm   * 0.32;

    // Pitch → cycles visible on screen (C4=60 → 3 cycles; each octave doubles)
    const cycles = Math.pow(2, (this._scopeNote - 60) / 12) * 3;

    // Phase flows at pitch speed → wave appears to scroll
    this._sPhase += (cycles / W) * Math.PI * 1.8;

    const cy   = H >> 1;
    const amp  = this._sAmp;
    const dist = this._sDist;
    const fm   = this._sFm;
    const ph   = this._sPhase;

    // ── Precompute wave into reused buffer ───────────────
    const wave = this._scopeWave;
    for (let x = 0; x < W; x++) {
      const t = (x / W) * Math.PI * 2 * cycles + ph;
      // FM from snare: modulator warps the carrier phase
      const fmMod = fm > 0.01 ? Math.sin(t * 3.73 + ph * 0.5) * fm * 18 : 0;
      // Composite: fundamental + harmonics (richer = more aggressive)
      let v = Math.sin(t + fmMod)
            + Math.sin(t * 2 + 0.8)  * 0.42
            + Math.sin(t * 3 + 1.6)  * 0.18
            + Math.sin(t * 5 + 2.4)  * 0.08;
      v *= amp;
      // Hard clip on kick → flat-top square-wave look
      if (dist > 0.04) {
        const lim = amp * (1.0 - dist * 0.65);
        v = Math.max(-lim, Math.min(lim, v * (1 + dist * 1.6)));
      }
      wave[x] = Math.round(cy + v);
    }

    // ── Draw 3 glow passes (CRT phosphor layers) ─────────
    const passes = [
      { shift:  1, color: '#336633', alpha: 0.45 },
      { shift:  0, color: '#8bac0f', alpha: 1.00 },
      { shift: -1, color: '#d4f020', alpha: 0.35 },
    ];
    for (const p of passes) {
      ctx.fillStyle  = p.color;
      ctx.globalAlpha = p.alpha;
      for (let x = 0; x < W - 1; x++) {
        const y1 = wave[x]     + p.shift;
        const y2 = wave[x + 1] + p.shift;
        const minY = Math.max(0,      Math.min(y1, y2));
        const maxY = Math.min(H - 13, Math.max(y1, y2));
        ctx.fillRect(x, minY, 1, Math.max(1, maxY - minY + 1));
      }
    }
    ctx.globalAlpha = 1;

    // Kick: bright full-screen flash
    if (kick > 5) {
      ctx.fillStyle   = '#9bbc0f';
      ctx.globalAlpha = ((kick - 5) / 5) * 0.4;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    // Step dots at bottom
    const stepN = this.step >= 0 ? this.step : Math.floor(frame / 8) % 16;
    for (let i = 0; i < 16; i++) {
      const active = i === stepN;
      ctx.fillStyle = active ? '#9bbc0f' : '#306230';
      ctx.fillRect(i * 10, H - 7, 9, active ? 7 : 2);
    }

    this._drawText(('00' + beat).slice(-3), 2, 2, '#8bac0f', 1);
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
      if (typeof vjRelay !== 'undefined') vjRelay.setStyle(btn.dataset.style);
    });
  });
}

// ── VJ Relay ────────────────────────────────────────────────
// コントローラー側 (メインシンセページ) で音楽イベントを
// WebSocket 経由で vj-display.html へ送信する。
// HTTP サーバー経由でない場合 (file:// や GitHub Pages) は無効化。
const vjRelay = (() => {
  let ws = null;

  function connect() {
    if (location.protocol !== 'http:') return;  // HTTPS や file:// は接続しない
    try {
      ws = new WebSocket(`ws://${location.host}`);
      ws.onclose = () => { ws = null; setTimeout(connect, 3000); };
      ws.onerror = () => {};  // サーバーなしの場合は静かに失敗
    } catch (_) {}
  }

  // ページロード後に接続試行
  if (typeof window !== 'undefined') setTimeout(connect, 800);

  function send(data) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(data));
  }

  return {
    onStep:   s              => send({ t: 'step', s }),
    onKick:   ()             => send({ t: 'kick' }),
    onSnare:  ()             => send({ t: 'snare' }),
    onNote:    m             => send({ t: 'note', m }),
    onNoteOff: m             => send({ t: 'noteoff', m }),
    setStyle: s              => send({ t: 'style', s }),
    onDrum:   d              => send({ t: 'drum', d }),
    onBass:   (seq, midi, dur) => send({ t: 'bass', seq, midi, dur }),
    onChord:  notes          => send({ t: 'chord', notes }),
    onPreset: name           => send({ t: 'preset', name }),
    // FX / volume control relay (knobs + sliders)
    onCtrl: (tgt, param, val) => send({ t: 'ctrl', tgt, param, val }),
    // PC Sequencer control: sends full pattern so PC can run its own clock
    onPlay: (bpm, seq1, seq2, drums, drumEnabled, chord, fxState) =>
      send({ t: 'pc_play', bpm, seq1, seq2, drums, drumEnabled, chord, fxState }),
    onStop: () => send({ t: 'pc_stop' }),
    onBpm:  bpm => send({ t: 'pc_bpm', bpm }),
    // Live pattern updates during playback (pattern bank switch, drum edits)
    onSeqUpdate:   (seq, steps) => send({ t: 'pc_seq_update', seq, steps }),
    onChordUpdate: steps        => send({ t: 'pc_chord_update', steps }),
    onDrumUpdate:  drums        => send({ t: 'pc_drum_update', drums }),
    onDrumEnable:  enabled      => send({ t: 'pc_drum_enable', enabled }),
  };
})();
