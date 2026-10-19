import type { V3 } from "../types.js";

// A small signed-distance modeller: ellipsoids, round cones and rounded boxes
// joined with smooth unions, turned into a mesh with sparse naive surface
// nets. No dependencies, so it runs in Node as well as the browser.

interface Base {
  /** Smooth-union radius in metres: how softly this shape blends in. */
  k: number;
  /** Carve the shape out instead of adding it. */
  sub?: boolean;
  /** Free for the caller (bone, muscle, paint …). */
  tag: number;
}

/** Ellipsoid with semi-axes `r` along the unit axes `ax`. */
export interface Ellipsoid extends Base {
  kind: 0;
  c: V3;
  r: V3;
  ax: [V3, V3, V3];
}

/** Capsule from `a` (radius `ra`) to `b` (radius `rb`). */
export interface RoundCone extends Base {
  kind: 1;
  a: V3;
  b: V3;
  ra: number;
  rb: number;
}

/** Box with half extents `h` along `ax`, edges rounded by `round`. */
export interface RoundBox extends Base {
  kind: 2;
  c: V3;
  h: V3;
  ax: [V3, V3, V3];
  round: number;
}

export type Prim = Ellipsoid | RoundCone | RoundBox;

/** Distance from `p` to one shape (approximate for ellipsoids). */
export function primDist(s: Prim, x: number, y: number, z: number): number {
  if (s.kind === 1) {
    // Inigo Quilez's round cone.
    const bx = s.b[0] - s.a[0];
    const by = s.b[1] - s.a[1];
    const bz = s.b[2] - s.a[2];
    const l2 = bx * bx + by * by + bz * bz;
    const rr = s.ra - s.rb;
    const a2 = l2 - rr * rr;
    const il2 = 1 / l2;
    const px = x - s.a[0];
    const py = y - s.a[1];
    const pz = z - s.a[2];
    const yy = px * bx + py * by + pz * bz;
    const zz = yy - l2;
    const qx = px * l2 - bx * yy;
    const qy = py * l2 - by * yy;
    const qz = pz * l2 - bz * yy;
    const x2 = qx * qx + qy * qy + qz * qz;
    const y2 = yy * yy * l2;
    const z2 = zz * zz * l2;
    const k = (rr < 0 ? -1 : rr > 0 ? 1 : 0) * rr * rr * x2;
    if ((zz < 0 ? -a2 : a2) * z2 > k) return Math.sqrt(x2 + z2) * il2 - s.rb;
    if ((yy < 0 ? -a2 : a2) * y2 < k) return Math.sqrt(x2 + y2) * il2 - s.ra;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - s.ra;
  }
  const dx = x - s.c[0];
  const dy = y - s.c[1];
  const dz = z - s.c[2];
  const [u, v, w] = s.ax;
  const lx = dx * u[0] + dy * u[1] + dz * u[2];
  const ly = dx * v[0] + dy * v[1] + dz * v[2];
  const lz = dx * w[0] + dy * w[1] + dz * w[2];
  if (s.kind === 0) {
    const ax = lx / s.r[0];
    const ay = ly / s.r[1];
    const az = lz / s.r[2];
    const bx = ax / s.r[0];
    const by = ay / s.r[1];
    const bz = az / s.r[2];
    const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
    const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
    return k1 < 1e-9 ? -Math.min(s.r[0], s.r[1], s.r[2]) : (k0 * (k0 - 1)) / k1;
  }
  const qx = Math.abs(lx) - s.h[0];
  const qy = Math.abs(ly) - s.h[1];
  const qz = Math.abs(lz) - s.h[2];
  const ox = qx > 0 ? qx : 0;
  const oy = qy > 0 ? qy : 0;
  const oz = qz > 0 ? qz : 0;
  const out = Math.sqrt(ox * ox + oy * oy + oz * oz);
  return out + Math.min(Math.max(qx, qy, qz), 0) - s.round;
}

/**
 * A lower bound on the distance to `s`, for deciding which shapes can be
 * skipped. The ellipsoid estimate above can overshoot on flat ellipsoids, and
 * a skipped shape that mattered leaves a seam where one block meets the next.
 */
function primBound(s: Prim, x: number, y: number, z: number): number {
  if (s.kind !== 0) return primDist(s, x, y, z);
  const dx = x - s.c[0];
  const dy = y - s.c[1];
  const dz = z - s.c[2];
  const [u, v, w] = s.ax;
  const ax = (dx * u[0] + dy * u[1] + dz * u[2]) / s.r[0];
  const ay = (dx * v[0] + dy * v[1] + dz * v[2]) / s.r[1];
  const az = (dx * w[0] + dy * w[1] + dz * w[2]) / s.r[2];
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
  return (k0 - 1) * (k0 > 1 ? Math.min(s.r[0], s.r[1], s.r[2]) : Math.max(s.r[0], s.r[1], s.r[2]));
}

