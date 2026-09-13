/**
 * face-scan-hologram.js
 * 2D holographic face-scan visual — Canvas 2D + lightweight HTML HUD.
 *
 * - Zero dependencies. No WebGL, no Three.js, no 3D. The face is a flat,
 *   frontal 2D wireframe generated once at load from authored anatomical
 *   contours + a seeded density-mapped point field + constrained Delaunay fill.
 * - Dynamic expression deformation via live blendshape tracking.
 * - 21-landmark hand skeleton tracking rendering.
 * - Tension-display curved frame with double-stroke glow.
 *
 *     import { mount } from './face-scan-hologram.js';
 *     const fs = mount(document.getElementById('face-scan'));
 *     fs.startScan();      // IDLE → SCANNING → COMPLETE → IDLE
 *     fs.applyTracking({ blendshapes, handLandmarks });
 *     fs.destroy();        // cancels rAF, observers, listeners, removes DOM
 */

// ───────────────────────────── Tuning ─────────────────────────────
const DEFAULTS = Object.freeze({
  coarseDuration: 1100,    // ms — fast detection sweep (contour only)
  pauseDuration: 380,      // ms — target lock / rewind to top
  scanDuration: 2600,      // ms — detail analysis sweep
  completeDuration: 2000,  // ms — hold COMPLETE before returning to IDLE
  hudRate: 8,              // Hz — HUD text refresh
  idleParticles: 24,
  maxParticles: 46,
  onStateChange: null,     // (next, prev) => void
});

export const STATES = Object.freeze({ IDLE: 'IDLE', SCANNING: 'SCANNING', COMPLETE: 'COMPLETE' });

// Colour tiers
const BLUE   = [30, 110, 240];   // body / glow / low-intensity mesh
const CYAN   = [60, 200, 255];   // lines, nodes, HUD (cooler, less saturated)
const ACCENT = [0, 229, 255];    // reserved: scan line, landmarks, pupils, completion
const WHITE  = [232, 250, 255];

const TAU = Math.PI * 2;
const BREATH_PERIOD = 4.2;
const NB = 7, I_MAX = 1.8;
const SCAN_Y0 = 0.02, SCAN_Y1 = 0.98;
const LM_BRACKET_LIFE = 1.0;
const LM_MARK_ALPHA = 0.38;
const PH_COARSE = 0, PH_PAUSE = 1, PH_DETAIL = 2;
const SEED = 0xC0FFEE;

// Point types
const T_FILL = 0, T_FEATURE = 1, T_CONTOUR = 2, T_LANDMARK = 3, T_PUPIL = 4, T_DUST = 5;
const NODE_RADIUS = [0.95, 1.5, 1.45, 2.2, 2.6, 0.95];
const NODE_ALPHA  = [0.40, 0.85, 0.8, 1.0, 1.0, 0.45];

// Edge classes: 0 contour, 1 feature, 2 fill (delaunay), 3 faint (hair / folds), 4 dust links
const EDGE_STYLE = [
  { core: 0.85, glow: 0.12, w: 1.3, gw: 5.0 },
  { core: 0.90, glow: 0.11, w: 1.1, gw: 4.0 },
  { core: 0.28, glow: 0.04, w: 0.75, gw: 2.6 },
  { core: 0.30, glow: 0.00, w: 0.7, gw: 0 },
  { core: 0.30, glow: 0.00, w: 0.7, gw: 0 },
];
const DUST_CLASS = 4;

// MediaPipe Hand 21 Connections Topology
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],          // Thumb
  [0, 5], [5, 6], [6, 7], [7, 8],          // Index
  [5, 9], [9, 10], [10, 11], [11, 12],     // Middle
  [9, 13], [13, 14], [14, 15], [15, 16],   // Ring
  [13, 17], [17, 18], [18, 19], [19, 20],  // Pinky
  [0, 17]                                  // Base palm
];

// Holographic medium
const HOLO = {
  scanlinePeriod: 3,
  scanlineCut: 0.26,
  scanlineSpeed: 5,
  chromaBlue: 0.22, chromaWhite: 0.14,
};

// Motion
const MOTION = {
  faceWaveSpeed: 1.25,
  faceWaveTravel: 7.0,
  pupilDriftX: 0.85,
  pupilDriftY: 0.45,
  pupilDriftSpeed: 0.82,
};

// Pseudo-normal shading (2D only) + translucent surface
const SHADE_LATERAL = 0.45, SHADE_EDGE = 0.25, SHADE_MIN = 0.30;
const SURFACE = { top: 0.065, centre: 0.07, centreR: 0.30 };
const EDGE_MARGIN = 0.014;
const FADE_START = 0.85;

// ───────────────────── Authored anatomy (normalized 0..1, LEFT half) ─────────────────────
const SILHOUETTE_L = [
  [.5, .052], [.455, .054], [.412, .063], [.372, .080], [.337, .105], [.306, .140], [.283, .180],
  [.268, .225], [.258, .272], [.253, .322], [.252, .372], [.255, .422], [.262, .470], [.273, .515],
  [.290, .558], [.312, .598], [.338, .635], [.366, .668], [.385, .695],
  [.378, .725], [.378, .770], [.374, .820], [.362, .858],
  [.300, .872], [.220, .890], [.150, .912], [.090, .942], [.040, .978],
];
const POLY_TAIL_L = [[.04, .999], [.5, .999]];

const FEATURES = [
  // jaw → chin
  { c: 0, group: 'jaw', pts: [[.366, .668], [.400, .700], [.440, .722], [.475, .732], [.5, .735]], lm: [4], lmName: ['CHIN'] },
  // hairline
  { c: 1, pts: [[.270, .245], [.295, .235], [.320, .212], [.355, .198], [.400, .190], [.450, .187], [.5, .188]] },
  // hair strands (faint)
  { c: 3, pts: [[.455, .054], [.450, .187]] },
  { c: 3, pts: [[.412, .063], [.400, .190]] },
  { c: 3, pts: [[.372, .080], [.355, .198]] },
  { c: 3, pts: [[.306, .140], [.320, .212]] },
  { c: 3, pts: [[.5, .052], [.5, .188]] },
  // brow
  { c: 1, group: 'brow', closed: true, lm: [2], lmName: ['BROW'], pts: [[.298, .343], [.330, .326], [.370, .318], [.413, .322], [.452, .337], [.450, .356], [.414, .343], [.373, .338], [.335, .346], [.303, .360]] },
  // eye
  { c: 1, group: 'eye', closed: true, lm: [0, 4], lmName: ['EYE_IN', 'EYE_OUT'], pts: [[.443, .405], [.418, .387], [.386, .379], [.353, .383], [.322, .398], [.350, .414], [.385, .421], [.418, .417]] },
  // upper eyelid crease
  { c: 1, group: 'eye', pts: [[.437, .392], [.412, .372], [.384, .364], [.352, .368], [.325, .383]] },
  // cheekbone
  { c: 1, pts: [[.275, .440], [.290, .478], [.318, .508], [.352, .530]] },
  // nose: bridge → alar wing → nostril base
  { c: 1, lm: [6], lmName: ['NOSE_W'], pts: [[.466, .352], [.468, .400], [.466, .445], [.462, .485], [.454, .512], [.443, .530], [.438, .545], [.446, .556], [.466, .560], [.484, .557], [.5, .554]] },
  // nose midline
  { c: 1, lm: [4], lmName: ['NOSE_TIP'], pts: [[.5, .352], [.5, .420], [.5, .480], [.5, .520], [.5, .538], [.5, .554]] },
  // nasolabial fold (faint, detached)
  { c: 3, pts: [[.428, .562], [.414, .588], [.406, .608]] },
  // mouth
  { c: 1, group: 'mouth', lm: [0], lmName: ['MOUTH'], pts: [[.418, .623], [.445, .609], [.470, .602], [.488, .607], [.5, .602]] },
  { c: 1, group: 'mouth', pts: [[.418, .623], [.455, .621], [.5, .622]] },
  { c: 1, group: 'mouth', pts: [[.418, .623], [.445, .641], [.475, .650], [.5, .652]] },
  // chin crease
  { c: 1, group: 'jaw', pts: [[.440, .683], [.470, .676], [.5, .674]] },
  // ear
  { c: 1, pts: [[.252, .372], [.238, .392], [.230, .428], [.234, .470], [.250, .505], [.273, .515]] },
  { c: 1, pts: [[.250, .410], [.244, .448], [.253, .482]] },
  // neck
  { c: 1, pts: [[.385, .695], [.400, .750], [.420, .800], [.452, .845], [.5, .868]] },
  { c: 1, pts: [[.5, .735], [.5, .780], [.5, .825], [.5, .868]] },
  { c: 1, pts: [[.5, .868], [.450, .878], [.380, .876], [.300, .880], [.220, .893], [.150, .912]] },
];
const IRIS = { cx: .383, cy: .400, r: .0115, n: 8 };

function densityAt(x, y) {
  const mx = Math.abs(x - 0.5);
  if (y < 0.20) return 0.050;
  if (y > 0.74) return 0.054;
  if (mx < 0.21 && y > 0.30 && y < 0.71) return 0.029;
  return 0.046;
}

