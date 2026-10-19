import type { Motion, Params, PatternId, Pose, V3 } from "./types.js";
import { ARM, BODY, LEG, STAND, chestOf, frameOf, hipOf, local, shoulderOf, sideSign, type Frame } from "./rig.js";
import { add, comb, lerp, mid, mix, mul, norm, rad, sub } from "./vec.js";

// Movement patterns. Each one turns a handful of settings into a Motion.
// ~30 patterns cover the whole library: a new exercise is a new set of
// settings, not new code.

const A: number = BODY.ankle;
const SIDES = [0, 1] as const;

// ── Settings readers ───────────────────────────────────────────────────────
const num = (p: Params, k: string, d: number) => (typeof p[k] === "number" ? (p[k] as number) : d);
const str = <T extends string>(p: Params, k: string, d: T) => (typeof p[k] === "string" ? (p[k] as T) : d);
const bool = (p: Params, k: string, d: boolean) => (typeof p[k] === "boolean" ? (p[k] as boolean) : d);
const cues = (p: Params, d: [string, string]): [string, string] => {
  const c = p.cues;
  return typeof c === "string" && c.includes("|") ? (c.split("|", 2) as [string, string]) : d;
};

/** Samples a movement t ∈ [0, 1] into evenly spaced keys. */
function sweep(n: number, at: (t: number) => Pose): Pose[] {
  return Array.from({ length: n }, (_, i) => at(i / (n - 1)));
}
const ease = (t: number) => 0.5 - Math.cos(Math.PI * t) / 2;
const pair = (f: (i: 0 | 1, s: number) => V3): [V3, V3] => [f(0, 1), f(1, -1)];

// ── Shared body helpers ────────────────────────────────────────────────────
const stance = (w = 0.12, z = 0, y = A): [V3, V3] => [
  [w, y, z],
  [-w, y, z],
];
const toesOut = (deg = 12): [V3, V3] => pair((_, s) => [s * Math.sin(rad(deg)), 0, Math.cos(rad(deg))]);
/** Feet flat under the knees for a seat whose pelvis is at `pelvis`. */
const seatedFeet = (pelvis: V3, w = 0.14): [V3, V3] => stance(w, pelvis[2] + BODY.thigh + 0.03);
/** Arms hanging straight down from the shoulders. */
const hang = (pelvis: V3, torso: V3, i: 0 | 1, w?: number, shrug = 0, fwd = 0.03): V3 => {
  const sh = shoulderOf(pelvis, torso, i, shrug);
  return [w === undefined ? sh[0] + sideSign(i) * 0.03 : sideSign(i) * w, sh[1] - ARM * 0.97, sh[2] + fwd];
};
const onHip = (pelvis: V3, f: Frame, i: 0 | 1): V3 => local(pelvis, f, [sideSign(i) * 0.21, 0.06, 0.03]);
/** Pole in torso-local [up, fwd, left·side] coefficients. */
const pole = (f: Frame, s: number, u: number, fw: number, l: number): V3 => comb([f.up, u], [f.fwd, fw], [f.left, l * s]);
/** Elbow pole that reproduces an elbow position exactly. */
const through = (joint: V3, root: V3, end: V3): V3 => sub(joint, mid(root, end));

type Posture = "standing" | "seated" | "lying" | "incline" | "bent" | "kneeling";

/** Base body placement shared by upper-body patterns. */
function base(posture: Posture, lean = 0): { pelvis: V3; torso: V3; feet: [V3, V3]; kneePole?: [V3, V3]; toes?: [V3, V3] } {
  switch (posture) {
    case "seated": {
      const pelvis: V3 = [0, 0.53, 0];
      return { pelvis, torso: [lean, 0, 0], feet: seatedFeet(pelvis) };
    }
    case "lying":
      return { pelvis: [0, 0.57, 0], torso: [-90 + lean, 0, 0], feet: stance(0.3, 0.5), kneePole: pair((_, s) => [s * 0.3, 1, 0.2]) };
    case "incline":
      return { pelvis: [0, 0.56, 0], torso: [-55 + lean, 0, 0], feet: stance(0.24, 0.48) };
    case "bent":
      return { pelvis: [0, 0.85, -0.17], torso: [68 + lean, 0, 0], feet: stance(0.14, 0) };
    case "kneeling":
      return {
        pelvis: [0, 0.52, 0],
        torso: [lean, 0, 0],
        feet: stance(0.12, -0.43, 0.07),
        kneePole: pair(() => [0, -0.5, 1]),
        toes: pair(() => [0, -0.2, -1]),
      };
    default:
      return { pelvis: [0, STAND - 0.01, 0], torso: [lean, 0, 0], feet: stance(0.13), toes: toesOut(8) };
  }
}

// ── Lower body ─────────────────────────────────────────────────────────────

function squat(p: Params): Motion {
  const load = str(p, "load", "back" as "back" | "front" | "goblet" | "none" | "sides" | "hack" | "smith" | "shoulders");
  const depth = num(p, "depth", 1);
  const hack = load === "hack";
  const w = num(p, "stance", 0.15);
  const feetZ = hack ? 0.24 : load === "smith" ? 0.1 : 0;
  const lean = { back: 36, smith: 22, front: 20, goblet: 24, none: 34, sides: 30, hack: -14, shoulders: 22 }[load];
  const keys = sweep(7, (t) => {
    const e = ease(t) * depth;
    const pelvis: V3 = hack
      ? [0, lerp(STAND - 0.03, 0.5, e), lerp(feetZ - 0.26, feetZ - 0.5, e)]
      : [0, lerp(STAND - 0.01, 0.5, e), lerp(feetZ, feetZ - 0.2, e)];
    const torso: V3 = [hack ? lean : lerp(3, lean, e), 0, 0];
    const f = frameOf(torso);
    const chest = chestOf(pelvis, torso);
    const hands = pair((i, s): V3 => {
      switch (load) {
        case "front":
          return local(chest, f, [s * 0.2, 0.01, 0.17]);
        case "goblet":
          return local(chest, f, [s * 0.05, -0.15, 0.21]);
        case "none":
          return local(chest, f, [s * 0.17, -0.06, 0.56]);
        case "sides":
          return hang(pelvis, torso, i, 0.24);
        case "hack":
        case "shoulders":
          return local(chest, f, [s * 0.27, 0.03, 0.1]);
        default:
          return local(chest, f, [s * 0.42, 0.0, -0.07]);
      }
    });
    const elbowPole = pair((_, s): V3 =>
      load === "front"
        ? pole(f, s, 0.2, 1, 0.3)
        : load === "goblet"
          ? pole(f, s, -1, 0, 0.5)
          : load === "none"
            ? pole(f, s, -1, 0, 0.4)
            : pole(f, s, -1, -0.4, 0.4)
    );
    return {
      pelvis,
      torso,
      head: -torso[0] * 0.5,
      hands,
      elbowPole,
      feet: stance(w, feetZ),
      kneePole: pair((_, s) => [s * 0.35, 0, 1]),
      toes: toesOut(14),
    };
  });
  return { keys, kind: "rep", effort: "second", cues: cues(p, ["Sit down", "Drive up"]), tempo: [2, 0.2, 1.2, 0.6] };
}

