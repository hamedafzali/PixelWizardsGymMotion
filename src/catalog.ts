import type { ExerciseInput, Motion, MotionSpec, Part, V3 } from "./types.js";
import { buildMotion } from "./patterns.js";

// The exercise library as data: exercise id → MotionSpec. Equipment is built
// from a small set of standard presets, so a new exercise is a few lines here
// (or, for user-made exercises, inferred from its name and equipment).

// ── Equipment presets ──────────────────────────────────────────────────────
const bar = (style: "straight" | "ez" | "trap" = "straight", length?: number): Part => ({ kind: "barbell", style, length });
const dbs: Part[] = [
  { kind: "dumbbell", to: "handL" },
  { kind: "dumbbell", to: "handR" },
];
const db1: Part[] = [{ kind: "dumbbell", to: "hands" }];
const flatBench = (at: V3 = [0, 0.46, 0.08]): Part => ({ kind: "bench", at, incline: 0, length: 0.95 });
const inclineBench: Part = { kind: "bench", at: [0, 0.46, -0.02], incline: 35, length: 0.85 };
const uprightBench: Part = { kind: "bench", at: [0, 0.43, -0.02], incline: 82, length: 0.72 };
const seat = (back?: number, at: V3 = [0, 0.43, 0]): Part => ({ kind: "seat", at, back });
const stack = (at: V3 = [-0.62, 0, -0.35]): Part => ({ kind: "stack", at });
const mat: Part = { kind: "box", at: [0, 0.006, 0], size: [0.65, 0.012, 1.8], tone: "pad" };
const tower = (from: V3, handle: "bar" | "rope" | "single" | "none" = "bar", to: "hands" | "handL" | "handR" = "hands"): Part => ({
  kind: "cable",
  from,
  to,
  handle,
  tower: true,
});
const handles = (pivotL: V3, end: "handle" | "roller" | "pad" = "handle"): Part[] => [
  { kind: "lever", pivot: pivotL, to: "handL", end },
  { kind: "lever", pivot: [-pivotL[0], pivotL[1], pivotL[2]], to: "handR", end },
];
const kneePad: Part = { kind: "pad", to: "knees", size: [0.42, 0.07, 0.12], offset: [0, 0.08, -0.02], roller: true };
const rack: Part = { kind: "rack", height: 1.38, width: 1.2, z: -0.12 };
const benchRack = (height = 1.08, z = -0.62): Part => ({ kind: "rack", height, width: 1.15, z });
const thrustBench: Part = { kind: "box", at: [0, 0.22, -0.72], size: [0.9, 0.44, 0.36], tone: "pad" };

