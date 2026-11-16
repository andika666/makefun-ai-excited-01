// Phoenix Unframed — a phoenix bursting out of a framed painting over a neon city.
// Every pixel is computed here: gradients, shapes, particles and layered glow.
// Standard library only (node:fs, node:path, node:zlib). Deterministic: fixed seed,
// no time, no randomness from the environment, no network. Writes one PNG to
// $MAKEFUN_OUTPUT_DIR/entry.png (default /output), 1024x1024, well under 1 MiB.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const W = 1024;
const H = 1024;
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR || "/output";
const OUT_PATH = path.join(OUT_DIR, "entry.png");

// ---- deterministic PRNG (mulberry32, fixed seed) ----
let seedState = 20261116;
function rnd() {
  seedState |= 0;
  seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function rr(a, b) {
  return a + rnd() * (b - a);
}
function pick(arr) {
  return arr[Math.floor(rnd() * arr.length)];
}

// ---- pixel buffer (RGB, 8 bit) ----
const px = Buffer.alloc(W * H * 3);

function blend(x, y, r, g, b, a) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || ix >= W || iy < 0 || iy >= H) return;
  if (a <= 0) return;
  if (a > 1) a = 1;
  const o = (iy * W + ix) * 3;
  const ia = 1 - a;
  px[o] = Math.round(px[o] * ia + r * a);
  px[o + 1] = Math.round(px[o + 1] * ia + g * a);
  px[o + 2] = Math.round(px[o + 2] * ia + b * a);
}
function setPx(x, y, r, g, b) {
  blend(x, y, r, g, b, 1);
}

// Linear interpolation between two [r,g,b] colours.
function lerpC(c1, c2, t) {
  return [
    c1[0] + (c2[0] - c1[0]) * t,
    c1[1] + (c2[1] - c1[1]) * t,
    c1[2] + (c2[2] - c1[2]) * t,
  ];
}

// Soft radial glow: colour fades with distance from (cx,cy).
function glow(cx, cy, rad, r, g, b, a) {
  const x0 = Math.max(0, Math.floor(cx - rad));
  const x1 = Math.min(W - 1, Math.ceil(cx + rad));
  const y0 = Math.max(0, Math.floor(cy - rad));
  const y1 = Math.min(H - 1, Math.ceil(cy + rad));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rad;
      const dy = (y - cy) / rad;
      const d2 = dx * dx + dy * dy;
      if (d2 >= 1) continue;
      const fall = (1 - d2) * (1 - d2);
      blend(x, y, r, g, b, a * fall);
    }
  }
}

// Solid filled disc.
function disc(cx, cy, rad, r, g, b, a) {
  const x0 = Math.max(0, Math.floor(cx - rad));
  const x1 = Math.min(W - 1, Math.ceil(cx + rad));
  const y0 = Math.max(0, Math.floor(cy - rad));
  const y1 = Math.min(H - 1, Math.ceil(cy + rad));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rad;
      const dy = (y - cy) / rad;
      if (dx * dx + dy * dy <= 1) blend(x, y, r, g, b, a);
    }
  }
}

// Filled rotated ellipse.
function ellipse(cx, cy, rx, ry, rot, r, g, b, a) {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const rad = Math.max(rx, ry);
  const x0 = Math.max(0, Math.floor(cx - rad));
  const x1 = Math.min(W - 1, Math.ceil(cx + rad));
  const y0 = Math.max(0, Math.floor(cy - rad));
  const y1 = Math.min(H - 1, Math.ceil(cy + rad));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const u = (dx * cos + dy * sin) / rx;
      const v = (-dx * sin + dy * cos) / ry;
      if (u * u + v * v <= 1) blend(x, y, r, g, b, a);
    }
  }
}

// Filled polygon (scanline via point-in-polygon test over its bounding box).
function poly(pts, r, g, b, a) {
  let x0 = W;
  let x1 = 0;
  let y0 = H;
  let y1 = 0;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  x0 = Math.max(0, Math.floor(x0));
  x1 = Math.min(W - 1, Math.ceil(x1));
  y0 = Math.max(0, Math.floor(y0));
  y1 = Math.min(H - 1, Math.ceil(y1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i][0];
        const yi = pts[i][1];
        const xj = pts[j][0];
        const yj = pts[j][1];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
      if (inside) blend(x, y, r, g, b, a);
    }
  }
}

