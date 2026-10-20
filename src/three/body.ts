import { MUSCLES } from "../muscles.js";
import { BODY, sideSign, solve, STAND, type Skeleton } from "../rig.js";
import type { Muscle, Pose, V3 } from "../types.js";
import { add, cross, dist, dot, len, mul, norm, sub } from "../vec.js";
import { meshField, primDist, refine, type Prim } from "./sdf.js";

// The body is modelled once, in a relaxed A-pose, as a signed distance field:
// bones, muscle bellies and features are ellipsoids and round cones in each
// bone's own frame, smoothly unioned into one skin. Surface nets turn it into
// a mesh, every vertex is weighted to the bones whose shapes it lies on, and
// helper bones at the big joints (half the rotation) keep elbows, knees,
// shoulders and hips from collapsing when they bend.

// ── Bones ──────────────────────────────────────────────────────────────────

export const BONE = {
  torso: 0,
  neck: 1,
  head: 2,
  upper: [3, 4],
  fore: [5, 6],
  hand: [7, 8],
  thigh: [9, 10],
  shin: [11, 12],
  foot: [13, 14],
  /** The torso's shapes all belong to `torso` (the chest); skinning shares them out down the spine. */
  pelvis: 15,
  lumbar: 16,
  scap: [17, 18],
} as const;
export const MAIN_BONES = 19;

/** Helper bones: [parent, child, joint] with the joint read off the skeleton. */
export const HELPERS: { parent: number; child: number; joint: (sk: Skeleton) => V3 }[] = [0, 1].flatMap((i) => [
  { parent: BONE.scap[i], child: BONE.upper[i], joint: (sk: Skeleton) => sk.shoulder[i] },
  { parent: BONE.upper[i], child: BONE.fore[i], joint: (sk: Skeleton) => sk.elbow[i] },
  { parent: BONE.pelvis, child: BONE.thigh[i], joint: (sk: Skeleton) => sk.hip[i] },
  { parent: BONE.thigh[i], child: BONE.shin[i], joint: (sk: Skeleton) => sk.knee[i] },
]);
export const BONE_COUNT = MAIN_BONES + HELPERS.length;

/** Bones whose skin may blend with each bone. */
const NEIGHBOURS: number[][] = [
  [BONE.neck, ...BONE.upper, ...BONE.thigh],
  [BONE.torso, BONE.head],
  [BONE.neck],
  ...[0, 1].map(() => [BONE.torso]),
  ...[0, 1].map((i) => [BONE.upper[i]]),
  [],
  [],
  ...[0, 1].map((i) => [BONE.torso, BONE.shin[i]]),
  ...[0, 1].map((i) => [BONE.thigh[i], BONE.foot[i]]),
  ...[0, 1].map((i) => [BONE.shin[i]]),
];
NEIGHBOURS[BONE.upper[0]].push(BONE.fore[0]);
NEIGHBOURS[BONE.upper[1]].push(BONE.fore[1]);

/** A bone's frame: origin plus x (lateral / figure's left), y (along the bone), z (front). */
export interface BoneFrame {
  o: V3;
  x: V3;
  y: V3;
  z: V3;
}

const perp = (a: V3, axis: V3): V3 => sub(a, mul(axis, dot(a, axis)));

/** Front direction for a bone: the hint, fading to the torso frame as it degenerates. */
function frontFor(axis: V3, hint: V3, sk: Skeleton): V3 {
  const h = perp(hint, axis);
  const s = len(h);
  const w = Math.min(1, s / 0.04);
  const fb = perp(sk.frame.fwd, axis);
  const fall = len(fb) > 0.15 ? norm(fb) : norm(perp(sk.frame.up, axis));
  const hn = s > 1e-9 ? mul(h, 1 / s) : fall;
  return norm(add(mul(hn, w), mul(fall, 1 - w)));
}

/** Lateral axis for a limb on side `s` (mirrored, so authored shapes mirror too). */
const lateral = (y: V3, z: V3, s: number): V3 => mul(cross(z, y), s);

/** Every main bone's frame for a solved skeleton. Bind pose and animation share this. */
export function boneFrames(sk: Skeleton): BoneFrame[] {
  const f = sk.frame;
  const out: BoneFrame[] = [];
  out[BONE.torso] = { o: sk.pelvis, x: f.left, y: f.up, z: f.fwd };
  // Spine: the pelvis bone carries the hips and glutes, the lumbar bone sits
  // half-way between pelvis and chest, so the bend spreads along the back.
  const pf = sk.pelvisFrame;
  out[BONE.pelvis] = { o: sk.pelvis, x: pf.left, y: pf.up, z: pf.fwd };
  const ly = norm(add(pf.up, f.up));
  const lz = norm(perp(add(pf.fwd, f.fwd), ly));
  out[BONE.lumbar] = { o: sk.pelvis, x: cross(ly, lz), y: ly, z: lz };
  // Shoulder blades: the chest frame, glided with the arm.
  for (const i of [0, 1] as const) out[BONE.scap[i]] = { o: add(sk.pelvis, sk.scap[i]), x: f.left, y: f.up, z: f.fwd };
  const ny = norm(sub(sk.head, sk.chest));
  const nz = frontFor(ny, sk.headFwd, sk);
  out[BONE.neck] = { o: sk.chest, x: cross(ny, nz), y: ny, z: nz };
  const hy = norm(sub(sk.head, sk.neck));
  const hz = frontFor(hy, sk.headFwd, sk);
  out[BONE.head] = { o: sk.head, x: cross(hy, hz), y: hy, z: hz };

  for (const i of [0, 1] as const) {
    const s = sideSign(i);
    const limb = (o: V3, to: V3, hint: V3): BoneFrame => {
      const y = norm(sub(to, o));
      const z = frontFor(y, hint, sk);
      return { o, x: lateral(y, z, s), y, z };
    };
    out[BONE.upper[i]] = limb(sk.shoulder[i], sk.elbow[i], sub(sk.hand[i], sk.elbow[i]));
    const fore = limb(sk.elbow[i], sk.hand[i], sub(sk.shoulder[i], sk.elbow[i]));
    out[BONE.fore[i]] = fore;
    out[BONE.thigh[i]] = limb(sk.hip[i], sk.knee[i], mul(sub(sk.ankle[i], sk.knee[i]), -1));
    out[BONE.shin[i]] = limb(sk.knee[i], sk.ankle[i], mul(sub(sk.hip[i], sk.knee[i]), -1));
    out[BONE.foot[i]] = limb(sk.ankle[i], sk.toe[i], sub(sk.knee[i], sk.ankle[i]));
    out[BONE.hand[i]] = handFrame(sk, i, fore);
  }
  return out;
}

