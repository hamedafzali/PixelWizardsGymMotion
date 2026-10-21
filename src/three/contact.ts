import * as THREE from "three";
import type { Skeleton } from "../rig.js";
import type { V3 } from "../types.js";
import { add, mix, mul, norm, sub } from "../vec.js";
import { frontFor } from "./body.js";

// Contacts: where equipment and body meet. A part marks the places on its
// own geometry that a body surface belongs against — a grip in a hand, a
// pedal under a sole, a roller on a shin — and the scene measures the gap
// every frame. Equipment follows the body, so a gap means a part tracks the
// wrong point or the pose misses the machine; tests sweep every exercise.

/** Body surfaces equipment touches: a point (hands) or a capsule (limbs). */
export type Limb =
  | "handL"
  | "handR"
  | "forearmL"
  | "forearmR"
  | "upperArmL"
  | "upperArmR"
  | "thighL"
  | "thighR"
  | "shinL"
  | "shinR"
  | "soleL"
  | "soleR"
  | "shoulderL"
  | "shoulderR"
  | "back"
  | "front"
  | "seat";

/** Pairs a group name expands to. */
export const BOTH = {
  hands: ["handL", "handR"],
  forearms: ["forearmL", "forearmR"],
  upperArms: ["upperArmL", "upperArmR"],
  thighs: ["thighL", "thighR"],
  shins: ["shinL", "shinR"],
  soles: ["soleL", "soleR"],
  shoulders: ["shoulderL", "shoulderR"],
} as const satisfies Record<string, readonly Limb[]>;

export interface Capsule {
  a: V3;
  b: V3;
  r: number;
}

/** A limb's surface as a capsule this frame. */
export function limbCapsule(sk: Skeleton, l: Limb): Capsule {
  const i = l.endsWith("R") ? 1 : 0;
  const f = sk.frame;
  switch (l) {
    case "handL":
    case "handR":
      return { a: sk.hand[i], b: sk.hand[i], r: 0 };
    case "forearmL":
    case "forearmR":
      return { a: mix(sk.elbow[i], sk.hand[i], 0.12), b: mix(sk.elbow[i], sk.hand[i], 0.82), r: 0.04 };
    case "upperArmL":
    case "upperArmR":
      return { a: mix(sk.shoulder[i], sk.elbow[i], 0.2), b: sk.elbow[i], r: 0.05 };
    case "thighL":
    case "thighR":
      return { a: mix(sk.hip[i], sk.knee[i], 0.15), b: mix(sk.hip[i], sk.knee[i], 0.92), r: 0.08 };
    case "shinL":
    case "shinR":
      return { a: mix(sk.knee[i], sk.ankle[i], 0.1), b: sk.ankle[i], r: 0.045 };
    case "soleL":
    case "soleR": {
      // Heel to ball along the shoe's tread, 0.08 m under the ankle in the
      // foot's own frame (the one the mesh is skinned to), so a pointed foot's sole faces up.
      const along = norm(sub(sk.toe[i], sk.ankle[i]));
      const up = frontFor(along, sub(sk.knee[i], sk.ankle[i]), sk);
      const down = mul(up, -0.08);
      return { a: add(add(sk.ankle[i], down), mul(along, -0.05)), b: add(sk.toe[i], down), r: 0 };
    }
    case "shoulderL":
    case "shoulderR":
      return { a: sk.shoulder[i], b: sk.shoulder[i], r: 0.06 };
    case "back":
      // Spine from the waist to between the shoulder blades, at the back's surface depth.
      return { a: add(mix(sk.pelvis, sk.chest, 0.3), mul(sk.frame.fwd, -0.02)), b: add(sk.chest, mul(f.up, 0.08)), r: 0.11 };
    case "front":
      return { a: mix(sk.pelvis, sk.chest, 0.35), b: add(sk.chest, mul(f.up, 0.05)), r: 0.11 };
    case "seat":
      // The sit bones: under and slightly behind the hip joints.
      return { a: sk.hip[0], b: sk.hip[1], r: 0.1 };
  }
}

export interface ContactMark {
  /** Any one of these limbs satisfies the mark (a bench takes a back or a knee). */
  limbs: readonly Limb[];
  /** Segment on the part, in the marked object's local space (a point when a = b)... */
  a: V3;
  b: V3;
  /** ...or a box of these half extents about the local origin (a pad, a deck). */
  box?: V3;
  /** Radius of the part's surface around the segment. */
  r: number;
  /** How far the surfaces may part, and how deep they may press in (pads give). */
  gap: number;
  press: number;
}

/** Along a unit cylinder's axis, the shape `rod`, `span` and `xRod` scale. */
export const AXIS = { a: [0, -0.5, 0] as V3, b: [0, 0.5, 0] as V3 };

export interface TouchOptions {
  a?: V3;
  b?: V3;
  box?: V3;
  r?: number;
  gap?: number;
  press?: number;
}

/**
 * Marks where on `on` a body surface belongs: one of `limbs` must meet it
 * (call once per limb that must all touch). Returns `on`.
 */
export function touch<T extends THREE.Object3D>(on: T, limbs: Limb | readonly Limb[], o: TouchOptions = {}): T {
  const a = o.a ?? [0, 0, 0];
  const mark: ContactMark = {
    limbs: typeof limbs === "string" ? [limbs] : limbs,
    a,
    b: o.b ?? a,
    box: o.box,
    r: o.r ?? 0,
    gap: o.gap ?? 0.04,
    press: o.press ?? 0.05,
  };
  ((on.userData.contacts ??= []) as ContactMark[]).push(mark);
  return on;
}

