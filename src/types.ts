// Data model of the movement-guide engine.
//
// One engine animates every exercise. An exercise is pure data — a
// MotionSpec: which movement pattern to use, the pattern's settings, the
// generic equipment parts in the scene, and optional tempo/camera tweaks.
// Adding an exercise never needs new rendering code.
//
// World space: metres, Y up, floor at y = 0. The figure stands at the origin
// facing +Z, so its left hand side is +X.

export type V3 = [number, number, number];

/** A full-body pose. Hands and feet are IK targets; the solver places the rest. */
export interface Pose {
  /** Centre of the pelvis. */
  pelvis: V3;
  /** Chest orientation in degrees: [pitch (+ leans forward), yaw (+ turns left), roll (+ tips to its right)]. */
  torso: V3;
  /**
   * Spine flexion in degrees between pelvis and chest (+ curls forward, − arches
   * back); the pelvis tilts by the rest of the torso's pitch. The bend is
   * shared along the lower and upper back. Omit to let the hips do the work
   * within their range, the spine taking only what they cannot.
   */
  spine?: number;
  /** Neck flexion in degrees (+ looks down). */
  head?: number;
  /** Shoulder elevation in metres (shrugs). */
  shrug?: number;
  /** Grip points [left, right]. */
  hands: [V3, V3];
  /** Ankle points [left, right]. */
  feet: [V3, V3];
  /** Direction each elbow should point (world). Defaults: back, down and out. */
  elbowPole?: [V3, V3];
  /** Direction each knee should point (world). Defaults to the chest's facing. */
  kneePole?: [V3, V3];
  /** Direction the toes point (world). Defaults to the knee's facing. */
  toes?: [V3, V3];
}

/** Body points equipment can attach to. */
export type Anchor =
  | "handL"
  | "handR"
  | "hands"
  | "elbowL"
  | "elbowR"
  | "kneeL"
  | "kneeR"
  | "knees"
  | "footL"
  | "footR"
  | "feet"
  | "pelvis"
  | "chest"
  | "upperBack"
  | "shoulders";

/**
 * Generic, standard equipment, assembled from settings. Parts with `to`
 * follow a body anchor every frame (a bar in the hands, a pad on the shins),
 * everything else is static frame.
 */
export type Part =
  | { kind: "bench"; at?: V3; /** back-rest incline in degrees, 0 = flat */ incline?: number; height?: number; length?: number }
  | { kind: "seat"; at: V3; /** back-rest recline from vertical in degrees; omit for no back */ back?: number; width?: number }
  | { kind: "box"; at: V3; size: V3; /** rotation about X in degrees */ tilt?: number; tone?: Tone }
  | { kind: "pad"; to: Anchor; size: V3; offset?: V3; tilt?: number; roller?: boolean }
  | { kind: "barbell"; style?: "straight" | "ez" | "trap"; length?: number; plates?: boolean }
  | { kind: "dumbbell"; to: "handL" | "handR" | "hands" }
  | { kind: "kettlebell"; to: Anchor; offset?: V3 }
  | { kind: "cable"; from: V3; to: Anchor; handle?: "bar" | "rope" | "single" | "none"; tower?: boolean }
  | { kind: "lever"; pivot: V3; to: Anchor; offset?: V3; end?: "handle" | "roller" | "pad" | "none"; width?: number }
  | { kind: "platform"; to: Anchor; /** plate normal tilt from vertical, degrees */ tilt: number; offset?: V3 }
  /** Plate-loaded sled on rails (leg press): the carriage rides with `to` along rails rising at `angle` degrees. */
  | { kind: "sled"; to: Anchor; angle: number; offset?: V3 }
  | { kind: "rack"; height: number; width?: number; z?: number }
  | { kind: "smith"; z?: number }
  | { kind: "pullupBar"; height: number; z?: number }
  | { kind: "dipBars"; height: number; z?: number }
  | { kind: "band" }
  | { kind: "stack"; at: V3 }
  | { kind: "treadmill" }
  | { kind: "bike" }
  | { kind: "rower" }
  | { kind: "elliptical" }
  | { kind: "stairs" };

export type Tone = "frame" | "pad" | "metal";

export type PatternId =
  | "squat"
  | "hinge"
  | "swing"
  | "legPress"
  | "kneeExtension"
  | "kneeCurl"
  | "hipAbduction"
  | "calfRaise"
  | "kickback"
  | "hipThrust"
  | "lunge"
  | "press"
  | "overheadPress"
  | "armArc"
  | "row"
  | "pulldown"
  | "pullUp"
  | "inverted"
  | "pushUp"
  | "elbow"
  | "dip"
  | "shrug"
  | "trunkFlex"
  | "legRaise"
  | "twist"
  | "woodchop"
  | "plank"
  | "deadBug"
  | "mountainClimber"
  | "burpee"
  | "thruster"
  | "carry"
  | "cardio";