/**
 * The fist turns about the forearm so its grip runs along the bar: towards
 * the other hand, or the forearm's own lateral axis when the hands are close.
 * The palm faces the inside of the elbow, forwards, or away from the head,
 * whichever fits best, so presses, pulldowns and curls all read naturally.
 */
function handFrame(sk: Skeleton, i: 0 | 1, fore: BoneFrame): BoneFrame {
  const s = sideSign(i);
  const y = fore.y;
  const apart = perp(sub(sk.hand[i], sk.hand[1 - i]), y);
  const w = Math.min(1, Math.max(0, (len(apart) - 0.12) / 0.12));
  let g = norm(add(mul(len(apart) > 1e-9 ? norm(apart) : fore.x, w), mul(fore.x, 1 - w)));
  if (len(g) < 1e-6) g = fore.x;
  // Palm normal for this grip axis, and the side it should face.
  let z = norm(cross(g, y));
  const want = add(add(mul(fore.z, 2), sk.frame.fwd), mul(sk.frame.up, -0.7));
  if (dot(z, want) < 0) z = mul(z, -1);
  return { o: sk.hand[i], x: lateral(y, z, s), y, z };
}

/** Relaxed A-pose the body is modelled in. */
export function bindPose(): Pose {
  const sy = STAND + 0.012 + BODY.torso - 0.03;
  const a = (40 * Math.PI) / 180;
  const reach = BODY.upperArm + BODY.forearm - 0.03;
  const hand = (s: number): V3 => [s * (BODY.shoulderHalf + reach * Math.sin(a)), sy - reach * Math.cos(a), 0.06];
  return {
    pelvis: [0, STAND + 0.012, 0],
    torso: [0, 0, 0],
    hands: [hand(1), hand(-1)],
    feet: [
      [0.12, BODY.ankle, 0.0],
      [-0.12, BODY.ankle, 0.0],
    ],
    toes: [
      [0.1, 0, 1],
      [-0.1, 0, 1],
    ],
  };
}

// ── Anatomy ────────────────────────────────────────────────────────────────

/** What a shape paints when it is the nearest one. */
export type Paint = "skin" | "hair" | "shoe" | "sole" | "sock" | "shorts" | "eye" | "iris" | "lips" | "brow";
export const PAINTS: Paint[] = ["skin", "hair", "shoe", "sole", "sock", "shorts", "eye", "iris", "lips", "brow"];
export const PAINT_COUNT = PAINTS.length;
const SOCK = PAINTS.indexOf("sock");
const SHORTS = PAINTS.indexOf("shorts");
const SOLE = PAINTS.indexOf("sole");
/**
 * Paints that sit inside other shapes and override the rest: the eye behind
 * its lids wins on its own surface; brows win wherever the skin lies within
 * them (they are buried under the brow ridge).
 */
const INSET: [paint: number, inside: boolean][] = [
  [PAINTS.indexOf("eye"), false],
  [PAINTS.indexOf("iris"), false],
  [PAINTS.indexOf("brow"), true],
];

interface Shape {
  /** Ellipsoid [centre, radii], round cone [a, b, ra, rb] or rounded box [centre, half, round]. */
  e?: [V3, V3];
  c?: [V3, V3, number, number];
  box?: [V3, V3, number];
  k?: number;
  sub?: boolean;
  muscle?: Muscle;
  paint?: Paint;
  /** Torso and head only: also add the mirror image (x → -x). */
  mirror?: boolean;
}

const E = (c: V3, r: V3, o: Omit<Shape, "e"> = {}): Shape => ({ e: [c, r], ...o });
const C = (a: V3, b: V3, ra: number, rb: number, o: Omit<Shape, "c"> = {}): Shape => ({ c: [a, b, ra, rb], ...o });
const M = (s: Shape): Shape => ({ ...s, mirror: true });