/** Polynomial smooth minimum. */
function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** The combined field at a point, from the shapes in `list`. */
export function field(prims: readonly Prim[], list: readonly number[], x: number, y: number, z: number): number {
  let d = 1e9;
  for (const i of list) {
    const s = prims[i];
    const di = primDist(s, x, y, z);
    if (s.sub) d = -smin(-d, di, s.k);
    else d = smin(d, di, s.k);
  }
  return d;
}

/** Conservative axis-aligned bounds of one shape. */
function bounds(s: Prim): [V3, V3] {
  if (s.kind === 1) {
    const r = Math.max(s.ra, s.rb);
    return [
      [Math.min(s.a[0], s.b[0]) - r, Math.min(s.a[1], s.b[1]) - r, Math.min(s.a[2], s.b[2]) - r],
      [Math.max(s.a[0], s.b[0]) + r, Math.max(s.a[1], s.b[1]) + r, Math.max(s.a[2], s.b[2]) + r],
    ];
  }
  const r = s.kind === 0 ? Math.max(...s.r) : Math.hypot(...s.h) + s.round;
  return [
    [s.c[0] - r, s.c[1] - r, s.c[2] - r],
    [s.c[0] + r, s.c[1] + r, s.c[2] + r],
  ];
}

export interface SurfaceMesh {
  position: Float32Array;
  normal: Float32Array;
  index: Uint32Array;
  /** Shapes near each vertex (indices into the input), for per-vertex lookups. */
  near(vertex: number): readonly number[];
}

const BLOCK = 6;

/**
 * Meshes the smooth union of `prims` with naive surface nets on a grid of
 * cell size `h`. Only blocks near the surface are sampled, and each block only
 * evaluates the shapes that can reach it.
 */
