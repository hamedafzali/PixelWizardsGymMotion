import type { Muscle, MotionSpec, Params } from "./types.js";

// The muscles a movement works, read from its pattern and parameters. Used
// when there is no exercise record to say so, e.g. a bare spec or the demo.

export interface Targets {
  primary: Muscle;
  secondary: Muscle[];
}

const T = (primary: Muscle, ...secondary: Muscle[]): Targets => ({ primary, secondary });
const n = (p: Params | undefined, k: string, d: number) => (typeof p?.[k] === "number" ? (p[k] as number) : d);
const s = (p: Params | undefined, k: string, d: string) => (typeof p?.[k] === "string" ? (p[k] as string) : d);

export function musclesFor(spec: MotionSpec): Targets {
  const p = spec.params;
  switch (spec.pattern) {
    case "squat":
    case "thruster":
      return spec.pattern === "thruster" ? T("quads", "glutes", "shoulders", "triceps") : T("quads", "glutes", "adductors", "lower back");
    case "lunge":
    case "legPress":
      return T("quads", "glutes", "adductors");
    case "hinge":
      return T("hamstrings", "glutes", "lower back", "upper back", "forearms");
    case "swing":
    case "hipThrust":
    case "kickback":
      return T("glutes", "hamstrings");
    case "kneeExtension":
      return T("quads");
    case "kneeCurl":
      return T("hamstrings", "calves");
    case "hipAbduction":
      return p?.out === false ? T("adductors") : T("abductors", "glutes");
    case "calfRaise":
      return T("calves");
    case "press": {
      if (s(p, "dir", "fwd") === "down") return T("triceps", "chest", "shoulders");
      if (p?.tucked && n(p, "grip", 0.4) <= 0.3) return T("triceps", "chest", "shoulders");
      return T("chest", "triceps", "shoulders");
    }
    case "overheadPress":
      return T("shoulders", "triceps", "traps");
    case "pushUp":
      return T("chest", "triceps", "shoulders", "abs");
    case "dip":
      return T("triceps", "chest", "shoulders");
    case "armArc": {
      const plane = s(p, "plane", "frontal");
      const opens = n(p, "from", 10) < n(p, "to", 85);
      if (plane === "transverse") return opens ? T("rear delts", "upper back", "traps") : T("chest", "shoulders");
      if (plane === "sagittal" && !opens) return T("lats", "triceps");
      return T("shoulders", "traps");
    }
    case "row": {
      const style = s(p, "style", "cable");
      if (style === "upright") return T("shoulders", "traps", "biceps");
      if (style === "face") return T("rear delts", "upper back", "traps");
      return T("upper back", "lats", "biceps", "rear delts");
    }
    case "pulldown":
    case "pullUp":
    case "inverted":
      return T("lats", "biceps", "upper back");
    case "elbow": {
      const from = n(p, "from", 8);
      const to = n(p, "to", 135);
      if (Math.abs(to - from) < 40) return T("forearms");
      if (from > to || n(p, "upperArm", 0) >= 90) return T("triceps");
      return T("biceps", "forearms");
    }
    case "shrug":
      return T("traps", "forearms");
    case "trunkFlex": {
      const style = s(p, "style", "crunch");
      return style === "backExt" || style === "hyper" ? T("lower back", "glutes", "hamstrings") : T("abs", "obliques");
    }
    case "legRaise":
    case "deadBug":
    case "mountainClimber":
      return T("abs", "obliques");
    case "plank":
      return T("abs", "obliques", "shoulders", "glutes");
    case "twist":
    case "woodchop":
      return T("obliques", "abs");
    case "burpee":
      return T("full body");
    case "carry":
      return T("forearms", "traps", "abs");
    case "cardio":
      return s(p, "machine", "treadmill") === "rower" ? T("full body") : T("cardio");
  }
}