// ── The library ────────────────────────────────────────────────────────────
export const MOTIONS: Record<string, MotionSpec> = {
  // Legs — machines
  "e-legpress": {
    pattern: "legPress",
    params: { angle: 42 },
    equipment: [seat(48, [0, 0.4, 0]), { kind: "sled", to: "feet", angle: 42, offset: [0, 0.1, 0.05] }],
  },
  "e-legcurl": {
    pattern: "kneeCurl",
    equipment: [
      seat(12),
      { kind: "pad", to: "knees", size: [0.44, 0.08, 0.14], offset: [0, 0.1, -0.06] },
      { kind: "lever", pivot: [0.34, 0.51, 0.44], to: "feet", offset: [0, 0.03, -0.07], end: "roller", width: 0.42 },
      stack(),
    ],
  },
  "e-legext": {
    pattern: "kneeExtension",
    equipment: [seat(12), { kind: "lever", pivot: [0.34, 0.51, 0.44], to: "feet", offset: [0, 0.02, 0.07], end: "roller", width: 0.42 }, stack()],
  },
  "e-lycurl": {
    pattern: "kneeExtension",
    params: { mode: "lyingCurl" },
    equipment: [
      { kind: "box", at: [0, 0.69, 0.25], size: [0.38, 0.08, 1.3], tone: "pad" },
      { kind: "box", at: [0, 0.33, 0.25], size: [0.1, 0.66, 1.0], tone: "frame" },
      { kind: "lever", pivot: [0.32, 0.72, -0.44], to: "feet", offset: [0, 0.06, 0], end: "roller", width: 0.42 },
    ],
  },
  "e-hacksquat": {
    pattern: "squat",
    params: { load: "hack" },
    equipment: [
      { kind: "box", at: [0.34, 0.95, -0.3], size: [0.06, 0.06, 2.1], tilt: -60, tone: "frame" },
      { kind: "box", at: [-0.34, 0.95, -0.3], size: [0.06, 0.06, 2.1], tilt: -60, tone: "frame" },
      { kind: "pad", to: "upperBack", size: [0.42, 0.6, 0.07], offset: [0, -0.12, -0.04], tilt: -14 },
      { kind: "pad", to: "shoulders", size: [0.56, 0.07, 0.12], offset: [0, 0.07, -0.02] },
      { kind: "box", at: [0, 0.025, 0.26], size: [0.8, 0.05, 0.55], tone: "metal" },
    ],
    camera: { yaw: 70 },
  },
  "e-adduct": {
    pattern: "hipAbduction",
    params: { out: false },
    equipment: [
      seat(10),
      { kind: "pad", to: "kneeL", size: [0.05, 0.2, 0.26], offset: [-0.07, 0, 0] },
      { kind: "pad", to: "kneeR", size: [0.05, 0.2, 0.26], offset: [0.07, 0, 0] },
      stack(),
    ],
    camera: { yaw: 20, pitch: 30 },
  },
  "e-abduct": {
    pattern: "hipAbduction",
    equipment: [
      seat(10),
      { kind: "pad", to: "kneeL", size: [0.05, 0.2, 0.26], offset: [0.08, 0, 0] },
      { kind: "pad", to: "kneeR", size: [0.05, 0.2, 0.26], offset: [-0.08, 0, 0] },
      stack(),
    ],
    camera: { yaw: 20, pitch: 30 },
  },
  "e-calfraise": {
    pattern: "calfRaise",
    params: { step: 0.1 },
    equipment: [
      { kind: "box", at: [0, 0.05, 0.16], size: [0.6, 0.1, 0.26], tone: "metal" },
      { kind: "pad", to: "shoulders", size: [0.6, 0.08, 0.14], offset: [0, 0.07, 0] },
      { kind: "box", at: [0.42, 1.1, -0.12], size: [0.06, 2.2, 0.06], tone: "frame" },
      { kind: "box", at: [-0.42, 1.1, -0.12], size: [0.06, 2.2, 0.06], tone: "frame" },
    ],
  },
  "e-seatcalf": {
    pattern: "calfRaise",
    params: { seated: true, step: 0.1 },
    equipment: [
      seat(undefined, [0, 0.55, 0]),
      { kind: "box", at: [0, 0.05, 0.68], size: [0.5, 0.1, 0.22], tone: "metal" },
      { kind: "pad", to: "knees", size: [0.42, 0.07, 0.16], offset: [0, 0.08, 0] },
      { kind: "lever", pivot: [0.32, 0.6, -0.2], to: "knees", offset: [0, 0.1, 0], end: "none" },
    ],
  },
  "e-glutekick": {
    pattern: "kickback",
    equipment: [
      { kind: "pad", to: "chest", size: [0.38, 0.3, 0.07], offset: [0, -0.04, 0.05], tilt: 35 },
      { kind: "lever", pivot: [-0.3, 0.92, 0.05], to: "footR", offset: [0, -0.04, -0.08], end: "pad" },
      { kind: "box", at: [0.1, 0.015, 0.06], size: [0.25, 0.03, 0.35], tone: "metal" },
      { kind: "box", at: [0, 0.6, 0.5], size: [0.5, 1.2, 0.08], tone: "frame" },
    ],
  },
  "e-hipthrustm": {
    pattern: "hipThrust",
    params: { hold: "handles" },
    equipment: [
      thrustBench,
      { kind: "pad", to: "pelvis", size: [0.48, 0.07, 0.18], offset: [0, 0.13, 0.04] },
      { kind: "lever", pivot: [0.36, 0.32, 0.35], to: "pelvis", offset: [0, 0.13, 0.04], end: "none" },
      { kind: "lever", pivot: [-0.36, 0.32, 0.35], to: "pelvis", offset: [0, 0.13, 0.04], end: "none" },
    ],
  },

  // Legs — free weights
  "e-squat": { pattern: "squat", params: { load: "back" }, equipment: [rack, bar()] },
  "e-frontsquat": { pattern: "squat", params: { load: "front" }, equipment: [rack, bar()] },
  "e-smithsquat": { pattern: "squat", params: { load: "smith" }, equipment: [{ kind: "smith", z: 0 }, bar("straight", 1.9)] },
  "e-gobletsquat": { pattern: "squat", params: { load: "goblet" }, equipment: db1 },
  "e-rdl": { pattern: "hinge", equipment: [bar()] },
  "e-dbrdl": { pattern: "hinge", params: { grip: 0.18 }, equipment: dbs },
  "e-lunge": { pattern: "lunge", params: { style: "walking" }, equipment: dbs },
  "e-splitsquat": {
    pattern: "lunge",
    params: { style: "bulgarian" },
    equipment: [...dbs, { kind: "box", at: [-0.08, 0.22, -0.72], size: [0.36, 0.44, 0.42], tone: "pad" }],
  },
  "e-stepup": {
    pattern: "lunge",
    params: { style: "step", box: 0.42 },
    equipment: [...dbs, { kind: "box", at: [0, 0.21, 0.34], size: [0.6, 0.42, 0.44], tone: "pad" }],
  },
  "e-hipthrust": { pattern: "hipThrust", equipment: [thrustBench, bar()] },
  "e-kbswing": { pattern: "swing", equipment: [{ kind: "kettlebell", to: "hands", offset: [0, -0.1, 0] }] },
  "e-bwsquat": { pattern: "squat", params: { load: "none" } },
  "e-glutebridge": { pattern: "hipThrust", params: { floor: true, hold: "floor" }, equipment: [mat] },

  // Chest
  "e-chestpress": { pattern: "press", params: { posture: "seated", grip: 0.3 }, equipment: [seat(12), ...handles([0.42, 1.35, -0.2]), stack()] },
  "e-inclinepressm": {
    pattern: "press",
    params: { posture: "seated", lean: -30, grip: 0.3 },
    equipment: [seat(30), ...handles([0.42, 1.55, -0.3]), stack()],
  },
  "e-pecdeck": {
    pattern: "armArc",
    params: { plane: "transverse", posture: "seated", from: 80, to: 10, bend: 25, elevFrom: 5, elevTo: 5, cues: "Squeeze|Open" },
    equipment: [seat(4), ...handles([0.2, 1.42, -0.06]), stack()],
    camera: { yaw: 30, pitch: 40 },
  },
  "e-bench": { pattern: "press", params: { grip: 0.4 }, equipment: [flatBench(), benchRack(), bar()] },
  "e-inclinebench": { pattern: "press", params: { posture: "incline", grip: 0.38 }, equipment: [inclineBench, benchRack(1.5, -0.6), bar()] },
  "e-dbbench": { pattern: "press", params: { grip: 0.3, tucked: true }, equipment: [flatBench(), ...dbs] },
  "e-dbincline": { pattern: "press", params: { posture: "incline", grip: 0.3, tucked: true }, equipment: [inclineBench, ...dbs] },
  "e-dbfly": {
    pattern: "armArc",
    params: { plane: "transverse", posture: "lying", from: 78, to: 6, bend: 22, elevFrom: 12, elevTo: 0, cues: "Squeeze|Open" },
    equipment: [flatBench(), ...dbs],
    camera: { yaw: 20, pitch: 40 },
  },
  "e-cablefly": {
    pattern: "armArc",
    params: { plane: "transverse", posture: "standing", lean: 14, from: 78, to: 6, bend: 18, elevFrom: -22, elevTo: 28, cues: "Squeeze|Open" },
    equipment: [tower([1.15, 2.05, -0.1], "single", "handL"), tower([-1.15, 2.05, -0.1], "single", "handR")],
    camera: { yaw: 25 },
  },
  "e-smithbench": { pattern: "press", params: { grip: 0.4 }, equipment: [flatBench(), { kind: "smith", z: -0.43 }, bar("straight", 1.9)] },
  "e-pushup": { pattern: "pushUp", equipment: [mat] },
  "e-dip": { pattern: "dip", equipment: [{ kind: "dipBars", height: 1.3 }] },
  "e-weighteddip": { pattern: "dip", equipment: [{ kind: "dipBars", height: 1.3 }, { kind: "kettlebell", to: "pelvis", offset: [0, -0.32, 0.06] }] },
  "e-assistdip": {
    pattern: "dip",
    params: { style: "kneePad" },
    equipment: [{ kind: "dipBars", height: 1.3 }, { kind: "pad", to: "knees", size: [0.42, 0.06, 0.3], offset: [0, -0.07, 0] }, stack([-0.6, 0, -0.5])],
  },

  // Back
  "e-pulldown": { pattern: "pulldown", equipment: [seat(), kneePad, tower([0, 2.3, 0.08], "bar")] },
  "e-row": {
    pattern: "row",
    params: { style: "machine" },
    equipment: [seat(), { kind: "box", at: [0, 0.98, 0.3], size: [0.36, 0.36, 0.08], tone: "pad" }, ...handles([0.3, 0.25, 0.8]), stack([-0.62, 0, 0.6])],
  },
  "e-cablerow": {
    pattern: "row",
    params: { style: "cable" },
    equipment: [
      { kind: "box", at: [0, 0.18, 0.15], size: [0.32, 0.36, 1.3], tone: "pad" },
      { kind: "box", at: [0, 0.3, 0.76], size: [0.55, 0.3, 0.05], tone: "metal", tilt: -20 },
      tower([0, 0.38, 1.05], "single"),
    ],
  },
  "e-closepulldown": { pattern: "pulldown", params: { grip: "neutral" }, equipment: [seat(), kneePad, tower([0, 2.3, 0.08], "single")] },
  "e-straightpd": {
    pattern: "armArc",
    params: { plane: "sagittal", lean: 22, from: 118, to: 12, bend: 10, poleU: 0.3, poleF: -1, poleL: 0.4, cues: "Pull down|Return" },
    equipment: [tower([0, 2.1, 0.8], "bar")],
  },
  "e-tbarrow": {
    pattern: "row",
    params: { style: "tbar" },
    equipment: [
      { kind: "lever", pivot: [0, 0.04, -1.05], to: "hands", offset: [0, -0.04, 0.08], end: "handle", width: 0.22 },
      { kind: "box", at: [0, 0.025, 0], size: [0.7, 0.05, 0.5], tone: "metal" },
    ],
  },
  "e-bbrow": { pattern: "row", params: { style: "bent" }, equipment: [bar()] },
  "e-dbrow": { pattern: "row", params: { style: "oneArm" }, equipment: [flatBench([0.24, 0.44, 0.32]), { kind: "dumbbell", to: "handR" }], camera: { yaw: -60 } },
  "e-deadlift": { pattern: "hinge", params: { from: "floor" }, equipment: [bar()] },
  "e-trapdeadlift": { pattern: "hinge", params: { from: "floor", trap: true }, equipment: [bar("trap")] },
  "e-pullup": { pattern: "pullUp", equipment: [{ kind: "pullupBar", height: 2.25 }] },
  "e-chinup": { pattern: "pullUp", params: { grip: "chin" }, equipment: [{ kind: "pullupBar", height: 2.25 }] },
  "e-weightedpullup": {
    pattern: "pullUp",
    equipment: [{ kind: "pullupBar", height: 2.25 }, { kind: "kettlebell", to: "pelvis", offset: [0, -0.32, 0.06] }],
  },
  "e-assistpullup": {
    pattern: "pullUp",
    params: { kneePad: true },
    equipment: [{ kind: "pullupBar", height: 2.25 }, { kind: "pad", to: "knees", size: [0.42, 0.06, 0.3], offset: [0, -0.07, 0] }, stack([-0.6, 0, -0.5])],
  },
  "e-invrow": { pattern: "inverted", params: { bar: 1.0 }, equipment: [{ kind: "pullupBar", height: 1.0, z: -0.06 }] },
  "e-backext": {
    pattern: "trunkFlex",
    params: { style: "backExt" },
    equipment: [
      seat(),
      { kind: "pad", to: "upperBack", size: [0.44, 0.24, 0.07], offset: [0, 0, -0.06] },
      { kind: "lever", pivot: [0.34, 0.62, -0.08], to: "upperBack", offset: [0, 0, -0.06], end: "none" },
      stack(),
    ],
  },
  "e-hyperext": {
    pattern: "trunkFlex",
    params: { style: "hyper" },
    equipment: [
      { kind: "box", at: [0, 0.8, 0.02], size: [0.45, 0.08, 0.36], tilt: -45, tone: "pad" },
      { kind: "box", at: [0, 0.25, -0.62], size: [0.42, 0.05, 0.3], tilt: -45, tone: "metal" },
      { kind: "box", at: [0, 0.5, -0.32], size: [0.08, 0.08, 1.1], tilt: -45, tone: "frame" },
    ],
  },
  "e-shrug": { pattern: "shrug", equipment: dbs },
  "e-facepull": {
    pattern: "row",
    params: { style: "face", cues: "Pull to face|Release" },
    equipment: [tower([0, 1.75, 0.95], "rope")],
    camera: { yaw: 55, pitch: 18 },
  },

  // Shoulders
  "e-shpressm": { pattern: "overheadPress", params: { posture: "seated", style: "machine" }, equipment: [seat(6), ...handles([0.42, 0.95, -0.35]), stack()] },
  "e-ohp": { pattern: "overheadPress", equipment: [bar()] },
  "e-dbpress": { pattern: "overheadPress", params: { posture: "seated", style: "dumbbell" }, equipment: [uprightBench, ...dbs], camera: { yaw: 30 } },
  "e-arnold": { pattern: "overheadPress", params: { posture: "seated", style: "arnold" }, equipment: [uprightBench, ...dbs], camera: { yaw: 30 } },
  "e-lateral": { pattern: "armArc", params: { plane: "frontal", from: 8, to: 82, bend: 14 }, equipment: dbs, camera: { yaw: 15 } },
  "e-latraisem": {
    pattern: "armArc",
    params: { plane: "frontal", posture: "seated", from: 10, to: 80, bend: 70 },
    equipment: [
      seat(),
      { kind: "pad", to: "elbowL", size: [0.07, 0.07, 0.2], offset: [0.04, 0, 0] },
      { kind: "pad", to: "elbowR", size: [0.07, 0.07, 0.2], offset: [-0.04, 0, 0] },
      stack([-0.1, 0, -0.55]),
    ],
    camera: { yaw: 15 },
  },
  "e-cablelateral": {
    pattern: "armArc",
    params: { plane: "frontal", from: 0, to: 80, bend: 12, arms: "right" },
    equipment: [tower([0.55, 0.12, 0.05], "single", "handR")],
    camera: { yaw: 10 },
  },
  "e-frontraise": { pattern: "armArc", params: { plane: "sagittal", from: 6, to: 88, bend: 10 }, equipment: dbs },
  "e-reversefly": {
    pattern: "armArc",
    params: { plane: "transverse", posture: "seated", lean: 8, from: 8, to: 85, bend: 8, cues: "Open|Return" },
    equipment: [seat(), { kind: "box", at: [0, 0.98, 0.3], size: [0.36, 0.4, 0.08], tone: "pad" }, ...handles([0.12, 1.35, 0.3]), stack()],
    camera: { yaw: 150, pitch: 35 },
  },
  "e-dbreversefly": {
    pattern: "armArc",
    params: { plane: "transverse", posture: "bent", from: 8, to: 80, bend: 12, cues: "Open|Return" },
    equipment: dbs,
    camera: { yaw: 25, pitch: 30 },
  },
  "e-uprightrow": { pattern: "row", params: { style: "upright", cues: "Pull up|Lower" }, equipment: [tower([0, 0.1, 0.38], "bar")], camera: { yaw: 35 } },

  // Arms
  "e-curl": { pattern: "elbow", equipment: dbs },
  "e-hammercurl": { pattern: "elbow", equipment: dbs },
  "e-bbcurl": { pattern: "elbow", params: { out: 10 }, equipment: [bar("straight", 1.4)] },
  "e-ezcurl": { pattern: "elbow", params: { out: 10 }, equipment: [bar("ez", 1.3)] },
  "e-preacher": {
    pattern: "elbow",
    params: { posture: "seated", upperArm: 40, lean: 12, from: 15, to: 125 },
    equipment: [seat(), { kind: "box", at: [0, 1.0, 0.33], size: [0.5, 0.04, 0.32], tilt: -50, tone: "pad" }, bar("ez", 1.3)],
  },
  "e-cablecurl": { pattern: "elbow", equipment: [tower([0, 0.1, 0.6], "bar")] },
  "e-curlm": {
    pattern: "elbow",
    params: { posture: "seated", upperArm: 50, lean: 10, from: 15, to: 125 },
    equipment: [seat(), { kind: "box", at: [0, 1.02, 0.32], size: [0.55, 0.04, 0.3], tilt: -40, tone: "pad" }, ...handles([0.22, 0.86, 0.38])],
  },
  "e-pushdown": {
    pattern: "elbow",
    params: { upperArm: 8, lean: 8, from: 100, to: 6, cues: "Push down|Return" },
    equipment: [tower([0, 2.05, 0.42], "bar")],
  },
  "e-ohcableext": {
    pattern: "elbow",
    params: { upperArm: 162, lean: 22, from: 140, to: 12, together: true, cues: "Extend|Return" },
    equipment: [tower([0, 0.95, -0.75], "rope")],
  },
  "e-skullcrusher": {
    pattern: "elbow",
    params: { posture: "lying", upperArm: 100, from: 10, to: 118, effort: "second", cues: "Lower|Extend" },
    equipment: [flatBench(), bar("ez", 1.3)],
  },
  "e-dbohext": {
    pattern: "elbow",
    params: { posture: "seated", upperArm: 165, from: 135, to: 12, together: true, cues: "Extend|Lower" },
    equipment: [uprightBench, ...db1],
  },
  "e-trim": {
    pattern: "elbow",
    params: { posture: "seated", upperArm: 50, from: 110, to: 15, cues: "Extend|Return" },
    equipment: [seat(), { kind: "box", at: [0, 1.0, 0.3], size: [0.55, 0.04, 0.3], tilt: -40, tone: "pad" }, ...handles([0.22, 0.86, 0.36])],
  },
  "e-dipm": { pattern: "press", params: { posture: "seated", dir: "down" }, equipment: [seat(5), ...handles([0.4, 0.95, -0.4]), stack()] },
  "e-closebench": { pattern: "press", params: { grip: 0.2, tucked: true }, equipment: [flatBench(), benchRack(), bar()] },
  "e-benchdip": { pattern: "dip", params: { style: "bench" }, equipment: [{ kind: "box", at: [0, 0.22, -0.38], size: [0.9, 0.44, 0.36], tone: "pad" }] },
  "e-wristcurl": { pattern: "elbow", params: { posture: "seated", upperArm: 35, lean: 25, from: 85, to: 110 }, equipment: [flatBench([0, 0.43, 0.2]), ...dbs] },
  "e-farmer": { pattern: "carry", equipment: dbs },

  // Core
  "e-abs": {
    pattern: "trunkFlex",
    params: { style: "machine" },
    equipment: [seat(), { kind: "pad", to: "chest", size: [0.44, 0.08, 0.1], offset: [0, 0.1, 0.05] }, stack()],
  },
  "e-cablecrunch": { pattern: "trunkFlex", params: { style: "cable" }, equipment: [mat, tower([0, 2.15, 0.62], "rope")] },
  "e-rotary": { pattern: "twist", params: { style: "machine" }, equipment: [seat(), { kind: "pad", to: "chest", size: [0.4, 0.08, 0.1], offset: [0, 0, 0.06] }], camera: { yaw: 20, pitch: 45 } },
  "e-woodchop": { pattern: "woodchop", equipment: [tower([-1.0, 2.1, 0.12], "single")], camera: { yaw: 15 } },
  "e-crunch": { pattern: "trunkFlex", params: { style: "crunch" }, equipment: [mat] },
  "e-legraise": { pattern: "legRaise", equipment: [{ kind: "pullupBar", height: 2.25 }] },
  "e-kneeraise": {
    pattern: "legRaise",
    params: { style: "captain", knees: true },
    equipment: [
      { kind: "box", at: [0, 1.2, -0.2], size: [0.42, 0.6, 0.07], tone: "pad" },
      { kind: "box", at: [0.24, 1.2, 0.08], size: [0.1, 0.06, 0.38], tone: "pad" },
      { kind: "box", at: [-0.24, 1.2, 0.08], size: [0.1, 0.06, 0.38], tone: "pad" },
      { kind: "box", at: [0.3, 0.7, -0.22], size: [0.05, 1.4, 0.05], tone: "frame" },
      { kind: "box", at: [-0.3, 0.7, -0.22], size: [0.05, 1.4, 0.05], tone: "frame" },
    ],
  },
  "e-russiantwist": { pattern: "twist", equipment: [mat], camera: { yaw: 20, pitch: 30 } },
  "e-plank": { pattern: "plank", equipment: [mat] },
  "e-sideplank": { pattern: "plank", params: { style: "side" }, equipment: [{ ...mat, size: [1.8, 0.012, 0.65], at: [0.2, 0.006, 0] }], camera: { yaw: 5 } },
  "e-hollow": { pattern: "plank", params: { style: "hollow" }, equipment: [mat] },
  "e-deadhang": { pattern: "pullUp", params: { hold: true }, equipment: [{ kind: "pullupBar", height: 2.25 }] },
  "e-deadbug": { pattern: "deadBug", equipment: [mat], camera: { yaw: 50, pitch: 35 } },
  "e-mountain": { pattern: "mountainClimber", equipment: [mat] },
  "e-burpee": { pattern: "burpee", equipment: [mat] },
  "e-thruster": { pattern: "thruster", equipment: dbs },
  "e-kbgoblet": { pattern: "squat", params: { load: "goblet" }, equipment: [{ kind: "kettlebell", to: "hands", offset: [0, -0.04, 0] }] },
  "e-bandpullapart": {
    pattern: "armArc",
    params: { plane: "transverse", from: 6, to: 84, bend: 4, cues: "Pull apart|Return" },
    equipment: [{ kind: "band" }],
    camera: { yaw: 20, pitch: 30 },
  },

  // Machine versions of free-weight lifts (see MACHINE below)
  "m-smithrdl": { pattern: "hinge", equipment: [{ kind: "smith", z: 0.08 }, bar("straight", 1.9)] },
  "m-smithdeadlift": { pattern: "hinge", params: { from: "floor" }, equipment: [{ kind: "smith", z: 0.04 }, bar("straight", 1.9)] },
  "m-smithsplit": { pattern: "lunge", params: { style: "split", hold: "back" }, equipment: [{ kind: "smith", z: -0.1 }, bar("straight", 1.9)], camera: { yaw: 70 } },
  "m-smithshrug": { pattern: "shrug", equipment: [{ kind: "smith", z: 0.05 }, bar("straight", 1.9)] },
  "m-smithclose": { pattern: "press", params: { grip: 0.2, tucked: true }, equipment: [flatBench(), { kind: "smith", z: -0.43 }, bar("straight", 1.9)] },
  "m-cablefront": { pattern: "armArc", params: { plane: "sagittal", from: 6, to: 88, bend: 10 }, equipment: [tower([0, 0.1, -0.35], "bar")], camera: { yaw: 60 } },

  // Cardio
  "e-treadmill": { pattern: "cardio", params: { machine: "treadmill" }, equipment: [{ kind: "treadmill" }] },
  "e-bike": { pattern: "cardio", params: { machine: "bike" }, equipment: [{ kind: "bike" }] },
  "e-rower": {
    pattern: "cardio",
    params: { machine: "rower" },
    equipment: [{ kind: "rower" }, { kind: "pad", to: "pelvis", size: [0.3, 0.05, 0.3], offset: [0, -0.09, 0] }, { kind: "cable", from: [0, 0.5, 0.95], to: "hands", handle: "bar" }],
  },
  "e-elliptical": {
    pattern: "cardio",
    params: { machine: "elliptical" },
    equipment: [
      { kind: "elliptical" },
      { kind: "pad", to: "footL", size: [0.12, 0.03, 0.34], offset: [0, -0.09, 0.08] },
      { kind: "pad", to: "footR", size: [0.12, 0.03, 0.34], offset: [0, -0.09, 0.08] },
      { kind: "lever", pivot: [0.27, 0.55, 0.45], to: "handL", end: "handle" },
      { kind: "lever", pivot: [-0.27, 0.55, 0.45], to: "handR", end: "handle" },
    ],
  },
  "e-stairs": {
    pattern: "cardio",
    params: { machine: "stairs" },
    equipment: [
      { kind: "stairs" },
      { kind: "pad", to: "footL", size: [0.14, 0.03, 0.3], offset: [0, -0.09, 0.08] },
      { kind: "pad", to: "footR", size: [0.14, 0.03, 0.3], offset: [0, -0.09, 0.08] },
    ],
  },
};