// Thick line as a chain of discs.
function thickLine(x0, y0, x1, y1, w, r, g, b, a) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / (w * 0.4)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    disc(x0 + dx * t, y0 + dy * t, w / 2, r, g, b, a);
  }
}

// Filled rectangle.
function rect(x0, y0, x1, y1, r, g, b, a) {
  const xa = Math.max(0, Math.floor(x0));
  const xb = Math.min(W - 1, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0));
  const yb = Math.min(H - 1, Math.ceil(y1));
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) blend(x, y, r, g, b, a);
  }
}

// ---- palette ----
const INDIGO_TOP = [10, 8, 42];
const INDIGO_MID = [38, 20, 88];
const VIOLET = [96, 32, 120];
const MAGENTA_GLOW = [214, 44, 150];
const CYAN = [46, 226, 238];
const GOLD = [255, 190, 60];
const GOLD_DEEP = [232, 130, 24];
const CRIMSON = [214, 32, 52];
const EMBER = [255, 110, 30];
const CREAM = [255, 236, 180];

// ============ 1. SKY — deep indigo to violet, with a magenta horizon band ============
const skyStops = [
  [0.0, INDIGO_TOP],
  [0.38, INDIGO_MID],
  [0.62, VIOLET],
  [0.78, [150, 40, 110]],
  [1.0, [70, 22, 80]],
];
for (let y = 0; y < H; y++) {
  const t = y / (H - 1);
  let c = skyStops[skyStops.length - 1][1];
  for (let s = 0; s < skyStops.length - 1; s++) {
    const t0 = skyStops[s][0];
    const t1 = skyStops[s + 1][0];
    if (t >= t0 && t <= t1) {
      c = lerpC(skyStops[s][1], skyStops[s + 1][1], (t - t0) / (t1 - t0));
      break;
    }
  }
  for (let x = 0; x < W; x++) setPx(x, y, c[0], c[1], c[2]);
}

// Stars: tiny bright dots, denser and brighter up top.
for (let i = 0; i < 260; i++) {
  const x = rr(0, W);
  const y = rr(0, 620);
  const s = rr(0.5, 2.1);
  const bright = rr(120, 255);
  const warm = rnd() < 0.3;
  disc(x, y, s, bright, warm ? bright * 0.85 : bright, warm ? bright * 0.6 : 255, rr(0.35, 0.95));
}
// A few cross sparkle stars.
for (let i = 0; i < 14; i++) {
  const x = rr(40, W - 40);
  const y = rr(30, 420);
  const l = rr(5, 12);
  const b = rr(180, 255);
  thickLine(x - l, y, x + l, y, 1.4, b, b, 255, 0.8);
  thickLine(x, y - l, x, y + l, 1.4, b, b, 255, 0.8);
}

// Distant magenta city glow on the horizon.
glow(512, 760, 620, 214, 44, 150, 0.35);
glow(180, 780, 300, 46, 226, 238, 0.18);
glow(860, 780, 300, 255, 140, 40, 0.16);

