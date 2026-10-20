import type { Breath, Motion, Phase, PhaseEase } from "./types.js";

// Phases: a rep (or a loop) as a list of named parts. Each one moves the body
// along the motion's path to a position, or holds still, for a number of
// seconds, with its own cue, effort and breathing. Motions written the old
// way (tempo, two cues, a working half) turn into the same four phases they
// always played: go, hold, return, rest.

/** A phase with every default filled in and its position resolved to a number. */
export interface ResolvedPhase {
  name: string;
  /** Path position at the start and end, 0 (start) → 1 (far end). Loops count past 1 as they wrap. */
  from: number;
  to: number;
  time: number;
  /** Seconds into the cycle where this phase starts. */
  start: number;
  hold: boolean;
  keys?: Motion["keys"];
  ease: PhaseEase;
  cue: string;
  effort: number;
  /** Undefined in a loop: free breathing. */
  breath?: Breath;
}

const DEFAULT_TEMPO: [number, number, number, number] = [1.2, 0.3, 1.8, 0.3];
/** The four phases a tempo times, in order. */
export const TEMPO_PHASES = ["go", "hold", "return", "rest"] as const;

/** Where the load rests on the path: 0 unless the work is done on the way back. */
export const restOf = (m: Motion) => m.rest ?? (m.kind === "rep" && m.effort === "second" ? 1 : 0);

/** Named positions on the path: start, mid, end, rest (where the load sits) and peak (the far side). */
export function positionsOf(m: Motion): Record<string, number> {
  const rest = restOf(m);
  return { start: 0, mid: 0.5, end: 1, rest, peak: 1 - rest, ...m.positions };
}

/**
 * The standard rep: go to the far end, hold, return, rest. `effort` says
 * which way does the work ("first" = on the way out).
 */
export function standardPhases(
  effort: "first" | "second" | "both",
  [c1, c2]: [string, string],
  [a, h1, b, h2]: [number, number, number, number] = DEFAULT_TEMPO,
): Phase[] {
  const out = effort !== "second";
  return [
    { name: "go", to: "end", time: a, cue: c1, effort: effort === "second" ? 0 : 1, breath: out ? "out" : "in" },
    { name: "hold", time: h1, cue: c1, effort: 0, breath: "hold" },
    { name: "return", to: "start", time: b, cue: c2, effort: effort === "first" ? 0 : 1, breath: out ? "in" : "out" },
    { name: "rest", time: h2, cue: c2, effort: 0, breath: "hold" },
  ];
}

/** The standard loop: two working halves with free breathing. */
export function loopPhases(period: number, [c1, c2]: [string, string]): Phase[] {
  return [
    { name: "first", to: 0.5, time: period / 2, cue: c1, effort: 1 },
    { name: "second", to: 1, time: period / 2, cue: c2, effort: 1 },
  ];
}

/** The old fields as phases. */
function legacyPhases(m: Motion): Phase[] {
  const cues = m.cues ?? ["", ""];
  if (m.kind === "loop") return loopPhases(m.period ?? 1, cues);
  return standardPhases(m.effort ?? "first", cues, m.tempo ?? DEFAULT_TEMPO);
}

/**
 * Times the four standard phases (go, hold, return, rest) from a tempo. A
 * motion whose phases are shaped differently keeps its own timing.
 */
export function withTempo(m: Motion, tempo: [number, number, number, number]): Motion {
  if (!m.phases) return { ...m, tempo };
  if (m.phases.length !== 4 || m.phases.some((p, i) => p.name !== TEMPO_PHASES[i])) return m;
  return { ...m, tempo, phases: m.phases.map((p, i) => ({ ...p, time: tempo[i] })) };
}

/** Problems with a motion's phases, as messages; empty when it plays. */
export function checkPhases(m: Motion): string[] {
  const errors: string[] = [];
  const phases = m.phases ?? legacyPhases(m);
  const names = positionsOf(m);
  if (!phases.length) errors.push("a motion needs at least one phase");
  let total = 0;
  phases.forEach((p, i) => {
    const at = `phase ${i + 1}${p.name ? ` (${p.name})` : ""}`;
    if (!(p.time >= 0) || !Number.isFinite(p.time)) errors.push(`${at}: time must be zero or more seconds`);
    else total += p.time;
    if (typeof p.to === "string" && !(p.to in names)) errors.push(`${at}: unknown position "${p.to}" (known: ${Object.keys(names).join(", ")})`);
    if (typeof p.to === "number" && !(p.to >= 0 && p.to <= 1)) errors.push(`${at}: position ${p.to} is outside 0 → 1`);
    if (p.effort !== undefined && !(p.effort >= 0 && p.effort <= 1)) errors.push(`${at}: effort must be 0 → 1`);
    if (p.keys && !p.keys.length) errors.push(`${at}: keys must hold at least one pose`);
  });
  if (phases.length && !(total > 0)) errors.push("the phases must take some time");
  return errors;
}

/** A motion's phases, resolved: explicit ones as written, old-style motions converted. */
export function phasesOf(m: Motion): ResolvedPhase[] {
  const errors = checkPhases(m);
  if (errors.length) throw new Error(`Invalid motion phases: ${errors.join("; ")}`);
  const phases = m.phases ?? legacyPhases(m);
  const names = positionsOf(m);
  const pos = (to: Phase["to"]) => (typeof to === "string" ? names[to] : to);
  const loop = m.kind === "loop";
  // A cycle starts where it ends; a rep's last move says where that is.
  let u = 0;
  for (const p of phases) if (p.to !== undefined) u = pos(p.to)!;
  if (loop) u = 0;
  let start = 0;
  let cue = "";
  return phases.map((p, i) => {
    const hold = p.to === undefined;
    let to = hold ? u : pos(p.to)!;
    // Loops only move forwards; reaching the same point again is a full lap.
    if (loop && !hold) while (to <= u + 1e-9) to += 1;
    cue = p.cue ?? cue;
    const effort = p.effort ?? 0;
    const breath = p.breath ?? (loop ? undefined : hold ? "hold" : effort > 0 ? "out" : "in");
    const r: ResolvedPhase = { name: p.name ?? `phase ${i + 1}`, from: u, to, time: p.time, start, hold, keys: p.keys, ease: p.ease ?? "linear", cue, effort, breath };
    start += p.time;
    u = to;
    return r;
  });
}

/** Progress through a phase reshaped by its ease. Keys are already spaced along an eased path, so "linear" follows them as authored. */
export function easePhase(e: PhaseEase, p: number): number {
  switch (e) {
    case "smooth":
      return p * p * (3 - 2 * p);
    case "explosive":
      // Fast off the mark, settling into the end.
      return 1 - (1 - p) ** 2.2;
    default:
      return p;
  }
}