// ── Machines everywhere ────────────────────────────────────────────────────

/**
 * Free-weight lift → the standard machine that trains the same movement. The
 * guide shows the machine; the free-weight specs stay in the library as data.
 * Bodyweight moves and implements with no machine equivalent (kettlebell
 * swing, carries) keep their own setup.
 */
export const MACHINE: Record<string, string> = {
  "e-squat": "e-smithsquat",
  "e-frontsquat": "e-hacksquat",
  "e-gobletsquat": "e-hacksquat",
  "e-kbgoblet": "e-hacksquat",
  "e-rdl": "m-smithrdl",
  "e-dbrdl": "m-smithrdl",
  "e-deadlift": "m-smithdeadlift",
  "e-trapdeadlift": "m-smithdeadlift",
  "e-lunge": "m-smithsplit",
  "e-splitsquat": "m-smithsplit",
  "e-stepup": "e-legpress",
  "e-hipthrust": "e-hipthrustm",
  "e-bench": "e-smithbench",
  "e-inclinebench": "e-inclinepressm",
  "e-dbbench": "e-chestpress",
  "e-dbincline": "e-inclinepressm",
  "e-dbfly": "e-pecdeck",
  "e-closebench": "m-smithclose",
  "e-bbrow": "e-row",
  "e-dbrow": "e-cablerow",
  "e-shrug": "m-smithshrug",
  "e-ohp": "e-shpressm",
  "e-dbpress": "e-shpressm",
  "e-arnold": "e-shpressm",
  "e-lateral": "e-latraisem",
  "e-frontraise": "m-cablefront",
  "e-dbreversefly": "e-reversefly",
  "e-curl": "e-curlm",
  "e-hammercurl": "e-cablecurl",
  "e-bbcurl": "e-cablecurl",
  "e-ezcurl": "e-cablecurl",
  "e-preacher": "e-curlm",
  "e-skullcrusher": "e-trim",
  "e-dbohext": "e-ohcableext",
};

