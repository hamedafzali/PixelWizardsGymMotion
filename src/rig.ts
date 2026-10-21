import type { Anchor, Pose, V3 } from "./types.js";
import { add, comb, cross, dot, len, mid, mul, norm, rad, sub } from "./vec.js";

/** Body proportions of the standard figure (≈ 1.78 m), in metres. */
export const BODY = {
  hipHalf: 0.095,
  shoulderHalf: 0.19,
  torso: 0.5, // pelvis centre → base of neck
  neck: 0.08,
  head: 0.105,
  upperArm: 0.29,
  forearm: 0.3, // elbow → grip point
  thigh: 0.44,
  shin: 0.43,
  ankle: 0.08, // ankle height above the sole
  foot: 0.19,
} as const;

/** Pelvis height when standing tall. */
export const STAND = BODY.ankle + BODY.shin + BODY.thigh;
export const ARM = BODY.upperArm + BODY.forearm;
export const LEG = BODY.thigh + BODY.shin;

export interface Frame {
  up: V3; // along the spine, towards the head
  fwd: V3; // the way the chest faces
  left: V3; // the figure's own left
}

/** Torso frame from [pitch, yaw, roll] in degrees (applied roll → pitch → yaw). */
export function frameOf([pitch, yaw, roll]: V3): Frame {
  const p = rad(pitch);
  const y = rad(yaw);
  const r = rad(roll);
  const rot = (v: V3): V3 => {
    // roll about Z
    let [x, yy, z] = v;
    [x, yy] = [x * Math.cos(r) - yy * Math.sin(r), x * Math.sin(r) + yy * Math.cos(r)];
    // pitch about X
    [yy, z] = [yy * Math.cos(p) - z * Math.sin(p), yy * Math.sin(p) + z * Math.cos(p)];
    // yaw about Y
    [x, z] = [x * Math.cos(y) + z * Math.sin(y), -x * Math.sin(y) + z * Math.cos(y)];
    return [x, yy, z];
  };
  return { up: rot([0, 1, 0]), fwd: rot([0, 0, 1]), left: rot([1, 0, 0]) };
}

/** Converts torso-local [left, up, fwd] offsets to world, from a point. */
export function local(origin: V3, f: Frame, [l, u, fw]: V3): V3 {
  return comb([origin, 1], [f.left, l], [f.up, u], [f.fwd, fw]);
}

export const sideSign = (i: 0 | 1) => (i === 0 ? 1 : -1);

/** Chest (base of neck) for a pelvis and torso orientation. */
export function chestOf(pelvis: V3, torso: V3): V3 {
  return add(pelvis, mul(frameOf(torso).up, BODY.torso));
}

/** Shoulder joint (0 = left, 1 = right). */
export function shoulderOf(pelvis: V3, torso: V3, i: 0 | 1, shrug = 0): V3 {
  const f = frameOf(torso);
  return local(chestOf(pelvis, torso), f, [sideSign(i) * BODY.shoulderHalf, -0.03 + shrug, 0]);
}

/** Range of the spine between pelvis and chest, degrees of flexion (− is extension). */
export const SPINE_RANGE = [-30, 50] as const;
/** Range of the head on the neck, degrees of flexion. */
export const NECK_RANGE = [-45, 60] as const;

const clamp = (x: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, x));

/** Pelvis frame for a chest orientation and spine flexion: the chest's, pitched back by the flexion. */
export function pelvisFrameOf(torso: V3, spine = 0): Frame {
  return frameOf([torso[0] - clamp(spine, SPINE_RANGE), torso[1], torso[2]]);
}

/** Hip joint (0 = left, 1 = right), on the pelvis for the given spine flexion. */
export function hipOf(pelvis: V3, torso: V3, i: 0 | 1, spine = 0): V3 {
  return local(pelvis, pelvisFrameOf(torso, spine), [sideSign(i) * BODY.hipHalf, -0.02, 0]);
}

/** Hip flexion in degrees of a thigh on a pelvis frame: 0 hanging straight down, 90 forwards, − behind. */
export function hipFlexion(f: Frame, hip: V3, knee: V3): number {
  const t = sub(knee, hip);
  return (Math.atan2(dot(t, f.fwd), -dot(t, f.up)) * 180) / Math.PI;
}

/** How far the hips flex and extend before the lower back has to help (degrees). */
export const HIP_RANGE = [-12, 112] as const;
/** Lowest the knee joint goes: a kneecap resting on the floor. */
export const KNEE_FLOOR = 0.06;

