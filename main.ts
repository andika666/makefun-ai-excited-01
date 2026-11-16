// Phoenix Rising — an original deterministic image generator for make.fun
// bounty ai-excited-01 ("Make the AI judge excited").
// A golden/crimson phoenix bursts out of a gilt-framed painting over a
// neon city at night. Everything is drawn in code: no image assets, no
// network, no clock, no randomness outside a fixed-seed PRNG, so two runs
// produce byte-identical PNG output.
//
// Node 22, standard library only (node:fs, node:path, node:zlib).

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — fixed seed, no Math.random / Date.now.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0x9e3779b9);
function rr(min, max) {
  return min + rand() * (max - min);
}
function ri(min, max) {
  return Math.floor(rr(min, max + 1));
}
function pick(arr) {
  return arr[Math.floor(rand() * arr.length)];
}

// ---------------------------------------------------------------------------
// Canvas: RGBA pixel buffer with src-over blending.
// ---------------------------------------------------------------------------
const buf = new Uint8Array(W * H * 4);

function blendPixel(x, y, r, g, b, a) {
  if (x < 0 || x >= W || y < 0 || y >= H || a <= 0) return;
  const i = (y * W + x) * 4;
  const sa = a > 1 ? 1 : a;
  const da = buf[i + 3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;
  buf[i] = Math.round((r * sa + buf[i] * da * (1 - sa)) / outA);
  buf[i + 1] = Math.round((g * sa + buf[i + 1] * da * (1 - sa)) / outA);
  buf[i + 2] = Math.round((b * sa + buf[i + 2] * da * (1 - sa)) / outA);
  buf[i + 3] = Math.round(outA * 255);
}

function setOpaque(x, y, r, g, b) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  buf[i] = r;
  buf[i + 1] = g;
  buf[i + 2] = b;
  buf[i + 3] = 255;
}

// RGB helper: [r, g, b]
function lerpColor(c1, c2, t) {
  return [
    Math.round(c1[0] + (c2[0] - c1[0]) * t),
    Math.round(c1[1] + (c2[1] - c1[1]) * t),
    Math.round(c1[2] + (c2[2] - c1[2]) * t),
  ];
}

function fillRect(x0, y0, x1, y1, c, a = 1) {
  const xa = Math.max(0, Math.floor(x0));
  const xb = Math.min(W - 1, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0));
  const yb = Math.min(H - 1, Math.ceil(y1));
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) blendPixel(x, y, c[0], c[1], c[2], a);
  }
}

function fillCircle(cx, cy, r, c, a = 1) {
  const xa = Math.max(0, Math.floor(cx - r));
  const xb = Math.min(W - 1, Math.ceil(cx + r));
  const ya = Math.max(0, Math.floor(cy - r));
  const yb = Math.min(H - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) blendPixel(x, y, c[0], c[1], c[2], a);
    }
  }
}

// Soft radial glow: brightness falls off quadratically to radius r.
function glow(cx, cy, r, c, peak) {
  const xa = Math.max(0, Math.floor(cx - r));
  const xb = Math.min(W - 1, Math.ceil(cx + r));
  const ya = Math.max(0, Math.floor(cy - r));
  const yb = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      const dx = (x - cx) / r;
      const dy = (y - cy) / r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= 1) continue;
      const fall = (1 - d2) * (1 - d2);
      blendPixel(x, y, c[0], c[1], c[2], peak * fall);
    }
  }
}

// Filled ellipse, optionally rotated (degrees), via bounding-box test.
function ellipse(cx, cy, rx, ry, rotDeg, c, a = 1) {
  const rot = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const R = Math.max(rx, ry);
  const xa = Math.max(0, Math.floor(cx - R));
  const xb = Math.min(W - 1, Math.ceil(cx + R));
  const ya = Math.max(0, Math.floor(cy - R));
  const yb = Math.min(H - 1, Math.ceil(cy + R));
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      const v = (lx * lx) / (rx * rx) + (ly * ly) / (ry * ry);
      if (v <= 1) blendPixel(x, y, c[0], c[1], c[2], a);
    }
  }
}