function hinge(p: Params): Motion {
  const from = str(p, "from", "hang" as "hang" | "floor");
  const trap = bool(p, "trap", false);
  const grip = num(p, "grip", trap ? 0.27 : 0.23);
  if (from === "floor") {
    // Deadlift: starts on the floor, works on the way up.
    const bottomPelvis: V3 = trap ? [0, 0.53, -0.15] : [0, 0.56, -0.25];
    const bottomLean = trap ? 45 : 62;
    const keys = sweep(7, (t) => {
      const e = ease(t);
      const pelvis = mix(bottomPelvis, [0, STAND - 0.01, 0], e);
      const torso: V3 = [lerp(bottomLean, 0, e), 0, 0];
      const hands = pair((_, s): V3 => [s * grip, lerp(trap ? 0.3 : 0.23, STAND - 0.01 + 0.47 - ARM * 0.97, e), trap ? 0 : 0.04]);
      return { pelvis, torso, head: -torso[0] * 0.45, hands, feet: stance(0.13, 0), toes: toesOut(8), kneePole: pair((_, s) => [s * 0.25, 0, 1]) };
    });
    return { keys, kind: "rep", effort: "first", cues: cues(p, ["Lift", "Lower"]), tempo: [1.2, 0.6, 1.8, 0.4] };
  }
  // Romanian deadlift: hips travel back with soft knees.
  const keys = sweep(7, (t) => {
    const e = ease(t);
    const pelvis: V3 = [0, lerp(STAND - 0.01, 0.86, e), lerp(0, -0.18, e)];
    const torso: V3 = [lerp(3, 72, e), 0, 0];
    return {
      pelvis,
      torso,
      head: -torso[0] * 0.4,
      hands: pair((i) => hang(pelvis, torso, i, grip, 0, 0.04)),
      feet: stance(0.13, 0),
      toes: toesOut(6),
    };
  });
  return { keys, kind: "rep", effort: "second", cues: cues(p, ["Hips back", "Squeeze up"]), tempo: [2, 0.3, 1.2, 0.5] };
}

function swing(p: Params): Motion {
  const keys = sweep(9, (t) => {
    const e = ease(t);
    const pelvis: V3 = [0, lerp(0.84, STAND - 0.01, e), lerp(-0.16, 0, e)];
    const torso: V3 = [lerp(62, -4, e), 0, 0];
    const sh = mid(shoulderOf(pelvis, torso, 0), shoulderOf(pelvis, torso, 1));
    const a = rad(lerp(-30, 95, e));
    const h = add(sh, mul([0, -Math.cos(a), Math.sin(a)], ARM * 0.97));
    return {
      pelvis,
      torso,
      head: -torso[0] * 0.5,
      hands: pair((_, s) => [s * 0.045, h[1], h[2]]),
      elbowPole: pair((_, s) => [s * 0.4, -0.2, -1]),
      feet: stance(0.2, 0),
      toes: toesOut(14),
    };
  });
  return { keys, kind: "rep", effort: "first", cues: cues(p, ["Snap hips", "Hike back"]), tempo: [0.5, 0.05, 0.6, 0.05] };
}

function legPress(p: Params): Motion {
  const angle = num(p, "angle", 42);
  const D: V3 = [0, Math.sin(rad(angle)), Math.cos(rad(angle))];
  const pelvis: V3 = [0, 0.5, 0];
  const torso: V3 = [-48, 0, 0];
  const keys = sweep(5, (t) => {
    const s = lerp(0.82, 0.42, ease(t));
    return {
      pelvis,
      torso,
      head: 30,
      hands: pair((_, sd) => [sd * 0.27, 0.52, 0.14]),
      feet: pair((_, sd) => add([sd * 0.15, 0.5, 0.02], mul(D, s))),
      kneePole: pair((_, sd) => [sd * 0.3, 1, 0.1]),
      toes: pair(() => [0, Math.cos(rad(angle)), -Math.sin(rad(angle))]),
    };
  });
  return { keys, kind: "rep", effort: "second", cues: cues(p, ["Lower", "Press"]), tempo: [2, 0.2, 1.2, 0.5] };
}

function kneeExtension(p: Params): Motion {
  const mode = str(p, "mode", "extend" as "extend" | "curl" | "lyingCurl");
  if (mode === "lyingCurl") {
    const pelvis: V3 = [0, 0.84, 0];
    const torso: V3 = [84, 0, 0];
    const keys = sweep(7, (t) => {
      const phi = rad(lerp(4, 118, ease(t)));
      const knees = pair((i) => add(hipOf(pelvis, torso, i), [0, -0.035, -BODY.thigh + 0.005]));
      return {
        pelvis,
        torso,
        head: -50,
        hands: pair((_, s) => [s * 0.22, 0.74, 0.74]),
        feet: pair((i) => add(knees[i], mul([0, Math.sin(phi), -Math.cos(phi)], BODY.shin))),
        kneePole: pair(() => [0, -1, 0]),
        toes: pair(() => [0, -Math.cos(phi), -Math.sin(phi)]),
      };
    });
    return { keys, kind: "rep", effort: "first", cues: cues(p, ["Curl", "Lower"]), tempo: [1.1, 0.4, 2, 0.3] };
  }
  const pelvis: V3 = [0, 0.53, 0];
  const torso: V3 = [-12, 0, 0];
  const [from, to] = mode === "curl" ? [72, -28] : [2, 82];
  const keys = sweep(7, (t) => {
    const th = rad(lerp(from, to, ease(t)));
    const knees = pair((i) => {
      const h = hipOf(pelvis, torso, i);
      return [h[0], h[1] - 0.005, h[2] + BODY.thigh] as V3;
    });
    return {
      pelvis,
      torso,
      hands: pair((_, s) => [s * 0.27, 0.5, 0.06]),
      feet: pair((i) => add(knees[i], mul([0, -Math.cos(th), Math.sin(th)], BODY.shin))),
      kneePole: pair(() => [0, 1, 0]),
      toes: pair(() => [0, Math.sin(th), Math.cos(th)]),
    };
  });
  return {
    keys,
    kind: "rep",
    effort: "first",
    cues: cues(p, mode === "curl" ? ["Curl", "Return"] : ["Extend", "Lower"]),
    tempo: [1.1, 0.5, 2, 0.3],
  };
}

function hipAbduction(p: Params): Motion {
  const out = bool(p, "out", true);
  const pelvis: V3 = [0, 0.53, 0];
  const torso: V3 = [-10, 0, 0];
  const [from, to] = out ? [4, 36] : [38, 5];
  const keys = sweep(5, (t) => {
    const a = rad(lerp(from, to, ease(t)));
    const knees = pair((i, s) => add(hipOf(pelvis, torso, i), [s * Math.sin(a) * BODY.thigh, 0, Math.cos(a) * BODY.thigh]));
    return {
      pelvis,
      torso,
      hands: pair((_, s) => [s * 0.27, 0.5, 0.06]),
      feet: pair((i) => add(knees[i], [0, -BODY.shin + 0.01, 0.03])),
      kneePole: pair(() => [0, 1, 0.3]),
      toes: pair((_, s) => [s * Math.sin(a) * 0.5, 0, 1]),
    };
  });
  return { keys, kind: "rep", effort: "first", cues: cues(p, out ? ["Push out", "Return"] : ["Squeeze in", "Return"]), tempo: [1.1, 0.5, 2, 0.3] };
}

function calfRaise(p: Params): Motion {
  const seated = bool(p, "seated", false);
  const step = num(p, "step", 0.1);
  const keys = sweep(5, (t) => {
    const b = rad(lerp(-16, 36, ease(t)));
    const u: V3 = [0, -Math.sin(b), Math.cos(b)];
    const toePts = stance(0.11, seated ? 0.66 : 0.14, step + A);
    const ankles = pair((i) => sub(toePts[i], mul(u, BODY.foot)));
    if (seated) {
      const pelvis: V3 = [0, 0.53 + step + 0.02, 0];
      return {
        pelvis,
        torso: [-4, 0, 0],
        hands: pair((_, s) => [s * 0.16, pelvis[1] + 0.05, 0.42]),
        feet: ankles,
        kneePole: pair(() => [0, 1, 0.2]),
        toes: pair(() => u),
      };
    }
    const pelvis: V3 = [0, ankles[0][1] + LEG - 0.005, ankles[0][2] - 0.01];
    const torso: V3 = [0, 0, 0];
    const chest = chestOf(pelvis, torso);
    return {
      pelvis,
      torso,
      hands: pair((_, s) => local(chest, frameOf(torso), [s * 0.25, 0.04, 0.08])),
      elbowPole: pair((_, s) => [s * 0.6, -1, 0.1]),
      feet: ankles,
      toes: pair(() => u),
    };
  });
  return { keys, kind: "rep", effort: "first", cues: cues(p, ["Rise", "Lower"]), tempo: [1, 0.6, 1.6, 0.4] };
}