// Torso: x = figure's left, y = up from the pelvis centre, z = front.
const TORSO: Shape[] = [
  E([0, 0.0, -0.012], [0.152, 0.1, 0.1], { k: 0.03 }), // pelvis
  E([0, 0.15, 0.0], [0.124, 0.13, 0.086], { k: 0.05 }), // waist
  E([0, 0.33, -0.006], [0.146, 0.172, 0.1], { k: 0.05 }), // ribcage
  C([0.14, 0.44, -0.012], [-0.14, 0.44, -0.012], 0.064, 0.064, { k: 0.04 }), // shoulder girdle
  M(C([0.02, 0.478, 0.058], [0.16, 0.466, 0.02], 0.012, 0.012, { k: 0.016 })), // collarbone
  M(E([0.072, 0.385, 0.07], [0.076, 0.06, 0.042], { k: 0.02, muscle: "chest" })),
  M(C([0.09, 0.405, 0.064], [0.165, 0.43, 0.035], 0.04, 0.028, { k: 0.02, muscle: "chest" })),
  // Rectus abdominis: a flat sheet, three tendinous rows above the navel and
  // a smooth lower belly that tucks into the waistband.
  E([0, 0.2, 0.058], [0.064, 0.14, 0.03], { k: 0.025, muscle: "abs" }),
  E([0, 0.105, 0.064], [0.052, 0.05, 0.022], { k: 0.025, muscle: "abs" }),
  ...[0.168, 0.228, 0.284].map((y, i) =>
    M(E([0.029, y, 0.079 - i * 0.002], [0.028, 0.028 - i * 0.002, 0.011], { k: 0.018, muscle: "abs" })),
  ),
  E([0, 0.118, 0.088], [0.0055, 0.0065, 0.008], { k: 0.007, sub: true }), // navel
  // Serratus: fingers of muscle along the ribs under the armpit.
  ...[0.255, 0.29, 0.325].map((y) => M(C([0.112, y - 0.012, 0.036], [0.13, y + 0.006, 0.0], 0.011, 0.009, { k: 0.016, muscle: "obliques" }))),
  M(E([0.098, 0.17, 0.022], [0.036, 0.095, 0.05], { k: 0.05, muscle: "obliques" })),
  M(E([0.116, 0.315, -0.04], [0.05, 0.13, 0.066], { k: 0.03, muscle: "lats" })),
  M(E([0.075, 0.37, -0.074], [0.075, 0.075, 0.036], { k: 0.025, muscle: "upper back" })),
  M(C([0.0, 0.36, -0.072], [0.1, 0.468, -0.034], 0.045, 0.03, { k: 0.03, muscle: "traps" })),
  M(C([0.035, 0.53, -0.03], [0.14, 0.47, -0.014], 0.03, 0.027, { k: 0.026, muscle: "traps" })),
  M(C([0.032, 0.03, -0.064], [0.032, 0.27, -0.072], 0.03, 0.022, { k: 0.035, muscle: "lower back" })),
  M(E([0.075, -0.055, -0.068], [0.086, 0.092, 0.072], { k: 0.03, muscle: "glutes" })),
  M(E([0.13, 0.0, -0.012], [0.042, 0.07, 0.062], { k: 0.03, muscle: "abductors" })),
  C([0, 0.06, -0.122], [0, 0.42, -0.128], 0.01, 0.01, { k: 0.016, sub: true }), // spine groove
];

// Neck: y = chest → head, z = front.
const NECK: Shape[] = [
  C([0, -0.02, -0.006], [0, 0.11, 0.004], 0.053, 0.048, { k: 0.03 }),
  M(C([0.024, 0.0, 0.042], [0.05, 0.12, -0.004], 0.013, 0.012, { k: 0.016 })), // sternocleidomastoid
  E([0, 0.03, -0.034], [0.06, 0.05, 0.03], { k: 0.03, muscle: "traps" }),
];

// Head: origin at the centre of the skull, y up, z = face.
const HEAD: Shape[] = [
  E([0, 0.016, -0.012], [0.076, 0.091, 0.097], { k: 0.02 }), // cranium
  E([0, -0.04, 0.03], [0.061, 0.062, 0.064], { k: 0.03 }), // face and jaw
  E([0, -0.087, 0.066], [0.024, 0.018, 0.021], { k: 0.02 }), // chin
  M(E([0.011, -0.093, 0.077], [0.011, 0.009, 0.01], { k: 0.012 })), // chin mounds
  M(C([0.05, -0.05, -0.012], [0.025, -0.09, 0.05], 0.015, 0.015, { k: 0.022 })), // jawline
  M(E([0.047, -0.011, 0.052], [0.026, 0.014, 0.022], { k: 0.03 })), // cheekbones
  M(E([0.042, -0.048, 0.038], [0.018, 0.026, 0.026], { k: 0.03 })), // cheeks over the masseter
  // Brows: a ridge rising from the bridge of the nose and fading at the temple.
  M(C([0.008, 0.024, 0.0832], [0.046, 0.027, 0.0745], 0.006, 0.0048, { k: 0.026 })),
  E([0, 0.022, 0.087], [0.011, 0.01, 0.007], { k: 0.012 }), // glabella
  // Eyes: a socket carved under the brow, a lid shell with an almond opening
  // cut through it, and the eyeball and iris showing behind.
  M(E([0.031, 0.006, 0.092], [0.016, 0.0095, 0.0105], { k: 0.016, sub: true })),
  M(E([0.031, 0.003, 0.0712], [0.0127, 0.0118, 0.0124], { k: 0.004 })), // lids
  M(E([0.031, 0.0022, 0.0842], [0.0122, 0.0041, 0.006], { k: 0.0016, sub: true })), // opening
  M(E([0.031, 0.003, 0.0712], [0.0114, 0.0114, 0.0114], { k: 0.0012, paint: "eye" })), // eyeball
  M(E([0.0305, 0.0024, 0.0812], [0.0056, 0.0056, 0.0018], { k: 0.0006, paint: "iris" })),
  // Brows: hair along the ridge, thick at the bridge, thinning at the temple.
  M(C([0.011, 0.0262, 0.0888], [0.047, 0.0292, 0.0802], 0.0042, 0.0026, { k: 0.003, paint: "brow" })),
  // Nose: bridge, tip, wings, nostrils.
  C([0, 0.008, 0.088], [0, -0.022, 0.104], 0.0058, 0.0075, { k: 0.006 }),
  E([0, -0.006, 0.091], [0.0105, 0.018, 0.007], { k: 0.012 }), // nose sides
  E([0, -0.026, 0.103], [0.0095, 0.0085, 0.0088], { k: 0.006 }), // tip
  M(E([0.0105, -0.03, 0.093], [0.0062, 0.006, 0.0068], { k: 0.006 })), // wings
  // Mouth: philtrum, lips, and the line between them.
  M(C([0, -0.0478, 0.094], [0.021, -0.0525, 0.0835], 0.0048, 0.003, { k: 0.006, paint: "lips" })), // upper lip
  M(E([0.0075, -0.0585, 0.0895], [0.0125, 0.0056, 0.0064], { k: 0.006, paint: "lips" })), // lower lip
  M(C([0, -0.0528, 0.0975], [0.0215, -0.0538, 0.0855], 0.0014, 0.0011, { k: 0.005, sub: true })), // mouth line
  // Ears: a shell with a rolled rim and a hollow.
  M(E([0.074, -0.004, -0.01], [0.007, 0.027, 0.016], { k: 0.006 })),
  M(C([0.079, 0.016, 0.0], [0.081, 0.023, -0.012], 0.0032, 0.0034, { k: 0.003 })),
  M(C([0.081, 0.023, -0.012], [0.081, 0.008, -0.025], 0.0034, 0.0034, { k: 0.003 })),
  M(C([0.081, 0.008, -0.025], [0.08, -0.015, -0.02], 0.0034, 0.0034, { k: 0.003 })),
  M(C([0.08, -0.015, -0.02], [0.077, -0.028, -0.01], 0.0034, 0.0055, { k: 0.004 })), // lobe
  M(E([0.0805, -0.004, -0.009], [0.004, 0.011, 0.0075], { k: 0.003, sub: true })), // hollow
  E([0, 0.036, -0.02], [0.08, 0.094, 0.1], { k: 0.01, paint: "hair" }),
];