export type ParamValue = number | string | boolean;
export type Params = Record<string, ParamValue>;

/** Everything needed to show one exercise. Plain data — serialisable, editable later. */
export interface MotionSpec {
  pattern: PatternId;
  params?: Params;
  equipment?: Part[];
  /** Seconds: [first half, pause, second half, pause]. Overrides the pattern's default timing; ignored with `phases`. */
  tempo?: [number, number, number, number];
  /** The rep as phases, replacing the pattern's own. Positions name points on the pattern's path. */
  phases?: Phase[];
  /** Extra named positions (0 → 1) for `phases`. */
  positions?: Record<string, number>;
  camera?: { yaw?: number; pitch?: number; zoom?: number };
  /** Name of the machine or station shown, e.g. "Smith machine". */
  device?: string;
}

/** How a phase moves through time. "linear" follows the keys as authored (they are already eased). */
export type PhaseEase = "linear" | "smooth" | "explosive";
export type Breath = "in" | "out" | "hold";

/**
 * One part of a rep: move along the path to `to`, or hold still when `to` is
 * omitted, for `time` seconds.
 */
export interface Phase {
  /** Shown to apps as `Frame.phaseName`, e.g. "lower", "pause", "drive". */
  name?: string;
  /** Where the phase ends: a path position 0 → 1 or a named position. Omit to hold still. */
  to?: number | string;
  /** Seconds. */
  time: number;
  /**
   * The phase's own path instead of the motion's keys, played from first to
   * last — a different way back, say. Start it where the previous phase ends
   * and end it where `to` is on the main path.
   */
  keys?: Pose[];
  ease?: PhaseEase;
  /** Coaching label; a phase without one keeps the previous phase's. */
  cue?: string;
  /** How hard the target muscles work, 0 → 1. Drives the highlight pulse and the muscle flex. Default 0. */
  effort?: number;
  /** Breathing. Defaults: out while working, in while moving easy, held in a hold; free in a loop. */
  breath?: Breath;
}

/** What a pattern produces: a time-less movement the timeline plays. */
export interface Motion {
  /** Poses sampled evenly along the movement: the path phases move along. */
  keys: Pose[];
  /**
   * rep:  a path from keys[0] (position 0) to keys[last] (position 1); phases
   *       move back and forth along it.
   * loop: keys[0] → … → keys[last] → keys[0] (position 1 wraps to 0); phases
   *       only move forwards.
   */
  kind: "rep" | "loop";
  /**
   * The parts of one rep or lap, played in order and repeated. When omitted
   * the old fields below describe it (tempo, period, effort, cues), which
   * makes four phases for a rep — go, hold, return, rest — and two for a loop.
   */
  phases?: Phase[];
  /** Extra named positions on the path (0 → 1) for phases to move to. Built in: start, mid, end, rest, peak. */
  positions?: Record<string, number>;
  /** Path position where the load rests (weight stacks sit down here). Default 0, or 1 for `effort: "second"`. */
  rest?: number;
  /** Old format: seconds of [go, hold, return, rest]. */
  tempo?: [number, number, number, number];
  /** Old format: seconds per loop. */
  period?: number;
  /** Old format: which half of a rep does the work (keys[0] → keys[last] is "first"). */
  effort?: "first" | "second" | "both";
  /** Old format: coaching labels for the two halves, e.g. ["Lower", "Press"]. */
  cues?: [string, string];
  /** The pattern's usual equipment; a spec's own `equipment` replaces it. */
  defaultEquipment?: Part[];
}

// ── Exercise input ─────────────────────────────────────────────────────────

/** Muscle groups the figure can highlight. */
export type Muscle =
  | "chest"
  | "shoulders"
  | "rear delts"
  | "triceps"
  | "biceps"
  | "forearms"
  | "lats"
  | "upper back"
  | "traps"
  | "lower back"
  | "abs"
  | "obliques"
  | "glutes"
  | "quads"
  | "hamstrings"
  | "adductors"
  | "abductors"
  | "calves"
  | "full body"
  | "cardio";

/** How an exercise is loaded. Picks the bar, dumbbells or machine shown. */
export type Equipment =
  | "barbell"
  | "dumbbell"
  | "kettlebell"
  | "machine"
  | "plate_loaded"
  | "cable"
  | "smith"
  | "ez_bar"
  | "trap_bar"
  | "band"
  | "bodyweight"
  | "cardio_machine"
  | "other";

/**
 * What the catalog needs to know about an exercise. `id` matches a catalog
 * entry (see `EXERCISE_IDS`); any other id is inferred from the name,
 * equipment and main muscle.
 */
export interface ExerciseInput {
  id: string;
  name: string;
  equipment?: Equipment | null;
  primaryMuscle?: Muscle | string | null;
}
