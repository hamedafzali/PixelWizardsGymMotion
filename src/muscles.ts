import type { Muscle } from "./types.js";

/** 0 = off, 1 = helper muscle, 2 = main muscle. */
export type Level = 0 | 1 | 2;
export type Highlight = Partial<Record<Muscle, Level>>;

export const MUSCLES: readonly Muscle[] = [
  "chest",
  "shoulders",
  "rear delts",
  "triceps",
  "biceps",
  "forearms",
  "lats",
  "upper back",
  "traps",
  "lower back",
  "abs",
  "obliques",
  "glutes",
  "quads",
  "hamstrings",
  "adductors",
  "abductors",
  "calves",
  "full body",
  "cardio",
];

const isMuscle = (m: unknown): m is Muscle => typeof m === "string" && (MUSCLES as readonly string[]).includes(m);

/** Muscles shown on the figure, expanded for the catch-all groups. Unknown names are ignored. */
export function highlightFor(primary: Muscle | string | null | undefined, secondary: readonly (Muscle | string)[] = []): Highlight {
  const h: Highlight = {};
  const set = (m: Muscle, l: Level) => (h[m] = Math.max(h[m] ?? 0, l) as Level);
  const expand = (m: Muscle, l: Level) => {
    if (m === "full body") for (const x of ["quads", "glutes", "chest", "shoulders", "abs", "upper back"] as Muscle[]) set(x, l);
    else if (m === "cardio") for (const x of ["quads", "hamstrings", "calves", "glutes"] as Muscle[]) set(x, l);
    else set(m, l);
  };
  for (const m of secondary) if (isMuscle(m)) expand(m, 1);
  if (isMuscle(primary)) expand(primary, 2);
  return h;
}