// Limbs: y = along the bone from the proximal joint, z = front, x = lateral.
const UPPER_ARM: Shape[] = [
  C([0, 0.0, 0], [0, 0.27, -0.005], 0.05, 0.036, { k: 0.02 }),
  E([0.0, 0.035, 0.022], [0.048, 0.08, 0.042], { k: 0.02, muscle: "shoulders" }),
  E([0.026, 0.04, 0.0], [0.038, 0.085, 0.046], { k: 0.02, muscle: "shoulders" }),
  E([0.0, 0.035, -0.026], [0.045, 0.075, 0.04], { k: 0.02, muscle: "rear delts" }),
  E([0, 0.155, 0.026], [0.034, 0.085, 0.034], { k: 0.02, muscle: "biceps" }),
  E([0.005, 0.13, -0.028], [0.038, 0.1, 0.035], { k: 0.02, muscle: "triceps" }),
  E([0, 0.285, -0.02], [0.028, 0.03, 0.022], { k: 0.02 }), // elbow
];

/** Forearm-local y where the hand takes over (a round section, so twist is invisible). */
export const WRIST = 0.225;

const FOREARM: Shape[] = [
  C([0, 0.0, 0], [0, 0.205, 0], 0.04, 0.027, { k: 0.02 }),
  E([0.0, 0.075, 0.012], [0.04, 0.085, 0.034], { k: 0.02, muscle: "forearms" }),
  E([0.022, 0.06, 0.0], [0.03, 0.08, 0.035], { k: 0.02, muscle: "forearms" }),
  C([0, 0.195, 0], [0, 0.25, 0], 0.0265, 0.0265, { k: 0.01 }), // wrist
];

// Hand: origin at the grip point, y along the forearm, x along the bar, z = palm.
const HAND: Shape[] = (() => {
  const r = 0.026; // finger centreline radius around the bar
  const arc = (deg: number): [number, number] => {
    const t = (deg * Math.PI) / 180;
    return [r * Math.sin(t), -r * Math.cos(t)]; // [y, z]
  };
  const finger = (x: number, reach: number, rad: number): Shape[] => {
    const pts = [0, 70, 150, 150 + reach].map(arc);
    const p = pts.map(([y, z]) => [x, y, z] as V3);
    return [
      E(p[0], [0.0108, 0.0105, 0.011], { k: 0.008 }), // knuckle
      C(p[0], p[1], rad, rad * 0.98, { k: 0.008 }),
      C(p[1], p[2], rad * 0.98, rad * 0.94, { k: 0.008 }),
      C(p[2], p[3], rad * 0.94, rad * 0.84, { k: 0.007 }),
    ];
  };
  return [
    C([0, -0.088, 0], [0, -0.06, -0.008], 0.0265, 0.025, { k: 0.016 }),
    { box: [[0, -0.034, -0.028], [0.031, 0.03, 0.003], 0.011], k: 0.016 },
    E([0.002, -0.036, -0.032], [0.04, 0.038, 0.013], { k: 0.012 }), // domed back of the hand
    E([-0.03, -0.045, -0.018], [0.02, 0.03, 0.016], { k: 0.015 }), // thumb pad
    // Fingers packed side by side, as in a real grip: no gaps between them.
    ...finger(-0.03, 62, 0.0104),
    ...finger(-0.01, 72, 0.0108),
    ...finger(0.01, 66, 0.0105),
    ...finger(0.029, 50, 0.0095),
    // Flesh between the curled fingers, so the joints meet without pockets.
    // Straight phalanges sag inside the arc between joints; pad each span
    // back out to it so the wrap reads as round flesh, not a polygon.
    ...[35, 110].map((deg) => {
      const [y, z] = arc(deg);
      return C([-0.029, y, z], [0.028, y, z], 0.0094, 0.0086, { k: 0.008 });
    }),
    C([-0.04, -0.05, -0.024], [-0.048, -0.014, 0.0], 0.013, 0.011, { k: 0.012 }), // thumb
    C([-0.048, -0.014, 0.0], [-0.028, 0.002, 0.03], 0.011, 0.0095, { k: 0.01 }),
  ];
})();