function kickback(p: Params): Motion {
  const pelvis: V3 = [0, STAND - 0.02, 0];
  const torso: V3 = [35, 0, 0];
  const f = frameOf(torso);
  const chest = chestOf(pelvis, torso);
  const hipR = hipOf(pelvis, torso, 1);
  const keys = sweep(7, (t) => {
    const e = ease(t);
    const psi = rad(lerp(38, -38, e));
    const kappa = rad(lerp(88, 24, e));
    const knee = add(hipR, mul([0, -Math.cos(psi), Math.sin(psi)], BODY.thigh));
    const foot = add(knee, mul([0, -Math.cos(psi - kappa), Math.sin(psi - kappa)], BODY.shin));
    return {
      pelvis,
      torso,
      head: -20,
      hands: pair((_, s) => local(chest, f, [s * 0.2, -0.12, 0.42])),
      feet: [[0.1, A, 0.03], foot],
      kneePole: [
        [0, 0, 1],
        through(knee, hipR, foot),
      ],
    };
  });
  return { keys, kind: "rep", effort: "first", cues: cues(p, ["Drive back", "Return"]), tempo: [1, 0.4, 1.8, 0.2] };
}

function hipThrust(p: Params): Motion {
  const floor = bool(p, "floor", false);
  const bar = str(p, "hold", "bar" as "bar" | "floor" | "handles");
  const chest: V3 = floor ? [0, 0.11, -0.5] : [0, 0.58, -0.5];
  const [from, to] = floor ? [-90, -124] : [-55, -92];
  const keys = sweep(5, (t) => {
    const torso: V3 = [lerp(from, to, ease(t)), 0, 0];
    const f = frameOf(torso);
    const pelvis = sub(chest, mul(f.up, BODY.torso));
    return {
      pelvis,
      torso,
      head: floor ? 10 : 25,
      hands: pair((_, s) =>
        bar === "bar" ? local(pelvis, f, [s * 0.32, 0.0, 0.17]) : bar === "handles" ? local(pelvis, f, [s * 0.3, 0.12, 0.05]) : [s * 0.28, 0.03, pelvis[2] - 0.1]
      ),
      feet: stance(0.16, floor ? 0.0 : 0.42),
      kneePole: pair((_, s) => [s * 0.2, 1, 0.3]),
    };
  });
  return { keys, kind: "rep", effort: "first", cues: cues(p, ["Drive hips up", "Lower"]), tempo: [1, 0.8, 1.6, 0.3] };
}

function lunge(p: Params): Motion {
  const style = str(p, "style", "split" as "split" | "walking" | "bulgarian" | "step");
  if (style === "step") {
    const box = num(p, "box", 0.42);
    const keys = sweep(9, (t) => {
      const e = ease(t);
      const pelvis: V3 = [0, lerp(0.9, box + STAND - 0.02, e), lerp(-0.06, 0.28, e)];
      const torso: V3 = [lerp(14, 0, e), 0, 0];
      const rear: V3 = [-0.12, lerp(A, box + A, e) + Math.sin(Math.PI * t) * 0.16, lerp(-0.15, 0.3, e)];
      return {
        pelvis,
        torso,
        hands: pair((i) => hang(pelvis, torso, i, 0.25)),
        feet: [[0.12, box + A, 0.32], rear],
        toes: pair(() => [0, 0, 1]),
      };
    });
    return { keys, kind: "rep", effort: "first", cues: cues(p, ["Step up", "Step down"]), tempo: [1.2, 0.4, 1.6, 0.3] };
  }
  const bulgarian = style === "bulgarian";
  const onBack = str(p, "hold", "sides" as "sides" | "back") === "back";
  const front: V3 = [0.12, A, bulgarian ? 0.26 : 0.34];
  const rear: V3 = bulgarian ? [-0.12, 0.5, -0.62] : [-0.12, 0.14, -0.44];
  const keys = sweep(7, (t) => {
    const e = ease(t);
    const pelvis: V3 = [0, lerp(bulgarian ? 0.88 : 0.88, bulgarian ? 0.52 : 0.5, e), lerp(-0.04, -0.07, e)];
    const torso: V3 = [lerp(2, bulgarian ? 12 : 6, e), 0, 0];
    const f = frameOf(torso);
    return {
      pelvis,
      torso,
      hands: pair((i, s): V3 => (onBack ? local(chestOf(pelvis, torso), f, [s * 0.42, 0.0, -0.07]) : hang(pelvis, torso, i, 0.25))),
      ...(onBack ? { elbowPole: pair((_, s) => pole(f, s, -1, -0.4, 0.4)) } : {}),
      feet: [front, rear],
      kneePole: [
        [0, 0, 1],
        [0, -1, 0.15],
      ],
      toes: [
        [0, 0, 1],
        bulgarian ? [0, -0.6, -0.8] : [0, -0.75, 0.66],
      ],
    };
  });
  return { keys, kind: "rep", effort: "second", cues: cues(p, ["Lower", "Drive up"]), tempo: [1.8, 0.2, 1.2, 0.4] };
}

// ── Upper body: pushing ────────────────────────────────────────────────────

function press(p: Params): Motion {
  const posture = str(p, "posture", "lying" as Posture);
  const grip = num(p, "grip", 0.4);
  const tucked = bool(p, "tucked", false);
  const dir = str(p, "dir", "fwd" as "fwd" | "down");
  const b = base(posture, num(p, "lean", posture === "seated" ? -12 : 0));
  const f = frameOf(b.torso);
  const chest = chestOf(b.pelvis, b.torso);
  if (dir === "down") {
    const keys = sweep(5, (t) => {
      const e = ease(t);
      return {
        ...b,
        hands: pair((_, s) => mix(local(chest, f, [s * 0.27, -0.16, -0.03]), local(chest, f, [s * 0.25, -0.03 - ARM * 0.95, 0.04]), e)),
        elbowPole: pair((_, s) => pole(f, s, 0, -1, 0.15)),
      };
    });
    return { keys, kind: "rep", effort: "first", cues: cues(p, ["Push down", "Return"]), tempo: [1.1, 0.4, 1.8, 0.3] };
  }
  const keys = sweep(5, (t) => {
    const e = ease(t);
    return {
      ...b,
      head: posture === "lying" ? 0 : -b.torso[0] * 0.3,
      hands: pair((_, s) => mix(local(chest, f, [s * grip, -0.07, ARM * 0.95]), local(chest, f, [s * grip, -0.13, 0.1]), e)),
      elbowPole: pair((_, s) => (tucked ? pole(f, s, -0.8, -1, 0.35) : pole(f, s, -0.4, -1, 0.8))),
    };
  });
  return { keys, kind: "rep", effort: "second", cues: cues(p, ["Lower", "Press"]), tempo: [2, 0.2, 1.1, 0.4] };
}

function overheadPress(p: Params): Motion {
  const posture = str(p, "posture", "standing" as Posture);
  const style = str(p, "style", "barbell" as "barbell" | "dumbbell" | "arnold" | "machine");
  const b = base(posture, posture === "seated" ? -6 : -2);
  const f = frameOf(b.torso);
  const chest = chestOf(b.pelvis, b.torso);
  const keys = sweep(7, (t) => {
    const e = ease(t);
    const bottom = pair((_, s): V3 =>
      style === "barbell"
        ? local(chest, f, [s * 0.27, 0.04, 0.14])
        : style === "arnold"
          ? local(chest, f, [s * lerp(0.12, 0.3, Math.min(1, t * 1.6)), 0.05, lerp(0.14, 0.03, Math.min(1, t * 1.6))])
          : local(chest, f, [s * 0.3, 0.06, 0.04])
    );
    const top = pair((_, s) => local(chest, f, [s * (style === "barbell" ? 0.24 : 0.2), 0.58, 0.03]));
    const elbowPole = pair((_, s) =>
      style === "barbell" ? pole(f, s, -1, 0.7, 0.3) : style === "arnold" ? pole(f, s, -1, lerp(1, -0.1, e), lerp(0.1, 0.9, e)) : pole(f, s, -1, -0.1, 0.9)
    );
    return {
      ...b,
      head: posture === "standing" && style === "barbell" ? lerp(-12, 0, Math.abs(e - 0.35) < 0.3 ? 1 : 0) : 0,
      hands: [mix(bottom[0], top[0], e), mix(bottom[1], top[1], e)],
      elbowPole,
    };
  });
  return { keys, kind: "rep", effort: "first", cues: cues(p, ["Press", "Lower"]), tempo: [1.1, 0.3, 2, 0.3] };
}