/** The machine or station each spec shows, for the guide's label. */
const SMITH = "Smith machine";
const CABLE = "Cable station";
export const DEVICE: Record<string, string> = {
  "e-legpress": "Leg press",
  "e-legcurl": "Seated leg curl",
  "e-legext": "Leg extension",
  "e-lycurl": "Lying leg curl",
  "e-hacksquat": "Hack squat",
  "e-adduct": "Adductor machine",
  "e-abduct": "Abductor machine",
  "e-calfraise": "Standing calf machine",
  "e-seatcalf": "Seated calf machine",
  "e-glutekick": "Glute kickback machine",
  "e-hipthrustm": "Hip thrust machine",
  "e-smithsquat": SMITH,
  "e-chestpress": "Chest press machine",
  "e-inclinepressm": "Incline press machine",
  "e-pecdeck": "Pec deck",
  "e-cablefly": "Cable crossover",
  "e-smithbench": SMITH,
  "e-assistdip": "Assisted dip machine",
  "e-pulldown": "Lat pulldown",
  "e-row": "Seated row machine",
  "e-cablerow": "Seated cable row",
  "e-closepulldown": "Lat pulldown",
  "e-straightpd": CABLE,
  "e-tbarrow": "T-bar row",
  "e-assistpullup": "Assisted pull-up machine",
  "e-backext": "Back extension machine",
  "e-hyperext": "Hyperextension bench",
  "e-facepull": CABLE,
  "e-shpressm": "Shoulder press machine",
  "e-latraisem": "Lateral raise machine",
  "e-cablelateral": CABLE,
  "e-reversefly": "Reverse fly machine",
  "e-uprightrow": CABLE,
  "e-cablecurl": CABLE,
  "e-curlm": "Biceps curl machine",
  "e-pushdown": CABLE,
  "e-ohcableext": CABLE,
  "e-trim": "Triceps extension machine",
  "e-dipm": "Triceps dip machine",
  "e-abs": "Ab crunch machine",
  "e-cablecrunch": CABLE,
  "e-rotary": "Rotary torso machine",
  "e-woodchop": CABLE,
  "e-treadmill": "Treadmill",
  "e-bike": "Exercise bike",
  "e-rower": "Rowing machine",
  "e-elliptical": "Elliptical",
  "e-stairs": "Stair climber",
  "m-smithrdl": SMITH,
  "m-smithdeadlift": SMITH,
  "m-smithsplit": SMITH,
  "m-smithshrug": SMITH,
  "m-smithclose": SMITH,
  "m-cablefront": CABLE,
};