const THIGH: Shape[] = [
  C([0.005, -0.01, -0.005], [0, 0.42, 0.0], 0.08, 0.05, { k: 0.025 }),
  E([0.0, 0.2, 0.04], [0.05, 0.16, 0.045], { k: 0.025, muscle: "quads" }),
  E([0.04, 0.22, 0.01], [0.045, 0.15, 0.05], { k: 0.025, muscle: "quads" }),
  E([-0.032, 0.34, 0.03], [0.038, 0.065, 0.04], { k: 0.02, muscle: "quads" }),
  E([0.0, 0.2, -0.04], [0.058, 0.16, 0.048], { k: 0.025, muscle: "hamstrings" }),
  E([-0.04, 0.12, 0.0], [0.045, 0.12, 0.055], { k: 0.025, muscle: "adductors" }),
  E([0.06, 0.04, 0.02], [0.03, 0.07, 0.04], { k: 0.025, muscle: "abductors" }),
  C([0, 0.4, -0.004], [0, 0.47, -0.004], 0.05, 0.047, { k: 0.02 }), // knee
  E([0, 0.435, 0.042], [0.028, 0.032, 0.018], { k: 0.015 }), // kneecap
];

const SHIN: Shape[] = [
  C([0, 0.0, -0.005], [0, 0.4, -0.004], 0.048, 0.028, { k: 0.02 }),
  E([-0.02, 0.13, -0.035], [0.033, 0.085, 0.036], { k: 0.02, muscle: "calves" }),
  E([0.02, 0.11, -0.03], [0.03, 0.075, 0.032], { k: 0.02, muscle: "calves" }),
  E([0, 0.22, -0.02], [0.042, 0.1, 0.03], { k: 0.025, muscle: "calves" }),
  E([0.015, 0.15, 0.025], [0.022, 0.1, 0.02], { k: 0.02 }), // tibialis
  E([0.022, 0.41, 0], [0.011, 0.014, 0.011], { k: 0.012 }), // ankle bones
  E([-0.024, 0.4, 0], [0.014, 0.016, 0.014], { k: 0.012 }),
];

// Foot: y = heel → toe, z = up from the ankle, x = lateral. The sole is at z = -0.08.
const FOOT: Shape[] = [
  E([0, -0.035, -0.04], [0.037, 0.046, 0.042], { k: 0.02, paint: "shoe" }), // heel
  C([0, 0.0, -0.025], [-0.005, 0.15, -0.05], 0.042, 0.027, { k: 0.025, paint: "shoe" }),
  E([-0.006, 0.155, -0.056], [0.043, 0.056, 0.025], { k: 0.02, paint: "shoe" }), // toe box
  C([0, -0.012, -0.02], [0, 0.0, 0.018], 0.04, 0.035, { k: 0.02, paint: "shoe" }), // collar
  // Sole: a thick heel and thinner forefoot following the upper's outline,
  // rounded at both ends, with a little toe spring. Painted by height (SOLE_TOP).
  { box: [[0, -0.025, -0.071], [0.026, 0.04, 0.002], 0.009], k: 0.015, paint: "shoe" },
  { box: [[-0.005, 0.08, -0.074], [0.031, 0.1, 0.0], 0.008], k: 0.015, paint: "shoe" },
  E([0, -0.05, -0.07], [0.035, 0.03, 0.011], { k: 0.015, paint: "shoe" }), // heel
  E([-0.006, 0.178, -0.07], [0.039, 0.034, 0.009], { k: 0.015, paint: "shoe" }), // toe
  // Tongue; the laces are painted across it (LACES).
  C([0, 0.018, 0.02], [-0.003, 0.085, -0.002], 0.016, 0.014, { k: 0.012, paint: "shoe" }),
];

// ── Building ───────────────────────────────────────────────────────────────

interface Meta {
  bone: number;
  muscle: number; // index into MUSCLES, or -1
  paint: number; // index into PAINTS
}

function place(f: BoneFrame, p: V3, flip = 1): V3 {
  return add(f.o, add(add(mul(f.x, p[0] * flip), mul(f.y, p[1])), mul(f.z, p[2])));
}

function toPrims(shapes: Shape[], bone: number, f: BoneFrame, prims: Prim[], meta: Meta[]) {
  for (const s of shapes)
    for (const flip of s.mirror ? [1, -1] : [1]) {
      const m: Meta = {
        bone,
        muscle: s.muscle ? MUSCLES.indexOf(s.muscle) : -1,
        paint: PAINTS.indexOf(s.paint ?? "skin"),
      };
      const k = s.k ?? 0.02;
      const tag = meta.length;
      const ax: [V3, V3, V3] = [mul(f.x, flip), f.y, f.z];
      if (s.e) prims.push({ kind: 0, c: place(f, s.e[0], flip), r: s.e[1], ax, k, sub: s.sub, tag });
      else if (s.c)
        prims.push({ kind: 1, a: place(f, s.c[0], flip), b: place(f, s.c[1], flip), ra: s.c[2], rb: s.c[3], k, sub: s.sub, tag });
      else if (s.box) prims.push({ kind: 2, c: place(f, s.box[0], flip), h: s.box[1], ax, round: s.box[2], k, sub: s.sub, tag });
      meta.push(m);
    }
}