// ============ 2. NEON CITY — three depth layers of silhouettes ============
function cityLayer(yBase, hMin, hMax, col, winAlpha, neonChance) {
  let x = -20;
  while (x < W + 20) {
    const bw = rr(46, 120);
    const bh = rr(hMin, hMax);
    const top = yBase - bh;
    rect(x, top, x + bw, yBase, col[0], col[1], col[2], 1);
    // Rooftop antenna / spire on some towers.
    if (rnd() < 0.35) {
      const ax = x + bw * rr(0.3, 0.7);
      thickLine(ax, top, ax, top - rr(14, 42), 3, col[0], col[1], col[2], 1);
      disc(ax, top - rr(14, 42), 3, 255, 80, 90, 0.9);
    }
    // Lit windows.
    const cols = Math.floor(bw / 16);
    const rows = Math.floor(bh / 22);
    for (let cx = 0; cx < cols; cx++) {
      for (let cy = 0; cy < rows; cy++) {
        if (rnd() < 0.42) {
          const wx = x + 7 + cx * 16;
          const wy = top + 10 + cy * 22;
          const warm = rnd();
          if (warm < 0.55) rect(wx, wy, wx + 7, wy + 10, 255, 196, 110, winAlpha);
          else if (warm < 0.8) rect(wx, wy, wx + 7, wy + 10, 90, 230, 240, winAlpha);
          else rect(wx, wy, wx + 7, wy + 10, 255, 90, 150, winAlpha);
        }
      }
    }
    // Neon strip on some rooftops.
    if (rnd() < neonChance) {
      const nc = pick([[255, 45, 170], [46, 226, 238], [255, 190, 60], [140, 90, 255]]);
      rect(x + 4, top - 4, x + bw - 4, top - 1, nc[0], nc[1], nc[2], 0.95);
      glow(x + bw / 2, top - 2, bw * 0.6, nc[0], nc[1], nc[2], 0.22);
    }
    x += bw + rr(2, 18);
  }
}
// Far layer (hazy violet), mid layer, near layer (near-black).
cityLayer(1024, 150, 260, [52, 30, 96], 0.5, 0.25);
cityLayer(1024, 190, 330, [28, 16, 58], 0.7, 0.4);
cityLayer(1024, 240, 400, [12, 8, 30], 0.9, 0.55);
// Wet-street reflection shimmer at the very bottom.
for (let i = 0; i < 90; i++) {
  const x = rr(0, W);
  const y = rr(960, 1023);
  const len = rr(14, 70);
  const c = pick([[255, 45, 170], [46, 226, 238], [255, 190, 60]]);
  rect(x, y, x + rr(2, 5), y + len * 0.18, c[0], c[1], c[2], rr(0.12, 0.4));
}

// ============ 3. THE FRAMED PAINTING — gilt frame, calm painted world inside ============
const FX0 = 268;
const FX1 = 756;
const FY0 = 148;
const FY1 = 566;
// Halo glow behind the whole frame so it lifts off the sky.
glow(512, 360, 330, 255, 170, 60, 0.28);
glow(512, 360, 200, 255, 120, 40, 0.3);

// Painting interior: a serene painted dawn sky + lake + mountains.
const paintStops = [
  [0.0, [250, 190, 110]],
  [0.35, [240, 130, 80]],
  [0.62, [150, 70, 110]],
  [1.0, [60, 40, 110]],
];
for (let y = FY0 + 16; y <= FY1 - 16; y++) {
  const t = (y - FY0) / (FY1 - FY0);
  let c = paintStops[paintStops.length - 1][1];
  for (let s = 0; s < paintStops.length - 1; s++) {
    if (t >= paintStops[s][0] && t <= paintStops[s + 1][0]) {
      c = lerpC(paintStops[s][1], paintStops[s + 1][1], (t - paintStops[s][0]) / (paintStops[s + 1][0] - paintStops[s][0]));
      break;
    }
  }
  for (let x = FX0 + 16; x <= FX1 - 16; x++) setPx(x, y, c[0], c[1], c[2]);
}
// Painted sun low in the painting.
glow(512, 470, 90, 255, 220, 130, 0.9);
disc(512, 470, 34, 255, 226, 150, 1);
// Painted mountains (two ridges) and a lake band.
poly([[FX0 + 16, 520], [380, 430], [470, 500], [560, 440], [660, 510], [FX1 - 16, 460], [FX1 - 16, 566], [FX0 + 16, 566]], 74, 52, 110, 1);
poly([[FX0 + 16, 566], [FX1 - 16, 566], [FX1 - 16, 520], [660, 540], [512, 522], [360, 545]], 40, 30, 84, 1);
// Painted clouds.
for (const [cx, cy, s] of [[360, 250, 1], [640, 220, 1.2], [470, 300, 0.8], [600, 330, 0.7]]) {
  glow(cx, cy, 52 * s, 255, 210, 170, 0.5);
  ellipse(cx, cy, 58 * s, 16 * s, 0, 255, 220, 185, 0.85);
  ellipse(cx - 34 * s, cy + 6, 34 * s, 11 * s, 0, 255, 220, 185, 0.8);
  ellipse(cx + 36 * s, cy + 7, 36 * s, 12 * s, 0, 255, 220, 185, 0.8);
}