function armArc(p: Params): Motion {
  const plane = str(p, "plane", "frontal" as "sagittal" | "frontal" | "transverse");
  const posture = str(p, "posture", "standing" as Posture);
  const arms = str(p, "arms", "both" as "both" | "left" | "right");
  const from = num(p, "from", 10);
  const to = num(p, "to", 85);
  const bend = rad(num(p, "bend", 15));
  const elevFrom = num(p, "elevFrom", 0);
  const elevTo = num(p, "elevTo", 0);
  const b = base(posture, num(p, "lean", 0));
  const f = frameOf(b.torso);
  const reach = Math.sqrt(BODY.upperArm ** 2 + BODY.forearm ** 2 + 2 * BODY.upperArm * BODY.forearm * Math.cos(bend));
  const defaults = { sagittal: [0, -0.3, 1], frontal: [0.35, -1, 0], transverse: [-1, -0.4, 0.3] }[plane];
  const [pu, pf, pl] = [num(p, "poleU", defaults[0]), num(p, "poleF", defaults[1]), num(p, "poleL", defaults[2])];
  const keys = sweep(7, (t) => {
    const e = ease(t);
    const a = rad(lerp(from, to, e));
    const el = rad(lerp(elevFrom, elevTo, e));
    const hands = pair((i, s): V3 => {
      const active = arms === "both" || (arms === "left" ? i === 0 : i === 1);
      if (!active) return onHip(b.pelvis, f, i);
      const sh = shoulderOf(b.pelvis, b.torso, i);
      let dir: V3;
      if (plane === "sagittal") dir = comb([f.up, -Math.cos(a)], [f.fwd, Math.sin(a)], [f.left, s * 0.12]);
      else if (plane === "frontal") dir = comb([f.up, -Math.cos(a)], [f.left, s * Math.sin(a)], [f.fwd, 0.25 * Math.sin(a) + 0.08]);
      else {
        const h = comb([f.fwd, Math.cos(a)], [f.left, s * Math.sin(a)]);
        dir = comb([h, Math.cos(el)], [f.up, -Math.sin(el)]);
      }
      return add(sh, mul(norm(dir), reach));
    });
    return { ...b, hands, elbowPole: pair((_, s) => pole(f, s, pu, pf, pl)) };
  });
  const effort = str(p, "effort", "first" as "first" | "second");
  return { keys, kind: "rep", effort, cues: cues(p, effort === "first" ? ["Raise", "Lower"] : ["Lower", "Raise"]), tempo: [1.2, 0.4, 2, 0.3] };
}

// ── Upper body: pulling ────────────────────────────────────────────────────

function row(p: Params): Motion {
  const style = str(p, "style", "cable" as "cable" | "machine" | "bent" | "tbar" | "oneArm" | "face" | "upright");
  const grip = num(p, "grip", style === "bent" ? 0.25 : style === "tbar" || style === "cable" ? 0.07 : 0.2);
  let posture: { pelvis: V3; torso: [number, number]; feet: [V3, V3]; kneePole?: [V3, V3] };
  switch (style) {
    case "cable":
      posture = { pelvis: [0, 0.45, 0], torso: [18, -6], feet: stance(0.12, 0.64, 0.3), kneePole: pair(() => [0, 1, 0]) };
      break;
    case "machine":
      posture = { pelvis: [0, 0.53, 0], torso: [6, 2], feet: seatedFeet([0, 0.53, 0]) };
      break;
    case "bent":
      posture = { pelvis: [0, 0.84, -0.17], torso: [62, 60], feet: stance(0.14, 0) };
      break;
    case "tbar":
      posture = { pelvis: [0, 0.8, -0.2], torso: [50, 45], feet: stance(0.17, 0) };
      break;
    case "oneArm":
      posture = {
        pelvis: [0.06, 0.8, -0.12],
        torso: [80, 80],
        feet: [
          [0.2, 0.53, -0.5],
          [-0.22, A, 0.06],
        ],
        kneePole: [
          [0, -1, 0.3],
          [0, 0, 1],
        ],
      };
      break;
    default:
      posture = { pelvis: [0, STAND - 0.01, -0.04], torso: [-3, -3], feet: stance(0.15, -0.04) };
  }
  const keys = sweep(7, (t) => {
    const e = ease(t);
    const torso: V3 = [lerp(posture.torso[0], posture.torso[1], e), 0, 0];
    const f = frameOf(torso);
    const pelvis = posture.pelvis;
    const chest = chestOf(pelvis, torso);
    const hands = pair((i, s): V3 => {
      if (style === "oneArm" && i === 0) return [0.27, 0.48, 0.42];
      if (style === "oneArm") {
        const start = hang(pelvis, torso, i, undefined, 0, 0.02);
        return mix(start, local(chest, f, [s * 0.2, -0.36, 0.05]), e);
      }
      const sh = shoulderOf(pelvis, torso, i);
      switch (style) {
        case "cable":
        case "machine": {
          const start = add([s * grip, sh[1], sh[2]], mul(norm([0, -0.08, 1]), ARM * 0.95));
          start[0] = s * grip;
          return mix(start, local(chest, f, [s * (style === "cable" ? 0.12 : 0.2), -0.28, 0.14]), e);
        }
        case "face": {
          const start = add([s * 0.05, sh[1], sh[2]], mul(norm([0, 0.22, 1]), ARM * 0.95));
          start[0] = s * 0.05;
          return mix(start, local(chest, f, [s * 0.27, 0.15, 0.03]), e);
        }
        case "upright":
          return mix(local(pelvis, f, [s * 0.1, -0.12, 0.15]), local(chest, f, [s * 0.11, -0.02, 0.13]), e);
        default: {
          const start = hang(pelvis, torso, i, grip, 0, 0.02);
          return mix(start, local(chest, f, [s * Math.max(grip, 0.12), -0.3, 0.15]), e);
        }
      }
    });
    const elbowPole = pair((i, s): V3 =>
      style === "face"
        ? pole(f, s, 0.5, -0.5, 1)
        : style === "upright"
          ? pole(f, s, 1, -0.3, 1)
          : style === "oneArm" && i === 0
            ? pole(f, s, 0, -0.5, 1)
            : pole(f, s, -0.4, -1, 0.3)
    );
    return { pelvis, torso, head: -torso[0] * 0.5, hands, elbowPole, feet: posture.feet, kneePole: posture.kneePole };
  });
  return { keys, kind: "rep", effort: "first", cues: cues(p, ["Pull", "Release"]), tempo: [1.1, 0.5, 2, 0.3] };
}

function pulldown(p: Params): Motion {
  const g = { wide: 0.44, close: 0.14, neutral: 0.08 }[str(p, "grip", "wide" as "wide" | "close" | "neutral")];
  const pelvis: V3 = [0, 0.53, 0];
  const keys = sweep(7, (t) => {
    const e = ease(t);
    const torso: V3 = [lerp(-8, -16, e), 0, 0];
    const f = frameOf(torso);
    const chest = chestOf(pelvis, torso);
    return {
      pelvis,
      torso,
      head: lerp(-25, -10, e),
      hands: pair((_, s) => mix(local(chest, f, [s * g, g > 0.3 ? 0.48 : 0.56, 0.07]), local(chest, f, [s * Math.max(g * 0.92, 0.1), 0.02, 0.17]), e)),
      elbowPole: pair((_, s) => (g > 0.3 ? pole(f, s, -1, -0.2, 0.7) : pole(f, s, -1, -0.3, 0.25))),
      feet: seatedFeet(pelvis),
    };
  });
  return { keys, kind: "rep", effort: "first", cues: cues(p, ["Pull", "Release"]), tempo: [1.1, 0.4, 2, 0.4] };
}