export function meshField(prims: readonly Prim[], h: number): SurfaceMesh {
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  const reach = prims.map((s) => {
    const [a, b] = bounds(s);
    const pad = s.k + 2 * h;
    if (!s.sub)
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i], a[i]);
        hi[i] = Math.max(hi[i], b[i]);
      }
    return [a.map((v) => v - pad), b.map((v) => v + pad)] as [V3, V3];
  });
  const o = lo.map((v) => v - 2 * h) as V3;
  const n = hi.map((v, i) => Math.ceil((v + 2 * h - o[i]) / h) + 1);
  const nb = n.map((v) => Math.ceil(v / BLOCK));
  const blockId = (bx: number, by: number, bz: number) => bx + nb[0] * (by + nb[1] * bz);

  // Which shapes can reach each block.
  const lists = new Map<number, number[]>();
  prims.forEach((_, i) => {
    const [a, b] = reach[i];
    const from = a.map((v, j) => Math.max(0, Math.floor((v - o[j]) / (h * BLOCK))));
    const to = b.map((v, j) => Math.min(nb[j] - 1, Math.floor((v - o[j]) / (h * BLOCK))));
    for (let bz = from[2]; bz <= to[2]; bz++)
      for (let by = from[1]; by <= to[1]; by++)
        for (let bx = from[0]; bx <= to[0]; bx++) {
          const id = blockId(bx, by, bz);
          let l = lists.get(id);
          if (!l) lists.set(id, (l = []));
          l.push(i);
        }
  });

  const S = BLOCK + 1;
  const half = (BLOCK * h) / 2;
  const radius = Math.sqrt(3) * half;
  const cellKey = (i: number, j: number, k: number) => i + n[0] * (j + n[1] * k);
  const verts = new Map<number, number>();
  const pos: number[] = [];
  const vBlock: number[] = [];
  const active: { id: number; b: [number, number, number]; vals: Float32Array; list: number[] }[] = [];

  // Pass 1: one vertex per cell that the surface crosses.
  const cornerOff = [0, 1, S, S + 1, S * S, S * S + 1, S * S + S, S * S + S + 1];
  const cornerXYZ = [0, 1, 2, 3, 4, 5, 6, 7].map((c) => [c & 1, (c >> 1) & 1, (c >> 2) & 1]);
  const edges: [number, number][] = [];
  for (let a = 0; a < 8; a++) for (let bit = 1; bit < 8; bit <<= 1) if (!(a & bit)) edges.push([a, a | bit]);

  for (const [id, all] of [...lists]) {
    const bx = id % nb[0];
    const by = Math.floor(id / nb[0]) % nb[1];
    const bz = Math.floor(id / (nb[0] * nb[1]));
    const x0 = o[0] + bx * BLOCK * h;
    const y0 = o[1] + by * BLOCK * h;
    const z0 = o[2] + bz * BLOCK * h;
    const cx = x0 + half;
    const cy = y0 + half;
    const cz = z0 + half;
    const dc = field(prims, all, cx, cy, cz);
    if (Math.abs(dc) > radius * 1.6 + 2 * h) continue;
    // Drop shapes too far away to change the field anywhere in this block.
    const R = radius * 1.25 + h;
    const list = all.filter((i) => {
      const s = prims[i];
      const di = primBound(s, cx, cy, cz) - R;
      return s.sub ? di < s.k + Math.abs(dc) + R : di < dc + R + s.k;
    });
    lists.set(id, list);

    const vals = new Float32Array(S * S * S);
    for (let k = 0; k < S; k++)
      for (let j = 0; j < S; j++)
        for (let i = 0; i < S; i++) vals[i + S * (j + S * k)] = field(prims, list, x0 + i * h, y0 + j * h, z0 + k * h);
    active.push({ id, b: [bx, by, bz], vals, list });

    for (let k = 0; k < BLOCK; k++)
      for (let j = 0; j < BLOCK; j++)
        for (let i = 0; i < BLOCK; i++) {
          const gi = bx * BLOCK + i;
          const gj = by * BLOCK + j;
          const gk = bz * BLOCK + k;
          if (gi >= n[0] - 1 || gj >= n[1] - 1 || gk >= n[2] - 1) continue;
          const base = i + S * (j + S * k);
          let mask = 0;
          for (let c = 0; c < 8; c++) if (vals[base + cornerOff[c]] < 0) mask |= 1 << c;
          if (mask === 0 || mask === 255) continue;
          let sx = 0;
          let sy = 0;
          let sz = 0;
          let cnt = 0;
          for (const [a, b] of edges) {
            const va = vals[base + cornerOff[a]];
            const vb = vals[base + cornerOff[b]];
            if (va < 0 === vb < 0) continue;
            const t = va / (va - vb);
            const pa = cornerXYZ[a];
            const pb = cornerXYZ[b];
            sx += pa[0] + (pb[0] - pa[0]) * t;
            sy += pa[1] + (pb[1] - pa[1]) * t;
            sz += pa[2] + (pb[2] - pa[2]) * t;
            cnt++;
          }
          verts.set(cellKey(gi, gj, gk), pos.length / 3);
          pos.push(x0 + (i + sx / cnt) * h, y0 + (j + sy / cnt) * h, z0 + (k + sz / cnt) * h);
          vBlock.push(id);
        }
  }

  // Pull each vertex onto the surface and take the normal from the gradient.
  const nv = pos.length / 3;
  const position = new Float32Array(nv * 3);
  const normal = new Float32Array(nv * 3);
  for (let v = 0; v < nv; v++) project(prims, lists.get(vBlock[v])!, pos, v, h, position, normal, v);

  // Pass 2: a quad around every grid edge the surface crosses.
  const index: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (flip) [b, d] = [d, b];
    const P = position;
    const dd = (p: number, q: number) =>
      (P[p * 3] - P[q * 3]) ** 2 + (P[p * 3 + 1] - P[q * 3 + 1]) ** 2 + (P[p * 3 + 2] - P[q * 3 + 2]) ** 2;
    if (dd(a, c) <= dd(b, d)) index.push(a, b, c, a, c, d);
    else index.push(a, b, d, b, c, d);
  };
  const look = (i: number, j: number, k: number) => verts.get(cellKey(i, j, k));
  for (const { b, vals } of active) {
    for (let k = 0; k < BLOCK; k++)
      for (let j = 0; j < BLOCK; j++)
        for (let i = 0; i < BLOCK; i++) {
          const gi = b[0] * BLOCK + i;
          const gj = b[1] * BLOCK + j;
          const gk = b[2] * BLOCK + k;
          const base = i + S * (j + S * k);
          const inside = vals[base] < 0;
          // +x edge: cells sharing it differ in j and k.
          if (inside !== vals[base + 1] < 0 && gj > 0 && gk > 0) {
            const q = [look(gi, gj, gk), look(gi, gj - 1, gk), look(gi, gj - 1, gk - 1), look(gi, gj, gk - 1)];
            if (q.every((x) => x !== undefined)) quad(q[0]!, q[1]!, q[2]!, q[3]!, !inside);
          }
          if (inside !== vals[base + S] < 0 && gi > 0 && gk > 0) {
            const q = [look(gi, gj, gk), look(gi, gj, gk - 1), look(gi - 1, gj, gk - 1), look(gi - 1, gj, gk)];
            if (q.every((x) => x !== undefined)) quad(q[0]!, q[1]!, q[2]!, q[3]!, !inside);
          }
          if (inside !== vals[base + S * S] < 0 && gi > 0 && gj > 0) {
            const q = [look(gi, gj, gk), look(gi - 1, gj, gk), look(gi - 1, gj - 1, gk), look(gi, gj - 1, gk)];
            if (q.every((x) => x !== undefined)) quad(q[0]!, q[1]!, q[2]!, q[3]!, !inside);
          }
        }
  }

  return {
    position,
    normal,
    index: new Uint32Array(index),
    near: (v) => lists.get(vBlock[v])!,
  };
}