// ── Fallback for exercises outside the library ────────────────────────────

/** Name keywords → a library exercise whose movement matches. First match wins. */
const KEYWORDS: [RegExp, string][] = [
  [/treadmill|run|jog|walk(?!ing lunge)/, "e-treadmill"],
  [/bike|cycl|spin/, "e-bike"],
  [/rower|rowing machine|erg/, "e-rower"],
  [/elliptical|cross.?trainer/, "e-elliptical"],
  [/stair|step.?mill/, "e-stairs"],
  [/burpee/, "e-burpee"],
  [/mountain/, "e-mountain"],
  [/thruster/, "e-thruster"],
  [/dead.?bug/, "e-deadbug"],
  [/side plank/, "e-sideplank"],
  [/plank/, "e-plank"],
  [/hollow/, "e-hollow"],
  [/hang(?!ing leg)/, "e-deadhang"],
  [/leg raise|toes to bar/, "e-legraise"],
  [/knee raise/, "e-kneeraise"],
  [/russian|twist/, "e-russiantwist"],
  [/rotat/, "e-rotary"],
  [/chop/, "e-woodchop"],
  [/cable crunch|kneeling crunch/, "e-cablecrunch"],
  [/crunch|sit.?up/, "e-crunch"],
  [/carry|walk/, "e-farmer"],
  [/leg press/, "e-legpress"],
  [/hack/, "e-hacksquat"],
  [/leg ext/, "e-legext"],
  [/lying.*curl|prone.*curl/, "e-lycurl"],
  [/leg curl|hamstring curl/, "e-legcurl"],
  [/adduct/, "e-adduct"],
  [/abduct/, "e-abduct"],
  [/seated calf/, "e-seatcalf"],
  [/calf/, "e-calfraise"],
  [/kickback.*(glute|cable|machine)|glute kick|donkey/, "e-glutekick"],
  [/hip thrust|bridge/, "e-hipthrust"],
  [/swing/, "e-kbswing"],
  [/romanian|rdl|stiff|good morning/, "e-rdl"],
  [/trap bar|hex bar/, "e-trapdeadlift"],
  [/deadlift/, "e-deadlift"],
  [/front squat/, "e-frontsquat"],
  [/goblet/, "e-gobletsquat"],
  [/smith.*squat/, "e-smithsquat"],
  [/squat/, "e-squat"],
  [/bulgarian|split/, "e-splitsquat"],
  [/step.?up/, "e-stepup"],
  [/lunge/, "e-lunge"],
  [/back ext|hyperext|reverse hyper/, "e-hyperext"],
  [/pull.?apart/, "e-bandpullapart"],
  [/face pull/, "e-facepull"],
  [/upright/, "e-uprightrow"],
  [/shrug/, "e-shrug"],
  [/reverse (fly|pec)|rear delt/, "e-dbreversefly"],
  [/lateral|side raise/, "e-lateral"],
  [/front raise/, "e-frontraise"],
  [/arnold/, "e-arnold"],
  [/overhead press|military|shoulder press|ohp/, "e-ohp"],
  [/pec deck|butterfly/, "e-pecdeck"],
  [/crossover|cable fly/, "e-cablefly"],
  [/fly/, "e-dbfly"],
  [/push.?up|press.?up/, "e-pushup"],
  [/bench dip/, "e-benchdip"],
  [/dip/, "e-dip"],
  [/skull|lying tricep|french/, "e-skullcrusher"],
  [/overhead.*(ext|tricep)/, "e-dbohext"],
  [/pushdown|push.?down|tricep/, "e-pushdown"],
  [/wrist/, "e-wristcurl"],
  [/preacher/, "e-preacher"],
  [/hammer/, "e-hammercurl"],
  [/curl/, "e-curl"],
  [/chin.?up/, "e-chinup"],
  [/pull.?up/, "e-pullup"],
  [/straight.?arm|pullover/, "e-straightpd"],
  [/pulldown|pull.?down/, "e-pulldown"],
  [/inverted|australian/, "e-invrow"],
  [/t.?bar/, "e-tbarrow"],
  [/one.?arm.*row|single.?arm.*row|dumbbell row/, "e-dbrow"],
  [/cable row|seated row/, "e-cablerow"],
  [/row/, "e-bbrow"],
  [/incline.*(dumbbell|db)/, "e-dbincline"],
  [/incline/, "e-inclinebench"],
  [/(dumbbell|db).*(bench|press)/, "e-dbbench"],
  [/chest press/, "e-chestpress"],
  [/bench|press/, "e-bench"],
];