/**
 * Spine flexion the legs force on a neutral back: past the hips' range the
 * pelvis tilts and the lower back takes most of the excess, as in a deep
 * squat or a high kick. Hinges and squats within range keep a neutral spine.
 */
export function autoSpine(flex: [number, number]): number {
  const hi = Math.max(...flex);
  const lo = Math.min(...flex);
  return clamp(0.6 * Math.max(0, hi - HIP_RANGE[1]) + 0.6 * Math.min(0, lo - HIP_RANGE[0]), [-25, 40]);
}

/**
 * Scapular rhythm: where the shoulder joint moves on the rib cage for an
 * upper arm direction, in metres along the chest frame. The blade glides
 * forwards round the ribs as the arm reaches forwards or across the body,
 * back as the elbow drives behind, and up as the arm rises overhead. A
 * nearly straight arm keeps its shoulder put, so it still reaches its grip.
 */
export function scapula(f: Frame, i: 0 | 1, upperArm: V3, straight: number): V3 {
  const s = sideSign(i);
  const a = norm(upperArm);
  const fw = dot(a, f.fwd);
  const up = dot(a, f.up);
  const out = dot(a, f.left) * s;
  const protract = Math.min(0.035, Math.max(-0.028, 0.03 * fw + 0.022 * Math.max(0, -out)));
  const elevate = 0.035 * Math.max(0, up) ** 2;
  const k = 1 - straight;
  return comb([f.fwd, protract * k], [f.up, elevate * k], [f.left, -s * 0.35 * Math.max(0, protract) * k]);
}

/**
 * Two-bone IK. Places the middle joint so the chain reaches `target` (or as
 * close as the bones allow) and bends towards `pole`.
 */
export function twoBone(root: V3, target: V3, l1: number, l2: number, pole: V3, minY = -Infinity): { joint: V3; end: V3 } {
  let to = sub(target, root);
  let d = len(to);
  const max = (l1 + l2) * 0.999;
  const min = Math.abs(l1 - l2) + 1e-3;
  const dir = d > 1e-9 ? mul(to, 1 / d) : ([0, -1, 0] as V3);
  if (d > max) d = max;
  if (d < min) d = min;
  to = mul(dir, d);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  // Component of the pole perpendicular to the chain.
  let perp = sub(pole, mul(dir, dot(pole, dir)));
  if (len(perp) < 1e-6) perp = Math.abs(dir[1]) < 0.9 ? cross(dir, [0, 1, 0]) : cross(dir, [1, 0, 0]);
  perp = norm(perp);
  const c = comb([root, 1], [dir, a]);
  // Below `minY` (a knee in the floor) the joint swings round the chain's
  // axis, as little as it can, until it clears.
  if (c[1] + perp[1] * h < minY && h > 1e-6) {
    const w = cross(dir, perp);
    const R = Math.hypot(perp[1], w[1]);
    const phi = Math.atan2(w[1], perp[1]);
    const k = (minY - c[1]) / (h * Math.max(R, 1e-9));
    let th = phi;
    if (k < 1) {
      const lo = phi - Math.acos(k);
      const hi = phi + Math.acos(k);
      const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
      th = Math.abs(wrap(lo)) < Math.abs(wrap(hi)) ? lo : hi;
    }
    perp = comb([perp, Math.cos(th)], [w, Math.sin(th)]);
  }
  return { joint: comb([c, 1], [perp, h]), end: add(root, to) };
}

export interface Skeleton {
  /** Chest frame. */
  frame: Frame;
  /** Pelvis frame; differs from the chest by the spine's bend. */
  pelvisFrame: Frame;
  /** Spine flexion used, degrees. */
  spine: number;
  /** Shoulder-blade glide from its rest place, per side (world, metres). */
  scap: [V3, V3];
  pelvis: V3;
  chest: V3;
  neck: V3;
  head: V3;
  headFwd: V3;
  shoulder: [V3, V3];
  elbow: [V3, V3];
  hand: [V3, V3];
  hip: [V3, V3];
  knee: [V3, V3];
  ankle: [V3, V3];
  toe: [V3, V3];
}

/** Default elbow direction: back, down and out. */
export const defaultElbowPole = (f: Frame, i: 0 | 1): V3 => comb([f.fwd, -0.6], [f.up, -0.5], [f.left, 0.6 * sideSign(i)]);
/** Default knee direction: the way the chest faces, slightly out. */
export const defaultKneePole = (f: Frame, i: 0 | 1): V3 => comb([f.fwd, 1], [f.left, 0.15 * sideSign(i)]);