// Gilt frame: outer gold, inner bevel, dark inner lip.
// The TOP edge is broken open in the middle where the phoenix bursts through.
function goldBar(x0, y0, x1, y1) {
  rect(x0, y0, x1, y1, 176, 128, 34, 1);
  rect(x0, y0, x1, y0 + 4, 255, 214, 110, 0.95);
  rect(x0, y0 + 5, x1, y0 + 9, 120, 84, 20, 0.9);
  rect(x0, y1 - 4, x1, y1, 255, 214, 110, 0.95);
}
// Left, right, bottom bars (whole).
goldBar(FX0, FY0, FX0 + 18, FY1);
goldBar(FX1 - 18, FY0, FX1, FY1);
goldBar(FX0, FY1 - 18, FX1, FY1);
// Top bar in two pieces with a burst gap in the middle (x 430..594).
goldBar(FX0, FY0, 430, FY0 + 18);
goldBar(594, FY0, FX1, FY0 + 18);
// Frame corner rosettes.
for (const [cx, cy] of [[FX0 + 9, FY0 + 9], [FX1 - 9, FY0 + 9], [FX0 + 9, FY1 - 9], [FX1 - 9, FY1 - 9]]) {
  disc(cx, cy, 8, 255, 214, 110, 1);
  disc(cx, cy, 4, 140, 96, 24, 1);
}
// Torn top-edge shards still attached, tilted outward.
poly([[430, FY0 + 18], [452, FY0 - 26], [478, FY0 + 14]], 220, 164, 60, 1);
poly([[594, FY0 + 18], [576, FY0 - 20], [548, FY0 + 12]], 200, 148, 52, 1);
poly([[452, FY0 - 26], [470, FY0 - 44], [486, FY0 - 18]], 255, 214, 110, 1);

// ============ 4. THE PHOENIX — tail, wings, body, head, crest ============
// Big warm glow behind the bird so it burns against the indigo sky.
glow(512, 330, 260, 255, 140, 30, 0.5);
glow(512, 330, 150, 255, 200, 90, 0.55);

// --- Tail: long flowing plumes sweeping down over the frame's bottom edge ---
const tailCols = [
  [255, 190, 60],
  [255, 140, 40],
  [232, 80, 30],
  [214, 32, 52],
  [255, 110, 30],
];
for (let i = 0; i < 9; i++) {
  const spread = (i - 4) * 26;
  const cx = 512 + spread;
  const len = 300 - Math.abs(i - 4) * 22;
  const topY = 430;
  const botY = topY + len;
  const sway = spread * 0.55;
  const col = tailCols[i % tailCols.length];
  // Plume as a tapered ribbon of overlapping ellipses.
  const steps = 14;
  for (let s2 = 0; s2 <= steps; s2++) {
    const t = s2 / steps;
    const px2 = cx + sway * t * t + Math.sin(t * 3.1 + i) * 8 * t;
    const py = topY + (botY - topY) * t;
    const wdt = 26 * (1 - t * 0.55);
    ellipse(px2, py, wdt, 34, sway * 0.0016 + Math.sin(t * 2 + i) * 0.25, col[0], col[1], col[2], 0.95);
  }
  // Glowing eye-spot near the tip of each plume.
  const tipX = cx + sway + Math.sin(3.1 + i) * 8;
  const tipY = botY - 26;
  glow(tipX, tipY, 22, 255, 200, 80, 0.4);
  ellipse(tipX, tipY, 10, 16, 0.2, 255, 220, 120, 0.95);
  ellipse(tipX, tipY, 5, 8, 0.2, 160, 24, 44, 0.9);
}