const BY_MUSCLE: Record<string, string> = {
  chest: "e-chestpress",
  shoulders: "e-shpressm",
  "rear delts": "e-reversefly",
  triceps: "e-pushdown",
  biceps: "e-curl",
  forearms: "e-wristcurl",
  lats: "e-pulldown",
  "upper back": "e-row",
  traps: "e-shrug",
  "lower back": "e-backext",
  abs: "e-crunch",
  obliques: "e-russiantwist",
  glutes: "e-hipthrust",
  quads: "e-squat",
  hamstrings: "e-rdl",
  adductors: "e-adduct",
  abductors: "e-abduct",
  calves: "e-calfraise",
  "full body": "e-burpee",
  cardio: "e-treadmill",
};

/** Equipment that matches how the exercise is loaded, for an inferred movement. */
function equipmentFor(ex: Pick<ExerciseInput, "equipment">, spec: MotionSpec): Part[] | undefined {
  const pattern = spec.pattern;
  const freeWeightPattern = ["squat", "hinge", "press", "overheadPress", "row", "elbow", "shrug", "armArc", "lunge", "carry"].includes(pattern);
  if (!freeWeightPattern) return spec.equipment;
  const statics = (spec.equipment ?? []).filter((p) => !["barbell", "dumbbell", "kettlebell", "cable", "lever"].includes(p.kind));
  switch (ex.equipment) {
    case "barbell":
      return [...statics, bar()];
    case "ez_bar":
      return [...statics, bar("ez", 1.3)];
    case "trap_bar":
      return [...statics, bar("trap")];
    case "dumbbell":
      return [...statics, ...dbs];
    case "kettlebell":
      return [...statics, { kind: "kettlebell", to: "handL" }, { kind: "kettlebell", to: "handR" }];
    case "band":
      return [...statics, { kind: "band" }];
    default:
      return spec.equipment;
  }
}