/**
 * Moves point `v` of `src` onto the surface with a few Newton steps (each at
 * most `h / 2`), and writes it and its gradient normal to slot `o`.
 */
function project(
  prims: readonly Prim[],
  list: readonly number[],
  src: ArrayLike<number>,
  v: number,
  h: number,
  position: Float32Array,
  normal: Float32Array,
  o: number,
  iterations = 3,
) {
  let x = src[v * 3];
  let y = src[v * 3 + 1];
  let z = src[v * 3 + 2];
  // Only the shapes that shape the surface here (exact: the others are no-ops).
  const d0 = field(prims, list, x, y, z);
  const local: number[] = [];
  for (const i of list) {
    const s = prims[i];
    const di = primBound(s, x, y, z) - h;
    if (s.sub ? di < s.k + Math.abs(d0) + h : di < d0 + h + s.k) local.push(i);
  }
  const f = (a: number, b: number, c: number) => field(prims, local, a, b, c);
  const e = h * 0.25;
  let gx = 0;
  let gy = 0;
  let gz = 0;
  for (let it = 0; it < iterations; it++) {
    // Tetrahedral gradient: four samples.
    const a = f(x + e, y - e, z - e);
    const b = f(x - e, y - e, z + e);
    const c = f(x - e, y + e, z - e);
    const d = f(x + e, y + e, z + e);
    gx = (a - b - c + d) / (4 * e);
    gy = (-a - b + c + d) / (4 * e);
    gz = (-a + b - c + d) / (4 * e);
    if (it === iterations - 1) break;
    const g2 = gx * gx + gy * gy + gz * gz;
    if (g2 < 1e-8) break;
    let s = (a + b + c + d) / 4 / g2;
    const step = Math.abs(s) * Math.sqrt(g2);
    // Within a few microns: on the surface, and the gradient is the normal here.
    if (step < 5e-6) break;
    if (step > h * 0.5) s *= (h * 0.5) / step;
    x -= s * gx;
    y -= s * gy;
    z -= s * gz;
  }
  const gl = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
  position[o * 3] = x;
  position[o * 3 + 1] = y;
  position[o * 3 + 2] = z;
  normal[o * 3] = gx / gl;
  normal[o * 3 + 1] = gy / gl;
  normal[o * 3 + 2] = gz / gl;
}

/**
 * Adaptive detail: splits triangles longer than `target(x, y, z)` allows, 1:4,
 * and pulls the new vertices onto the true surface, so small features (lips,
 * eyelids, knuckles) appear where they are wanted without meshing the whole
 * body that finely. Neighbours are split 1:2 so the mesh stays watertight.
 */