// --- Wings: three rows of fanned feathers, left and right, breaking past the frame ---
function wing(side) {
  // side: -1 left, +1 right. Wing root at the body, tip sweeping up-out.
  const rootX = 512 + side * 26;
  const rootY = 360;
  // Back row (longest, darkest crimson), mid row (orange), front row (gold).
  const rows = [
    { n: 6, len: 310, col: [176, 22, 44], w: 30, baseAng: 0.3 },
    { n: 6, len: 262, col: [232, 90, 26], w: 27, baseAng: 0.22 },
    { n: 5, len: 210, col: [255, 176, 52], w: 24, baseAng: 0.14 },
  ];
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    for (let f = 0; f < row.n; f++) {
      const t = f / (row.n - 1); // 0 = upper/outer, 1 = lower/inner
      const ang = side * (row.baseAng + t * 0.85); // fan angle from vertical
      const L = row.len * (1 - t * 0.3);
      // Feather direction: outward and upward for upper feathers, outward-down for lower.
      const dirX = Math.sin(ang);
      const dirY = -Math.cos(ang) * (t < 0.45 ? 1 : 0.4) + t * 0.45;
      const tipX = rootX + dirX * L * 0.92;
      const tipY = rootY + dirY * L * 0.92;
      const midX = (rootX + tipX) / 2;
      const midY = (rootY + tipY) / 2;
      const rot = Math.atan2(tipY - rootY, tipX - rootX) + Math.PI / 2;
      // Feather body: layered ellipses along its length.
      for (let s2 = 0; s2 <= 5; s2++) {
        const u = s2 / 5;
        const fx = rootX + (tipX - rootX) * u;
        const fy = rootY + (tipY - rootY) * u;
        const fw = row.w * (1 - u * 0.45);
        ellipse(fx, fy, fw, 30, rot, row.col[0], row.col[1], row.col[2], 0.96);
      }
      // Bright leading edge + glowing tip.
      ellipse(midX, midY, row.w * 0.55, 26, rot, 255, 200, 90, 0.5);
      glow(tipX, tipY, 22, 255, 180, 60, 0.45);
      disc(tipX, tipY, 5, 255, 220, 130, 0.95);
    }
  }
}
wing(-1);
wing(1);

// --- Body: golden torso, chest forward, glowing ---
ellipse(512, 384, 60, 88, 0, 255, 176, 52, 1);
ellipse(512, 396, 46, 70, 0, 255, 205, 100, 1);
ellipse(512, 408, 30, 50, 0, 255, 232, 160, 1);
glow(512, 384, 96, 255, 180, 60, 0.4);
// Belly feather scallops.
for (let r2 = 0; r2 < 3; r2++) {
  for (let c2 = -2; c2 <= 2; c2++) {
    const ex = 512 + c2 * 20;
    const ey = 362 + r2 * 24;
    ellipse(ex, ey, 13, 10, 0, 232, 130, 24, 0.35);
  }
}

// --- Head + beak + crest, thrown back in a cry toward the sky ---
ellipse(512, 262, 42, 48, -0.12, 255, 196, 70, 1);
ellipse(524, 272, 27, 31, 0, 255, 220, 130, 1);
// Beak open, pointing up.
poly([[532, 236], [576, 206], [540, 258]], 255, 150, 40, 1);
poly([[532, 246], [568, 230], [538, 264]], 120, 40, 20, 1);
// Eye: fierce, bright.
disc(532, 252, 9, 255, 240, 200, 1);
disc(533, 252, 5, 20, 8, 8, 1);
disc(535, 250, 2, 255, 255, 255, 1);
// Crest: three flame plumes streaming back from the crown.
for (let i = 0; i < 3; i++) {
  const bx = 498 - i * 12;
  const by = 224 - i * 4;
  poly([[bx, by], [bx - 40 - i * 14, by - 60 - i * 12], [bx + 10, by - 34]], [255, 176 - i * 30, 52][0], 176 - i * 30, 52, 1);
  glow(bx - 24 - i * 8, by - 38, 22, 255, 170, 60, 0.5);
}
// Neck ruff.
for (let i = 0; i < 7; i++) {
  const a = -0.5 + i * 0.17;
  ellipse(512 + Math.sin(a) * 34, 306 + Math.cos(a) * 10, 12, 20, a, 255, 140, 40, 0.9);
}

