import * as THREE from "three";
import type { Muscle } from "../types.js";
import { sideSign, type Skeleton } from "../rig.js";
import type { V3 } from "../types.js";
import { dot, len, mul, norm, sub } from "../vec.js";

// Procedural anatomical figure. Every body segment is a sculpted tube: a
// cross-section profile (width, depth, offset) along the bone plus muscle
// bulges, built once as a smooth mesh. Muscle groups, clothing and hair are
// painted into vertex colours, so highlighting a muscle is a paint pass, not
// extra geometry. Segments are rigid and overlap at the joints; each frame
// only sets 13 matrices.

import type { Highlight } from "../muscles.js";
export type { Highlight };

export const SKIN = {
  skin: "#9FA6BC",
  shorts: "#262C4A",
  shoe: "#323A63",
  sole: "#E9ECF5",
  hair: "#20263F",
  primary: "#CDF542",
  secondary: "#86A23A",
};

// ── Shape description ─────────────────────────────────────────────────────

/** [y, half-width (side), half-depth (front), centre offset front, centre offset side] */
type Key = [number, number, number, number?, number?];

interface Bump {
  y: number;
  th: number; // degrees, 0 = front, +90 = lateral (+X), 180 = back
  sy: number;
  sth: number;
  amp: number;
}

/** Soft region on the tube surface, in (y, angle) space. */
interface Zone {
  y: [number, number];
  th: [number, number]; // degrees, a0 < a1, may wrap past 180
  f?: number; // feather in metres
}

type Paint = "skin" | "shorts" | "shoe" | "sole" | "hair";

interface TubeSpec {
  keys: Key[];
  /** Length of the rounded end caps beyond the first and last key. */
  cap: [number, number];
  exp?: number; // superellipse exponent: 2 = ellipse, higher = boxier
  bumps?: Bump[];
  muscles?: Partial<Record<Muscle, Zone[]>>;
  paint?: (x: number, y: number, z: number, th: number) => Paint;
  segs?: number;
  ringsPerMetre?: number;
}

const mirror = (b: Bump): Bump[] => [b, { ...b, th: -b.th }];
const both = (z: Zone): Zone[] => [z, { ...z, th: [-z.th[1], -z.th[0]] }];