/** Local coordinates of world point `p` in frame `f`. */
const toLocal = (f: BoneFrame, p: V3): V3 => {
  const d = sub(p, f.o);
  return [dot(d, f.x), dot(d, f.y), dot(d, f.z)];
};

export interface BodyMesh {
  position: Float32Array;
  normal: Float32Array;
  index: Uint32Array;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  /** Per vertex, how much of each of PAINTS shows (PAINT_COUNT weights summing to 1). */
  paints: Float32Array;
  /** Up to two muscles per vertex: [muscle index or 255, weight] × 2. */
  muscleA: Uint8Array;
  weightA: Float32Array;
  muscleB: Uint8Array;
  weightB: Float32Array;
  bind: BoneFrame[];
  bindSkeleton: Skeleton;
}

const SIGMA = 0.02;

/** Where the cloth ends, in bone-local y: torso (waistband), thigh (shorts), shin (sock cuff). */
const HEM = { waist: 0.07, thigh: 0.17, sock: 0.355 };
/** Height in the foot frame where the sole's sidewall meets the upper. */
const SOLE_TOP = -0.062;
/** Laces across the tongue in the foot frame: rows along y, half-width in x, and the band's half-thickness. */
const LACES = { rows: [0.03, 0.047, 0.064, 0.081], half: 0.017, band: 0.0028 };