// ============ 5. SHATTERED FRAME SHARDS + EMBERS flying at the viewer ============
// Gold frame shards bursting outward from the broken top edge.
const shardCols = [[255, 214, 110], [220, 164, 60], [176, 128, 34], [255, 190, 80]];
for (let i = 0; i < 26; i++) {
  const a = rr(-Math.PI * 0.85, -Math.PI * 0.15);
  const d = rr(60, 260);
  const cx = 512 + Math.cos(a) * d;
  const cy = 160 + Math.sin(a) * d * 0.8;
  const s = rr(6, 22);
  const rot = rr(0, Math.PI);
  const c = pick(shardCols);
  poly(
    [
      [cx + Math.cos(rot) * s, cy + Math.sin(rot) * s],
      [cx + Math.cos(rot + 2.1) * s * 0.7, cy + Math.sin(rot + 2.1) * s * 0.7],
      [cx + Math.cos(rot + 4.2) * s * 0.8, cy + Math.sin(rot + 4.2) * s * 0.8],
    ],
    c[0],
    c[1],
    c[2],
    0.95
  );
}
// Ember storm: hundreds of glowing sparks radiating from the phoenix.
for (let i = 0; i < 420; i++) {
  const a = rr(0, Math.PI * 2);
  const d = Math.pow(rnd(), 0.6) * 520;
  const x = 512 + Math.cos(a) * d;
  const y = 340 + Math.sin(a) * d * 0.85;
  const s = rr(1, 4.2);
  const heat = rnd();
  const col = heat < 0.5 ? [255, 200, 80] : heat < 0.85 ? [255, 120, 30] : [255, 70, 40];
  glow(x, y, s * 3.2, col[0], col[1], col[2], 0.55);
  disc(x, y, s, col[0], col[1], col[2], 0.95);
  // A few embers get motion streaks pointing away from the bird.
  if (rnd() < 0.22) {
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    thickLine(x - dx * 14, y - dy * 14, x + dx * 10, y + dy * 10, 2, col[0], col[1], col[2], 0.7);
  }
}
// Foreground sparks, big and close, bottom corners.
for (let i = 0; i < 26; i++) {
  const x = rnd() < 0.5 ? rr(0, 260) : rr(764, 1024);
  const y = rr(560, 1024);
  const s = rr(2.5, 6);
  glow(x, y, s * 4, 255, 170, 60, 0.5);
  disc(x, y, s, 255, 210, 110, 0.95);
}

// ============ 6. SPEED LINES + VIGNETTE ============
// Diagonal speed lines streaking past the wings.
for (let i = 0; i < 22; i++) {
  const side = rnd() < 0.5 ? -1 : 1;
  const x = 512 + side * rr(260, 500);
  const y = rr(60, 640);
  const len = rr(24, 70);
  const a = side > 0 ? 0.5 : Math.PI - 0.5;
  thickLine(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, rr(1.5, 3), 255, 220, 160, rr(0.1, 0.28));
}
// Vignette: darken the corners so the centre burns.
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx = (x - 512) / 512;
    const dy = (y - 470) / 520;
    const d2 = dx * dx + dy * dy;
    if (d2 > 0.75) {
      const a = Math.min(0.42, (d2 - 0.75) * 0.55);
      blend(x, y, 4, 2, 18, a);
    }
  }
}

// ============ PNG ENCODER (zlib deflate + chunks + CRC32) ============
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  const crcBuf = Buffer.concat([Buffer.from(type, "ascii"), data]);
  out.writeUInt32BE(crc32(crcBuf), 8 + data.length);
  return out;
}

// Raw scanlines: filter byte 0 + RGB triplets per row.
const raw = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 3)] = 0;
  px.copy(raw, y * (1 + W * 3) + 1, y * W * 3, (y + 1) * W * 3);
}
const idat = zlib.deflateSync(raw, { level: 9 });
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type 2 = RGB
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_PATH, png);
console.log("wrote " + OUT_PATH + " (" + png.length + " bytes, " + W + "x" + H + ")");
