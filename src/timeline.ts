import type { Motion, Pose, V3 } from "./types.js";
import { defaultElbowPole, defaultKneePole, frameOf } from "./rig.js";
import { lerp, mix } from "./vec.js";

// Plays a Motion over time. Keys are already spaced along an eased path, so
// time maps linearly onto them.

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

/** Pose at position u ∈ [0, 1] along the keys (cyclic for loops). */
function along(keys: Pose[], u: number, cyclic: boolean): Pose {
  const n = keys.length;
  if (n === 1) return keys[0];
  const x = cyclic ? (((u % 1) + 1) % 1) * n : Math.min(1, Math.max(0, u)) * (n - 1);
  const i = Math.min(Math.floor(x), cyclic ? n - 1 : n - 2);
  return lerpPose(keys[i], keys[(i + 1) % n], x - i);
}

/** Length of one cycle in seconds. */
export function cycleLength(m: Motion, tempo?: Motion["tempo"]): number {
  if (m.kind === "loop") return m.period ?? 1;
  return (tempo ?? m.tempo ?? DEFAULT_TEMPO).reduce((s, x) => s + x, 0);
}

export function sample(m: Motion, time: number, tempo?: Motion["tempo"]): Frame {
  const [c1, c2] = m.cues ?? ["", ""];
  const effort = m.effort ?? "first";
  if (m.kind === "loop") {
    const period = m.period ?? 1;
    const u = (((time / period) % 1) + 1) % 1;
    return { pose: along(m.keys, u, true), cue: u < 0.5 ? c1 : c2, working: true, phase: (u * 2) % 1, load: 0 };
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
  return { pose: along(m.keys, u, false), cue: half === 0 ? c1 : c2, working, phase, load };
}