// Scanline polygon fill.
function polygon(pts, c, a = 1) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(H - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % pts.length];
      if ((p1[1] <= y && p2[1] > y) || (p2[1] <= y && p1[1] > y)) {
        const t = (y - p1[1]) / (p2[1] - p1[1]);
        xs.push(p1[0] + t * (p2[0] - p1[0]));
      }
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.floor(xs[k]));
      const xb = Math.min(W - 1, Math.ceil(xs[k + 1]));
      for (let x = xa; x <= xb; x++) blendPixel(x, y, c[0], c[1], c[2], a);
    }
  }
}

// Thick line as a chain of circles.
function thickLine(x0, y0, x1, y1, w, c, a = 1) {
  const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    fillCircle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w / 2, c, a);
  }
}

// Quadratic bezier point.
function quad(p0, p1, p2, t) {
  const u = 1 - t;
  return [
    u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
    u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
  ];
}

// Tapering bezier stroke: width shrinks from w0 to w1 along the curve.
function taperCurve(p0, p1, p2, w0, w1, c, a = 1) {
  const steps = 90;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const [x, y] = quad(p0, p1, p2, t);
    const w = w0 + (w1 - w0) * t;
    fillCircle(x, y, Math.max(0.6, w / 2), c, a);
  }
}

// ---------------------------------------------------------------------------
// PNG encoder: IHDR / IDAT (zlib deflate, filter 0) / IEND, CRC32.
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePNG() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 4)] = 0; // filter: none
    raw.set(buf.subarray(y * W * 4, (y + 1) * W * 4), y * (1 + W * 4) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const INK = [8, 8, 34];
const INDIGO = [24, 16, 68];
const VIOLET = [64, 28, 110];
const MAGENTA = [255, 45, 149];
const CYAN = [0, 229, 255];
const GOLD = [255, 200, 60];
const GOLD_DEEP = [214, 148, 16];
const GOLD_DARK = [139, 101, 8];
const EMBER = [255, 110, 20];
const CRIMSON = [220, 30, 60];
const FLAME = [255, 140, 40];
const CREAM = [255, 240, 200];

// ---------------------------------------------------------------------------
// 1. Night sky: three-stop vertical gradient + stars + horizon glow.
// ---------------------------------------------------------------------------
function drawSky() {
  const top = [6, 6, 30];
  const mid = [22, 14, 66];
  const low = [58, 20, 96];
  for (let y = 0; y < H; y++) {
    const t = y / H;
    let c;
    if (t < 0.55) c = lerpColor(top, mid, t / 0.55);
    else c = lerpColor(mid, low, (t - 0.55) / 0.45);
    for (let x = 0; x < W; x++) setOpaque(x, y, c[0], c[1], c[2]);
  }
  // Wide magenta glow low over the city, cyan glow to the left.
  glow(512, 760, 620, MAGENTA, 0.30);
  glow(150, 700, 420, CYAN, 0.22);
  glow(880, 720, 380, [255, 120, 40], 0.18);

  // Stars.
  for (let i = 0; i < 260; i++) {
    const x = rr(0, W);
    const y = rr(0, 640);
    const r = rr(0.6, 2.1);
    const b = rr(0.35, 1);
    const c = pick([[255, 255, 255], [255, 255, 255], [200, 220, 255], [255, 230, 180]]);
    fillCircle(x, y, r, c, b);
    if (r > 1.6) glow(x, y, r * 5, c, 0.35);
  }
  // A few bright cross-sparkle stars.
  for (let i = 0; i < 10; i++) {
    const x = rr(40, W - 40);
    const y = rr(30, 420);
    const s = rr(4, 9);
    thickLine(x - s, y, x + s, y, 1.2, [255, 255, 255], 0.8);
    thickLine(x, y - s, x, y + s, 1.2, [255, 255, 255], 0.8);
    fillCircle(x, y, 1.8, [255, 255, 255], 1);
  }
}

// ---------------------------------------------------------------------------
// 2. Neon city skyline along the bottom, two depth layers.
// ---------------------------------------------------------------------------
function drawCityLayer(baseY, topMin, topMax, body, windowColors, winChance) {
  let x = -20;
  while (x < W + 20) {
    const w = rr(46, 120);
    const top = rr(topMin, topMax);
    fillRect(x, top, x + w, H, body, 1);
    // Rooftop antenna on some towers.
    if (rand() < 0.35) {
      const ax = x + w * rr(0.3, 0.7);
      thickLine(ax, top, ax, top - rr(14, 42), 3, body, 1);
      fillCircle(ax, top - rr(14, 42), 3, [255, 60, 80], 0.9);
    }
    // Neon rim light on the roof edge.
    if (rand() < 0.6) {
      fillRect(x, top, x + w, top + 3, pick([MAGENTA, CYAN, GOLD]), rr(0.5, 0.9));
    }
    // Lit windows in a grid.
    const cols = Math.floor(w / 16);
    const rows = Math.floor((baseY - top) / 22);
    for (let cx = 0; cx < cols; cx++) {
      for (let cy = 0; cy < rows; cy++) {
        if (rand() < winChance) {
          const wx = x + 6 + cx * 16;
          const wy = top + 10 + cy * 22;
          fillRect(wx, wy, wx + 8, wy + 11, pick(windowColors), rr(0.55, 1));
        }
      }
    }
    x += w + rr(2, 18);
  }
}

function drawCity() {
  drawCityLayer(1024, 600, 730, [16, 12, 52], [[255, 45, 149], [0, 229, 255], [255, 200, 90]], 0.16);
  drawCityLayer(1024, 730, 880, [7, 6, 26], [[255, 45, 149], [0, 229, 255], [255, 210, 110], [255, 255, 255]], 0.34);
  // Wet-street glow band at the very bottom.
  glow(512, 1010, 500, MAGENTA, 0.16);
  glow(300, 1020, 300, CYAN, 0.14);
}

// ---------------------------------------------------------------------------
// 3. The gilt frame and the painting inside it.
//    Frame outer: x 212..812, y 150..720. Bar thickness 26.
//    The top bar is broken open in the middle (gap x 438..592).
// ---------------------------------------------------------------------------
const FRAME = { x0: 212, y0: 150, x1: 812, y1: 720, bar: 26 };

function drawPainting() {
  const ix0 = FRAME.x0 + FRAME.bar;
  const iy0 = FRAME.y0 + FRAME.bar;
  const ix1 = FRAME.x1 - FRAME.bar;
  const iy1 = FRAME.y1 - FRAME.bar;
  // Sunset gradient inside the painting.
  const stops = [
    [52, 18, 92],
    [122, 30, 96],
    [214, 80, 40],
    [255, 176, 66],
  ];
  for (let y = iy0; y <= iy1; y++) {
    const t = (y - iy0) / (iy1 - iy0);
    const seg = Math.min(2, Math.floor(t * 3));
    const lt = t * 3 - seg;
    const c = lerpColor(stops[seg], stops[seg + 1], lt);
    for (let x = ix0; x <= ix1; x++) setOpaque(x, y, c[0], c[1], c[2]);
  }
  // Low sun.
  glow(512, 560, 150, [255, 220, 120], 0.9);
  fillCircle(512, 560, 52, [255, 236, 170], 1);
  fillCircle(512, 560, 38, [255, 248, 220], 1);
  // Mountain silhouettes, two ridges.
  const ridge = (baseY, amp, col) => {
    const pts = [[ix0, iy1]];
    let x = ix0;
    while (x < ix1) {
      pts.push([x, baseY - rr(0, amp)]);
      x += rr(40, 110);
    }
    pts.push([ix1, iy1]);
    polygon(pts, col, 1);
  };
  ridge(560, 90, [74, 28, 88]);
  ridge(620, 70, [38, 16, 62]);
  // Painted birds.
  for (let i = 0; i < 5; i++) {
    const bx = rr(ix0 + 40, ix1 - 40);
    const by = rr(iy0 + 60, iy0 + 200);
    const s = rr(6, 12);
    thickLine(bx - s, by, bx, by - s * 0.5, 2, [30, 12, 50], 0.9);
    thickLine(bx, by - s * 0.5, bx + s, by, 2, [30, 12, 50], 0.9);
  }
}

function goldBar(x0, y0, x1, y1) {
  fillRect(x0, y0, x1, y1, GOLD_DEEP, 1);
  fillRect(x0, y0, x1, y0 + 4, [255, 226, 120], 1); // top highlight
  fillRect(x0, y1 - 4, x1, y1, GOLD_DARK, 1); // bottom shade
  fillRect(x0, y0, x0 + 4, y1, [255, 226, 120], 0.8);
  fillRect(x1 - 4, y0, x1, y1, GOLD_DARK, 0.8);
  // Inner bevel line.
  fillRect(x0 + 7, y0 + 7, x1 - 7, y0 + 9, GOLD_DARK, 0.7);
}

function drawFrame() {
  const { x0, y0, x1, y1, bar } = FRAME;
  // Outer glow so the frame pops against the night.
  glow(512, 435, 420, GOLD, 0.12);
  // Bottom, left, right bars whole; top bar in two pieces with a gap.
  goldBar(x0, y1 - bar, x1, y1); // bottom
  goldBar(x0, y0, x0 + bar, y1); // left
  goldBar(x1 - bar, y0, x1, y1); // right
  goldBar(x0, y0, 438, y0 + bar); // top-left piece
  goldBar(592, y0, x1, y0 + bar); // top-right piece
  // Jagged torn ends at the break.
  polygon(
    [[438, y0], [462, y0 + 10], [446, y0 + bar], [438, y0 + bar]],
    GOLD_DEEP,
    1
  );
  polygon(
    [[592, y0], [570, y0 + 8], [584, y0 + bar], [592, y0 + bar]],
    GOLD_DEEP,
    1
  );
  // Bright torn-edge highlights.
  thickLine(438, y0, 462, y0 + 10, 3, [255, 236, 150], 1);
  thickLine(592, y0, 570, y0 + 8, 3, [255, 236, 150], 1);
  // Ornate corner rosettes.
  for (const [cx, cy] of [
    [x0 + bar / 2, y0 + bar / 2],
    [x1 - bar / 2, y0 + bar / 2],
    [x0 + bar / 2, y1 - bar / 2],
    [x1 - bar / 2, y1 - bar / 2],
  ]) {
    fillCircle(cx, cy, 11, GOLD, 1);
    fillCircle(cx, cy, 6, CRIMSON, 1);
    fillCircle(cx, cy, 2.5, CREAM, 1);
  }
}

// Gold shards flying out of the broken top edge.
function drawShards() {
  glow(515, 130, 130, GOLD, 0.55);
  for (let i = 0; i < 16; i++) {
    const cx = rr(420, 620);
    const cy = rr(28, 150);
    const s = rr(6, 22);
    const a = rr(0, Math.PI * 2);
    const pts = [];
    for (let k = 0; k < 4; k++) {
      const ang = a + (k * Math.PI) / 2 + rr(-0.3, 0.3);
      const rad = s * (k % 2 === 0 ? 1 : 0.45);
      pts.push([cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad]);
    }
    polygon(pts, pick([GOLD, [255, 226, 120], GOLD_DEEP]), 1);
    if (rand() < 0.5) glow(cx, cy, s * 2.2, GOLD, 0.4);
  }
  // A few thin gold streaks shooting upward from the break.
  for (let i = 0; i < 7; i++) {
    const x0 = rr(450, 580);
    thickLine(x0, 150, x0 + rr(-70, 70), rr(20, 90), rr(1.5, 3.5), GOLD, rr(0.5, 0.9));
  }
}

// ---------------------------------------------------------------------------
// 4. The phoenix: tail plumes, wings, body, neck, head.
//    Body centre ~(512, 440); head up-right at ~(585, 250).
// ---------------------------------------------------------------------------
function drawTailPlumes() {
  // Long plumes sweep down from the body, bowing outward over the frame's
  // bottom edge, then curling back in toward their eye-spot tips.
  const plumes = [
    { ctrl: [296, 620], end: [368, 812], w0: 32, w1: 10 },
    { ctrl: [428, 700], end: [452, 842], w0: 36, w1: 12 },
    { ctrl: [586, 700], end: [580, 842], w0: 36, w1: 12 },
    { ctrl: [716, 620], end: [664, 812], w0: 32, w1: 10 },
  ];
  const cols = [CRIMSON, [255, 90, 30], GOLD, [200, 40, 90]];
  plumes.forEach((p, i) => {
    const c = cols[i % cols.length];
    taperCurve([512, 500], p.ctrl, p.end, p.w0, p.w1, c, 1);
    taperCurve([512, 500], p.ctrl, p.end, p.w0 * 0.45, p.w1 * 0.4, GOLD, 0.75);
    // Eye-spot near the tip: gold ring, teal centre, dark pupil.
    const [ex, ey] = quad([512, 500], p.ctrl, p.end, 0.86);
    glow(ex, ey, 34, CYAN, 0.5);
    fillCircle(ex, ey, 15, GOLD, 1);
    fillCircle(ex, ey, 10, [0, 150, 160], 1);
    fillCircle(ex, ey, 5, [10, 10, 40], 1);
    fillCircle(ex - 2, ey - 2, 1.8, [255, 255, 255], 1);
  });
}

// One wing: three rows of overlapping feather ellipses fanning from the
// shoulder. `dir` is -1 for the left wing, +1 for the right.
function drawWing(shoulderX, shoulderY, dir) {
  const rows = [
    { n: 7, len: 290, wid: 40, spread: 55, baseAng: -90 },
    { n: 6, len: 225, wid: 40, spread: 48, baseAng: -90 },
    { n: 5, len: 160, wid: 38, spread: 38, baseAng: -90 },
  ];
  const tipCols = [
    [255, 60, 90],
    [255, 90, 40],
    [255, 140, 40],
    [255, 180, 50],
  ];
  rows.forEach((row, ri) => {
    for (let i = 0; i < row.n; i++) {
      const f = row.n === 1 ? 0.5 : i / (row.n - 1);
      // Fan angle: feathers sweep from straight up outward to the wing side.
      const angDeg = row.baseAng + dir * f * row.spread;
      const ang = (angDeg * Math.PI) / 180;
      // Outer (tip) feathers longest: a swept wing, not a round fan.
      const len = row.len * (0.68 + 0.32 * f);
      const dist = len * 0.52;
      const cx = shoulderX + Math.cos(ang) * dist;
      const cy = shoulderY + Math.sin(ang) * dist;
      // Colour: gold near the body, crimson/magenta at the tips.
      const tip = tipCols[Math.min(tipCols.length - 1, Math.floor(f * tipCols.length))];
      const col = lerpColor(GOLD, tip, 0.35 + 0.55 * (ri / 2) + 0.1 * f);
      // Feather ellipse, long axis along the fan direction.
      const rot = angDeg + 90;
      // Dark rim behind the feather so neighbours separate.
      ellipse(cx, cy, row.wid / 2 + 3, len / 2 + 5, rot, [120, 10, 30], 1);
      ellipse(cx, cy, row.wid / 2, len / 2, rot, col, 1);
      // Bright shaft highlight down the feather.
      const hx = cx - Math.cos(ang) * len * 0.18;
      const hy = cy - Math.sin(ang) * len * 0.18;
      ellipse(hx, hy, row.wid / 5, len * 0.32, rot, [255, 226, 130], 0.55);
      // Dark tip cap on the outer row.
      if (ri === 0) {
        const tx = cx + Math.cos(ang) * len * 0.42;
        const ty = cy + Math.sin(ang) * len * 0.42;
        ellipse(tx, ty, row.wid / 2.4, len * 0.1, rot, CRIMSON, 0.85);
      }
    }
  });
}

function drawPhoenix() {
  // Halo behind the bird.
  glow(512, 400, 330, [255, 170, 60], 0.55);
  glow(512, 400, 170, [255, 230, 140], 0.7);

  drawTailPlumes();

  // Wings behind the body.
  drawWing(478, 430, -1);
  drawWing(546, 430, 1);

  // Body: angled teardrop, crimson over gold, bright chest.
  ellipse(500, 468, 62, 88, -18, CRIMSON, 1);
  ellipse(505, 472, 46, 70, -18, [255, 90, 30], 1);
  ellipse(516, 492, 32, 50, -18, GOLD, 1);
  ellipse(520, 506, 20, 32, -18, [255, 236, 150], 0.95);

  // Neck: thick S-curve from the body up to the head, clear of the wings.
  taperCurve([512, 400], [548, 322], [576, 274], 46, 28, [255, 110, 30], 1);
  taperCurve([512, 400], [548, 322], [576, 274], 22, 13, GOLD, 0.9);

  // Head: large, held high above the wing line, with a bright halo.
  glow(596, 254, 70, [255, 200, 90], 0.6);
  ellipse(594, 254, 40, 29, -18, [255, 120, 30], 1);
  ellipse(602, 248, 27, 18, -18, GOLD, 1);
  // Crest: three flame feathers sweeping back from the crown.
  ellipse(568, 220, 8, 38, -38, CRIMSON, 1);
  ellipse(581, 213, 7, 33, -18, [255, 90, 30], 1);
  ellipse(594, 211, 6, 29, 2, GOLD, 1);
  // Beak: gold, open, pointing up-right toward the viewer.
  polygon(
    [[620, 238], [662, 228], [622, 254]],
    [255, 200, 40],
    1
  );
  polygon(
    [[620, 250], [648, 254], [618, 262]],
    [200, 130, 10],
    1
  );
  // Eye: fierce, white with dark pupil and glint.
  fillCircle(606, 246, 7.5, [255, 255, 255], 1);
  fillCircle(608, 246, 4, [12, 8, 20], 1);
  fillCircle(606.5, 244.5, 1.6, [255, 255, 255], 1);
  // Cheek ember glow.
  glow(606, 258, 24, EMBER, 0.5);
}

// ---------------------------------------------------------------------------
// 5. Embers, motion streaks, vignette.
// ---------------------------------------------------------------------------
function drawEmbers() {
  for (let i = 0; i < 190; i++) {
    const x = rr(230, 800);
    const y = rr(80, 780);
    const r = rr(1, 3.6);
    const c = pick([GOLD, EMBER, FLAME, [255, 200, 90], CRIMSON]);
    fillCircle(x, y, r, c, rr(0.6, 1));
    if (r > 2.4) glow(x, y, r * 4, c, 0.4);
  }
  // A rising trail of embers along each side of the bird.
  for (let i = 0; i < 40; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = 512 + side * rr(120, 320);
    const y = rr(120, 700) - rr(0, 120);
    fillCircle(x, y, rr(1, 2.6), pick([GOLD, EMBER]), rr(0.7, 1));
  }
}

function drawStreaks() {
  // Diagonal motion streaks radiating out from the phoenix.
  for (let i = 0; i < 26; i++) {
    const ang = rr(0, Math.PI * 2);
    const d0 = rr(180, 320);
    const d1 = d0 + rr(60, 180);
    const x0 = 512 + Math.cos(ang) * d0;
    const y0 = 420 + Math.sin(ang) * d0;
    const x1 = 512 + Math.cos(ang) * d1;
    const y1 = 420 + Math.sin(ang) * d1;
    thickLine(x0, y0, x1, y1, rr(1, 2.6), pick([[255, 220, 130], [255, 255, 255], GOLD]), rr(0.12, 0.3));
  }
}

function drawVignette() {
  // Darken the corners slightly so the centre burns brighter.
  const cx = W / 2;
  const cy = H / 2;
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const dx = (x - cx) / (W / 2);
      const dy = (y - cy) / (H / 2);
      const d2 = dx * dx + dy * dy;
      if (d2 > 0.85) {
        const a = Math.min(0.32, (d2 - 0.85) * 0.55);
        blendPixel(x, y, 4, 4, 18, a);
        blendPixel(x + 1, y, 4, 4, 18, a);
        blendPixel(x, y + 1, 4, 4, 18, a);
        blendPixel(x + 1, y + 1, 4, 4, 18, a);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main: paint back to front, encode, write $MAKEFUN_OUTPUT_DIR/entry.png.
// ---------------------------------------------------------------------------
function main() {
  drawSky();
  drawCity();
  drawPainting();
  drawFrame();
  drawShards();
  drawPhoenix();
  drawEmbers();
  drawStreaks();
  drawVignette();

  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "out";
  fs.mkdirSync(outDir, { recursive: true });
  const png = encodePNG();
  fs.writeFileSync(path.join(outDir, "entry.png"), png);
}

main();