function pullUp(p: Params): Motion {
  const g = { wide: 0.4, close: 0.17, chin: 0.17 }[str(p, "grip", "wide" as "wide" | "close" | "chin")];
  const bar = num(p, "bar", 2.25);
  const hold = bool(p, "hold", false);
  const kneeling = bool(p, "kneePad", false);
  const keys = sweep(7, (t) => {
    const e = hold ? ease(t) * 0.04 : ease(t);
    const torso: V3 = [lerp(-5, -14, e), 0, 0];
    const f = frameOf(torso);
    const chestY = lerp(bar - ARM * 0.985 + 0.03, bar - 0.13, e);
    const pelvis = sub([0, chestY, 0.03], mul(f.up, BODY.torso));
    const feet = pair((_, s): V3 => (kneeling ? [s * 0.1, pelvis[1] - 0.5, pelvis[2] - 0.45] : [s * 0.06, pelvis[1] - 0.8, pelvis[2] - 0.22]));
    return {
      pelvis,
      torso,
      head: -12,
      hands: pair((_, s) => [s * g, bar, 0.04]),
      elbowPole: pair((_, s) => (g > 0.3 ? pole(f, s, -1, -0.2, 0.8) : pole(f, s, -1, 0.3, 0.3))),
      feet,
      kneePole: pair(() => [0, 0, 1]),
    };
  });
  return {
    keys,
    kind: "rep",
    effort: hold ? "both" : "first",
    cues: cues(p, hold ? ["Hang", "Hang"] : ["Pull", "Lower"]),
    tempo: hold ? [2.5, 0, 2.5, 0] : [1.2, 0.4, 2, 0.4],
  };
}

function inverted(p: Params): Motion {
  const bar = num(p, "bar", 1.0);
  const body = LEG * 0.995 + 0.02 + BODY.torso;
  const ankleY = 0.1;
  const gTop = Math.asin((bar - 0.12 - ankleY) / body);
  const heelZ = body * Math.cos(gTop);
  const keys = sweep(5, (t) => {
    const g = lerp(Math.asin((bar - ARM * 0.95 - ankleY) / body), gTop, ease(t));
    const dir: V3 = [0, Math.sin(g), -Math.cos(g)];
    const ankle: V3 = [0, ankleY, heelZ];
    const pelvis = add(ankle, mul(dir, LEG * 0.995 + 0.02));
    const torso: V3 = [-(90 - (g * 180) / Math.PI), 0, 0];
    return {
      pelvis,
      torso,
      hands: pair((_, s) => [s * 0.3, bar, -0.06]),
      elbowPole: pair((_, s) => [s * 0.5, -0.3, 0.6]),
      feet: pair((_, s) => [s * 0.1, ankleY, heelZ]),
      kneePole: pair(() => [0, 1, 0]),
      toes: pair(() => [0, 1, 0.2]),
    };
  });
  return { keys, kind: "rep", effort: "first", cues: cues(p, ["Pull", "Lower"]), tempo: [1.1, 0.4, 1.8, 0.3] };
}

/** Straight-body poses on the floor, pivoting at the toes. */
function plankPose(chestY: number, chestZ: number, opts: { hands?: (f: Frame, pelvis: V3) => [V3, V3]; ankleY?: number } = {}) {
  const ankleY = opts.ankleY ?? 0.17;
  const body = LEG * 0.995 + 0.02 + BODY.torso;
  const g = Math.asin((chestY - ankleY) / body);
  const ankleZ = chestZ - body * Math.cos(g);
  const dir: V3 = [0, Math.sin(g), Math.cos(g)];
  const ankle: V3 = [0, ankleY, ankleZ];
  const pelvis = add(ankle, mul(dir, LEG * 0.995 + 0.02));
  const torso: V3 = [90 - (g * 180) / Math.PI, 0, 0];
  return { pelvis, torso, ankleZ, ankleY };
}

function pushUp(p: Params): Motion {
  const keys = sweep(5, (t) => {
    const chestY = lerp(0.03 + ARM * 0.97 + 0.03, 0.22, ease(t));
    const { pelvis, torso, ankleZ, ankleY } = plankPose(chestY, 0.02);
    const f = frameOf(torso);
    return {
      pelvis,
      torso,
      head: -15,
      hands: pair((_, s) => [s * 0.3, 0.03, 0.02]),
      elbowPole: pair((_, s) => pole(f, s, -1, 0, 0.55)),
      feet: pair((_, s) => [s * 0.09, ankleY, ankleZ]),
      kneePole: pair(() => [0, -1, 0]),
      toes: pair(() => [0, -0.85, -0.5]),
    };
  });
  return { keys, kind: "rep", effort: "second", cues: cues(p, ["Lower", "Push"]), tempo: [1.8, 0.2, 1.1, 0.4] };
}

// ── Arms ───────────────────────────────────────────────────────────────────

function elbow(p: Params): Motion {
  const posture = str(p, "posture", "standing" as Posture);
  const ua = rad(num(p, "upperArm", 0));
  const out = rad(num(p, "out", 6));
  const from = num(p, "from", 8);
  const to = num(p, "to", 135);
  const together = bool(p, "together", false);
  const b = base(posture, num(p, "lean", 0));
  const f = frameOf(b.torso);
  const keys = sweep(7, (t) => {
    const fl = rad(lerp(from, to, ease(t)));
    const hands: V3[] = [];
    const poles: V3[] = [];
    for (const i of SIDES) {
      const s = sideSign(i);
      const sh = shoulderOf(b.pelvis, b.torso, i);
      const inPlane = comb([f.up, -Math.cos(ua)], [f.fwd, Math.sin(ua)]);
      const perp = comb([f.fwd, Math.cos(ua)], [f.up, Math.sin(ua)]);
      const uaDir = norm(comb([inPlane, Math.cos(out)], [f.left, s * Math.sin(out)]));
      const el = add(sh, mul(uaDir, BODY.upperArm));
      let hand = add(el, mul(comb([inPlane, Math.cos(fl)], [perp, Math.sin(fl)]), BODY.forearm));
      if (together) hand = add(hand, mul(f.left, -s * (Math.abs(sub(hand, el)[0]) * 0 + BODY.shoulderHalf - 0.05)));
      hands.push(hand);
      poles.push(together ? comb([sub(el, mid(sh, hand)), 1], [f.left, s * 0.3]) : through(el, sh, hand));
    }
    return { ...b, hands: hands as [V3, V3], elbowPole: poles as [V3, V3] };
  });
  const effort = str(p, "effort", "first" as "first" | "second");
  return { keys, kind: "rep", effort, cues: cues(p, ["Curl", "Lower"]), tempo: [1.1, 0.4, 2, 0.3] };
}

function dip(p: Params): Motion {
  const style = str(p, "style", "bars" as "bars" | "bench" | "kneePad");
  if (style === "bench") {
    const keys = sweep(5, (t) => {
      const e = ease(t);
      const pelvis: V3 = [0, lerp(0.55, 0.22, e), -0.12];
      const torso: V3 = [-4, 0, 0];
      return {
        pelvis,
        torso,
        hands: pair((_, s) => [s * 0.2, 0.47, -0.27]),
        elbowPole: pair((_, s) => [s * 0.15, 0, -1]),
        feet: stance(0.15, 0.66),
        kneePole: pair(() => [0, 1, 0]),
      };
    });
    return { keys, kind: "rep", effort: "second", cues: cues(p, ["Lower", "Push"]), tempo: [1.6, 0.2, 1.1, 0.4] };
  }
  const barY = num(p, "bar", 1.3);
  const keys = sweep(5, (t) => {
    const e = ease(t);
    const torso: V3 = [lerp(12, 26, e), 0, 0];
    const f = frameOf(torso);
    const chest: V3 = [0, lerp(barY + ARM * 0.96 + 0.03, barY + 0.24, e), lerp(-0.02, 0.06, e)];
    const pelvis = sub(chest, mul(f.up, BODY.torso));
    return {
      pelvis,
      torso,
      head: -10,
      hands: pair((_, s) => [s * 0.27, barY, 0]),
      elbowPole: pair((_, s) => pole(f, s, 0, -1, 0.2)),
      feet: pair((_, s): V3 => (style === "kneePad" ? [s * 0.1, pelvis[1] - 0.48, pelvis[2] - 0.42] : [s * 0.06, pelvis[1] - 0.66, pelvis[2] - 0.34])),
      kneePole: pair(() => [0, 0, 1]),
    };
  });
  return { keys, kind: "rep", effort: "second", cues: cues(p, ["Lower", "Push"]), tempo: [1.8, 0.2, 1.1, 0.4] };
}

