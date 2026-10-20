import type { Motion, Pose, V3 } from "./types.js";
import { defaultElbowPole, defaultKneePole, frameOf } from "./rig.js";
import { comb, lerp, mix } from "./vec.js";
import { easePhase, phasesOf, restOf, withTempo, type ResolvedPhase } from "./phases.js";

// Plays a Motion over time, phase by phase (see phases.ts). Keys are already
// spaced along an eased path, so time maps linearly onto them; a spline
// through the keys keeps the velocity continuous, so joints glide through
// each key instead of turning a corner.

export interface Frame {
  pose: Pose;
  /** Coaching label for the current phase. */
  cue: string;
  /** True while the target muscles do the work: the phase's effort is above 0. */
  working: boolean;
  /** 0 → 1 progress through the current phase. */
  phase: number;
  /** Index into the motion's phases. */
  phaseIndex: number;
  /** The current phase's name ("go", "hold", "return", "rest" for old-style motions). */
  phaseName: string;
  /** The current phase's effort, 0 → 1. */
  effort: number;
  /** Effort swelling and easing through the phase, 0 → 1: drives the highlight glow and muscle flex. */
  pulse: number;
  /** Completed reps (or laps) before this frame. */
  rep: number;
  /**
   * 0 → 1: how far the load is lifted. 0 where the weight rests (the start of
   * the working half), 1 at the far end. Drives weight stacks; 0 for loops.
   */
  load: number;
}

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
    spine: a.spine !== undefined && b.spine !== undefined ? lerp(a.spine, b.spine, t) : undefined,
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
    spine: ps.every((p) => p.spine !== undefined) ? s((p) => p.spine!) : undefined,
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

/** A motion with a tempo override applied (old-style timing). */
const timed = (m: Motion, tempo?: Motion["tempo"]) => (tempo ? withTempo(m, tempo) : m);

/** Length of one cycle in seconds. */
export function cycleLength(m: Motion, tempo?: Motion["tempo"]): number {
  return phasesOf(timed(m, tempo)).reduce((s, p) => s + p.time, 0);
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
    spine: pose.spine === undefined ? undefined : pose.spine - 0.8 * breath,
    head: (pose.head ?? 0) + 1.2 * sway - 1.5 * breath,
  };
}

export interface SampleOptions {
  /** Layer breathing and sway over the keys (default true). */
  alive?: boolean;
}

/**
 * Time in the cycle where the body is furthest along the path from where it
 * starts — the working end of a rep, a good still frame. 0 for loops.
 */
export function peakTime(m: Motion, tempo?: Motion["tempo"]): number {
  if (m.kind === "loop") return 0;
  const phases = phasesOf(timed(m, tempo));
  const u0 = phases[0].from;
  let best = 0;
  let at = 0;
  for (const p of phases)
    if (Math.abs(p.to - u0) > best + 1e-9) {
      best = Math.abs(p.to - u0);
      at = p.start + p.time;
    }
  return at;
}

// Resolving phases is cheap but runs every frame; remember the last motion's.
let cache: { m: Motion; tempo?: Motion["tempo"]; phases: ResolvedPhase[]; breath: number[] } | null = null;

function resolved(m: Motion, tempo?: Motion["tempo"]) {
  if (cache?.m === m && cache.tempo === tempo) return cache;
  const phases = phasesOf(timed(m, tempo));
  // Breath level at the start of each phase, carried round the cycle twice
  // so the first phase starts where the last one leaves off.
  const breath: number[] = [];
  let level = 0;
  for (let lap = 0; lap < 2; lap++)
    phases.forEach((p, i) => {
      breath[i] = level;
      if (p.breath === "out") level = 0;
      else if (p.breath === "in") level = 1;
    });
  cache = { m, tempo, phases, breath };
  return cache;
}

export function sample(m: Motion, time: number, tempo?: Motion["tempo"], opts: SampleOptions = {}): Frame {
  const live = opts.alive ?? true;
  const { phases, breath: breathAt } = resolved(m, tempo);
  const cycle = phases.reduce((s, p) => s + p.time, 0);
  const rep = Math.floor(time / cycle);
  const t = time - rep * cycle;
  // The phase holding t; zero-length phases are passed over.
  let i = phases.length - 1;
  for (let j = 0; j < phases.length; j++)
    if (phases[j].time > 0 && t < phases[j].start + phases[j].time) {
      i = j;
      break;
    }
  const ph = phases[i];
  const phase = ph.time > 0 ? Math.min(1, Math.max(0, (t - ph.start) / ph.time)) : 1;
  const e = easePhase(ph.ease, phase);
  const u = lerp(ph.from, ph.to, e);
  const loop = m.kind === "loop";
  const pose = ph.keys ? along(ph.keys, e, false) : along(m.keys, u, loop);
  // Load: how far the path is from where the weight rests.
  const load = loop ? 0 : Math.min(1, Math.abs(u - restOf(m)));
  const pulse = ph.effort * Math.sin(Math.PI * phase);
  let breath: number;
  if (ph.breath === undefined) breath = 0.5 + 0.5 * Math.sin((time * 2 * Math.PI) / 3.5); // free, about every 3.5 s
  else {
    const from = breathAt[i];
    const target = ph.breath === "out" ? 0 : ph.breath === "in" ? 1 : from;
    breath = lerp(from, target, phase * phase * (3 - 2 * phase));
  }
  return {
    pose: live ? alive(pose, time, breath) : pose,
    cue: ph.cue,
    working: ph.effort > 0,
    phase,
    phaseIndex: i,
    phaseName: ph.name,
    effort: ph.effort,
    pulse,
    rep,
    load,
  };
}