/** Hermite spline through the keys, flat at the ends. */
function profile(keys: Key[]) {
  const ys = keys.map((k) => k[0]);
  const cols = [1, 2, 3, 4].map((c) => keys.map((k) => k[c] ?? 0));
  const slope = (vals: number[], i: number) =>
    i === 0 || i === vals.length - 1
      ? 0
      : (vals[i + 1] - vals[i - 1]) / (ys[i + 1] - ys[i - 1]);
  return (y: number): number[] => {
    if (y <= ys[0]) return cols.map((c) => c[0]);
    const n = ys.length - 1;
    if (y >= ys[n]) return cols.map((c) => c[n]);
    let i = 0;
    while (y > ys[i + 1]) i++;
    const h = ys[i + 1] - ys[i];
    const t = (y - ys[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return cols.map(
      (c) =>
        (2 * t3 - 3 * t2 + 1) * c[i] +
        (t3 - 2 * t2 + t) * h * slope(c, i) +
        (-2 * t3 + 3 * t2) * c[i + 1] +
        (t3 - t2) * h * slope(c, i + 1),
    );
  };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const wrapDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

function zoneWeight(z: Zone, y: number, th: number) {
  const f = z.f ?? 0.02;
  const wy =
    smooth(z.y[0] - f, z.y[0] + f, y) * (1 - smooth(z.y[1] - f, z.y[1] + f, y));
  if (wy <= 0) return 0;
  const [a0, a1] = z.th;
  let t = th;
  while (t < a0 - 180) t += 360;
  while (t >= a0 + 180) t -= 360;
  const fa = 12;
  return wy * smooth(a0 - fa, a0 + fa, t) * (1 - smooth(a1 - fa, a1 + fa, t));
}

const colour = (hex: string) => new THREE.Color(hex);

/** Builds one sculpted segment as an indexed, smooth-shaded geometry. */
function sculpt(spec: TubeSpec, highlight: Highlight): THREE.BufferGeometry {
  const at = profile(spec.keys);
  const N = spec.segs ?? 36;
  const exp = spec.exp ?? 2;
  const yA = spec.keys[0][0];
  const yB = spec.keys[spec.keys.length - 1][0];

  // Ring stations: hemispherical spacing on the caps, even along the body.
  const rings: { y: number; k: number }[] = [];
  const capRings = 6;
  for (let j = capRings; j >= 1; j--) {
    const phi = (j / capRings) * (Math.PI / 2);
    rings.push({ y: yA - spec.cap[0] * Math.sin(phi), k: Math.cos(phi) });
  }
  const bodyRings = Math.max(
    4,
    Math.round((yB - yA) * (spec.ringsPerMetre ?? 110)),
  );
  for (let j = 0; j <= bodyRings; j++)
    rings.push({ y: yA + ((yB - yA) * j) / bodyRings, k: 1 });
  for (let j = 1; j <= capRings; j++) {
    const phi = (j / capRings) * (Math.PI / 2);
    rings.push({ y: yB + spec.cap[1] * Math.sin(phi), k: Math.cos(phi) });
  }
  // The first and last stations are the poles (radius 0).

  const pos: number[] = [];
  const col: number[] = [];
  const glow: number[] = [];
  const base = {
    skin: colour(SKIN.skin),
    shorts: colour(SKIN.shorts),
    shoe: colour(SKIN.shoe),
    sole: colour(SKIN.sole),
    hair: colour(SKIN.hair),
  };
  const hi1 = colour(SKIN.secondary);
  const hi2 = colour(SKIN.primary);
  const c = new THREE.Color();
  const zones = Object.entries(spec.muscles ?? {}) as [Muscle, Zone[]][];

  const paintVertex = (x: number, y: number, z: number, th: number) => {
    c.copy(base[spec.paint?.(x, y, z, th) ?? "skin"]);
    let w1 = 0;
    let w2 = 0;
    for (const [m, zs] of zones) {
      const l = highlight[m];
      if (!l) continue;
      const w = Math.max(...zs.map((zz) => zoneWeight(zz, y, th)));
      if (l === 2) w2 = Math.max(w2, w);
      else w1 = Math.max(w1, w);
    }
    c.lerp(hi1, w1 * 0.9).lerp(hi2, w2);
    col.push(c.r, c.g, c.b);
    glow.push(w2);
  };

  const ringAt = (y: number, k: number) => {
    const [rx, rz, zc, xc] = at(y);
    for (let s = 0; s < N; s++) {
      const a = (s / N) * Math.PI * 2;
      const th = wrapDeg((a * 180) / Math.PI);
      const sn = Math.sin(a);
      const cs = Math.cos(a);
      let bulge = 1;
      for (const b of spec.bumps ?? []) {
        const dy = (y - b.y) / b.sy;
        const dt = wrapDeg(th - b.th) / b.sth;
        bulge += b.amp * Math.exp(-0.5 * (dy * dy + dt * dt));
      }
      const x = xc + k * bulge * rx * Math.sign(sn) * Math.abs(sn) ** (2 / exp);
      const z = zc + k * bulge * rz * Math.sign(cs) * Math.abs(cs) ** (2 / exp);
      pos.push(x, y, z);
      paintVertex(x, y, z, th);
    }
  };

  // Bottom pole, rings, top pole.
  const first = rings[0];
  const last = rings[rings.length - 1];
  const p0 = at(first.y);
  pos.push(p0[3], first.y, p0[2]);
  paintVertex(p0[3], first.y, p0[2], 0);
  const inner = rings.slice(1, -1);
  for (const r of inner) ringAt(r.y, r.k);
  const p1 = at(last.y);
  pos.push(p1[3], last.y, p1[2]);
  paintVertex(p1[3], last.y, p1[2], 0);

  const idx: number[] = [];
  const R = inner.length;
  const vi = (r: number, s: number) => 1 + r * N + (s % N);
  for (let s = 0; s < N; s++) idx.push(0, vi(0, s + 1), vi(0, s));
  for (let r = 0; r < R - 1; r++)
    for (let s = 0; s < N; s++) {
      const a = vi(r, s);
      const b = vi(r, s + 1);
      const d = vi(r + 1, s);
      const e = vi(r + 1, s + 1);
      idx.push(a, b, d, b, e, d);
    }
  const top = 1 + R * N;
  for (let s = 0; s < N; s++) idx.push(top, vi(R - 1, s), vi(R - 1, s + 1));

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute("glow", new THREE.Float32BufferAttribute(glow, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ── Anatomy ────────────────────────────────────────────────────────────────
// Torso local space: x = figure's left, y = up from the pelvis centre, z = front.
// Limb local space: y = along the bone from the proximal joint, z = front
// (biceps / quads / palm side), x = lateral (away from the body).

const shortsTorso = (_x: number, y: number): Paint =>
  y < 0.07 ? "shorts" : "skin";

const TORSO: TubeSpec = {
  keys: [
    [-0.13, 0.115, 0.075, 0.0],
    [-0.09, 0.148, 0.094, -0.006],
    [-0.03, 0.16, 0.102, -0.014],
    [0.05, 0.148, 0.094, -0.006],
    [0.15, 0.126, 0.085, 0.004],
    [0.25, 0.14, 0.094, 0.012],
    [0.33, 0.162, 0.106, 0.016],
    [0.41, 0.186, 0.112, 0.008],
    [0.465, 0.18, 0.098, -0.008],
    [0.51, 0.118, 0.074, -0.016],
    [0.545, 0.06, 0.052, -0.012],
  ],
  cap: [0.04, 0.03],
  exp: 2.6,
  segs: 48,
  ringsPerMetre: 130,
  bumps: [
    ...mirror({ y: 0.385, th: 27, sy: 0.048, sth: 24, amp: 0.2 }), // pecs
    ...mirror({ y: 0.322, th: 24, sy: 0.016, sth: 26, amp: -0.05 }), // lower pec line
    ...mirror({ y: 0.455, th: 14, sy: 0.012, sth: 22, amp: 0.04 }), // collarbones
    ...mirror({ y: -0.055, th: 148, sy: 0.055, sth: 26, amp: 0.26 }), // glutes
    ...mirror({ y: 0.34, th: 108, sy: 0.07, sth: 18, amp: 0.1 }), // lats
    ...mirror({ y: 0.4, th: 148, sy: 0.045, sth: 20, amp: 0.07 }), // shoulder blades
    ...mirror({ y: 0.49, th: 118, sy: 0.03, sth: 30, amp: 0.1 }), // trapezius slope
    { y: 0.25, th: 180, sy: 0.17, sth: 7, amp: -0.06 }, // spine groove
    { y: 0.19, th: 0, sy: 0.11, sth: 5, amp: -0.035 }, // linea alba
    ...[0.12, 0.185, 0.25].flatMap((y) =>
      mirror({ y, th: 10, sy: 0.022, sth: 8, amp: 0.035 }),
    ), // abs
    ...mirror({ y: 0.07, th: 36, sy: 0.04, sth: 14, amp: 0.035 }), // iliac crest
    ...mirror({ y: 0.2, th: 62, sy: 0.07, sth: 14, amp: 0.04 }), // obliques
  ],
  muscles: {
    chest: both({ y: [0.31, 0.47], th: [3, 62] }),
    abs: [{ y: [0.06, 0.3], th: [-30, 30] }],
    obliques: both({ y: [0.06, 0.3], th: [36, 98] }),
    lats: both({ y: [0.2, 0.43], th: [92, 150] }),
    "upper back": [{ y: [0.3, 0.47], th: [140, 220] }],
    traps: [{ y: [0.45, 0.6], th: [70, 290] }],
    "lower back": [{ y: [0.04, 0.24], th: [148, 212] }],
    glutes: both({ y: [-0.15, 0.06], th: [118, 180] }),
    abductors: both({ y: [-0.12, 0.05], th: [72, 118] }),
  },
  paint: shortsTorso,
};

const UPPER_ARM: TubeSpec = {
  keys: [
    [-0.02, 0.062, 0.062, 0.0, 0.014],
    [0.03, 0.06, 0.058, 0.0, 0.012],
    [0.09, 0.047, 0.05, 0.003],
    [0.16, 0.043, 0.05, 0.004],
    [0.23, 0.037, 0.04, 0.0],
    [0.29, 0.035, 0.034, -0.002],
  ],
  cap: [0.04, 0.035],
  bumps: [
    { y: 0.15, th: 0, sy: 0.05, sth: 40, amp: 0.1 }, // biceps
    { y: 0.11, th: 180, sy: 0.06, sth: 45, amp: 0.08 }, // triceps
    { y: 0.02, th: 70, sy: 0.04, sth: 50, amp: 0.06 }, // side delt
  ],
  muscles: {
    shoulders: [{ y: [-0.07, 0.09], th: [-60, 115] }],
    "rear delts": [{ y: [-0.07, 0.09], th: [115, 220] }],
    biceps: [{ y: [0.09, 0.27], th: [-65, 65] }],
    triceps: [{ y: [0.06, 0.27], th: [110, 250] }],
  },
};

const FOREARM: TubeSpec = {
  keys: [
    [0.0, 0.039, 0.037],
    [0.06, 0.044, 0.04, 0.0, 0.004],
    [0.14, 0.035, 0.03],
    [0.21, 0.027, 0.02],
    [0.25, 0.04, 0.024, 0.002],
    [0.3, 0.045, 0.03, 0.006],
  ],
  cap: [0.035, 0.04],
  bumps: [{ y: 0.06, th: 70, sy: 0.04, sth: 40, amp: 0.08 }], // brachioradialis
  muscles: { forearms: [{ y: [-0.02, 0.21], th: [-180, 180] }] },
};

const THIGH: TubeSpec = {
  keys: [
    [-0.04, 0.084, 0.088, -0.006, 0.006],
    [0.05, 0.088, 0.09, 0.0, 0.004],
    [0.15, 0.081, 0.083, 0.004],
    [0.28, 0.067, 0.069, 0.003],
    [0.38, 0.053, 0.056],
    [0.44, 0.049, 0.051],
  ],
  cap: [0.07, 0.035],
  segs: 40,
  bumps: [
    { y: 0.18, th: 10, sy: 0.12, sth: 40, amp: 0.08 }, // rectus femoris
    { y: 0.2, th: 70, sy: 0.1, sth: 25, amp: 0.06 }, // outer quad sweep
    { y: 0.35, th: -45, sy: 0.045, sth: 22, amp: 0.1 }, // vastus medialis
    { y: 0.44, th: 0, sy: 0.025, sth: 30, amp: 0.12 }, // kneecap
    { y: 0.2, th: 180, sy: 0.12, sth: 40, amp: 0.04 }, // hamstrings
  ],
  muscles: {
    quads: [{ y: [0.0, 0.42], th: [-62, 75] }],
    hamstrings: [{ y: [0.04, 0.4], th: [118, 245] }],
    adductors: [{ y: [-0.02, 0.3], th: [-118, -55] }],
    abductors: [{ y: [-0.1, 0.1], th: [70, 120] }],
    glutes: [{ y: [-0.1, 0.02], th: [120, 240] }],
  },
  paint: (_x, y) => (y < 0.17 ? "shorts" : "skin"),
};

const SHIN: TubeSpec = {
  keys: [
    [0.0, 0.049, 0.05],
    [0.05, 0.048, 0.052, -0.004],
    [0.13, 0.05, 0.054, -0.008],
    [0.22, 0.045, 0.047, -0.004],
    [0.31, 0.035, 0.037],
    [0.4, 0.03, 0.03],
    [0.43, 0.031, 0.031],
  ],
  cap: [0.035, 0.035],
  bumps: [
    { y: 0.14, th: 160, sy: 0.07, sth: 40, amp: 0.2 }, // calf, inner head lower
    { y: 0.12, th: -160, sy: 0.06, sth: 40, amp: 0.16 },
    { y: 0.08, th: 0, sy: 0.15, sth: 25, amp: 0.03 }, // shin bone
  ],
  muscles: { calves: [{ y: [0.02, 0.3], th: [95, 265] }] },
  paint: (_x, y) => (y > 0.39 ? "shoe" : "skin"),
};

const FOOT: TubeSpec = {
  // y = heel → toe, z = up from the ankle, x = lateral
  keys: [
    [-0.045, 0.031, 0.034, -0.046],
    [0.0, 0.037, 0.05, -0.03],
    [0.06, 0.041, 0.04, -0.04],
    [0.12, 0.047, 0.029, -0.051, -0.004],
    [0.17, 0.044, 0.021, -0.059, -0.006],
    [0.2, 0.037, 0.017, -0.063, -0.008],
  ],
  cap: [0.025, 0.03],
  exp: 3,
  segs: 32,
  ringsPerMetre: 140,
  paint: (_x, _y, z) => (z < -0.067 ? "sole" : "shoe"),
};

const NECK: TubeSpec = {
  keys: [
    [0.0, 0.05, 0.048, -0.008],
    [0.06, 0.046, 0.046, 0.0],
    [0.11, 0.045, 0.046, 0.008],
  ],
  cap: [0.03, 0.02],
  bumps: mirror({ y: 0.02, th: 35, sy: 0.04, sth: 14, amp: 0.06 }), // sternocleidomastoid
  muscles: { traps: [{ y: [-0.03, 0.07], th: [100, 260] }] },
};

const HEAD: TubeSpec = {
  keys: [
    [-0.1, 0.042, 0.04, 0.035],
    [-0.072, 0.06, 0.07, 0.016],
    [-0.035, 0.068, 0.088, 0.006],
    [0.015, 0.074, 0.099, 0.0],
    [0.06, 0.07, 0.094, -0.006],
    [0.095, 0.056, 0.074, -0.01],
  ],
  cap: [0.022, 0.028],
  segs: 40,
  bumps: [
    { y: -0.025, th: 0, sy: 0.018, sth: 9, amp: 0.1 }, // nose
    ...mirror({ y: 0.012, th: 30, sy: 0.012, sth: 12, amp: -0.035 }), // eye sockets
    { y: 0.03, th: 0, sy: 0.012, sth: 35, amp: 0.025 }, // brow
    ...mirror({ y: -0.005, th: 92, sy: 0.022, sth: 10, amp: 0.1 }), // ears
    { y: -0.085, th: 0, sy: 0.015, sth: 30, amp: 0.05 }, // chin
  ],
  paint: (_x, y, _z, th) => {
    const a = Math.abs(th);
    return y > 0.045 || (a > 105 && y > -0.045) || (a > 80 && y > 0.02)
      ? "hair"
      : "skin";
  },
};

// ── Material ───────────────────────────────────────────────────────────────

function skinMaterial(pulse: { value: number }) {
  const m = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.6,
    metalness: 0,
    sheen: 0.12,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color("#E8ECFF"),
    clearcoat: 0.08,
    clearcoatRoughness: 0.5,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPulse = pulse;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float glow;\nvarying float vGlow;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvGlow = glow;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float vGlow;\nuniform float uPulse;",
      )
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.62, 0.78, 0.12) * vGlow * (0.12 + 0.45 * uPulse);",
      );
  };
  m.customProgramCacheKey = () => "pwgm-skin";
  return m;
}

// ── Figure ─────────────────────────────────────────────────────────────────

export interface Figure {
  group: THREE.Group;
  update(sk: Skeleton, pulse: number): void;
  dispose(): void;
}

const tv = (p: V3, o = new THREE.Vector3()) => o.set(p[0], p[1], p[2]);

/** Unit vector of `a` with its component along unit `axis` removed. */
function perp(a: V3, axis: V3): V3 {
  return sub(a, mul(axis, dot(a, axis)));
}

/** Front direction for a bone: preferred hint, falling back to the torso frame. */
function frontFor(axis: V3, hint: V3, sk: Skeleton): V3 {
  const h = perp(hint, axis);
  const fb = perp(sk.frame.fwd, axis);
  const fb2 = perp(sk.frame.up, axis);
  const s = len(h);
  // Blend so a nearly straight joint fades smoothly to the fallback.
  const w = Math.min(1, s / 0.04);
  const out: V3 = [0, 0, 0];
  const hn = s > 1e-6 ? mul(h, 1 / s) : out;
  const fbl = len(fb) > 0.15 ? norm(fb) : norm(fb2);
  return norm([
    hn[0] * w + fbl[0] * (1 - w),
    hn[1] * w + fbl[1] * (1 - w),
    hn[2] * w + fbl[2] * (1 - w),
  ]);
}

export function buildFigure(highlight: Highlight): Figure {
  const group = new THREE.Group();
  const pulse = { value: 0 };
  const mat = skinMaterial(pulse);
  const geo = {
    torso: sculpt(TORSO, highlight),
    neck: sculpt(NECK, highlight),
    head: sculpt(HEAD, highlight),
    upper: sculpt(UPPER_ARM, highlight),
    fore: sculpt(FOREARM, highlight),
    thigh: sculpt(THIGH, highlight),
    shin: sculpt(SHIN, highlight),
    foot: sculpt(FOOT, highlight),
  };
  const one = (g: THREE.BufferGeometry) => {
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
    return m;
  };
  const limb = (g: THREE.BufferGeometry): [THREE.Mesh, THREE.Mesh] => [
    one(g),
    one(g),
  ];
  const torso = one(geo.torso);
  const neck = one(geo.neck);
  const head = one(geo.head);
  const upper = limb(geo.upper);
  const fore = limb(geo.fore);
  const thigh = limb(geo.thigh);
  const shin = limb(geo.shin);
  const foot = limb(geo.foot);

  const X = new THREE.Vector3();
  const Yv = new THREE.Vector3();
  const Z = new THREE.Vector3();
  const P = new THREE.Vector3();

  /** Places a mesh with its local y along `axis` and z towards `front`. */
  const orient = (
    m: THREE.Mesh,
    origin: V3,
    axis: V3,
    front: V3,
    side: 1 | -1 | 0,
  ) => {
    tv(axis, Yv);
    tv(front, Z);
    if (side === 0) X.crossVectors(Yv, Z);
    else X.crossVectors(Z, Yv).multiplyScalar(side);
    m.matrix.makeBasis(X, Yv, Z).setPosition(tv(origin, P));
    m.matrixWorldNeedsUpdate = true;
  };

  return {
    group,
    update(sk, p) {
      pulse.value = p;
      const f = sk.frame;
      orient(torso, sk.pelvis, f.up, f.fwd, 0);
      const neckAxis = norm(sub(sk.head, sk.chest));
      orient(neck, sk.chest, neckAxis, frontFor(neckAxis, sk.headFwd, sk), 0);
      const headUp = norm(sub(sk.head, sk.neck));
      orient(head, sk.head, headUp, frontFor(headUp, sk.headFwd, sk), 0);

      for (const i of [0, 1] as const) {
        const s = sideSign(i);
        const ua = norm(sub(sk.elbow[i], sk.shoulder[i]));
        orient(
          upper[i],
          sk.shoulder[i],
          ua,
          frontFor(ua, sub(sk.hand[i], sk.elbow[i]), sk),
          s,
        );
        const fa = norm(sub(sk.hand[i], sk.elbow[i]));
        orient(
          fore[i],
          sk.elbow[i],
          fa,
          frontFor(fa, sub(sk.shoulder[i], sk.elbow[i]), sk),
          s,
        );

        const th = norm(sub(sk.knee[i], sk.hip[i]));
        orient(
          thigh[i],
          sk.hip[i],
          th,
          frontFor(th, mul(sub(sk.ankle[i], sk.knee[i]), -1), sk),
          s,
        );
        const sh = norm(sub(sk.ankle[i], sk.knee[i]));
        orient(
          shin[i],
          sk.knee[i],
          sh,
          frontFor(sh, mul(sub(sk.hip[i], sk.knee[i]), -1), sk),
          s,
        );

        const ft = norm(sub(sk.toe[i], sk.ankle[i]));
        const up = frontFor(ft, sub(sk.knee[i], sk.ankle[i]), sk);
        orient(foot[i], sk.ankle[i], ft, up, s);
      }
    },
    dispose() {
      mat.dispose();
      for (const g of Object.values(geo)) g.dispose();
    },
  };
}