function shrug(p: Params): Motion {
  const b = base("standing");
  const keys = sweep(5, (t) => {
    const sh = ease(t) * 0.075;
    return { ...b, shrug: sh, hands: pair((i) => hang(b.pelvis, b.torso, i, 0.25, sh)) };
  });
  return { keys, kind: "rep", effort: "first", cues: cues(p, ["Shrug", "Lower"]), tempo: [0.9, 0.8, 1.6, 0.3] };
}

// ── Trunk ──────────────────────────────────────────────────────────────────

function trunkFlex(p: Params): Motion {
  const style = str(p, "style", "crunch" as "crunch" | "machine" | "cable" | "backExt" | "hyper");
  const crossed = (chest: V3, f: Frame) => pair((_, s) => local(chest, f, [-s * 0.08, -0.1, 0.13]));
  const keys = sweep(7, (t) => {
    const e = ease(t);
    switch (style) {
      case "crunch": {
        const torso: V3 = [lerp(-90, -60, e), 0, 0];
        const f = frameOf(torso);
        const pelvis: V3 = [0, 0.11, 0];
        const chest = chestOf(pelvis, torso);
        return {
          pelvis,
          torso,
          head: lerp(10, 25, e),
          hands: pair((_, s) => local(chest, f, [s * 0.13, 0.19, -0.03])),
          elbowPole: pair((_, s) => pole(f, s, 0.3, 0, 1)),
          feet: stance(0.13, 0.44),
          kneePole: pair(() => [0, 1, 0.2]),
        };
      }
      case "machine": {
        const pelvis: V3 = [0, 0.53, 0];
        const torso: V3 = [lerp(-6, 34, e), 0, 0];
        const f = frameOf(torso);
        const chest = chestOf(pelvis, torso);
        return {
          pelvis,
          torso,
          head: 10,
          hands: pair((_, s) => local(chest, f, [s * 0.17, 0.05, 0.1])),
          elbowPole: pair((_, s) => pole(f, s, -1, 0.3, 0.3)),
          feet: seatedFeet(pelvis),
        };
      }
      case "cable": {
        const pelvis: V3 = [0, 0.52, lerp(0, -0.08, e)];
        const torso: V3 = [lerp(22, 74, e), 0, 0];
        const f = frameOf(torso);
        const chest = chestOf(pelvis, torso);
        return {
          ...base("kneeling", 0),
          pelvis,
          torso,
          head: 20,
          hands: pair((_, s) => local(chest, f, [s * 0.07, 0.12, 0.13])),
          elbowPole: pair((_, s) => pole(f, s, -1, 0.3, 0.2)),
        };
      }
      case "backExt": {
        const pelvis: V3 = [0, 0.53, 0];
        const torso: V3 = [lerp(34, -10, e), 0, 0];
        const f = frameOf(torso);
        return { pelvis, torso, hands: crossed(chestOf(pelvis, torso), f), feet: seatedFeet(pelvis) };
      }
      default: {
        // 45° back extension: legs locked on the bench, torso lifts in line.
        const pelvis: V3 = [0, 0.94, 0];
        const torso: V3 = [lerp(140, 47, e), 0, 0];
        const f = frameOf(torso);
        return {
          pelvis,
          torso,
          head: lerp(10, 0, e),
          hands: crossed(chestOf(pelvis, torso), f),
          feet: stance(0.11, -0.62, 0.32),
          kneePole: pair(() => [0, -1, 1]),
          toes: pair(() => [0, -0.7, 0.7]),
        };
      }
    }
  });
  const back = style === "backExt" || style === "hyper";
  return { keys, kind: "rep", effort: "first", cues: cues(p, back ? ["Extend", "Lower"] : ["Crunch", "Release"]), tempo: [1, 0.5, 1.8, 0.3] };
}

function legRaise(p: Params): Motion {
  const style = str(p, "style", "hanging" as "hanging" | "captain");
  const bentKnees = bool(p, "knees", false);
  const keys = sweep(7, (t) => {
    const e = ease(t);
    let pelvis: V3;
    let torso: V3;
    let hands: [V3, V3];
    let elbowPole: [V3, V3] | undefined;
    if (style === "captain") {
      torso = [-4, 0, 0];
      pelvis = [0, 1.07, -0.04];
      hands = pair((_, s) => [s * 0.2, 1.24, 0.27]);
      elbowPole = pair((_, s) => [s * 0.1, -1, -0.2]);
    } else {
      torso = [lerp(-3, -14, e), 0, 0];
      const f = frameOf(torso);
      const chest: V3 = [0, 2.25 - ARM * 0.985 + 0.03, 0.03];
      pelvis = sub(chest, mul(f.up, BODY.torso));
      hands = pair((_, s) => [s * 0.24, 2.25, 0.04]);
    }
    const th = rad(lerp(4, bentKnees ? 108 : 92, e));
    const ka = rad(bentKnees ? lerp(12, 105, e) : 4);
    const feet: V3[] = [];
    const kneePole: V3[] = [];
    for (const i of SIDES) {
      const hip = hipOf(pelvis, torso, i);
      const knee = add(hip, mul([0, -Math.cos(th), Math.sin(th)], BODY.thigh));
      const foot = add(knee, mul([0, -Math.cos(th - ka), Math.sin(th - ka)], BODY.shin));
      feet.push(foot);
      kneePole.push(bentKnees ? through(knee, hip, foot) : [0, Math.sin(th), Math.cos(th)]);
    }
    return { pelvis, torso, hands, elbowPole, feet: feet as [V3, V3], kneePole: kneePole as [V3, V3] };
  });
  return { keys, kind: "rep", effort: "first", cues: cues(p, ["Raise", "Lower"]), tempo: [1.1, 0.4, 1.8, 0.3] };
}

function twist(p: Params): Motion {
  const style = str(p, "style", "russian" as "russian" | "machine");
  if (style === "machine") {
    const pelvis: V3 = [0, 0.53, 0];
    const keys = sweep(5, (t) => {
      const torso: V3 = [0, lerp(-4, 45, ease(t)), 0];
      const f = frameOf(torso);
      const chest = chestOf(pelvis, torso);
      return { pelvis, torso, hands: pair((_, s) => local(chest, f, [s * 0.17, -0.06, 0.24])), feet: seatedFeet(pelvis) };
    });
    return { keys, kind: "rep", effort: "first", cues: cues(p, ["Rotate", "Return"]), tempo: [1.1, 0.4, 1.8, 0.3] };
  }
  const pelvis: V3 = [0, 0.13, 0];
  const keys = sweep(7, (t) => {
    const torso: V3 = [-42, lerp(-38, 38, ease(t)), 0];
    const f = frameOf(torso);
    const chest = chestOf(pelvis, torso);
    return {
      pelvis,
      torso,
      head: 15,
      hands: pair((_, s) => local(chest, f, [s * 0.05, -0.15, 0.32])),
      feet: stance(0.1, 0.5, 0.22),
      kneePole: pair(() => [0, 1, 0]),
    };
  });
  return { keys, kind: "rep", effort: "both", cues: cues(p, ["Rotate", "Rotate"]), tempo: [0.9, 0.15, 0.9, 0.15] };
}

