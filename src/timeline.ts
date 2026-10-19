import type { Motion, Pose, V3 } from "./types.js";
import { defaultElbowPole, defaultKneePole, frameOf } from "./rig.js";
import { comb, lerp, mix } from "./vec.js";

// Plays a Motion over time. Keys are already spaced along an eased path, so
// time maps linearly onto them; a spline through the keys keeps the velocity
// continuous, so joints glide through each key instead of turning a corner.

export interface Frame {
  pose: Pose;
  /** Coaching label for the current half of the rep. */
  cue: string;
  /** True while the target muscles do the work (drives the highlight pulse). */
  working: boolean;
  /** 0 → 1 progress through the current half. */
  phase: number;
  /**
   * 0 → 1: how far the load is lifted. 0 where the weight rests (the start of
   * the working half), 1 at the far end. Drives weight stacks; 0 for loops.
   */
  load: number;
}

const DEFAULT_TEMPO: [number, number, number, number] = [1.2, 0.3, 1.8, 0.3];

type Pair = [V3, V3];
const lerpPair = (a: Pair, b: Pair, t: number): Pair => [mix(a[0], b[0], t), mix(a[1], b[1], t)];
const elbowPoles = (p: Pose): Pair => p.elbowPole ?? [defaultElbowPole(frameOf(p.torso), 0), defaultElbowPole(frameOf(p.torso), 1)];
const kneePoles = (p: Pose): Pair => p.kneePole ?? [defaultKneePole(frameOf(p.torso), 0), defaultKneePole(frameOf(p.torso), 1)];

/** Blends two poses. Missing poles take their defaults; toes only blend when both keys set them. */
export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  if (t <= 0) return a;
  if (t >= 1) return b;
  return {
    pelvis: mix(a.pelvis, b.pelvis, t),
    torso: mix(a.torso, b.torso, t),
    head: lerp(a.head ?? 0, b.head ?? 0, t),
    shrug: lerp(a.shrug ?? 0, b.shrug ?? 0, t),
    hands: lerpPair(a.hands, b.hands, t),
    feet: lerpPair(a.feet, b.feet, t),
    elbowPole: a.elbowPole || b.elbowPole ? lerpPair(elbowPoles(a), elbowPoles(b), t) : undefined,
    kneePole: a.kneePole || b.kneePole ? lerpPair(kneePoles(a), kneePoles(b), t) : undefined,
    toes: a.toes && b.toes ? lerpPair(a.toes, b.toes, t) : undefined,
  };
}

/** Weighted sum of poses; the weights sum to 1. */
function blendPoses(ps: Pose[], ws: number[]): Pose {
  const v = (f: (p: Pose) => V3) => comb(...ps.map((p, i): [V3, number] => [f(p), ws[i]]));
  const s = (f: (p: Pose) => number) => ps.reduce((acc, p, i) => acc + f(p) * ws[i], 0);
  const pr = (f: (p: Pose) => Pair): Pair => [v((p) => f(p)[0]), v((p) => f(p)[1])];
  return {
    pelvis: v((p) => p.pelvis),
    torso: v((p) => p.torso),
    head: s((p) => p.head ?? 0),
    shrug: s((p) => p.shrug ?? 0),
    hands: pr((p) => p.hands),
    feet: pr((p) => p.feet),
    elbowPole: ps.some((p) => p.elbowPole) ? pr(elbowPoles) : undefined,
    kneePole: ps.some((p) => p.kneePole) ? pr(kneePoles) : undefined,
    toes: ps.every((p) => p.toes) ? pr((p) => p.toes!) : undefined,
  };
}

/**
 * Cardinal-spline weights for the four keys around a segment. Tension below
 * Catmull-Rom's 0.5 keeps unevenly spaced keys from overshooting.
 */
const TENSION = 0.4;
function splineWeights(t: number): number[] {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return [-TENSION * h10, h00 - TENSION * h11, h01 + TENSION * h10, TENSION * h11];
}