/** Models, meshes and weights the body. Takes a few hundred milliseconds; cache the result. */
export function buildBody(cell = 0.0065): BodyMesh {
  const bindSkeleton = solve(bindPose());
  const bind = boneFrames(bindSkeleton);
  const prims: Prim[] = [];
  const meta: Meta[] = [];
  toPrims(TORSO, BONE.torso, bind[BONE.torso], prims, meta);
  toPrims(NECK, BONE.neck, bind[BONE.neck], prims, meta);
  toPrims(HEAD, BONE.head, bind[BONE.head], prims, meta);
  for (const i of [0, 1] as const) {
    toPrims(UPPER_ARM, BONE.upper[i], bind[BONE.upper[i]], prims, meta);
    toPrims(FOREARM, BONE.fore[i], bind[BONE.fore[i]], prims, meta);
    toPrims(HAND, BONE.hand[i], bind[BONE.hand[i]], prims, meta);
    toPrims(THIGH, BONE.thigh[i], bind[BONE.thigh[i]], prims, meta);
    toPrims(SHIN, BONE.shin[i], bind[BONE.shin[i]], prims, meta);
    toPrims(FOOT, BONE.foot[i], bind[BONE.foot[i]], prims, meta);
  }

  // The face and hands carry features of a few millimetres, finer than the
  // grid; split the triangles there and pull the new points onto the surface.
  const head = bind[BONE.head];
  const hands = [0, 1].map((i) => bind[BONE.hand[i]]);
  const detail = (x: number, y: number, z: number) => {
    const p: V3 = [x, y, z];
    const h = toLocal(head, p);
    if (Math.hypot(h[0], h[1] - 0.0, h[2] + 0.01) < 0.13) {
      const face = h[2] > 0.035 && h[1] < 0.045 && h[1] > -0.08;
      const ear = Math.abs(h[0]) > 0.06 && h[1] < 0.035 && h[2] < 0.01;
      return face || ear ? 0.0016 : 0.0035;
    }
    for (const f of hands) if (Math.hypot(...toLocal(f, p)) < 0.1) return 0.0028;
    // Feet: laces across the instep, and the sole's top edge.
    for (const i of [0, 1] as const) {
      const l = toLocal(bind[BONE.foot[i]], p);
      if (l[2] > -0.02 && Math.abs(l[0]) < LACES.half + 0.004 && LACES.rows.some((y) => Math.abs(l[1] - y) < LACES.band + 0.003)) return 0.0022;
      if (Math.abs(l[2] - SOLE_TOP) < 0.004 && l[1] > -0.1 && l[1] < 0.23) return 0.0032;
    }
    // Hems: fine enough for the cloth edge to be a clean line with a lip.
    const t = toLocal(bind[BONE.torso], p);
    if (Math.abs(t[1] - HEM.waist) < 0.018 && Math.hypot(t[0], t[2]) < 0.2) return 0.0022;
    for (const i of [0, 1] as const) {
      const l = toLocal(bind[BONE.thigh[i]], p);
      if (Math.abs(l[1] - HEM.thigh) < 0.016 && Math.hypot(l[0], l[2]) < 0.12) return 0.0022;
      const c = toLocal(bind[BONE.shin[i]], p);
      if (Math.abs(c[1] - HEM.sock) < 0.014 && Math.hypot(c[0], c[2]) < 0.08) return 0.0022;
    }
    return Infinity;
  };
  const m = refine(prims, meshField(prims, cell), detail, 3);
  const nv = m.position.length / 3;
  const skinIndex = new Uint16Array(nv * 4);
  const skinWeight = new Float32Array(nv * 4);
  const paints = new Float32Array(nv * PAINT_COUNT);
  const paintDist = new Float64Array(PAINT_COUNT);
  const insetDist = new Float64Array(INSET.length);
  const muscleA = new Uint8Array(nv).fill(255);
  const muscleB = new Uint8Array(nv).fill(255);
  const weightA = new Float32Array(nv);
  const weightB = new Float32Array(nv);
  const boneDist = new Float64Array(MAIN_BONES);
  const muscleW = new Float64Array(MUSCLES.length);
  const helperOf = new Map(HELPERS.map((h, i) => [h.parent * 100 + h.child, MAIN_BONES + i]));

  const hem: number[] = [];
  for (let v = 0; v < nv; v++) {
    const p: V3 = [m.position[v * 3], m.position[v * 3 + 1], m.position[v * 3 + 2]];
    boneDist.fill(Infinity);
    paintDist.fill(Infinity);
    insetDist.fill(Infinity);
    muscleW.fill(0);
    let best = Infinity;
    let owner = 0;
    for (const i of m.near(v)) {
      const s = prims[i];
      if (s.sub) continue;
      const d = primDist(s, p[0], p[1], p[2]);
      const mt = meta[s.tag];
      if (d < boneDist[mt.bone]) boneDist[mt.bone] = d;
      if (d < paintDist[mt.paint]) paintDist[mt.paint] = d;
      const ins = INSET.findIndex(([j]) => j === mt.paint);
      if (ins >= 0) {
        const e = INSET[ins][1] ? Math.max(d, 0) : Math.abs(d);
        if (e < insetDist[ins]) insetDist[ins] = e;
      }
      if (d < best) {
        best = d;
        owner = s.tag;
      }
      if (mt.muscle >= 0) {
        const w = 1 - smooth(0.002, 0.016, d);
        if (w > muscleW[mt.muscle]) muscleW[mt.muscle] = w;
      }
    }
    const om = meta[owner];
    let ob = om.bone;

    // The hand takes over at the wrist, a hard cut on a round section.
    for (const i of [0, 1] as const)
      if (ob === BONE.fore[i] || ob === BONE.hand[i]) ob = toLocal(bind[BONE.fore[i]], p)[1] > WRIST ? BONE.hand[i] : BONE.fore[i];

    // Gaussian falloff on how far the vertex is from each candidate bone's own shapes.
    const cands = [ob, ...NEIGHBOURS[ob]];
    const dmin = Math.min(...cands.map((b) => boneDist[b]));
    let ws: [number, number][] = cands
      .map((b) => [b, Math.exp(-(((boneDist[b] - dmin) / SIGMA) ** 2))] as [number, number])
      .filter(([, w]) => w > 1e-3);
    if (!ws.length) ws = [[ob, 1]];

    // The torso's share goes down the spine by height (pelvis → lower back →
    // rib cage), and round each shoulder to its blade.
    const ti = ws.findIndex(([b]) => b === BONE.torso);
    if (ti >= 0) {
      const w = ws[ti][1];
      ws.splice(ti, 1);
      const y = toLocal(bind[BONE.torso], p)[1];
      const wp = 1 - smooth(-0.01, 0.14, y);
      const wc = smooth(0.15, 0.3, y);
      let chest = w * wc;
      for (const i of [0, 1] as const) {
        const ws_ = chest * (1 - smooth(0.07, 0.18, dist(p, bindSkeleton.shoulder[i])));
        if (ws_ > 1e-3) ws.push([BONE.scap[i], ws_]);
        chest -= ws_;
      }
      for (const [b, x] of [
        [BONE.pelvis, w * wp],
        [BONE.lumbar, w * (1 - wp - wc)],
        [BONE.torso, chest],
      ] as const)
        if (x > 1e-3) ws.push([b, x]);
    }

    // Split parent/child pairs across their helper: (1-s)², 2s(1-s), s².
    for (const [key, hb] of helperOf) {
      const pa = ws.find(([b]) => b === Math.floor(key / 100));
      const ch = ws.find(([b]) => b === key % 100);
      if (!pa || !ch) continue;
      const t = pa[1] + ch[1];
      const s = ch[1] / t;
      pa[1] = t * (1 - s) ** 2;
      ch[1] = t * s * s;
      ws.push([hb, t * 2 * s * (1 - s)]);
    }
    ws.sort((a, b) => b[1] - a[1]);
    ws = ws.slice(0, 4);
    const total = ws.reduce((a, [, w]) => a + w, 0);
    ws.forEach(([b, w], j) => {
      skinIndex[v * 4 + j] = b;
      skinWeight[v * 4 + j] = w / total;
    });

    // Paint: a soft-min over the nearest shapes of each paint, so edges
    // between skin, hair, shoe and sole blend over a millimetre or two rather
    // than following the meshing grid. Shorts and socks then cover the skin
    // share by region.
    const pw = paints.subarray(v * PAINT_COUNT, (v + 1) * PAINT_COUNT);
    paintDist[PAINTS.indexOf("hair")] -= 0.0012; // the hair sits only a few millimetres proud
    const shoeDist = paintDist[PAINTS.indexOf("shoe")];
    const dm = Math.min(...paintDist);
    let sum = 0;
    for (let j = 0; j < PAINT_COUNT; j++) sum += pw[j] = paintDist[j] < Infinity ? Math.exp(-(paintDist[j] - dm) / 0.0012) : 0;
    for (let j = 0; j < PAINT_COUNT; j++) pw[j] /= sum;
    INSET.forEach(([j], i) => {
      const w = 1 - smooth(0.0001, 0.0004, insetDist[i]);
      for (let k = 0; k < PAINT_COUNT; k++) pw[k] *= 1 - w;
      pw[j] += w;
    });
    // Shorts: below the waistband, and above the hem on whichever thigh is
    // near. Socks: below their cuff. Both are cloth over the skin, so they
    // stand a little proud of it and end in a small lip.
    let rw = 0;
    let rp = SHORTS;
    const below = 1 - smooth(HEM.waist - 0.0015, HEM.waist + 0.0015, toLocal(bind[BONE.torso], p)[1]);
    // One hem per side, picked by which leg the point sits over, so the
    // hemline never steps where vertex ownership changes.
    let legs = 0;
    if (ob === BONE.torso || ob === BONE.thigh[0] || ob === BONE.thigh[1]) {
      const side = Math.abs(p[0] - bind[BONE.thigh[0]].o[0]) <= Math.abs(p[0] - bind[BONE.thigh[1]].o[0]) ? 0 : 1;
      legs = 1 - smooth(HEM.thigh - 0.0015, HEM.thigh + 0.0015, toLocal(bind[BONE.thigh[side]], p)[1]);
    }
    rw = below * legs;
    for (const i of [0, 1] as const)
      if (ob === BONE.shin[i] || ob === BONE.foot[i]) {
        const sock = smooth(HEM.sock - 0.0015, HEM.sock + 0.0015, toLocal(bind[BONE.shin[i]], p)[1]);
        if (sock > rw) {
          rw = sock;
          rp = SOCK;
        }
      }
    // Skin that lies on the shoe's surface (where the collar and tongue meet
    // the ankle) is shoe, not sock.
    const onShoe = 1 - smooth(0.0008, 0.0025, shoeDist);
    pw[PAINTS.indexOf("shoe")] += pw[0] * onShoe;
    pw[0] *= 1 - onShoe;
    pw[rp] += pw[0] * rw;
    pw[0] *= 1 - rw;
    for (const i of [0, 1] as const)
      if (ob === BONE.foot[i]) {
        const SHOE = PAINTS.indexOf("shoe");
        const w = 1 - smooth(SOLE_TOP - 0.0008, SOLE_TOP + 0.0008, toLocal(bind[BONE.foot[i]], p)[2]);
        pw[SOLE] += pw[SHOE] * w;
        pw[SHOE] *= 1 - w;
        // Laces: crossed bands over the tongue, white like the sole.
        const l = toLocal(bind[BONE.foot[i]], p);
        if (l[2] > -0.02 && Math.abs(l[0] + 0.002) < LACES.half + 0.002) {
          let d = Infinity;
          for (const y of LACES.rows) d = Math.min(d, Math.abs(l[1] - y));
          const lw = (1 - smooth(LACES.band - 0.0007, LACES.band + 0.0007, d)) * (1 - smooth(LACES.half - 0.002, LACES.half, Math.abs(l[0] + 0.002)));
          pw[SOLE] += pw[SHOE] * lw;
          pw[SHOE] *= 1 - lw;
        }
      }
    const lift = pw[SHORTS] * 0.0028 + pw[SOCK] * 0.0012;
    for (let j = 0; j < 3; j++) m.position[v * 3 + j] += m.normal[v * 3 + j] * lift;
    if (rw > 0 && rw < 1) hem.push(v);


    // The two strongest muscles under this vertex.
    let a = -1;
    let b = -1;
    for (let j = 0; j < muscleW.length; j++) {
      if (muscleW[j] <= 0) continue;
      if (a < 0 || muscleW[j] > muscleW[a]) {
        b = a;
        a = j;
      } else if (b < 0 || muscleW[j] > muscleW[b]) b = j;
    }
    if (a >= 0) {
      muscleA[v] = a;
      weightA[v] = muscleW[a];
    }
    if (b >= 0) {
      muscleB[v] = b;
      weightB[v] = muscleW[b];
    }
  }

  // The lip at each hem is a real step now; shade it from the geometry.
  hemNormals(m.position, m.normal, m.index, hem);

  return {
    position: m.position,
    normal: m.normal,
    index: m.index,
    skinIndex,
    skinWeight,
    paints,
    muscleA,
    weightA,
    muscleB,
    weightB,
    bind,
    bindSkeleton,
  };
}

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Recomputes the normals of `verts` (and their neighbours) from the faces around them. */
function hemNormals(pos: Float32Array, nor: Float32Array, index: Uint32Array, verts: number[]) {
  const nv = pos.length / 3;
  const mark = new Uint8Array(nv);
  for (const v of verts) mark[v] = 1;
  for (let t = 0; t < index.length; t += 3)
    if (mark[index[t]] === 1 || mark[index[t + 1]] === 1 || mark[index[t + 2]] === 1)
      for (let j = 0; j < 3; j++) if (!mark[index[t + j]]) mark[index[t + j]] = 2;
  const acc = new Float64Array(nv * 3);
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
    if (!mark[a] && !mark[b] && !mark[c]) continue;
    const ux = pos[b * 3] - pos[a * 3];
    const uy = pos[b * 3 + 1] - pos[a * 3 + 1];
    const uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const wx = pos[c * 3] - pos[a * 3];
    const wy = pos[c * 3 + 1] - pos[a * 3 + 1];
    const wz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const n = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
    for (const v of [a, b, c]) for (let j = 0; j < 3; j++) acc[v * 3 + j] += n[j];
  }
  for (let v = 0; v < nv; v++) {
    if (mark[v] !== 1) continue;
    const l = Math.hypot(acc[v * 3], acc[v * 3 + 1], acc[v * 3 + 2]);
    // Keep the winding's sign agreeing with the field normal.
    const s = acc[v * 3] * nor[v * 3] + acc[v * 3 + 1] * nor[v * 3 + 1] + acc[v * 3 + 2] * nor[v * 3 + 2] < 0 ? -1 : 1;
    if (l > 0) for (let j = 0; j < 3; j++) nor[v * 3 + j] = (s * acc[v * 3 + j]) / l;
  }
}