function woodchop(p: Params): Motion {
  const keys = sweep(7, (t) => {
    const e = ease(t);
    const pelvis: V3 = [0, lerp(STAND - 0.03, 0.86, e), 0];
    const torso: V3 = [lerp(0, 14, e), lerp(-40, 38, e), 0];
    const h = mix([-0.4, 1.6, 0.26], [0.34, 0.84, 0.34], e);
    return {
      pelvis,
      torso,
      hands: pair((_, s) => add(h, [s * 0.035, 0, 0])),
      feet: stance(0.22, 0),
      toes: toesOut(10),
      kneePole: pair((_, s) => [s * 0.3, 0, 1]),
    };
  });
  return { keys, kind: "rep", effort: "first", cues: cues(p, ["Chop", "Return"]), tempo: [0.9, 0.3, 1.6, 0.3] };
}

function plank(p: Params): Motion {
  const style = str(p, "style", "forearm" as "forearm" | "side" | "hollow");
  const keys = sweep(3, (t) => {
    const b = Math.sin(Math.PI * t) * 0.012;
    if (style === "side") {
      const torso: V3 = [0, 0, 72];
      const f = frameOf(torso);
      const ankle: V3 = [0.62, 0.09, 0];
      const pelvis = add(add(ankle, mul(f.up, LEG * 0.995 + 0.02)), [0, b, 0]);
      const shR = shoulderOf(pelvis, torso, 1);
      return {
        pelvis,
        torso,
        hands: [local(pelvis, f, [0.15, 0.04, 0.05]), [shR[0] + 0.02, 0.04, 0.29]],
        elbowPole: [pole(f, 1, -0.5, -0.5, 1), [0, -1, -0.4]],
        feet: [add(ankle, [0, 0.1, 0.06]), add(ankle, [0, 0, -0.04])],
        kneePole: pair(() => [0, 0, 1]),
      };
    }
    if (style === "hollow") {
      const pelvis: V3 = [0, 0.11, 0];
      const torso: V3 = [-78 - b * 100, 0, 0];
      const f = frameOf(torso);
      const chest = chestOf(pelvis, torso);
      return {
        pelvis,
        torso,
        head: 20,
        hands: pair((_, s) => local(chest, f, [s * 0.12, 0.55, 0.04])),
        feet: stance(0.05, 0.86, 0.28 + b),
        kneePole: pair(() => [0, 1, 0]),
      };
    }
    const { pelvis, torso, ankleZ, ankleY } = plankPose(0.36 + b, 0);
    const sh = pair((i) => shoulderOf(pelvis, torso, i));
    return {
      pelvis,
      torso,
      head: -10,
      hands: pair((i, s) => [s * 0.11, 0.04, sh[i][2] + 0.29]),
      elbowPole: pair((_, s) => [s * 0.2, -1, -0.5]),
      feet: pair((_, s) => [s * 0.09, ankleY, ankleZ]),
      kneePole: pair(() => [0, -1, 0]),
      toes: pair(() => [0, -0.85, -0.5]),
    };
  });
  return { keys, kind: "loop", period: 4.4, effort: "both", cues: ["Hold", "Breathe"] };
}

function deadBug(): Motion {
  const pelvis: V3 = [0, 0.11, 0];
  const torso: V3 = [-90, 0, 0];
  const sh = pair((i) => shoulderOf(pelvis, torso, i));
  const hip = pair((i) => hipOf(pelvis, torso, i));
  const armUp = (i: 0 | 1): V3 => add(sh[i], [0, ARM * 0.96, 0]);
  const armBack = (i: 0 | 1): V3 => add(sh[i], [0, 0.12, -ARM * 0.95]);
  const legTuck = (i: 0 | 1): V3 => add(hip[i], [0, BODY.thigh, BODY.shin]);
  const legLong = (i: 0 | 1): V3 => add(hip[i], [0, 0.12, LEG * 0.97]);
  const pose = (reachL: boolean, reachR: boolean): Pose => ({
    pelvis,
    torso,
    head: 10,
    hands: [reachL ? armBack(0) : armUp(0), reachR ? armBack(1) : armUp(1)],
    feet: [reachR ? legLong(0) : legTuck(0), reachL ? legLong(1) : legTuck(1)],
    kneePole: pair(() => [0, 1, 0.4]),
  });
  return { keys: [pose(false, false), pose(true, false), pose(false, false), pose(false, true)], kind: "loop", period: 5, effort: "both", cues: ["Reach opposite", "Reach opposite"] };
}

function mountainClimber(): Motion {
  const { pelvis, torso, ankleZ, ankleY } = plankPose(0.03 + ARM * 0.97 + 0.03, 0.02);
  const hip = pair((i) => hipOf(pelvis, torso, i));
  const tuck = (i: 0 | 1): V3 => add(hip[i], [0, -0.32, 0.3]);
  const back = (i: 0 | 1): V3 => [sideSign(i) * 0.09, ankleY, ankleZ];
  const pose = (left: boolean): Pose => ({
    pelvis,
    torso,
    head: -15,
    hands: pair((_, s) => [s * 0.3, 0.03, 0.02]),
    feet: [left ? tuck(0) : back(0), left ? back(1) : tuck(1)],
    kneePole: pair(() => [0, -1, 0.3]),
    toes: pair(() => [0, -0.85, -0.5]),
  });
  return { keys: [pose(true), pose(false)], kind: "loop", period: 0.9, effort: "both", cues: ["Drive knees", "Drive knees"] };
}

function burpee(): Motion {
  const stand = base("standing");
  const standPose: Pose = { ...stand, hands: pair((i) => hang(stand.pelvis, stand.torso, i)) };
  const squatPose: Pose = {
    pelvis: [0, 0.42, -0.12],
    torso: [65, 0, 0],
    head: -30,
    hands: pair((_, s) => [s * 0.25, 0.03, 0.32]),
    feet: stance(0.14, 0),
    kneePole: pair((_, s) => [s * 0.3, 0, 1]),
  };
  const top = plankPose(0.03 + ARM * 0.97 + 0.03, 0.32);
  const plankP: Pose = {
    pelvis: top.pelvis,
    torso: top.torso,
    head: -15,
    hands: pair((_, s) => [s * 0.25, 0.03, 0.32]),
    feet: pair((_, s) => [s * 0.11, top.ankleY, top.ankleZ]),
    kneePole: pair(() => [0, -1, 0]),
    toes: pair(() => [0, -0.85, -0.5]),
  };
  const jump: Pose = {
    pelvis: [0, STAND + 0.12, 0],
    torso: [-3, 0, 0],
    hands: pair((i, s) => add(shoulderOf([0, STAND + 0.12, 0], [-3, 0, 0], i), [s * 0.1, ARM * 0.95, 0.04])),
    feet: stance(0.12, 0, A + 0.14),
    toes: pair(() => [0, -0.6, 0.8]),
  };
  return { keys: [standPose, squatPose, plankP, squatPose, jump], kind: "loop", period: 3.4, effort: "both", cues: ["Down, back, up", "Jump"] };
}

function thruster(p: Params): Motion {
  const stand = base("standing", -2);
  const rack = (pelvis: V3, torso: V3) => pair((_, s) => local(chestOf(pelvis, torso), frameOf(torso), [s * 0.28, 0.06, 0.06]));
  const overhead: Pose = {
    ...stand,
    hands: pair((_, s) => local(chestOf(stand.pelvis, stand.torso), frameOf(stand.torso), [s * 0.2, 0.58, 0.03])),
    elbowPole: pair((_, s) => pole(frameOf(stand.torso), s, -1, -0.1, 0.9)),
  };
  const standRack: Pose = { ...stand, hands: rack(stand.pelvis, stand.torso), elbowPole: pair((_, s) => pole(frameOf(stand.torso), s, -1, 0.4, 0.6)) };
  const lowPelvis: V3 = [0, 0.52, -0.18];
  const lowTorso: V3 = [24, 0, 0];
  const bottom: Pose = {
    pelvis: lowPelvis,
    torso: lowTorso,
    head: -12,
    hands: rack(lowPelvis, lowTorso),
    elbowPole: pair((_, s) => pole(frameOf(lowTorso), s, -1, 0.4, 0.6)),
    feet: stance(0.15),
    kneePole: pair((_, s) => [s * 0.35, 0, 1]),
    toes: toesOut(14),
  };
  return { keys: [overhead, standRack, bottom], kind: "rep", effort: "second", cues: cues(p, ["Lower", "Drive & press"]), tempo: [1.8, 0.1, 1.1, 0.4] };
}