/** Movement for any exercise, shown on a machine wherever one exists: the
 * library entry, or one inferred from its name, equipment and muscles. */
export function motionSpecFor(ex: ExerciseInput): MotionSpec {
  const known = !!MOTIONS[ex.id];
  const name = ex.name.toLowerCase();
  const id = known ? ex.id : (KEYWORDS.find(([re]) => re.test(name))?.[1] ?? BY_MUSCLE[ex.primaryMuscle ?? ""] ?? "e-bwsquat");
  const shown = MACHINE[id] ?? id;
  const spec = MOTIONS[shown];
  // A machine keeps its own setup; an inferred free-weight move takes the exercise's loading.
  const equipment = known || DEVICE[shown] ? spec.equipment : equipmentFor(ex, spec);
  return { ...spec, equipment, device: DEVICE[shown] };
}

/** A spec turned into a playable motion. Spec equipment and tempo win over the pattern's own. */
export function resolveMotion(spec: MotionSpec): { motion: Motion; equipment: Part[] } {
  const motion = buildMotion(spec.pattern, spec.params);
  return {
    motion: spec.tempo ? { ...motion, tempo: spec.tempo } : motion,
    equipment: spec.equipment ?? motion.defaultEquipment ?? [],
  };
}

/** Every exercise id with its own catalog entry. */
export const EXERCISE_IDS = Object.keys(MOTIONS);