/** Pose at position u ∈ [0, 1] along the keys (cyclic for loops). */
function along(keys: Pose[], u: number, cyclic: boolean): Pose {
  const n = keys.length;
  if (n === 1) return keys[0];
  const x = cyclic ? (((u % 1) + 1) % 1) * n : Math.min(1, Math.max(0, u)) * (n - 1);
  const i = Math.min(Math.floor(x), cyclic ? n - 1 : n - 2);
  const t = x - i;
  if (t <= 0) return keys[i];
  // Past either end of a rep the path is mirrored, so it arrives at the
  // turnaround with zero velocity and the hold that follows is seamless.
  const at = (j: number) => keys[cyclic ? ((j % n) + n) % n : j < 0 ? Math.min(1, n - 1) : j >= n ? Math.max(0, n - 2) : j];
  return blendPoses([at(i - 1), at(i), at(i + 1), at(i + 2)], splineWeights(t));
}

/** Length of one cycle in seconds. */
export function cycleLength(m: Motion, tempo?: Motion["tempo"]): number {
  if (m.kind === "loop") return m.period ?? 1;
  return (tempo ?? m.tempo ?? DEFAULT_TEMPO).reduce((s, x) => s + x, 0);
}

/**
 * Breathing and a little postural sway, layered over a pose so the body is
 * never frozen, even in a hold. Breath follows the rep: in on the easy half,
 * out on the effort. `breath` is 0 (empty) → 1 (full).
 */
function alive(pose: Pose, time: number, breath: number): Pose {
  const sway = Math.sin(time * 1.3) * 0.6 + Math.sin(time * 0.53 + 1) * 0.4;
  return {
    ...pose,
    // The chest lifts and the spine extends a touch on the inhale.
    shrug: (pose.shrug ?? 0) + 0.006 * breath,
    torso: [pose.torso[0] - 0.8 * breath, pose.torso[1] + 0.4 * sway, pose.torso[2]],
    head: (pose.head ?? 0) + 1.2 * sway - 1.5 * breath,
  };
}

export interface SampleOptions {
  /** Layer breathing and sway over the keys (default true). */
  alive?: boolean;
}

export function sample(m: Motion, time: number, tempo?: Motion["tempo"], opts: SampleOptions = {}): Frame {
  const live = opts.alive ?? true;
  const [c1, c2] = m.cues ?? ["", ""];
  const effort = m.effort ?? "first";
  if (m.kind === "loop") {
    const period = m.period ?? 1;
    const u = (((time / period) % 1) + 1) % 1;
    const pose = along(m.keys, u, true);
    // Free breathing, about every 3.5 s, whatever the loop's own rhythm.
    const breath = 0.5 + 0.5 * Math.sin((time * 2 * Math.PI) / 3.5);
    return { pose: live ? alive(pose, time, breath) : pose, cue: u < 0.5 ? c1 : c2, working: true, phase: (u * 2) % 1, load: 0 };
  }
  const [a, h1, b, h2] = tempo ?? m.tempo ?? DEFAULT_TEMPO;
  const t = ((time % (a + h1 + b + h2)) + (a + h1 + b + h2)) % (a + h1 + b + h2);
  let u: number;
  let half: 0 | 1;
  let phase: number;
  if (t < a) [u, half, phase] = [t / a, 0, t / a];
  else if (t < a + h1) [u, half, phase] = [1, 0, 1];
  else if (t < a + h1 + b) [u, half, phase] = [1 - (t - a - h1) / b, 1, (t - a - h1) / b];
  else [u, half, phase] = [0, 1, 1];
  const working = effort === "both" || (effort === "first" ? half === 0 : half === 1);
  // The working half lifts: from keys[0] for "first", towards keys[0] for "second".
  const load = effort === "second" ? 1 - u : u;
  const pose = along(m.keys, u, false);
  // Exhale through the working half, inhale through the other; holds keep
  // the breath where it is.
  const exhale = effort === "both" ? half === 0 : working;
  const ease = phase * phase * (3 - 2 * phase);
  const breath = exhale ? 1 - ease : ease;
  return { pose: live ? alive(pose, time, breath) : pose, cue: half === 0 ? c1 : c2, working, phase, load };
}