/**
 * The trunk as limbs see it: ellipsoids for the rib cage and waist (in the
 * chest frame) and the pelvis (in the pelvis frame), centred and sized in
 * metres from the pelvis centre, matching the body model's surface.
 */
const TRUNK: { c: V3; r: V3; pelvic: boolean }[] = [
  { c: [0, 0.335, 0.004], r: [0.152, 0.175, 0.112], pelvic: false },
  { c: [0, 0.16, 0.004], r: [0.13, 0.12, 0.094], pelvic: false },
  { c: [0, -0.01, -0.012], r: [0.158, 0.1, 0.104], pelvic: true },
];

/** How deep a limb point of radius `r` sits inside the trunk (0 when clear). */
function trunkDepth(p: V3, r: number, pelvis: V3, f: Frame, pf: Frame): number {
  let depth = 0;
  for (const e of TRUNK) {
    const fr = e.pelvic ? pf : f;
    const d = sub(p, pelvis);
    const q = Math.hypot(
      (dot(d, fr.left) - e.c[0]) / (e.r[0] + r),
      (dot(d, fr.up) - e.c[1]) / (e.r[1] + r),
      (dot(d, fr.fwd) - e.c[2]) / (e.r[2] + r),
    );
    if (q < 1) depth += (1 - q) * Math.min(e.r[0], e.r[2]);
  }
  return depth;
}

/** Rotates `v` about the unit `axis` by `a` radians. */
function rotateAbout(v: V3, axis: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return comb([v, c], [cross(axis, v), s], [axis, dot(axis, v) * (1 - c)]);
}

/** Upper arm, elbow and forearm sample points, with the limb's radius at each. */
const ARM_SAMPLES: [number, number][] = [
  [0.45, 0.045],
  [0.75, 0.042],
  [1, 0.04],
  [1.3, 0.037],
  [1.6, 0.034],
  [1.85, 0.03],
];

/**
 * Arm IK that keeps the arm out of the trunk: if the elbow the pole asks for
 * would put the arm through the body, it swings round the shoulder–hand line
 * to the nearest place where the arm clears it.
 */
