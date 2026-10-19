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

/** Hip joint (0 = left, 1 = right). */
export function hipOf(pelvis: V3, torso: V3, i: 0 | 1): V3 {
  const f = frameOf(torso);
  return local(pelvis, f, [sideSign(i) * BODY.hipHalf, -0.02, 0]);
}

/**
 * Two-bone IK. Places the middle joint so the chain reaches `target` (or as
 * close as the bones allow) and bends towards `pole`.
 */
export function twoBone(root: V3, target: V3, l1: number, l2: number, pole: V3): { joint: V3; end: V3 } {
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
  return { joint: comb([root, 1], [dir, a], [perp, h]), end: add(root, to) };
}

export interface Skeleton {
  frame: Frame;
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

/** Solves a pose into joint positions. */
export function solve(pose: Pose): Skeleton {
  const f = frameOf(pose.torso);
  const chest = add(pose.pelvis, mul(f.up, BODY.torso));
  const h = rad(pose.head ?? 0);
  const headUp = norm(comb([f.up, Math.cos(h)], [f.fwd, Math.sin(h)]));
  const headFwd = norm(comb([f.fwd, Math.cos(h)], [f.up, -Math.sin(h)]));
  const neck = add(chest, mul(f.up, BODY.neck));
  const head = add(neck, mul(headUp, BODY.head));

  const shoulder: [V3, V3] = [0, 1].map((i) => shoulderOf(pose.pelvis, pose.torso, i as 0 | 1, pose.shrug ?? 0)) as [V3, V3];
  const hip: [V3, V3] = [0, 1].map((i) => hipOf(pose.pelvis, pose.torso, i as 0 | 1)) as [V3, V3];

  const elbow: V3[] = [];
  const hand: V3[] = [];
  const knee: V3[] = [];
  const ankle: V3[] = [];
  const toe: V3[] = [];
  for (const i of [0, 1] as const) {
    const ePole = pose.elbowPole?.[i] ?? defaultElbowPole(f, i);
    const arm = twoBone(shoulder[i], pose.hands[i], BODY.upperArm, BODY.forearm, ePole);
    elbow.push(arm.joint);
    hand.push(arm.end);

    const kPole = pose.kneePole?.[i] ?? defaultKneePole(f, i);
    const leg = twoBone(hip[i], pose.feet[i], BODY.thigh, BODY.shin, kPole);
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
    pelvis: pose.pelvis,
    chest,
    neck,
    head,
    headFwd,
    shoulder,
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