/** Walking / running cycle, used for carries and the treadmill. */
function gait(opts: { y0?: number; stride: number; lift: number; run?: boolean; arms?: "swing" | "carry" }): Pose[] {
  const y0 = opts.y0 ?? 0;
  return Array.from({ length: 10 }, (_, k) => {
    const th = (k / 10) * Math.PI * 2;
    const pelvis: V3 = [0, y0 + STAND - (opts.run ? 0.06 : 0.025) + Math.abs(Math.cos(th)) * (opts.run ? 0.04 : 0.015), 0];
    const torso: V3 = [opts.run ? 8 : 3, 0, 0];
    const f = frameOf(torso);
    const feet = pair((i, s): V3 => {
      const ph = th + (i === 0 ? 0 : Math.PI);
      return [s * 0.1, y0 + A + Math.max(0, Math.cos(ph)) * opts.lift, opts.stride * Math.sin(ph)];
    });
    const hands = pair((i, s): V3 => {
      if (opts.arms === "carry") return hang(pelvis, torso, i, 0.26);
      const sw = rad((opts.run ? 32 : 20) * Math.sin(th + (i === 0 ? Math.PI : 0)));
      const sh = shoulderOf(pelvis, torso, i);
      return opts.run
        ? add(sh, comb([f.up, -0.3], [f.fwd, 0.12 + Math.sin(sw) * 0.3], [f.left, s * 0.03]))
        : add(sh, mul([s * 0.06, -Math.cos(sw), Math.sin(sw)], ARM * 0.96));
    });
    return { pelvis, torso, hands, feet, elbowPole: pair((_, s) => [s * 0.2, -0.3, -1]), toes: pair(() => [0, 0, 1]) };
  });
}

function carry(): Motion {
  return { keys: gait({ stride: 0.26, lift: 0.08, arms: "carry" }), kind: "loop", period: 1.15, effort: "both", cues: ["Walk tall", "Walk tall"] };
}

function cardio(p: Params): Motion {
  const machine = str(p, "machine", "treadmill" as "treadmill" | "bike" | "rower" | "elliptical" | "stairs");
  switch (machine) {
    case "bike": {
      const pelvis: V3 = [0, 0.9, -0.05];
      const torso: V3 = [30, 0, 0];
      const keys = Array.from({ length: 12 }, (_, k): Pose => {
        const ph = (k / 12) * Math.PI * 2;
        return {
          pelvis,
          torso,
          head: -25,
          hands: pair((_, s) => [s * 0.2, 1.02, 0.5]),
          feet: pair((i, s) => {
            const a = ph + (i === 0 ? 0 : Math.PI);
            return [s * 0.13, 0.36 + Math.sin(a) * 0.17, 0.33 + Math.cos(a) * 0.17] as V3;
          }),
          kneePole: pair((_, s) => [s * 0.15, 0.3, 1]),
          toes: pair(() => [0, -0.15, 1]),
        };
      });
      return { keys, kind: "loop", period: 1, effort: "both", cues: ["Smooth circles", "Smooth circles"] };
    }
    case "rower": {
      const feet = stance(0.12, 0.32, 0.27);
      const toes = pair((): V3 => [0, 0.8, 0.6]);
      const pose = (pz: number, lean: number, arms: "long" | "in"): Pose => {
        const pelvis: V3 = [0, 0.36, pz];
        const torso: V3 = [lean, 0, 0];
        const f = frameOf(torso);
        const chest = chestOf(pelvis, torso);
        const hands = pair((i, s): V3 => {
          if (arms === "in") return local(chest, f, [s * 0.13, -0.27, 0.14]);
          const sh = shoulderOf(pelvis, torso, i);
          return [s * 0.13, sh[1] - 0.12, sh[2] + ARM * 0.95];
        });
        return { pelvis, torso, hands, feet, toes, kneePole: pair((_, s) => [s * 0.15, 1, 0]), elbowPole: pair((_, s) => pole(f, s, -0.5, -1, 0.3)) };
      };
      return {
        keys: [pose(-0.18, 26, "long"), pose(-0.5, 22, "long"), pose(-0.54, -16, "in"), pose(-0.54, 18, "long"), pose(-0.35, 24, "long")],
        kind: "loop",
        period: 2.6,
        effort: "both",
        cues: ["Legs, body, arms", "Arms, body, legs"],
      };
    }
    case "elliptical": {
      const keys = Array.from({ length: 12 }, (_, k): Pose => {
        const ph = (k / 12) * Math.PI * 2;
        return {
          pelvis: [0, 1.22 + Math.sin(ph * 2) * 0.01, -0.05],
          torso: [4, 0, 0],
          hands: pair((i, s) => [s * 0.27, 1.38, 0.24 + 0.1 * Math.sin(ph + (i === 0 ? Math.PI : 0))] as V3),
          feet: pair((i, s) => {
            const a = ph + (i === 0 ? 0 : Math.PI);
            return [s * 0.12, 0.48 + Math.sin(a) * 0.09, 0.1 + Math.cos(a) * 0.18] as V3;
          }),
          toes: pair(() => [0, 0, 1]),
        };
      });
      return { keys, kind: "loop", period: 1.3, effort: "both", cues: ["Push and pull", "Push and pull"] };
    }
    case "stairs": {
      const keys = Array.from({ length: 8 }, (_, k): Pose => {
        const ph = (k / 8) * Math.PI * 2;
        const fy = (i: 0 | 1) => 0.42 + 0.11 * Math.sin(ph + (i === 0 ? 0 : Math.PI));
        const py = (fy(0) + fy(1)) / 2 + 0.72;
        return {
          pelvis: [0, py, -0.02],
          torso: [6, 0, 0],
          hands: pair((_, s) => [s * 0.3, py + 0.2, 0.25]),
          feet: pair((i, s) => [s * 0.11, fy(i), 0.16 + 0.06 * Math.cos(ph + (i === 0 ? 0 : Math.PI))] as V3),
          toes: pair(() => [0, 0, 1]),
        };
      });
      return { keys, kind: "loop", period: 1.4, effort: "both", cues: ["Steady steps", "Steady steps"] };
    }
    default: {
      const run = bool(p, "run", false);
      return {
        keys: gait({ y0: 0.17, stride: run ? 0.36 : 0.28, lift: run ? 0.2 : 0.08, run }),
        kind: "loop",
        period: run ? 0.72 : 1.1,
        effort: "both",
        cues: run ? ["Quick, light steps", "Quick, light steps"] : ["Walk tall", "Walk tall"],
      };
    }
  }
}

const PATTERNS: Record<PatternId, (p: Params) => Motion> = {
  squat,
  hinge,
  swing,
  legPress,
  kneeExtension,
  kneeCurl: (p) => kneeExtension({ mode: "curl", ...p }),
  hipAbduction,
  calfRaise,
  kickback,
  hipThrust,
  lunge,
  press,
  overheadPress,
  armArc,
  row,
  pulldown,
  pullUp,
  inverted,
  pushUp,
  elbow,
  dip,
  shrug,
  trunkFlex,
  legRaise,
  twist,
  woodchop,
  plank,
  deadBug,
  mountainClimber,
  burpee,
  thruster,
  carry,
  cardio,
};

export const PATTERN_IDS = Object.keys(PATTERNS) as PatternId[];

export function buildMotion(pattern: PatternId, params: Params = {}): Motion {
  return (PATTERNS[pattern] ?? PATTERNS.squat)(params);
}