function clearArm(shoulder: V3, target: V3, pole: V3, pelvis: V3, f: Frame, pf: Frame) {
  const depthOf = (arm: { joint: V3; end: V3 }) => {
    let d = 0;
    for (const [t, r] of ARM_SAMPLES) {
      const p = t <= 1 ? comb([shoulder, 1 - t], [arm.joint, t]) : comb([arm.joint, 2 - t], [arm.end, t - 1]);
      d += trunkDepth(p, r, pelvis, f, pf);
    }
    return d;
  };
  const first = twoBone(shoulder, target, BODY.upperArm, BODY.forearm, pole);
  const d0 = depthOf(first);
  if (d0 < 1e-4) return first;
  const axis = norm(sub(first.end, shoulder));
  let best = first;
  let bestCost = d0;
  // Fine steps, so the elbow glides rather than jumps as the pose moves.
  for (let k = 1; k <= 90; k++)
    for (const sgn of [1, -1]) {
      const a = rad(2 * k * sgn);
      const arm = twoBone(shoulder, target, BODY.upperArm, BODY.forearm, rotateAbout(pole, axis, a));
      // Prefer the smallest swing that clears; a tiny cost per degree breaks ties.
      const cost = depthOf(arm) + 0.00004 * k;
      if (cost < bestCost) {
        best = arm;
        bestCost = cost;
      }
    }
  return best;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Solves a pose into joint positions. The chest goes where the pose says;
 * the pelvis tilts by the spine's bend (given, or what the legs need), the
 * legs hang off the pelvis, and the shoulder blades glide with the arms.
 */
export function solve(pose: Pose): Skeleton {
  const f = frameOf(pose.torso);
  const chest = add(pose.pelvis, mul(f.up, BODY.torso));
  const h = rad(clamp(pose.head ?? 0, NECK_RANGE));
  const headUp = norm(comb([f.up, Math.cos(h)], [f.fwd, Math.sin(h)]));
  const headFwd = norm(comb([f.fwd, Math.cos(h)], [f.up, -Math.sin(h)]));
  const neck = add(chest, mul(f.up, BODY.neck));
  const head = add(neck, mul(headUp, BODY.head));

  const legs = (spine: number) => {
    const pf = pelvisFrameOf(pose.torso, spine);
    const hip = [0, 1].map((i) => hipOf(pose.pelvis, pose.torso, i as 0 | 1, spine)) as [V3, V3];
    const solved = ([0, 1] as const).map((i) =>
      twoBone(hip[i], pose.feet[i], BODY.thigh, BODY.shin, pose.kneePole?.[i] ?? defaultKneePole(f, i), KNEE_FLOOR),
    );
    return { pf, hip, solved };
  };
  let spine = pose.spine;
  if (spine === undefined) {
    const neutral = legs(0);
    spine = autoSpine([0, 1].map((i) => hipFlexion(neutral.pf, neutral.hip[i], neutral.solved[i].joint)) as [number, number]);
  }
  spine = clamp(spine, SPINE_RANGE);
  const { pf, hip, solved } = legs(spine);

  const shoulder: V3[] = [];
  const scap: V3[] = [];
  const elbow: V3[] = [];
  const hand: V3[] = [];
  const knee: V3[] = [];
  const ankle: V3[] = [];
  const toe: V3[] = [];
  for (const i of [0, 1] as const) {
    const rest = shoulderOf(pose.pelvis, pose.torso, i, pose.shrug ?? 0);
    // A pole along the arm says nothing about where the elbow goes (a "down"
    // pole with the hands overhead), so lean it out to the side as it lines up.
    const asked = norm(pose.elbowPole?.[i] ?? defaultElbowPole(f, i));
    // Faded out with the hand near the shoulder, where the arm's line spins.
    const reach = sub(pose.hands[i], rest);
    const along = Math.abs(dot(asked, norm(reach))) * smoothstep(0.04, 0.1, len(reach));
    const ePole = comb([asked, 1], [f.left, 1.5 * sideSign(i) * smoothstep(0.3, 0.95, along)]);
    const first = clearArm(rest, pose.hands[i], ePole, pose.pelvis, f, pf);
    const straight = smoothstep(0.9, 0.985, len(sub(first.end, rest)) / ARM);
    const glide = scapula(f, i, sub(first.joint, rest), straight);
    const sh = add(rest, glide);
    const arm = clearArm(sh, pose.hands[i], ePole, pose.pelvis, f, pf);
    shoulder.push(sh);
    scap.push(glide);
    elbow.push(arm.joint);
    hand.push(arm.end);

    const kPole = pose.kneePole?.[i] ?? defaultKneePole(f, i);
    const leg = solved[i];
    knee.push(leg.joint);
    ankle.push(leg.end);

    let toeDir = pose.toes?.[i];
    if (!toeDir) {
      const shin = norm(sub(leg.end, leg.joint));
      let facing = sub(leg.joint, mid(hip[i], leg.end));
      if (len(facing) < 0.02) facing = kPole;
      const perp = sub(facing, mul(shin, dot(facing, shin)));
      toeDir = len(perp) > 1e-6 ? perp : f.fwd;
    }
    toe.push(add(leg.end, mul(norm(toeDir), BODY.foot)));
  }

  return {
    frame: f,
    pelvisFrame: pf,
    spine,
    scap: scap as [V3, V3],
    pelvis: pose.pelvis,
    chest,
    neck,
    head,
    headFwd,
    shoulder: shoulder as [V3, V3],
    elbow: elbow as [V3, V3],
    hand: hand as [V3, V3],
    hip,
    knee: knee as [V3, V3],
    ankle: ankle as [V3, V3],
    toe: toe as [V3, V3],
  };
}

/** World position of a body anchor. */
export function anchorPoint(sk: Skeleton, a: Anchor): V3 {
  switch (a) {
    case "handL":
      return sk.hand[0];
    case "handR":
      return sk.hand[1];
    case "hands":
      return mid(sk.hand[0], sk.hand[1]);
    case "elbowL":
      return sk.elbow[0];
    case "elbowR":
      return sk.elbow[1];
    case "kneeL":
      return sk.knee[0];
    case "kneeR":
      return sk.knee[1];
    case "knees":
      return mid(sk.knee[0], sk.knee[1]);
    case "footL":
      return sk.ankle[0];
    case "footR":
      return sk.ankle[1];
    case "feet":
      return mid(sk.ankle[0], sk.ankle[1]);
    case "pelvis":
      return sk.pelvis;
    case "chest":
      return local(sk.chest, sk.frame, [0, -0.12, 0.11]);
    case "upperBack":
      return local(sk.chest, sk.frame, [0, -0.12, -0.12]);
    case "shoulders":
      return mid(sk.shoulder[0], sk.shoulder[1]);
  }
}