export function refine(
  prims: readonly Prim[],
  m: SurfaceMesh,
  target: (x: number, y: number, z: number) => number,
  levels: number,
): SurfaceMesh {
  let position = m.position;
  let normal = m.normal;
  let index = m.index;
  let near: (readonly number[])[] = Array.from({ length: position.length / 3 }, (_, v) => m.near(v));
  for (let level = 0; level < levels; level++) {
    const P = position;
    const len = (a: number, b: number) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
    const key = (a: number, b: number) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);
    const split = new Map<number, number>(); // edge → new vertex (assigned later)
    const nt = index.length / 3;
    for (let t = 0; t < nt; t++) {
      const a = index[t * 3];
      const b = index[t * 3 + 1];
      const c = index[t * 3 + 2];
      const cx = (P[a * 3] + P[b * 3] + P[c * 3]) / 3;
      const cy = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3;
      const cz = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3;
      if (Math.max(len(a, b), len(b, c), len(c, a)) > target(cx, cy, cz) * 1.4)
        for (const [p, q] of [[a, b], [b, c], [c, a]]) split.set(key(p, q), -1);
    }
    if (!split.size) break;
    // Close up: a triangle with two split edges gets its third, so every
    // triangle splits 1:1, 1:2 or 1:4 and none turns into slivers.
    // Only triangles around a newly split edge can change, so walk those.
    const nvP = P.length / 3;
    const start = new Uint32Array(nvP + 1);
    for (let i = 0; i < index.length; i++) start[index[i] + 1]++;
    for (let i = 0; i < nvP; i++) start[i + 1] += start[i];
    const fill = start.slice(0, nvP);
    const vt = new Uint32Array(index.length); // vertex → triangles
    for (let t = 0; t < nt; t++) for (let j = 0; j < 3; j++) vt[fill[index[t * 3 + j]]++] = t;
    let queue = [...split.keys()];
    while (queue.length) {
      const next: number[] = [];
      for (const k of queue) {
        const p = Math.floor(k / 4294967296);
        const q = k % 4294967296;
        for (let i = start[p]; i < start[p + 1]; i++) {
          const t = vt[i];
          const a = index[t * 3];
          const b = index[t * 3 + 1];
          const c = index[t * 3 + 2];
          if (a !== q && b !== q && c !== q) continue;
          const k1 = key(a, b);
          const k2 = key(b, c);
          const k3 = key(c, a);
          const h1 = split.has(k1);
          const h2 = split.has(k2);
          const h3 = split.has(k3);
          if (+h1 + +h2 + +h3 !== 2) continue;
          const missing = !h1 ? k1 : !h2 ? k2 : k3;
          split.set(missing, -1);
          next.push(missing);
        }
      }
      queue = next;
    }
    const nv0 = P.length / 3;
    const nv = nv0 + split.size;
    const pos = new Float32Array(nv * 3);
    const nor = new Float32Array(nv * 3);
    pos.set(P);
    nor.set(normal);
    const nr = near.slice();
    let v = nv0;
    const mids = new Float32Array(3);
    for (const k of split.keys()) {
      const a = Math.floor(k / 4294967296);
      const b = k % 4294967296;
      for (let i = 0; i < 3; i++) mids[i] = (P[a * 3 + i] + P[b * 3 + i]) / 2;
      const list = near[a] === near[b] ? near[a] : [...new Set([...near[a], ...near[b]])];
      project(prims, list, mids, 0, len(a, b), pos, nor, v, 8);
      nr.push(list);
      split.set(k, v++);
    }
    const out: number[] = [];
    for (let t = 0; t < nt; t++) {
      const [a, b, c] = [index[t * 3], index[t * 3 + 1], index[t * 3 + 2]];
      const ab = split.get(key(a, b));
      const bc = split.get(key(b, c));
      const ca = split.get(key(c, a));
      if (ab !== undefined && bc !== undefined && ca !== undefined) out.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
      else if (ab !== undefined) out.push(a, ab, c, ab, b, c);
      else if (bc !== undefined) out.push(a, b, bc, a, bc, c);
      else if (ca !== undefined) out.push(a, b, ca, ca, b, c);
      else out.push(a, b, c);
    }
    position = pos;
    normal = nor;
    index = new Uint32Array(out);
    near = nr;
  }
  // Relax: move each refined vertex towards the middle of its neighbours and
  // back onto the surface, which evens out the 1:2 slivers and any folds
  // left where the coarse grid cut across a small feature.
  const nv = position.length / 3;
  const P = position;
  const active = new Uint8Array(nv);
  for (let v = 0; v < nv; v++) active[v] = target(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]) < Infinity ? 1 : 0;
  const ring: number[][] = Array.from({ length: nv }, () => []);
  for (let t = 0; t < index.length; t += 3)
    for (let j = 0; j < 3; j++) {
      const a = index[t + j];
      const b = index[t + ((j + 1) % 3)];
      if (active[a]) ring[a].push(b);
      if (active[b]) ring[b].push(a);
    }
  const avg = new Float32Array(3);
  for (let it = 0; it < 2; it++)
    for (let v = 0; v < nv; v++) {
      const r = ring[v];
      if (!r.length) continue;
      avg.fill(0);
      let edge = 0;
      for (const u of r) {
        for (let i = 0; i < 3; i++) avg[i] += P[u * 3 + i] / r.length;
        edge += Math.hypot(P[u * 3] - P[v * 3], P[u * 3 + 1] - P[v * 3 + 1], P[u * 3 + 2] - P[v * 3 + 2]) / r.length;
      }
      project(prims, near[v], avg, 0, edge, P, normal, v, 8);
    }
  const lists = near;
  return { position, normal, index, near: (v) => lists[v] };
}
