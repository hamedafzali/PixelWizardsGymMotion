import type { V3 } from "./types.js";

// Tiny allocation-light vector helpers. The engine core stays free of three.js
// so it runs (and is tested) anywhere.

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: V3, b: V3) => len(sub(a, b));
export const norm = (a: V3): V3 => {
  const l = len(a);
  return l > 1e-9 ? mul(a, 1 / l) : [0, 1, 0];
};
export const mix = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const mid = (a: V3, b: V3): V3 => mix(a, b, 0.5);

/** Sum of scaled vectors: comb([v, 2], [w, -1]) = 2v − w. */
export function comb(...terms: [V3, number][]): V3 {
  const o: V3 = [0, 0, 0];
  for (const [v, s] of terms) {
    o[0] += v[0] * s;
    o[1] += v[1] * s;
    o[2] += v[2] * s;
  }
  return o;
}

export const rad = (deg: number) => (deg * Math.PI) / 180;