/** Marks each limb separately: all of them must touch. */
export function touchEach<T extends THREE.Object3D>(on: T, limbs: readonly Limb[], o: TouchOptions = {}): T {
  for (const l of limbs) touch(on, l, o);
  return on;
}

export interface ContactGap {
  /** The limb closest to the mark. */
  limb: Limb;
  /** Surface distance: positive is apart, negative pressed in. */
  gap: number;
  /** The deepest any of the mark's limbs presses in, and which. */
  deepest: number;
  deepLimb: Limb;
  ok: boolean;
  /** Object the mark is on, for reports. */
  on: string;
}

const pa = new THREE.Vector3();
const pb = new THREE.Vector3();
const inv = new THREE.Matrix4();
const q = new THREE.Vector3();

function boxGap(c: Capsule, half: V3, toLocal: THREE.Matrix4): number {
  let best = Infinity;
  for (let k = 0; k <= 8; k++) {
    const p = mix(c.a, c.b, k / 8);
    q.set(...p).applyMatrix4(toLocal);
    const dx = Math.abs(q.x) - half[0];
    const dy = Math.abs(q.y) - half[1];
    const dz = Math.abs(q.z) - half[2];
    // Signed distance to the box: negative inside.
    const out = Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0));
    const d = out > 0 ? out : Math.max(dx, dy, dz);
    best = Math.min(best, d - c.r);
  }
  return best;
}

/** Every marked contact under `root`, measured against the skeleton. */
export function measureContacts(root: THREE.Object3D, sk: Skeleton): ContactGap[] {
  root.updateMatrixWorld(true);
  const out: ContactGap[] = [];
  root.traverseVisible((o) => {
    const marks = o.userData.contacts as ContactMark[] | undefined;
    if (!marks) return;
    if (marks.some((m) => m.box)) inv.copy(o.matrixWorld).invert();
    for (const m of marks) {
      pa.set(...m.a).applyMatrix4(o.matrixWorld);
      pb.set(...m.b).applyMatrix4(o.matrixWorld);
      let limb = m.limbs[0]!;
      let gap = Infinity;
      let deepest = Infinity;
      let deepLimb = limb;
      for (const l of m.limbs) {
        const c = limbCapsule(sk, l);
        const g = m.box ? boxGap(c, m.box, inv) : segmentDistance([pa.x, pa.y, pa.z], [pb.x, pb.y, pb.z], c.a, c.b) - m.r - c.r;
        if (Math.abs(g) < Math.abs(gap)) [limb, gap] = [l, g];
        if (g < deepest) [deepLimb, deepest] = [l, g];
      }
      out.push({ limb, gap, deepest, deepLimb, ok: gap <= m.gap && deepest >= -m.press, on: o.name || o.parent?.name || o.type });
    }
  });
  return out;
}

/** Closest distance between segments p0p1 and q0q1. */
export function segmentDistance(p0: V3, p1: V3, q0: V3, q1: V3): number {
  const d1 = sub(p1, p0);
  const d2 = sub(q1, q0);
  const r = sub(p0, q0);
  const a = d1[0] ** 2 + d1[1] ** 2 + d1[2] ** 2;
  const e = d2[0] ** 2 + d2[1] ** 2 + d2[2] ** 2;
  const f = d2[0] * r[0] + d2[1] * r[1] + d2[2] * r[2];
  const clamp = (x: number) => Math.min(Math.max(x, 0), 1);
  let s = 0;
  let t = 0;
  if (a < 1e-12 && e < 1e-12) return Math.hypot(...r);
  if (a < 1e-12) t = clamp(f / e);
  else {
    const c = d1[0] * r[0] + d1[1] * r[1] + d1[2] * r[2];
    if (e < 1e-12) s = clamp(-c / a);
    else {
      const b = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2];
      const den = a * e - b * b;
      s = den > 1e-12 ? clamp((b * f - c * e) / den) : 0;
      t = (b * s + f) / e;
      if (t < 0) [t, s] = [0, clamp(-c / a)];
      else if (t > 1) [t, s] = [1, clamp((b - c) / a)];
    }
  }
  const cp = add(p0, mul(d1, s));
  const cq = add(q0, mul(d2, t));
  return Math.hypot(...sub(cp, cq));
}

/**
 * Rests a part that follows the body on the limb it presses: `place(at)`
 * puts the part at a point, `dir` is the side it sits on (away from the
 * limb), and the point slides along `dir` until the nearest mark on
 * `marked` just touches. Offsets then only say which side; contact says how
 * far, so pads meet skin whatever the body's size or pose. Returns the point.
 */
export function settle(sk: Skeleton, at: V3, dir: V3, marked: THREE.Object3D, place: (at: V3) => void, press = 0): V3 {
  const n = Math.hypot(...dir);
  if (n < 1e-6) {
    place(at);
    return at;
  }
  const d = mul(dir, 1 / n);
  let p = at;
  for (let k = 0; k < 8; k++) {
    place(p);
    // The deepest limb, not the nearest: a pad rests on whatever stands highest.
    const gaps = measureContacts(marked, sk).map((c) => c.deepest);
    if (!gaps.length) break;
    const g = Math.min(...gaps) + press;
    if (Math.abs(g) < 0.002) break;
    p = add(p, mul(d, -g));
  }
  return p;
}