// ─────────────────────────── Helpers ───────────────────────────
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = v => clamp(v, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => [lerp(a[0], b[0], t) | 0, lerp(a[1], b[1], t) | 0, lerp(a[2], b[2], t) | 0];
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${clamp01(a).toFixed(3)})`;
const easeInOutSine = t => -(Math.cos(Math.PI * t) - 1) / 2;
const easeOutCubic = t => 1 - Math.pow(1 - clamp01(t), 3);
const rand = (a, b) => a + Math.random() * (b - a);
const bucketOf = I => { const b = (I / I_MAX * NB) | 0; return b < 0 ? 0 : b >= NB ? NB - 1 : b; };

function scanBoost(ny, sy) { const d = sy - ny; return d >= 0 ? Math.exp(-d * 14) : Math.exp(d * 60) * 0.8; }

const LM_DOT = mix(ACCENT, WHITE, 0.6);
const DUST_FRONT = mix(BLUE, CYAN, 0.7);

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function distToPoly(x, y, poly) {
  let m = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[j][0], ay = poly[j][1], bx = poly[i][0], by = poly[i][1];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-12;
    const t = clamp01(((x - ax) * dx + (y - ay) * dy) / l2);
    const ex = ax + dx * t - x, ey = ay + dy * t - y;
    const d = ex * ex + ey * ey; if (d < m) m = d;
  }
  return Math.sqrt(m);
}
function segCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx), d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax), d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Minimal Bowyer–Watson Delaunay. */
function delaunay(xs, ys) {
  const n = xs.length;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) { if (xs[i] < minX) minX = xs[i]; if (xs[i] > maxX) maxX = xs[i]; if (ys[i] < minY) minY = ys[i]; if (ys[i] > maxY) maxY = ys[i]; }
  const dm = Math.max(maxX - minX, maxY - minY) * 10, mx = (minX + maxX) / 2, my = (minY + maxY) / 2;
  const X = xs.concat([mx - 2 * dm, mx, mx + 2 * dm]), Y = ys.concat([my - dm, my + 2 * dm, my - dm]);
  const mk = (a, b, c) => {
    const ax = X[a], ay = Y[a], bx = X[b], by = Y[b], cx = X[c], cy = Y[c];
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-14) return { a, b, c, x: 0, y: 0, r2: -1 };
    const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
    const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
    const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
    return { a, b, c, x: ux, y: uy, r2: (ax - ux) ** 2 + (ay - uy) ** 2 };
  };
  let tris = [mk(n, n + 1, n + 2)];
  for (let i = 0; i < n; i++) {
    const px = X[i], py = Y[i], keep = [], bad = [];
    for (const t of tris) { const dx = t.x - px, dy = t.y - py; (dx * dx + dy * dy < t.r2 ? bad : keep).push(t); }
    const ec = new Map();
    for (const t of bad) {
      for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) {
        const k = u < v ? u * 8192 + v : v * 8192 + u;
        const e = ec.get(k); if (e) e.n++; else ec.set(k, { u, v, n: 1 });
      }
    }
    for (const e of ec.values()) if (e.n === 1) keep.push(mk(e.u, e.v, i));
    tris = keep;
  }
  return tris.filter(t => t.a < n && t.b < n && t.c < n).map(t => [t.a, t.b, t.c]);
}

// ───────────────────── Procedural 2D face build (once per module load) ─────────────────────
function buildFace() {
  const rnd = mulberry32(SEED);
  const pts = [], keyMap = new Map();
  const key = (x, y) => Math.round(x * 1000) + ',' + Math.round(y * 1000);
  function addRaw(x, y, t, group = '') {
    const k = key(x, y); let i = keyMap.get(k);
    if (i !== undefined) {
      if (t > pts[i].type && t !== T_DUST) pts[i].type = t;
      if (group && !pts[i].group) pts[i].group = group;
      return i;
    }
    i = pts.length; pts.push({ nx: x, ny: y, type: t, fade: 1, layer: 0, group: group || '' }); keyMap.set(k, i); return i;
  }
  function add(x, y, t, group = '') {
    if (Math.abs(x - 0.5) < 0.006) {
      const i = addRaw(0.5, y, t, group);
      return [i, i];
    }
    let grpL = group, grpR = group;
    if (group === 'brow') { grpL = 'browL'; grpR = 'browR'; }
    else if (group === 'eye') { grpL = 'eyeL'; grpR = 'eyeR'; }
    const iL = addRaw(x, y, t, grpL);
    const iR = addRaw(1 - x, y, t, grpR);
    return [iL, iR];
  }
  const edgeKeys = new Set(), edges = [], constraint = [];
  function addEdge(a, b, c) {
    if (a === b) return;
    const k = a < b ? a * 4096 + b : b * 4096 + a;
    if (edgeKeys.has(k)) return;
    edgeKeys.add(k); edges.push([a, b, c]);
    if (c <= 1) constraint.push([a, b]);
  }
  const addEdgeM = (A, B, c) => { addEdge(A[0], B[0], c); addEdge(A[1], B[1], c); };

  // 1) Silhouette + fill polygon
  const polyL = SILHOUETTE_L.concat(POLY_TAIL_L);
  const poly = polyL.concat(polyL.slice(1, -1).reverse().map(p => [1 - p[0], p[1]]));
  let prev = null;
  for (const p of SILHOUETTE_L) {
    const cur = add(p[0], p[1], T_CONTOUR);
    if (prev) addEdgeM(prev, cur, 0);
    prev = cur;
  }

  // 2) Features + landmarks
  const landmarks = [], landmarkNames = [];
  const pushLm = (A, name) => {
    landmarks.push(A[0]); landmarkNames.push(A[1] !== A[0] ? name + '_L' : name);
    if (A[1] !== A[0]) { landmarks.push(A[1]); landmarkNames.push(name + '_R'); }
  };
  for (const f of FEATURES) {
    const t = f.c === 3 ? T_FILL : T_FEATURE;
    const ids = f.pts.map(p => add(p[0], p[1], t, f.group || ''));
    for (let i = 0; i + 1 < ids.length; i++) addEdgeM(ids[i], ids[i + 1], f.c);
    if (f.closed) addEdgeM(ids[ids.length - 1], ids[0], f.c);
    if (f.lm) f.lm.forEach((li, q) => { const A = ids[li]; pts[A[0]].type = pts[A[1]].type = T_LANDMARK; pushLm(A, (f.lmName && f.lmName[q]) || 'PT'); });
  }
  const iris = [];
  for (let k = 0; k < IRIS.n; k++) {
    const a = k / IRIS.n * TAU;
    iris.push(add(IRIS.cx + Math.cos(a) * IRIS.r, IRIS.cy + Math.sin(a) * IRIS.r, T_FEATURE, 'eye'));
  }
  for (let k = 0; k < IRIS.n; k++) addEdgeM(iris[k], iris[(k + 1) % IRIS.n], 1);
  const pupils = add(IRIS.cx, IRIS.cy, T_PUPIL, 'eye');
  landmarks.unshift(pupils[1]); landmarkNames.unshift('PUPIL_R');
  landmarks.unshift(pupils[0]); landmarkNames.unshift('PUPIL_L');

  // 3) Density-mapped fill points
  const tooClose = (x, y, d) => { for (const p of pts) { const dx = p.nx - x, dy = p.ny - y; if (dx * dx + dy * dy < d * d) return true; } return false; };
  for (let k = 0; k < 7000; k++) {
    let x = rnd() * 0.5, y = 0.04 + rnd() * 0.96;
    const d = densityAt(x, y);
    if (x > 0.5 - d * 0.5) x = 0.5;
    if (!pointInPoly(x, y, poly) || distToPoly(x, y, poly) < EDGE_MARGIN || tooClose(x, y, d)) continue;
    add(x, y, T_FILL);
  }

  // 4) Constrained Delaunay fill
  const nHead = pts.length;
  const xs = [], ys = [];
  for (let i = 0; i < nHead; i++) { xs.push(pts[i].nx + (rnd() - 0.5) * 6e-4); ys.push(pts[i].ny + (rnd() - 0.5) * 6e-4); }
  for (const [a, b, c] of delaunay(xs, ys)) {
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const ux = pts[u].nx, uy = pts[u].ny, vx = pts[v].nx, vy = pts[v].ny;
      const dx = ux - vx, dy = uy - vy;
      if (dx * dx + dy * dy > 0.12 * 0.12) continue;
      if (!pointInPoly((ux + vx) / 2, (uy + vy) / 2, poly)) continue;
      let crosses = false;
      for (let q = 0; q < constraint.length; q++) {
        const [p, r] = constraint[q];
        if (p === u || p === v || r === u || r === v) continue;
        if (segCross(ux, uy, vx, vy, pts[p].nx, pts[p].ny, pts[r].nx, pts[r].ny)) { crosses = true; break; }
      }
      if (!crosses) addEdge(u, v, 2);
    }
  }

  // 5) Dust (two planes) + short links
  const dust = [];
  for (let k = 0; k < 44; k++) {
    const a = rnd() * TAU, r = 0.03 + rnd() * 0.12;
    const x = 0.5 + Math.cos(a) * (0.255 + r), y = 0.40 + Math.sin(a) * (0.36 + r);
    if (x < 0.04 || x > 0.96 || y < 0.02 || y > 0.86) continue;
    if (pointInPoly(x, y, poly) || distToPoly(x, y, poly) < 0.025) continue;
    const di = addRaw(x, y, T_DUST); pts[di].layer = rnd() < 0.5 ? 0 : 1; dust.push(di);
  }
  for (let i = 0; i < dust.length; i++) {
    let links = 0;
    for (let j = i + 1; j < dust.length && links < 2; j++) {
      const dx = pts[dust[i]].nx - pts[dust[j]].nx, dy = pts[dust[i]].ny - pts[dust[j]].ny;
      if (dx * dx + dy * dy < 0.075 * 0.075) { addEdge(dust[i], dust[j], DUST_CLASS); links++; }
    }
  }

  // 6) Per-node shading + shoulder fade
  for (const p of pts) {
    let fade = p.ny < FADE_START ? 1 : Math.max(0.08, 1 - (p.ny - FADE_START) / (1 - FADE_START) * 0.95);
    if (p.type !== T_DUST && p.type !== T_CONTOUR) {
      const lateral  = clamp01(Math.abs(p.nx - 0.5) / 0.26);
      const edgeProx = clamp01(1 - distToPoly(p.nx, p.ny, poly) / 0.07);
      const shade = Math.max(SHADE_MIN, 1 - SHADE_LATERAL * lateral - SHADE_EDGE * edgeProx);
      fade *= p.type === T_FILL ? shade : lerp(1, shade, 0.4);
    }
    p.fade = fade;
  }

  // 7) Row density → sparkline signal
  const rowDensity = new Float32Array(48); let rdMax = 0;
  for (const p of pts) if (p.type !== T_DUST) { const b = Math.min(47, (p.ny * 48) | 0); if (++rowDensity[b] > rdMax) rdMax = rowDensity[b]; }
  for (let b = 0; b < 48; b++) rowDensity[b] /= rdMax || 1;

  return { pts, edges, landmarks, landmarkNames, pupils, poly, rowDensity };
}

function buildPalette() {
  const edgeCore = [], edgeGlow = [], nodeCore = [], nodeGlow = [], particle = [];
  for (let c = 0; c < EDGE_STYLE.length; c++) {
    edgeCore[c] = []; edgeGlow[c] = [];
    for (let b = 0; b < NB; b++) {
      const v = (b + 0.5) / NB * I_MAX;
      const col = v < 1 ? mix(BLUE, CYAN, v * v) : mix(CYAN, WHITE, clamp01((v - 1) / 0.8));
      edgeCore[c][b] = rgba(col, EDGE_STYLE[c].core * v);
      edgeGlow[c][b] = rgba(BLUE, EDGE_STYLE[c].glow * Math.min(v, 1.5));
    }
  }
  for (let b = 0; b < NB; b++) {
    const v = (b + 0.5) / NB * I_MAX;
    nodeCore[b] = rgba(v < 1 ? mix(BLUE, CYAN, 0.35 + 0.65 * v) : mix(CYAN, WHITE, clamp01((v - 1) / 0.8)), v * 0.95);
    nodeGlow[b] = rgba(BLUE, v * 0.18);
  }
  const pc = mix(CYAN, WHITE, 0.2);
  for (let i = 0; i < 8; i++) particle[i] = rgba(pc, (i + 1) / 8 * 0.85);
  return { edgeCore, edgeGlow, nodeCore, nodeGlow, particle };
}

const FACE = buildFace();
const PAL = buildPalette();

// ─────────────────────────── DOM helpers ───────────────────────────
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

function buildHud(names, coords) {
  const main = el('div', 'fsh-hud fsh-hud--main');
  main.appendChild(el('div', 'fsh-hud__title', 'FACE SCAN'));
  const mode = el('div', 'fsh-hud__mode', 'STANDBY'); main.appendChild(mode);
  main.appendChild(el('div', 'fsh-hud__rule'));
  const fields = { mode };
  for (const [k, label] of [['identity', 'IDENTITY'], ['match', 'MATCH'], ['depth', 'DEPTH'], ['conf', 'CONFIDENCE'], ['nodes', 'NODES'], ['status', 'STATUS']]) {
    const row = el('div', 'fsh-hud__row');
    row.appendChild(el('span', 'fsh-hud__k', label));
    const v = el('span', 'fsh-hud__v', '—'); row.appendChild(v);
    main.appendChild(row); fields[k] = v;
  }
  const aux = el('div', 'fsh-hud fsh-hud--aux');
  const auxHead = el('div', 'fsh-hud__aux-head', 'LANDMARKS 00/' + String(names.length).padStart(2, '0'));
  aux.appendChild(auxHead);
  const auxRows = [];
  names.forEach((n, k) => {
    const row = el('div', 'fsh-hud__aux-line');
    row.appendChild(el('span', 'fsh-hud__aux-n', n));
    row.appendChild(el('span', 'fsh-hud__aux-c', coords[k]));
    const s = el('span', 'fsh-hud__aux-s', '--'); row.appendChild(s);
    aux.appendChild(row); auxRows.push({ el: row, s, hit: false, txt: '--' });
  });
  return { main, aux, fields, auxHead, auxRows };
}
const fmtPct = v => clamp(v, 0, 99.99).toFixed(2) + '%';
const pad4 = n => String(n | 0).padStart(4, '0');

// ═══════════════════════════════ mount ═══════════════════════════════
export function mount(container, userOptions = {}) {
  if (!container || !(container instanceof Element)) throw new Error('[face-scan-hologram] mount(container): a DOM element is required');
  const opts = { ...DEFAULTS, ...userOptions };

  const { pts, edges, landmarks, landmarkNames, pupils, poly, rowDensity } = FACE;

  // ---- DOM ----
  const root = el('div', 'fsh-root fsh-root--idle');
  const canvas = el('canvas', 'fsh-canvas');
  const hud = buildHud(landmarkNames, landmarks.map(i => pts[i].nx.toFixed(3) + ' ' + pts[i].ny.toFixed(3)));
  root.appendChild(canvas); root.appendChild(hud.main); root.appendChild(hud.aux);
  container.appendChild(root);
  const ctx = canvas.getContext('2d', { alpha: true });

  // projector-line pattern (alpha only; destination-out)
  const patCanvas = document.createElement('canvas');
  patCanvas.width = 1; patCanvas.height = HOLO.scanlinePeriod;
  const pctx = patCanvas.getContext('2d');
  pctx.fillStyle = `rgba(0,0,0,${HOLO.scanlineCut})`; pctx.fillRect(0, 0, 1, 1);
  const scanPattern = ctx.createPattern(patCanvas, 'repeat');
  const patM = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

  // ---- Geometry buffers ----
  const nP = pts.length, nE = edges.length, nC = EDGE_STYLE.length;
  const nxA = new Float32Array(nP), nyA = new Float32Array(nP), typeA = new Uint8Array(nP), nFade = new Float32Array(nP);
  const groupA = new Array(nP);
  const basePx = new Float32Array(nP), basePy = new Float32Array(nP);
  const px = new Float32Array(nP), py = new Float32Array(nP);
  const phase = new Float32Array(nP), nRad = new Float32Array(nP), nFlick = new Float32Array(nP), eFlick = new Float32Array(nE);
  const ea = new Int16Array(nE), eb = new Int16Array(nE), eClass = new Uint8Array(nE), emy = new Float32Array(nE), eFade = new Float32Array(nE);
  const contourIdx = [];
  for (let i = 0; i < nP; i++) {
    nxA[i] = pts[i].nx; nyA[i] = pts[i].ny; typeA[i] = pts[i].type; nFade[i] = pts[i].fade; phase[i] = Math.random() * TAU;
    groupA[i] = pts[i].group || '';
    if (pts[i].type === T_CONTOUR && pts[i].ny < 0.76) contourIdx.push(i);
  }
  for (let e = 0; e < nE; e++) {
    const [a, b, c] = edges[e];
    ea[e] = a; eb[e] = b; eClass[e] = c; emy[e] = (nyA[a] + nyA[b]) * 0.5; eFade[e] = Math.min(nFade[a], nFade[b]);
  }
  const contourEdges = [], dustIdx = [[], []], dustEdge = [[], []];
  for (let e = 0; e < nE; e++) {
    if (eClass[e] === 0) contourEdges.push(e);
    else if (eClass[e] === DUST_CLASS) dustEdge[pts[ea[e]].layer | 0].push(e);
  }
  for (let i = 0; i < nP; i++) if (typeA[i] === T_DUST) dustIdx[pts[i].layer | 0].push(i);
  const dX = new Float32Array(nP), dY = new Float32Array(nP);

  const eBuckets = [], eCount = [];
  for (let c = 0; c < nC; c++) { eBuckets[c] = []; eCount[c] = new Int32Array(NB); for (let b = 0; b < NB; b++) eBuckets[c][b] = new Int16Array(nE); }
  const nBuckets = [], nCount = new Int32Array(NB);
  for (let b = 0; b < NB; b++) nBuckets[b] = new Int16Array(nP);
  const lmHit = new Float32Array(landmarks.length).fill(-1e9);

  // identity graph: each landmark → 2 nearest landmarks
  const lmGraph = [];
  {
    const seen = new Set();
    for (let i = 0; i < landmarks.length; i++) {
      const d = [];
      for (let j = 0; j < landmarks.length; j++) if (j !== i) {
        const dx = nxA[landmarks[i]] - nxA[landmarks[j]], dy = nyA[landmarks[i]] - nyA[landmarks[j]];
        d.push([dx * dx + dy * dy, j]);
      }
      d.sort((a, b) => a[0] - b[0]);
      for (let k = 0; k < 2 && k < d.length; k++) {
        const j = d[k][1], key = i < j ? i * 1000 + j : j * 1000 + i;
        if (!seen.has(key)) { seen.add(key); lmGraph.push([landmarks[i], landmarks[j]]); }
      }
    }
  }

  // ---- Particles ----
  const particles = [];
  for (let i = 0; i < opts.maxParticles; i++) particles.push({ active: false, spark: false, x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1, size: 1 });
  let activeParticles = 0;

  // ---- Live tracking bridge state ----
  const targetBlendshapes = {};
  const smoothedBlendshapes = {};
  let rawHands = [];
  let smoothedHands = [];

  // ---- Runtime state ----
  let state = STATES.IDLE, stateTime = 0, time = 0, lastTs = 0;
  let rafId = 0, running = false, destroyed = false, needsLayout = true;
  let width = 0, height = 0, dpr = 1, S = 0, scale = 1, boxX = 0, boxY = 0, faceCx = 0, faceCy = 0;
  let fr = { x: 0, y: 0, w: 0, h: 0 }, fontPx = 11, font = '11px monospace', bandH = 60;
  let scanGrad = null, pupilGrad = null, pupilR = 22;
  let surfacePath = null, surfaceGradV = null, surfaceGradR = null;
  let sliceCanvas = null, sliceCtx = null;
  let jitterT = 0, jitterNext = 3, jitterY = 0, jitterH = 0, jitterX = 0;
  let breath = 0, scanProgress = 0, scanPhase = PH_COARSE, phaseP = 0, scanNy = SCAN_Y0, prevScanNy = SCAN_Y0;
  let hudAcc = 0, hudDots = 0, auxT = 0;
  let hudX = 0, compact = false, auxPing = -1, auxHits = -1;
  const SPARK_N = 72, spark = new Float32Array(SPARK_N); let sparkHead = 0, sparkAcc = 0;
  const hudCache = {};
  let emaFrame = 1 / 60, slowAccum = 0, lowQuality = false, currentFps = 60;

  // ───────────────────────── Layout ─────────────────────────
  function layout() {
    needsLayout = false;
    const w = container.clientWidth, h = container.clientHeight;
    width = w; height = h;
    if (!w || !h) { canvas.width = canvas.height = 0; return; }
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    S = Math.min(h * 0.95, w * 0.68);
    scale = clamp(S / 760, 0.65, 1.6);
    boxX = (w - S) / 2; boxY = (h - S) / 2;
    faceCx = boxX + 0.5 * S; faceCy = boxY + 0.40 * S;
    for (let i = 0; i < nP; i++) {
      basePx[i] = boxX + nxA[i] * S;
      basePy[i] = boxY + nyA[i] * S;
      px[i] = basePx[i];
      py[i] = basePy[i];
    }
    fr = { x: boxX + 0.14 * S, y: boxY + 0.02 * S, w: 0.72 * S, h: 0.80 * S };

    if (!sliceCanvas) { sliceCanvas = document.createElement('canvas'); sliceCtx = sliceCanvas.getContext('2d'); }
    sliceCanvas.width = Math.ceil(fr.w * dpr) + 4;
    sliceCanvas.height = Math.ceil(14 * scale * dpr) + 4;

    fontPx = Math.round(clamp(S * 0.0145, 9, 12));
    font = `${fontPx}px ui-monospace, Menlo, Consolas, "Roboto Mono", monospace`;

    bandH = 0.10 * S;
    scanGrad = ctx.createLinearGradient(0, -bandH, 0, 0);
    scanGrad.addColorStop(0, rgba(ACCENT, 0));
    scanGrad.addColorStop(0.7, rgba(ACCENT, 0.05));
    scanGrad.addColorStop(1, rgba(ACCENT, 0.16));

    pupilR = 22 * scale;
    pupilGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, pupilR);
    pupilGrad.addColorStop(0, 'rgba(255,255,255,0.95)');
    pupilGrad.addColorStop(0.12, rgba(ACCENT, 0.6));
    pupilGrad.addColorStop(0.4, rgba(BLUE, 0.2));
    pupilGrad.addColorStop(1, rgba(BLUE, 0));

    // translucent head surface
    surfacePath = new Path2D();
    for (let k = 0; k < poly.length; k++) {
      const x = boxX + poly[k][0] * S, y = boxY + poly[k][1] * S;
      k ? surfacePath.lineTo(x, y) : surfacePath.moveTo(x, y);
    }
    surfacePath.closePath();
    surfaceGradV = ctx.createLinearGradient(0, boxY + 0.05 * S, 0, boxY + 0.98 * S);
    surfaceGradV.addColorStop(0,    rgba(BLUE, SURFACE.top));
    surfaceGradV.addColorStop(0.72, rgba(BLUE, SURFACE.top * 0.55));
    surfaceGradV.addColorStop(1,    rgba(BLUE, 0));
    const rcy = faceCy + 0.06 * S;
    surfaceGradR = ctx.createRadialGradient(faceCx, rcy, 0, faceCx, rcy, SURFACE.centreR * S);
    surfaceGradR.addColorStop(0, rgba(BLUE, SURFACE.centre * 1.4));
    surfaceGradR.addColorStop(1, rgba(BLUE, 0));

    // HUD placement (anchored to frame)
    const gap = 24 * scale, hudW = 190 * fontPx / 11, auxW = 200 * fontPx / 11;
    hudX = Math.min(fr.x + fr.w + gap, w - hudW - 12);
    const auxRight = fr.x - 26 * scale;
    compact = w < 720 || h < 420 || (w - (fr.x + fr.w + gap)) < hudW * 0.85;
    root.classList.toggle('fsh-root--compact', compact);
    root.classList.toggle('fsh-root--noaux', auxRight < auxW + 8);
    root.style.setProperty('--fsh-hud-font', fontPx + 'px');
    root.style.setProperty('--fsh-hud-left', hudX + 'px');
    root.style.setProperty('--fsh-hud-top', (fr.y + fr.h * 0.5) + 'px');
    root.style.setProperty('--fsh-aux-right', Math.max(8, w - auxRight) + 'px');
    root.style.setProperty('--fsh-aux-bottom', (h - (fr.y + fr.h)) + 'px');

    for (const p of particles) p.active = false;
    activeParticles = 0;
  }

  // ───────────────────────── Expression Offsets (Live Tracking) ─────────────────────────
  function applyExpressionOffsets(dt) {
    const EMA_ALPHA = Math.min(1, dt * 14);
    for (const k in targetBlendshapes) {
      const cur = smoothedBlendshapes[k] || 0;
      smoothedBlendshapes[k] = cur + (targetBlendshapes[k] - cur) * EMA_ALPHA;
    }

    const jawOpen = smoothedBlendshapes['jawOpen'] || 0;
    const mouthSmileL = smoothedBlendshapes['mouthSmileLeft'] || 0;
    const mouthSmileR = smoothedBlendshapes['mouthSmileRight'] || 0;
    const mouthPucker = smoothedBlendshapes['mouthPucker'] || 0;
    const browInnerUp = smoothedBlendshapes['browInnerUp'] || 0;
    const browOuterUpL = smoothedBlendshapes['browOuterUpLeft'] || 0;
    const browOuterUpR = smoothedBlendshapes['browOuterUpRight'] || 0;
    const browDownL = smoothedBlendshapes['browDownLeft'] || 0;
    const browDownR = smoothedBlendshapes['browDownRight'] || 0;
    const eyeBlinkL = smoothedBlendshapes['eyeBlinkLeft'] || 0;
    const eyeBlinkR = smoothedBlendshapes['eyeBlinkRight'] || 0;

    for (let i = 0; i < nP; i++) {
      let dx = 0, dy = 0;
      const g = groupA[i];
      if (g) {
        const nx = nxA[i], ny = nyA[i];
        if (g === 'jaw') {
          const weight = clamp01((ny - 0.64) / 0.12);
          dy += jawOpen * 0.045 * S * weight;
        } else if (g === 'mouth') {
          if (ny > 0.62) {
            dy += jawOpen * 0.034 * S;
          } else {
            dy -= jawOpen * 0.008 * S;
          }
          if (nx < 0.46) {
            dx -= mouthSmileL * 0.024 * S;
            dy -= mouthSmileL * 0.016 * S;
          } else if (nx > 0.54) {
            dx += mouthSmileR * 0.024 * S;
            dy -= mouthSmileR * 0.016 * S;
          } else {
            dy -= (mouthSmileL + mouthSmileR) * 0.5 * 0.008 * S;
          }
          if (mouthPucker > 0.05) {
            dx += (0.5 - nx) * mouthPucker * 0.02 * S;
          }
        } else if (g === 'browL') {
          const lift = (browInnerUp * 0.7 + browOuterUpL * 0.6 - browDownL * 0.5) * 0.022 * S;
          dy -= lift;
        } else if (g === 'browR') {
          const lift = (browInnerUp * 0.7 + browOuterUpR * 0.6 - browDownR * 0.5) * 0.022 * S;
          dy -= lift;
        } else if (g === 'eyeL') {
          if (ny < 0.40) dy += eyeBlinkL * 0.012 * S;
          else dy -= eyeBlinkL * 0.006 * S;
        } else if (g === 'eyeR') {
          if (ny < 0.40) dy += eyeBlinkR * 0.012 * S;
          else dy -= eyeBlinkR * 0.006 * S;
        }
      }
      px[i] = basePx[i] + dx;
      py[i] = basePy[i] + dy;
    }
  }

  function updateHands(dt) {
    const EMA_HAND = Math.min(1, dt * 18);
    if (!rawHands || !rawHands.length) {
      if (smoothedHands.length) smoothedHands = [];
      return;
    }
    if (!smoothedHands.length || smoothedHands.length !== rawHands.length) {
      smoothedHands = rawHands.map(hand => hand.map(pt => ({ ...pt })));
    } else {
      for (let h = 0; h < rawHands.length; h++) {
        const targetHand = rawHands[h];
        const sHand = smoothedHands[h];
        if (!sHand || sHand.length !== targetHand.length) {
          smoothedHands[h] = targetHand.map(pt => ({ ...pt }));
          continue;
        }
        for (let j = 0; j < targetHand.length; j++) {
          sHand[j].x += (targetHand[j].x - sHand[j].x) * EMA_HAND;
          sHand[j].y += (targetHand[j].y - sHand[j].y) * EMA_HAND;
          sHand[j].z += (targetHand[j].z - sHand[j].z) * EMA_HAND;
        }
      }
    }
  }

  // ───────────────────────── State machine ─────────────────────────
  function setState(next) {
    if (next === state) return;
    const prev = state;
    state = next; stateTime = 0;
    root.classList.remove('fsh-root--idle', 'fsh-root--scanning', 'fsh-root--complete');
    root.classList.add('fsh-root--' + next.toLowerCase());
    if (next === STATES.SCANNING) {
      scanProgress = 0; scanPhase = PH_COARSE; phaseP = 0; scanNy = prevScanNy = SCAN_Y0; lmHit.fill(-1e9);
    } else if (next === STATES.COMPLETE) {
      scanNy = SCAN_Y1; scanProgress = 1; phaseP = 1;
      for (let i = 0; i < 10; i++) spawnSpark(landmarks[(Math.random() * landmarks.length) | 0], 1.6);
    }
    hudApply();
    if (typeof opts.onStateChange === 'function') { try { opts.onStateChange(next, prev); } catch (e) { console.error(e); } }
  }

  // ───────────────────────── HUD ─────────────────────────
  function hset(k, v) { if (hudCache[k] !== v) { hudCache[k] = v; hud.fields[k].textContent = v; } }
  function hudAux() {
    let hits = 0;
    for (let k = 0; k < hud.auxRows.length; k++) {
      const row = hud.auxRows[k]; let s, hit = false;
      if (state === STATES.IDLE) s = k === auxPing ? 'PING' : '--';
      else if (state === STATES.COMPLETE) { s = 'OK'; hit = true; }
      else if (lmHit[k] > -1e8) { s = 'LOCK'; hit = true; }
      else s = scanPhase === PH_DETAIL ? 'WAIT' : 'SRCH';
      if (hit) hits++;
      if (row.txt !== s) { row.txt = s; row.s.textContent = s; }
      if (row.hit !== hit) { row.hit = hit; row.el.classList.toggle('fsh-hud__aux-line--hit', hit); }
    }
    if (hits !== auxHits) { auxHits = hits; hud.auxHead.textContent = `LANDMARKS ${String(hits).padStart(2, '0')}/${String(hud.auxRows.length).padStart(2, '0')}`; }
  }
  function hudApply() {
    if (state === STATES.IDLE) {
      hset('mode', 'STANDBY'); hset('identity', 'AWAITING'); hset('match', '--.--%'); hset('depth', '--.--%');
      hset('conf', '--.--%'); hset('nodes', '----'); hset('status', 'IDLE');
    } else if (state === STATES.SCANNING) {
      hset('mode', 'DETECTING'); hset('identity', 'SEARCHING'); hset('status', 'ACQUIRING');
    } else {
      hset('mode', 'COMPLETE'); hset('identity', 'VERIFIED'); hset('match', '99.82%'); hset('depth', '98.44%');
      hset('conf', '99.97%'); hset('nodes', '1842'); hset('status', 'ONLINE');
    }
    hudAux();
  }
  function hudTick() {
    if (state === STATES.SCANNING) {
      hudDots = (hudDots + 1) % 4;
      const dots = '.'.repeat(hudDots), p = phaseP;
      if (scanPhase === PH_COARSE) {
        hset('mode', 'DETECTING' + dots); hset('identity', 'SEARCHING'); hset('status', 'ACQUIRING');
        hset('match', fmtPct(rand(4, 12))); hset('depth', fmtPct(lerp(0, 22, p) + rand(-1, 1))); hset('conf', '--.--%');
        hset('nodes', pad4(Math.round(210 * p)));
      } else if (scanPhase === PH_PAUSE) {
        hset('mode', 'TARGET LOCKED'); hset('identity', 'LOCKED'); hset('status', 'ALIGNING');
      } else {
        hset('mode', 'ANALYZING' + dots); hset('identity', 'SCANNING'); hset('status', 'PROCESSING');
        hset('match', fmtPct(lerp(38, 87.42, p) + rand(-1.4, 1.4)));
        hset('depth', fmtPct(lerp(22, 94.18, p) + rand(-1.1, 1.1)));
        hset('conf', fmtPct(lerp(51, 98.73, p) + rand(-0.8, 0.8)));
        hset('nodes', pad4(210 + Math.round(1632 * p)));
      }
    } else if (state === STATES.IDLE) {
      hset('mode', (time % 1.2) < 0.6 ? 'STANDBY_' : 'STANDBY');
      if (time - auxT > 1.6) { auxT = time; auxPing = (Math.random() * hud.auxRows.length) | 0; }
    }
    hudAux();
  }

  // ───────────────────────── Particles ─────────────────────────
  function getFreeParticle() {
    if (activeParticles >= opts.maxParticles) return null;
    for (const p of particles) if (!p.active) { p.active = true; activeParticles++; return p; }
    return null;
  }
  function spawnAmbient() {
    const p = getFreeParticle(); if (!p) return;
    const i = contourIdx[(Math.random() * contourIdx.length) | 0];
    p.spark = false; p.x = px[i] + rand(-4, 4); p.y = py[i] + rand(-4, 4);
    let dx = p.x - faceCx, dy = p.y - faceCy; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    const sp = rand(5, 16) * scale;
    p.vx = dx * sp + rand(-4, 4) * scale; p.vy = dy * sp + rand(-4, 4) * scale;
    p.age = 0; p.life = rand(2.5, 5); p.size = rand(1, 1.8);
  }
  function spawnSpark(i, mult = 1) {
    const p = getFreeParticle(); if (!p) return;
    p.spark = true; p.x = px[i]; p.y = py[i];
    const a = rand(0, TAU), sp = rand(18, 48) * scale * mult;
    p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp + 12 * scale;
    p.age = 0; p.life = rand(0.4, 0.9); p.size = rand(1, 1.6);
  }
  function updateParticles(dt) {
    const drag = 1 - 0.7 * dt;
    for (const p of particles) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) { p.active = false; activeParticles--; continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= drag; p.vy *= drag;
    }
    const target = lowQuality ? (opts.idleParticles >> 1) : opts.idleParticles;
    if (activeParticles < target && Math.random() < dt * 7) spawnAmbient();
  }

  // ───────────────────────── Update ─────────────────────────
  function update(dt) {
    applyExpressionOffsets(dt);
    updateHands(dt);

    breath = 0.5 + 0.5 * Math.sin(time * TAU / BREATH_PERIOD);
    for (let i = 0; i < nP; i++) if (nFlick[i] > 0) nFlick[i] -= dt;
    for (let e = 0; e < nE; e++) if (eFlick[e] > 0) eFlick[e] -= dt;
    if (Math.random() < dt * 3) nFlick[(Math.random() * nP) | 0] = rand(0.05, 0.12);
    if (Math.random() < dt * 2) eFlick[(Math.random() * nE) | 0] = rand(0.05, 0.1);

    if (state === STATES.SCANNING) {
      const tms = stateTime * 1000, c = opts.coarseDuration, ps = opts.pauseDuration, d = opts.scanDuration;
      scanProgress = clamp01(tms / (c + ps + d));
      prevScanNy = scanNy;
      if (tms < c) {                                                        // DETECT
        scanPhase = PH_COARSE; phaseP = tms / c;
        scanNy = lerp(SCAN_Y0, SCAN_Y1, 1 - (1 - phaseP) ** 2);
      } else if (tms < c + ps) {                                            // LOCK / rewind
        scanPhase = PH_PAUSE; phaseP = (tms - c) / ps;
        scanNy = lerp(SCAN_Y1, SCAN_Y0, easeInOutSine(phaseP));
      } else {                                                              // ANALYSE
        if (scanPhase !== PH_DETAIL) prevScanNy = SCAN_Y0;
        scanPhase = PH_DETAIL; phaseP = clamp01((tms - c - ps) / d);
        scanNy = lerp(SCAN_Y0, SCAN_Y1, easeOutCubic(phaseP));
        for (let i = 0; i < nP; i++) {
          const ny = nyA[i], t = typeA[i];
          if (ny > prevScanNy && ny <= scanNy && t >= T_FEATURE && t !== T_DUST && Math.random() < 0.3) spawnSpark(i);
        }
        for (let k = 0; k < landmarks.length; k++) { const ny = nyA[landmarks[k]]; if (ny > prevScanNy && ny <= scanNy) lmHit[k] = time; }
        if (phaseP >= 1) setState(STATES.COMPLETE);
      }
      if (scanPhase !== PH_PAUSE) {
        const lineY = boxY + scanNy * S;
        for (const p of particles) if (p.active && Math.abs(p.y - lineY) < 6 * scale) { p.vy += 10 * scale; p.vx += rand(-14, 14) * scale; }
      }
    } else if (state === STATES.COMPLETE) {
      if (stateTime * 1000 >= opts.completeDuration) setState(STATES.IDLE);
    }

    // slice jitter scheduling
    if (jitterT > 0) jitterT -= dt;
    else if (time >= jitterNext) {
      jitterT = rand(0.035, 0.06);
      jitterY = boxY + rand(0.08, 0.78) * S; jitterH = rand(5, 12) * scale;
      jitterX = rand(2.5, 4.5) * scale * (Math.random() < 0.5 ? -1 : 1);
      jitterNext = time + jitterT + (state === STATES.SCANNING ? rand(1.2, 2.4) : rand(4, 7));
    }

    // sparkline (30 Hz ring buffer)
    sparkAcc += dt;
    if (sparkAcc >= 1 / 30) {
      sparkAcc -= 1 / 30;
      let v = 0.10 + 0.06 * breath + Math.random() * 0.05;
      if (state === STATES.SCANNING && scanPhase !== PH_PAUSE) {
        const bin = clamp((scanNy * rowDensity.length) | 0, 0, rowDensity.length - 1);
        v += rowDensity[bin] * (scanPhase === PH_DETAIL ? 0.75 : 0.35) + Math.random() * 0.12;
      } else if (state === STATES.COMPLETE) v += Math.exp(-stateTime * 3) * 0.8;
      spark[sparkHead] = clamp01(v); sparkHead = (sparkHead + 1) % SPARK_N;
    }

    updateParticles(dt);
    hudAcc += dt;
    if (hudAcc >= 1 / opts.hudRate) { hudAcc = 0; hudTick(); }
  }

  // ───────────────────────── Draw ─────────────────────────
  function draw() {
    ctx.clearRect(0, 0, width, height);
    ctx.font = font; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const scanning = state === STATES.SCANNING, complete = state === STATES.COMPLETE;
    const flash = complete ? Math.exp(-stateTime * 2.6) : 0;
    const boost = flash * 0.55;
    const scanMode = scanning ? (scanPhase === PH_DETAIL ? 2 : scanPhase === PH_COARSE ? 1 : 0) : 0;
    const lineAlpha = scanning ? (scanPhase === PH_PAUSE ? 0.35 : 1) : complete ? clamp01(1 - stateTime / 0.35) : 0;
    const showBand = lineAlpha > 0 && (scanMode === 2 || complete);

    drawFrame(flash * 0.5);
    if (!compact) drawSpark();
    if (scanning) drawGuides(clamp01(stateTime / 0.4)); else if (complete) drawGuides(clamp01(1 - stateTime / 0.5));
    if (scanning || complete) drawRail(complete ? clamp01(1 - (stateTime - 0.8) / 0.6) : 1);
    if (showBand) drawScanBand(lineAlpha);

    computeDust();
    drawDust(0, boost);                       // back plane

    const sc = 1 + 0.0035 * Math.sin(time * 0.9);   // planar pulse only — not 3D

    ctx.save();
    ctx.translate(faceCx, faceCy); ctx.scale(sc, sc); ctx.translate(-faceCx, -faceCy);
    drawSurface(boost);
    drawPupilGlow(boost, scanMode);
    drawEdges(boost, scanMode);
    drawChromatic();
    drawNodes(boost, scanMode);
    drawHands();                              // Draw live hand skeleton immediately after drawNodes
    drawScanlines();
    if (scanning || complete) drawLandmarkBrackets(flash);
    if (complete) drawCompletion();
    ctx.restore();

    applySliceJitter();
    drawDust(1, boost);                       // front plane
    drawParticles();
    if (lineAlpha > 0) drawScanLine(lineAlpha);
  }

  function drawSurface(boost) {
    if (!surfacePath) return;
    ctx.save();
    ctx.globalAlpha = clamp01(0.8 + 0.2 * breath + boost * 0.6);
    ctx.fillStyle = surfaceGradV; ctx.fill(surfacePath);
    if (!lowQuality) { ctx.fillStyle = surfaceGradR; ctx.fill(surfacePath); }
    ctx.restore();
  }

  function drawPupilGlow(boost, scanMode) {
    if (lowQuality) return;
    const driftX = Math.sin(time * MOTION.pupilDriftSpeed) * MOTION.pupilDriftX * scale;
    const driftY = Math.cos(time * MOTION.pupilDriftSpeed * 0.73) * MOTION.pupilDriftY * scale;
    ctx.fillStyle = pupilGrad;
    for (let k = 0; k < 2; k++) {
      const i = pupils[k];
      let a = 0.50 + 0.20 * Math.sin(time * 1.3 + k * 0.45) + boost * 0.6;
      if (scanMode === 2) a += scanBoost(nyA[i], scanNy) * 0.5;
      ctx.save();
      ctx.globalAlpha = clamp01(a); ctx.translate(px[i] + driftX, py[i] + driftY);
      ctx.fillRect(-pupilR, -pupilR, pupilR * 2, pupilR * 2);
      ctx.restore();
    }
  }

  function drawEdges(boost, scanMode) {
    for (let c = 0; c < nC; c++) eCount[c].fill(0);
    const base = 0.58 + 0.10 * breath, sy = scanNy;
    for (let e = 0; e < nE; e++) {
      const c = eClass[e]; if (c === DUST_CLASS) continue;
      const edgeWave = 0.5 + 0.5 * Math.sin(time * MOTION.faceWaveSpeed - emy[e] * MOTION.faceWaveTravel);
      let I = base + edgeWave * 0.12 + boost;
      if (scanMode === 2) I += scanBoost(emy[e], sy) * 0.95;
      else if (scanMode === 1 && c === 0) I += scanBoost(emy[e], sy) * 0.7;
      if (eFlick[e] > 0) I *= 0.3;
      I *= eFade[e];
      const b = bucketOf(I);
      eBuckets[c][b][eCount[c][b]++] = e;
    }
    for (let c = 0; c < nC; c++) {
      const st = EDGE_STYLE[c];
      for (let b = 0; b < NB; b++) {
        const n = eCount[c][b]; if (!n) continue;
        const list = eBuckets[c][b];
        ctx.beginPath();
        for (let k = 0; k < n; k++) { const e = list[k]; ctx.moveTo(px[ea[e]], py[ea[e]]); ctx.lineTo(px[eb[e]], py[eb[e]]); }
        if (!lowQuality && st.gw > 0 && b >= 1) { ctx.lineWidth = st.gw * scale; ctx.strokeStyle = PAL.edgeGlow[c][b]; ctx.stroke(); }
        ctx.lineWidth = st.w * scale; ctx.strokeStyle = PAL.edgeCore[c][b]; ctx.stroke();
      }
    }
  }

  function drawNodes(boost, scanMode) {
    nCount.fill(0);
    const base = 0.55 + 0.15 * breath, sy = scanNy;
    for (let i = 0; i < nP; i++) {
      const t = typeA[i];
      if (t === T_DUST) continue;
      const travelPhase = time * MOTION.faceWaveSpeed - nyA[i] * MOTION.faceWaveTravel;
      const pulse = 0.5 + 0.5 * Math.sin(travelPhase + phase[i] * 0.22);
      let I = NODE_ALPHA[t] * base * (0.8 + 0.4 * pulse) + boost;
      if (scanMode === 2) I += scanBoost(nyA[i], sy);
      else if (scanMode === 1 && t === T_CONTOUR) I += scanBoost(nyA[i], sy) * 0.7;
      if (nFlick[i] > 0) I *= 0.35;
      I *= nFade[i];
      nRad[i] = NODE_RADIUS[t] * scale * (0.85 + 0.3 * pulse + Math.min(I, 1.6) * 0.15);
      const b = bucketOf(I);
      nBuckets[b][nCount[b]++] = i;
    }
    if (!lowQuality) {
      for (let b = 2; b < NB; b++) {
        const n = nCount[b]; if (!n) continue;
        ctx.beginPath();
        for (let k = 0; k < n; k++) { const i = nBuckets[b][k], r = nRad[i] * 2.6; ctx.moveTo(px[i] + r, py[i]); ctx.arc(px[i], py[i], r, 0, TAU); }
        ctx.fillStyle = PAL.nodeGlow[b]; ctx.fill();
      }
    }
    for (let b = 0; b < NB; b++) {
      const n = nCount[b]; if (!n) continue;
      ctx.beginPath();
      for (let k = 0; k < n; k++) { const i = nBuckets[b][k], r = nRad[i]; ctx.moveTo(px[i] + r, py[i]); ctx.arc(px[i], py[i], r, 0, TAU); }
      ctx.fillStyle = PAL.nodeCore[b]; ctx.fill();
    }
    ctx.beginPath();
    const r = 0.9 * scale;
    for (let k = 0; k < landmarks.length; k++) { const i = landmarks[k]; ctx.moveTo(px[i] + r, py[i]); ctx.arc(px[i], py[i], r, 0, TAU); }
    ctx.fillStyle = rgba(LM_DOT, 0.6 + 0.35 * breath + boost); ctx.fill();
  }

  function drawHands() {
    if (!smoothedHands || !smoothedHands.length) return;
    ctx.save();
    for (const hand of smoothedHands) {
      // Skeletons
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        if (!hand[a] || !hand[b]) continue;
        const ax = (1 - hand[a].x) * width;
        const ay = hand[a].y * height;
        const bx = (1 - hand[b].x) * width;
        const by = hand[b].y * height;
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
      }
      if (!lowQuality) {
        ctx.lineWidth = 4 * scale;
        ctx.strokeStyle = rgba(BLUE, 0.35);
        ctx.stroke();
      }
      ctx.lineWidth = 1.6 * scale;
      ctx.strokeStyle = rgba(CYAN, 0.85);
      ctx.stroke();

      // 21 Joint nodes
      for (let j = 0; j < hand.length; j++) {
        const pt = hand[j];
        const hx = (1 - pt.x) * width;
        const hy = pt.y * height;
        const isTip = j === 4 || j === 8 || j === 12 || j === 16 || j === 20;
        const r = (isTip ? 3.0 : 1.9) * scale;

        ctx.beginPath();
        ctx.arc(hx, hy, r * 2.2, 0, TAU);
        ctx.fillStyle = rgba(isTip ? ACCENT : BLUE, 0.35);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(hx, hy, r, 0, TAU);
        ctx.fillStyle = isTip ? rgba(ACCENT, 0.95) : rgba(WHITE, 0.9);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawChromatic() {
    if (lowQuality || !contourEdges.length) return;
    const off = (0.45 + 0.35 * Math.sin(time * 2.1) + 0.2 * Math.sin(time * 5.3)) * scale;
    ctx.lineWidth = 1 * scale;
    ctx.beginPath();
    for (let k = 0; k < contourEdges.length; k++) { const e = contourEdges[k]; ctx.moveTo(px[ea[e]] - off, py[ea[e]]); ctx.lineTo(px[eb[e]] - off, py[eb[e]]); }
    ctx.strokeStyle = rgba(BLUE, HOLO.chromaBlue); ctx.stroke();
    ctx.beginPath();
    for (let k = 0; k < contourEdges.length; k++) { const e = contourEdges[k]; ctx.moveTo(px[ea[e]] + off, py[ea[e]]); ctx.lineTo(px[eb[e]] + off, py[eb[e]]); }
    ctx.strokeStyle = rgba(WHITE, HOLO.chromaWhite); ctx.stroke();
  }

  function drawScanlines() {
    if (lowQuality || !scanPattern || !surfacePath || !scanPattern.setTransform) return;
    patM.f = (time * HOLO.scanlineSpeed) % HOLO.scanlinePeriod;
    scanPattern.setTransform(patM);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = scanPattern; ctx.fill(surfacePath);
    ctx.restore();
  }

  function applySliceJitter() {
    if (jitterT <= 0 || !sliceCanvas) return;
    const sx = Math.round(fr.x * dpr), sy = Math.round(jitterY * dpr);
    const sw = Math.round(fr.w * dpr), sh = Math.round(jitterH * dpr);
    if (sw <= 0 || sh <= 0) return;
    sliceCtx.clearRect(0, 0, sliceCanvas.width, sliceCanvas.height);
    sliceCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    ctx.clearRect(fr.x, jitterY, fr.w, jitterH);
    ctx.drawImage(sliceCanvas, 0, 0, sw, sh, fr.x + jitterX, jitterY, fr.w, jitterH);
  }

  function computeDust() {
    for (let L = 0; L < 2; L++) {
      const idx = dustIdx[L], amp = (L ? 2.4 : 1.1) * scale, spd = L ? 0.5 : 0.3;
      for (let k = 0; k < idx.length; k++) {
        const i = idx[k];
        dX[i] = px[i] + Math.sin(time * spd + phase[i]) * amp;
        dY[i] = py[i] + Math.cos(time * spd * 0.8 + phase[i] * 1.7) * amp * 0.6;
      }
    }
  }
  function drawDust(L, boost) {
    const idx = dustIdx[L], eds = dustEdge[L];
    if (!idx.length) return;
    const a = clamp01((L ? 0.6 : 0.3) * (0.8 + 0.2 * breath) + boost * 0.4);
    if (eds.length) {
      ctx.beginPath();
      for (let k = 0; k < eds.length; k++) { const e = eds[k]; ctx.moveTo(dX[ea[e]], dY[ea[e]]); ctx.lineTo(dX[eb[e]], dY[eb[e]]); }
      ctx.lineWidth = 0.7 * scale; ctx.strokeStyle = rgba(BLUE, a * 0.55); ctx.stroke();
    }
    const r = NODE_RADIUS[T_DUST] * scale * (L ? 1.15 : 0.8);
    ctx.beginPath();
    for (let k = 0; k < idx.length; k++) { const i = idx[k]; ctx.moveTo(dX[i] + r, dY[i]); ctx.arc(dX[i], dY[i], r, 0, TAU); }
    ctx.fillStyle = rgba(L ? DUST_FRONT : BLUE, a); ctx.fill();
  }

  function drawParticles() {
    for (const p of particles) {
      if (!p.active) continue;
      const a = Math.sin(Math.PI * p.age / p.life) * (p.spark ? 1 : 0.7);
      const s = p.size * scale;
      ctx.fillStyle = PAL.particle[clamp((a * 8) | 0, 0, 7)];
      ctx.fillRect(p.x - s * 0.5, p.y - s * 0.5, s, s);
    }
  }

  // ───────────────────────── Curved Tension Frame (Design Ref) ─────────────────────────
  function drawFrame(extra) {
    const a = 0.5 + 0.15 * breath + extra;
    const margin = 10 * scale;
    const x0 = margin, y0 = margin;
    const x1 = width - margin, y1 = height - margin;
    const w = x1 - x0, h = y1 - y0;
    const cx = (x0 + x1) / 2;
    const r = Math.min(22 * scale, Math.min(w, h) * 0.1);
    const bowY = Math.min(14 * scale, h * 0.045);
    const pinchX = Math.min(15 * scale, w * 0.045);

    ctx.save();
    ctx.beginPath();
    // Start top-left
    ctx.moveTo(x0 + r, y0);
    // Top edge: shallow outward-bowing arc
    ctx.bezierCurveTo(x0 + w * 0.28, y0 - bowY, x0 + w * 0.72, y0 - bowY, x1 - r, y0);
    // Top-right corner
    ctx.bezierCurveTo(x1, y0, x1, y0, x1, y0 + r);
    // Right edge: pinches inward slightly at vertical mid-height (hourglass/wave silhouette)
    ctx.bezierCurveTo(x1 - pinchX, y0 + h * 0.32, x1 - pinchX, y0 + h * 0.68, x1, y1 - r);
    // Bottom-right corner
    ctx.bezierCurveTo(x1, y1, x1, y1, x1 - r, y1);
    // Bottom edge: shallow outward-bowing arc
    ctx.bezierCurveTo(x0 + w * 0.72, y1 + bowY, x0 + w * 0.28, y1 + bowY, x0 + r, y1);
    // Bottom-left corner
    ctx.bezierCurveTo(x0, y1, x0, y1, x0, y1 - r);
    // Left edge: pinches inward slightly at vertical mid-height
    ctx.bezierCurveTo(x0 + pinchX, y0 + h * 0.68, x0 + pinchX, y0 + h * 0.32, x0, y0 + r);
    // Top-left corner close
    ctx.bezierCurveTo(x0, y0, x0, y0, x0 + r, y0);
    ctx.closePath();

    // Semi-transparent dark panel background
    ctx.fillStyle = 'rgba(2, 6, 15, 0.82)';
    ctx.fill();

    // Double-stroke glow
    if (!lowQuality) {
      ctx.lineWidth = 6 * scale;
      ctx.strokeStyle = rgba(BLUE, a * 0.22);
      ctx.stroke();
    }
    ctx.lineWidth = 1.8 * scale;
    ctx.strokeStyle = rgba(ACCENT, a * 0.88);
    ctx.stroke();

    // Thin vertical divider line down panel's center (support pole from reference photo)
    ctx.beginPath();
    ctx.moveTo(cx, y0 - bowY);
    ctx.lineTo(cx, y1 + bowY);
    if (!lowQuality) {
      ctx.lineWidth = 3.5 * scale;
      ctx.strokeStyle = rgba(BLUE, a * 0.18);
      ctx.stroke();
    }
    ctx.lineWidth = 1.2 * scale;
    ctx.strokeStyle = rgba(CYAN, a * 0.75);
    ctx.stroke();

    // Tension support pole caps
    ctx.fillStyle = rgba(ACCENT, a * 0.85);
    ctx.fillRect(cx - 3.5 * scale, y0 - bowY, 7 * scale, 3 * scale);
    ctx.fillRect(cx - 3.5 * scale, y1 + bowY - 3 * scale, 7 * scale, 3 * scale);

    // Inner subtle corner reticles
    const L = 12 * scale;
    ctx.lineWidth = 1 * scale;
    ctx.strokeStyle = rgba(CYAN, a * 0.55);
    ctx.beginPath();
    ctx.moveTo(x0 + 14 * scale, y0 + 14 * scale + L);
    ctx.lineTo(x0 + 14 * scale, y0 + 14 * scale);
    ctx.lineTo(x0 + 14 * scale + L, y0 + 14 * scale);
    ctx.moveTo(x1 - 14 * scale - L, y0 + 14 * scale);
    ctx.lineTo(x1 - 14 * scale, y0 + 14 * scale);
    ctx.lineTo(x1 - 14 * scale, y0 + 14 * scale + L);
    ctx.stroke();

    // Labels
    ctx.fillStyle = rgba(CYAN, a * 0.65);
    ctx.font = font;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText('SCN-01 // TENSION_HUD', x0 + 14 * scale, y0 + 12 * scale);
    ctx.textAlign = 'right';
    ctx.fillText(state === STATES.SCANNING ? (scanProgress * 100).toFixed(1) + '%' : state === STATES.COMPLETE ? '100.0%' : 'ONLINE', x1 - 14 * scale, y0 + 12 * scale);

    ctx.restore();
  }

  function drawSpark() {
    const x0 = fr.x, w = fr.w * 0.44, hgt = 16 * scale, y0 = fr.y + fr.h + 20 * scale + hgt;
    if (y0 + 16 * scale > height) return;
    const a = 0.5 + 0.15 * breath;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + w, y0);
    ctx.lineWidth = 1; ctx.strokeStyle = rgba(CYAN, a * 0.25); ctx.stroke();
    ctx.beginPath();
    for (let k = 0; k < SPARK_N; k++) {
      const v = spark[(sparkHead + k) % SPARK_N], x = x0 + w * k / (SPARK_N - 1), y = y0 - v * hgt;
      k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.lineWidth = 1 * scale; ctx.strokeStyle = rgba(CYAN, a * 0.85); ctx.stroke();
    const lv = spark[(sparkHead + SPARK_N - 1) % SPARK_N];
    ctx.fillStyle = rgba(WHITE, a); ctx.fillRect(x0 + w - 1.5 * scale, y0 - lv * hgt - 1.5 * scale, 3 * scale, 3 * scale);
    ctx.fillStyle = rgba(CYAN, a * 0.6); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('SIG ' + (lv * 100).toFixed(0).padStart(3, '0'), x0, y0 + 4 * scale);
  }

  function drawGuides(alpha) {
    if (alpha <= 0) return;
    const y0 = fr.y, y1 = fr.y + fr.h, x0 = fr.x, x1 = fr.x + fr.w, ey = boxY + IRIS.cy * S;
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.setLineDash([3 * scale, 5 * scale]); ctx.lineWidth = 1; ctx.strokeStyle = rgba(CYAN, 0.16);
    ctx.beginPath(); ctx.moveTo(faceCx, y0); ctx.lineTo(faceCx, y1); ctx.moveTo(x0, ey); ctx.lineTo(x1, ey); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = rgba(CYAN, 0.4); ctx.textBaseline = 'bottom'; ctx.textAlign = 'left';
    ctx.fillText('EYE ' + IRIS.cy.toFixed(3), x0 + 4 * scale, ey - 2);
    ctx.restore();
  }

  function drawRail(alpha) {
    if (alpha <= 0) return;
    const x = fr.x - 14 * scale, y0 = fr.y, y1 = fr.y + fr.h;
    const detail = state !== STATES.SCANNING || scanPhase === PH_DETAIL;
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1);
    ctx.lineWidth = 1; ctx.strokeStyle = rgba(CYAN, 0.18); ctx.stroke();
    ctx.beginPath();
    for (let k = 0; k <= 10; k++) { const yy = y0 + fr.h * k / 10, len = (k % 5 ? 3 : 6) * scale; ctx.moveTo(x - len, yy); ctx.lineTo(x, yy); }
    ctx.strokeStyle = rgba(CYAN, 0.35); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + fr.h * scanProgress);
    ctx.lineWidth = 2 * scale; ctx.strokeStyle = rgba(detail ? ACCENT : BLUE, 0.75); ctx.stroke();
    const hy = boxY + scanNy * S;
    if (hy >= y0 && hy <= y1) { ctx.fillStyle = rgba(WHITE, 0.9); ctx.fillRect(x - 2 * scale, hy - 1, 4 * scale, 2); }
    ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillStyle = rgba(CYAN, 0.6);
    ctx.fillText((scanProgress * 100).toFixed(0).padStart(3, '0'), x - 8 * scale, y0);
    ctx.restore();
  }

  function drawScanBand(alpha) {
    const y = boxY + scanNy * S;
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(fr.x, y);
    ctx.fillStyle = scanGrad; ctx.fillRect(0, -bandH, fr.w, bandH);
    ctx.restore();
  }

  function drawScanLine(alpha) {
    const y = boxY + scanNy * S, x0 = fr.x, x1 = fr.x + fr.w;
    const xa = boxX + 0.04 * S, xb = boxX + 0.96 * S;
    const detail = state !== STATES.SCANNING || scanPhase === PH_DETAIL;
    ctx.save(); ctx.globalAlpha = alpha;

    if (detail) {
      ctx.setLineDash([2 * scale, 6 * scale]);
      ctx.lineWidth = 1; ctx.strokeStyle = rgba(ACCENT, 0.28);
      ctx.beginPath();
      ctx.moveTo(x0, y - 18 * scale); ctx.lineTo(x1, y - 18 * scale);
      ctx.moveTo(x0, y + 18 * scale); ctx.lineTo(x1, y + 18 * scale);
      ctx.stroke(); ctx.setLineDash([]);
    }

    // faint carrier
    ctx.beginPath(); ctx.moveTo(xa, y); ctx.lineTo(xb, y);
    ctx.lineWidth = 1; ctx.strokeStyle = rgba(ACCENT, 0.22); ctx.stroke();

    // bright core clipped to head
    if (surfacePath) {
      ctx.save(); ctx.clip(surfacePath);
      ctx.beginPath(); ctx.moveTo(xa, y); ctx.lineTo(xb, y);
      if (detail) {
        if (!lowQuality) { ctx.lineWidth = 7 * scale; ctx.strokeStyle = rgba(ACCENT, 0.2); ctx.stroke(); }
        ctx.lineWidth = 2.4 * scale; ctx.strokeStyle = rgba(ACCENT, 0.8); ctx.stroke();
      } else {
        ctx.lineWidth = 1.4 * scale; ctx.strokeStyle = rgba(ACCENT, 0.7); ctx.stroke();
      }
      ctx.lineWidth = 1; ctx.strokeStyle = rgba(WHITE, 0.95); ctx.stroke();
      ctx.restore();
    }

    // ticks + labels
    ctx.beginPath();
    ctx.moveTo(x0 - 6 * scale, y - 4 * scale); ctx.lineTo(x0 - 6 * scale, y + 4 * scale);
    ctx.moveTo(x1 + 6 * scale, y - 4 * scale); ctx.lineTo(x1 + 6 * scale, y + 4 * scale);
    ctx.lineWidth = 1.2 * scale; ctx.strokeStyle = rgba(ACCENT, 0.9); ctx.stroke();
    ctx.fillStyle = rgba(ACCENT, 0.8); ctx.textBaseline = 'middle';
    ctx.textAlign = 'right'; ctx.fillText('Y ' + scanNy.toFixed(3), x0 - 22 * scale, y);
    ctx.textAlign = 'left'; ctx.fillText((detail ? 'ANL ' : 'DET ') + (phaseP * 100).toFixed(0).padStart(3, '0'), x1 + 10 * scale, y);
    ctx.restore();
  }

  function drawLandmarkBrackets(flash) {
    const r = 7 * scale, t = 3 * scale, m = 3 * scale;
    const markFade = state === STATES.COMPLETE ? clamp01(1 - (stateTime - 0.55) / 0.7) : 1;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.lineWidth = 1;
    for (let k = 0; k < landmarks.length; k++) {
      const age = time - lmHit[k];
      if (age < 0) continue;
      const i = landmarks[k], x = px[i], y = py[i];
      if (age < LM_BRACKET_LIFE) {
        const a = 1 - age / LM_BRACKET_LIFE;
        ctx.beginPath();
        ctx.moveTo(x - r, y - r + t); ctx.lineTo(x - r, y - r); ctx.lineTo(x - r + t, y - r);
        ctx.moveTo(x + r - t, y - r); ctx.lineTo(x + r, y - r); ctx.lineTo(x + r, y - r + t);
        ctx.moveTo(x + r, y + r - t); ctx.lineTo(x + r, y + r); ctx.lineTo(x + r - t, y + r);
        ctx.moveTo(x - r + t, y + r); ctx.lineTo(x - r, y + r); ctx.lineTo(x - r, y + r - t);
        ctx.strokeStyle = rgba(WHITE, a * 0.85); ctx.stroke();
        ctx.fillStyle = rgba(ACCENT, a * 0.75);
        ctx.fillText('P' + String(k).padStart(2, '0'), x + r + 4 * scale, y - r);
      }
      const ma = (Math.min(1, age / 0.3) * LM_MARK_ALPHA + flash * 0.6) * markFade;
      if (ma <= 0.01) continue;
      ctx.beginPath();
      ctx.moveTo(x - m, y); ctx.lineTo(x + m, y); ctx.moveTo(x, y - m); ctx.lineTo(x, y + m);
      ctx.strokeStyle = rgba(WHITE, ma); ctx.stroke();
    }
  }

  function drawCompletion() {
    const t = stateTime;
    if (t < 0.8) {
      const p = t / 0.8, R = (0.06 + 0.42 * (1 - (1 - p) ** 3)) * S, a = (1 - p) ** 1.5;
      const cy = boxY + 0.42 * S;
      ctx.beginPath(); ctx.arc(faceCx, cy, R, 0, TAU);
      if (!lowQuality) { ctx.lineWidth = 8 * scale; ctx.strokeStyle = rgba(ACCENT, a * 0.18); ctx.stroke(); }
      ctx.lineWidth = 1.5 * scale; ctx.strokeStyle = rgba(WHITE, a * 0.85); ctx.stroke();
    }
    const ga = t < 0.15 ? t / 0.15 : t < 0.9 ? 1 : clamp01(1 - (t - 0.9) / 0.6);
    if (ga > 0.01 && lmGraph.length) {
      ctx.beginPath();
      for (let k = 0; k < lmGraph.length; k++) { const [a, b] = lmGraph[k]; ctx.moveTo(px[a], py[a]); ctx.lineTo(px[b], py[b]); }
      if (!lowQuality) { ctx.lineWidth = 3 * scale; ctx.strokeStyle = rgba(ACCENT, ga * 0.18); ctx.stroke(); }
      ctx.lineWidth = 1; ctx.strokeStyle = rgba(WHITE, ga * 0.8); ctx.stroke();
    }
  }

  // ───────────────────────── Loop / perf ─────────────────────────
  function tick(ts) {
    if (!running) return;
    rafId = requestAnimationFrame(tick);
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000; lastTs = ts;
    if (dt > 0.1) dt = 0.1;
    time += dt; stateTime += dt;
    emaFrame += (dt - emaFrame) * 0.1;
    currentFps = 1 / Math.max(emaFrame, 1e-3);
    if (time > 2) {
      if (emaFrame > 0.024) slowAccum += dt; else slowAccum = Math.max(0, slowAccum - dt);
      if (!lowQuality && slowAccum > 1.5) { lowQuality = true; root.classList.add('fsh-root--low'); }
    }
    if (needsLayout) layout();
    if (!width || !height) return;
    update(dt);
    draw();
  }
  function start() { if (running || destroyed) return; running = true; lastTs = 0; rafId = requestAnimationFrame(tick); }
  function stop() { running = false; if (rafId) cancelAnimationFrame(rafId); rafId = 0; }

  // ───────────────────────── Init + listeners ─────────────────────────
  hudApply();
  const onVisibility = () => { if (document.hidden) stop(); else start(); };
  document.addEventListener('visibilitychange', onVisibility);
  let ro = null;
  const onResize = () => { needsLayout = true; };
  if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(onResize); ro.observe(container); }
  else window.addEventListener('resize', onResize);
  if (!document.hidden) start();

  // ───────────────────────── Public API ─────────────────────────
  return {
    startScan() { if (destroyed || state !== STATES.IDLE) return false; setState(STATES.SCANNING); return true; },
    reset() { if (destroyed) return; for (const p of particles) if (p.spark && p.active) { p.active = false; activeParticles--; } setState(STATES.IDLE); },
    getState() { return state; },
    getStats() { return { fps: Math.round(currentFps), lowQuality, nodes: nP, edges: nE, particles: activeParticles, dpr }; },
    applyTracking(data) {
      if (destroyed || !data) return;
      if (data.blendshapes) {
        if (Array.isArray(data.blendshapes)) {
          for (const b of data.blendshapes) {
            targetBlendshapes[b.categoryName] = b.score;
          }
        } else if (typeof data.blendshapes === 'object') {
          for (const k in data.blendshapes) {
            const v = data.blendshapes[k];
            targetBlendshapes[k] = typeof v === 'number' ? v : (v && typeof v.score === 'number' ? v.score : 0);
          }
        }
      }
      if (data.handLandmarks) {
        rawHands = data.handLandmarks;
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; stop();
      document.removeEventListener('visibilitychange', onVisibility);
      if (ro) ro.disconnect(); else window.removeEventListener('resize', onResize);
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}

export default mount;