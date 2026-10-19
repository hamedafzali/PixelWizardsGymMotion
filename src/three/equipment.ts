import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { anchorPoint, type Skeleton } from "../rig.js";
import type { Part, V3 } from "../types.js";
import { add, mid, mul, norm, rad, sub } from "../vec.js";
import { labelTexture, repeated, surfaceMaps } from "./textures.js";

// Gym equipment built from data. Every part is assembled once from a few
// shapes (rounded steel tube, upholstered pad, chrome rod, rubber plate) and
// exposes update(skeleton, context): parts held or pushed follow a body
// anchor, and weight stacks rise with the rep. No meshes are created per frame.

export const PALETTE = {
  frame: "#8E97A6",
  shroud: "#2A303A",
  pad: "#17191E",
  welt: "#30353F",
  board: "#22262D",
  chrome: "#D5DBE5",
  plate: "#1A1D23",
  grip: "#141619",
  cable: "#1E2228",
  cap: "#0D0F12",
  accent: "#C3E201",
  band: "#FF6B57",
  floor: "#141B25",
  background: "#0A1119",
};

/** What a part needs each frame besides the skeleton. */
export interface PartContext {
  /** 0 → 1, how far the load is lifted (spring-smoothed by the scene). */
  load: number;
}

export interface Built {
  object: THREE.Object3D;
  update?(sk: Skeleton, ctx: PartContext): void;
}

// ── Materials and shapes ───────────────────────────────────────────────────

const std = (color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...o });

/** Shared by every part. Created on first use so the module loads without WebGL. */
let mats: ReturnType<typeof makeMaterials> | null = null;
function makeMaterials() {
  const maps = surfaceMaps();
  const n = (s: number) => new THREE.Vector2(s, s);
  return {
    // Satin powder-coated steel with a faint orange-peel ripple.
    frame: std(PALETTE.frame, { metalness: 0.5, roughness: 0.46, normalMap: maps.powder, normalScale: n(0.08) }),
    shroud: std(PALETTE.shroud, { metalness: 0.1, roughness: 0.5, normalMap: maps.rubber, normalScale: n(0.05) }),
    // Vinyl upholstery: pebbled grain and a soft sheen at grazing angles.
    pad: new THREE.MeshPhysicalMaterial({
      color: PALETTE.pad,
      roughness: 0.62,
      metalness: 0,
      normalMap: maps.leather,
      normalScale: n(0.35),
      sheen: 0.5,
      sheenRoughness: 0.45,
      sheenColor: new THREE.Color("#6B7590"),
      clearcoat: 0.15,
      clearcoatRoughness: 0.55,
    }),
    welt: std(PALETTE.welt, { roughness: 0.55 }),
    board: std(PALETTE.board, { roughness: 0.8 }),
    chrome: std(PALETTE.chrome, { metalness: 1, roughness: 0.14 }),
    plate: std(PALETTE.plate, { metalness: 0, roughness: 0.72, normalMap: maps.rubber, normalScale: n(0.25) }),
    // Moulded rubber with a slight satin sheen (dumbbell heads, kettlebells).
    rubber: new THREE.MeshPhysicalMaterial({
      color: PALETTE.plate,
      roughness: 0.58,
      metalness: 0,
      normalMap: repeated(maps.rubber, 8, 8),
      normalScale: n(0.3),
      clearcoat: 0.2,
      clearcoatRoughness: 0.6,
    }),
    // Machined steel grip; knurledRod() scales UVs so one tile is KNURL_TILE metres.
    knurl: std("#BFC5CE", { metalness: 1, roughness: 0.34, normalMap: maps.knurl, normalScale: n(1.1) }),
    // Brushed steel: chrome with a softer highlight.
    steel: std("#B7BDC7", { metalness: 1, roughness: 0.28 }),
    // Painted cast iron (stack plates, kettlebells): satin black with a fine ripple.
    stackPlate: std("#262A31", { metalness: 0.35, roughness: 0.5, normalMap: maps.powder, normalScale: n(0.12) }),
    cast: std("#1F2228", { metalness: 0.3, roughness: 0.48, normalMap: maps.powder, normalScale: n(0.18) }),
    grip: std(PALETTE.grip, { roughness: 0.9, normalMap: maps.rubber, normalScale: n(0.4) }),
    cable: std(PALETTE.cable, { metalness: 0.3, roughness: 0.4 }),
    cap: std(PALETTE.cap, { roughness: 0.5 }),
    accent: std(PALETTE.accent, { emissive: PALETTE.accent, emissiveIntensity: 0.35, roughness: 0.4 }),
    band: std(PALETTE.band, { roughness: 0.7 }),
  };
}
const M = () => (mats ??= makeMaterials());
export type Tone = "frame" | "pad" | "metal";
const tone = (t: Tone) => (t === "metal" ? M().chrome : t === "pad" ? M().pad : M().frame);

let geos: ReturnType<typeof makeGeometries> | null = null;
function makeGeometries() {
  return {
    cyl: new THREE.CylinderGeometry(1, 1, 1, 20),
    disc: new THREE.CylinderGeometry(1, 1, 1, 40),
    hex: new THREE.CylinderGeometry(1, 1, 1, 6),
    sphere: new THREE.SphereGeometry(1, 24, 16),
    box: new THREE.BoxGeometry(1, 1, 1),
  };
}
const G = () => (geos ??= makeGeometries());

/** Physical size of one knurl tile (16 diamonds): about 2.5 mm pitch. */
const KNURL_TILE = 0.04;
const knurlGeos = new Map<string, THREE.BufferGeometry>();
/** Knurled steel section along X, centred on the origin. */
function knurledRod(len: number, r: number) {
  const k = `${len.toFixed(3)}:${r.toFixed(4)}`;
  let g = knurlGeos.get(k);
  if (!g) {
    g = new THREE.CylinderGeometry(r, r, len, 32, 1, true);
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    const su = Math.round((Math.PI * 2 * r) / KNURL_TILE) || 1;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, (uv.getY(i) * len) / KNURL_TILE);
    g.rotateZ(Math.PI / 2);
    knurlGeos.set(k, g);
  }
  return mesh(g, M().knurl);
}

const decalMats = new Map<string, THREE.Material>();
/** Painted weight numerals: a flat decal facing +Z, `w` metres wide. */
function label(text: string, w: number, color = "#D6DBE3") {
  const k = `${text}:${color}`;
  let mat = decalMats.get(k);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      map: labelTexture(text),
      color,
      roughness: 0.5,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    decalMats.set(k, mat);
  }
  const m = new THREE.Mesh(planeGeo(), mat);
  m.scale.set(w, w, 1);
  m.receiveShadow = true;
  return m;
}
let plane: THREE.PlaneGeometry | null = null;
const planeGeo = () => (plane ??= new THREE.PlaneGeometry(1, 1));

const hexBevel = (r: number) => Math.min(0.009, r * 0.14);
/** Distance from the axis to a flat of hexHeadGeo(r): the bevel pushes it out. */
const hexFlat = (r: number) => (r - hexBevel(r)) * Math.cos(Math.PI / 6) + hexBevel(r);
const hexGeos = new Map<string, THREE.BufferGeometry>();
/**
 * Moulded hex head along X: a hexagon (flats top and bottom) with rounded
 * vertical edges, extruded with a rounded chamfer on both faces.
 */
function hexHeadGeo(r: number, len: number) {
  const k = `${r.toFixed(3)}:${len.toFixed(3)}`;
  let g = hexGeos.get(k);
  if (!g) {
    const b = hexBevel(r);
    const corner = r * 0.16;
    const pts = Array.from({ length: 6 }, (_, i) => new THREE.Vector2(Math.cos((i * Math.PI) / 3), Math.sin((i * Math.PI) / 3)).multiplyScalar(r - b));
    const shape = new THREE.Shape();
    pts.forEach((c, i) => {
      const prev = pts[(i + 5) % 6];
      const next = pts[(i + 1) % 6];
      const a = c.clone().lerp(prev, corner / (r - b));
      const z = c.clone().lerp(next, corner / (r - b));
      if (i === 0) shape.moveTo(a.x, a.y);
      else shape.lineTo(a.x, a.y);
      shape.quadraticCurveTo(c.x, c.y, z.x, z.y);
    });
    shape.closePath();
    const depth = len - 2 * b;
    const e = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 4, curveSegments: 5 });
    e.translate(0, 0, -depth / 2);
    e.rotateY(Math.PI / 2);
    // Smooth across the rounded edges and chamfers; the flats stay flat.
    g = toCreasedNormals(e, rad(40));
    e.dispose();
    hexGeos.set(k, g);
  }
  return g;
}

const rounded = new Map<string, THREE.BufferGeometry>();
/** Rounded box geometry, cached per size: steel tube and upholstery corners. */
function roundedGeo(size: V3, r: number) {
  const k = `${size.map((x) => x.toFixed(3)).join(",")}:${r.toFixed(3)}`;
  let g = rounded.get(k);
  if (!g) {
    const rr = Math.min(r, ...size.map((s) => s / 2 - 1e-4));
    g = new RoundedBoxGeometry(size[0], size[1], size[2], 3, rr);
    rounded.set(k, g);
  }
  return g;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

const v = (p: V3) => new THREE.Vector3(p[0], p[1], p[2]);
const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const tmp = new THREE.Vector3();

/** Places a unit Y-cylinder between two points. */
function span(m: THREE.Object3D, a: V3, b: V3, r: number) {
  const d = tmp.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const l = d.length();
  m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  if (l > 1e-6) m.quaternion.setFromUnitVectors(Y, d.divideScalar(l));
  m.scale.set(r, Math.max(l, 1e-4), r);
}
const rod = (a: V3, b: V3, r: number, mat: THREE.Material) => {
  const m = mesh(G().cyl, mat);
  span(m, a, b, r);
  return m;
};
/** Rounded box at a point, optionally turned about X (degrees). */
function rbox(at: V3, size: V3, mat: THREE.Material, tilt = 0, r = 0.012) {
  const m = mesh(roundedGeo(size, r), mat);
  m.position.copy(v(at));
  m.rotation.x = rad(tilt);
  return m;
}
/** Square steel tube between two points (frame members). */
function beam(a: V3, b: V3, w = 0.06, mat = M().frame) {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const m = mesh(roundedGeo([w, Math.max(l, 1e-3), w], w * 0.25), mat);
  m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  if (l > 1e-6) m.quaternion.setFromUnitVectors(Y, v(sub(b, a)).normalize());
  return m;
}
/** Cylinder whose axis runs along X (bars, rollers, plates). */
const xRod = (len: number, r: number, mat: THREE.Material, geo = G().cyl) => {
  const m = mesh(geo, mat);
  m.rotation.z = Math.PI / 2;
  m.scale.set(r, len, r);
  return m;
};
/** Upright from the floor with a foot plate. */
function post(x: number, z: number, h: number, w = 0.06, mat = M().frame) {
  const g = new THREE.Group();
  const f = w * 2.2;
  g.add(beam([x, 0, z], [x, h, z], w, mat), rbox([x, 0.008, z], [f, 0.016, f], mat, 0, 0.005));
  // Plastic end cap, and four bolts through the foot plate.
  g.add(rbox([x, h + 0.006, z], [w * 1.06, 0.014, w * 1.06], M().cap, 0, 0.004));
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.add(bolt([x + sx * f * 0.36, 0.016, z + sz * f * 0.36]));
  return g;
}
/** A hex bolt head standing on a surface. */
function bolt(at: V3, r = 0.008) {
  const b = mesh(G().hex, M().chrome, false);
  b.scale.set(r, r * 0.7, r);
  b.position.set(at[0], at[1] + r * 0.35, at[2]);
  return b;
}
/**
 * Upholstered pad: a grained cushion with a sewn welt around its sides, on a
 * thinner board. The thinnest axis of `size` is the thickness; the board sits
 * on its negative side (under a seat, behind a back pad).
 */
function cushion(at: V3, size: V3, tilt = 0) {
  const m = M();
  const ax = size.indexOf(Math.min(...size));
  const t = size[ax];
  const g = new THREE.Group();
  g.add(mesh(roundedGeo(size, t * 0.42), m.pad));
  const welt = size.map((s, i) => (i === ax ? Math.max(0.006, t * 0.12) : s + 0.003)) as V3;
  const w = mesh(roundedGeo(welt, 0.003), m.welt);
  w.position.setComponent(ax, t * 0.12);
  const board = size.map((s, i) => (i === ax ? 0.014 : s - 0.03)) as V3;
  const b = mesh(roundedGeo(board, 0.004), m.board);
  b.position.setComponent(ax, -t / 2 - 0.004);
  g.add(w, b);
  g.position.copy(v(at));
  g.rotation.x = rad(tilt);
  return g;
}
const group = (...parts: THREE.Object3D[]) => {
  const g = new THREE.Group();
  g.add(...parts);
  return g;
};
const turnTowardsOrigin = (x: number, z: number) => Math.atan2(-x, -z);
const yawOf = (sk: Skeleton) => Math.atan2(sk.frame.fwd[0], sk.frame.fwd[2]);

// ── Weight stack ───────────────────────────────────────────────────────────

const stackGeos = new Map<string, THREE.BufferGeometry>();
/**
 * Cast stack plate: a rounded rectangle with bores for the two guide rods and
 * the lift rod, edges broken by a small chamfer. Thickness along Y.
 */
function stackPlateGeo(w: number, t: number, d: number) {
  const k = `${w}:${t}:${d}`;
  let g = stackGeos.get(k);
  if (!g) {
    const b = 0.0025;
    const hw = w / 2 - b;
    const hd = d / 2 - b;
    const c = 0.008;
    const shape = new THREE.Shape();
    shape.moveTo(-hw + c, -hd);
    shape.lineTo(hw - c, -hd);
    shape.quadraticCurveTo(hw, -hd, hw, -hd + c);
    shape.lineTo(hw, hd - c);
    shape.quadraticCurveTo(hw, hd, hw - c, hd);
    shape.lineTo(-hw + c, hd);
    shape.quadraticCurveTo(-hw, hd, -hw, hd - c);
    shape.lineTo(-hw, -hd + c);
    shape.quadraticCurveTo(-hw, -hd, -hw + c, -hd);
    for (const [x, r] of [[-0.095, 0.011], [0.095, 0.011], [0, 0.014]] as const) {
      const hole = new THREE.Path();
      hole.absarc(x, 0, r, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
    const depth = t - 2 * b;
    const e = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 6 });
    e.translate(0, 0, -depth / 2);
    e.rotateX(-Math.PI / 2);
    g = toCreasedNormals(e, rad(35));
    e.dispose();
    stackGeos.set(k, g);
  }
  return g;
}

const pulleyGeos = new Map<number, THREE.BufferGeometry>();
/** Machined pulley sheave turned on a lathe: a V-groove rim, a thin web, a hub. Axis along Y. */
function pulleyGeo(r: number) {
  let g = pulleyGeos.get(r);
  if (!g) {
    const w = 0.013;
    const prof: [number, number][] = [
      [0.008, w * 0.95],
      [0.017, w * 0.95],
      [0.02, w * 0.4],
      [r * 0.72, w * 0.32],
      [r * 0.78, w * 0.7],
      [r - 0.0015, w],
      [r, w * 0.8],
      [r - 0.004, w * 0.42],
      [r - 0.0085, w * 0.16],
    ];
    const pts = [...prof, ...prof.map(([x, y]) => [x, -y] as [number, number]).reverse()].map(([x, y]) => new THREE.Vector2(x, y));
    const l = new THREE.LatheGeometry(pts, 48);
    g = toCreasedNormals(l, rad(30));
    l.dispose();
    pulleyGeos.set(r, g);
  }
  return g;
}

const PLATE_T = 0.032;
const PLATE_GAP = 0.005;
const PLATES = 12;
/** Plates lifted at the selected weight (from the top). */
const PINNED = 5;
const STACK_TRAVEL = 0.3;

interface Stack {
  object: THREE.Group;
  /** Raises the selected plates by `load` × travel. */
  lift(load: number): void;
  /** World-space top of the lift rod, where the cable attaches. */
  rodTop(): V3;
}

/**
 * Selectorised weight stack: guide rods, a column of plates, a lime selector
 * pin, and the top plates riding up on the lift rod as the load rises.
 */
function weightStack(at: V3, height = 1.9, facing = turnTowardsOrigin(at[0], at[2])): Stack {
  const g = new THREE.Group();
  g.name = "stack";
  g.position.set(at[0], 0, at[2]);
  g.rotation.y = facing;
  const m = M();
  const w = 0.32;
  const d = 0.13;
  g.add(rbox([0, 0.03, 0], [w + 0.16, 0.06, d + 0.14], m.frame, 0, 0.01));
  for (const s of [1, -1]) {
    g.add(beam([s * (w / 2 + 0.05), 0.06, 0], [s * (w / 2 + 0.05), height, 0], 0.05));
    g.add(rod([s * 0.095, 0.06, 0], [s * 0.095, height - 0.04, 0], 0.008, m.chrome));
  }
  g.add(rbox([0, height + 0.03, 0], [w + 0.16, 0.06, d], m.frame, 0, 0.012));
  // Rubber bumpers the stack lands on.
  for (const s of [1, -1]) g.add(rod([s * 0.095, 0.06, 0], [s * 0.095, 0.1, 0], 0.02, m.grip));

  const plateGeo = stackPlateGeo(w, PLATE_T, d);
  const y0 = 0.1 + PLATE_T / 2;
  const moving = new THREE.Group();
  moving.name = "stack:lifted";
  for (let i = 0; i < PLATES; i++) {
    const p = mesh(plateGeo, m.stackPlate);
    p.position.y = y0 + i * (PLATE_T + PLATE_GAP);
    // The selector-pin hole and the plate's running total, painted on the front.
    const hole = mesh(G().disc, m.cap, false);
    hole.rotation.x = Math.PI / 2;
    hole.scale.set(0.0072, 0.001, 0.0072);
    hole.position.set(0, 0, d / 2 + 0.0002);
    const kg = label(String((PLATES - i) * 5), 0.026);
    kg.position.set(w / 2 - 0.042, 0, d / 2 + 0.0004);
    p.add(hole, kg);
    (i >= PLATES - PINNED ? moving : g).add(p);
  }
  const pinPlate = PLATES - PINNED;
  const pin = mesh(G().cyl, m.accent);
  pin.rotation.x = Math.PI / 2;
  pin.scale.set(0.009, d + 0.06, 0.009);
  pin.position.set(0, y0 + pinPlate * (PLATE_T + PLATE_GAP), 0.0);
  const knob = mesh(G().sphere, m.accent);
  knob.scale.setScalar(0.018);
  knob.position.set(0, pin.position.y, d / 2 + 0.035);
  moving.add(pin, knob);
  const topY = y0 + PLATES * (PLATE_T + PLATE_GAP);
  moving.add(rbox([0, topY, 0], [w, 0.018, d], m.frame, 0, 0.005));
  // Bronze-lined bushings where the top plate rides the guide rods.
  for (const s of [1, -1]) {
    const bush = mesh(G().disc, m.steel);
    bush.scale.set(0.017, 0.028, 0.017);
    bush.position.set(s * 0.095, topY + 0.012, 0);
    const lip = mesh(G().disc, m.chrome);
    lip.scale.set(0.021, 0.004, 0.021);
    lip.position.set(s * 0.095, topY + 0.026, 0);
    moving.add(bush, lip);
  }
  // Clevis and bolt where the lift rod meets the top plate.
  moving.add(rbox([0, topY + 0.024, 0], [0.04, 0.03, 0.03], m.steel, 0, 0.004), bolt([0.0, topY + 0.04, 0], 0.009));
  const rodLen = 0.7;
  moving.add(rod([0, topY, 0], [0, topY + rodLen, 0], 0.011, m.chrome));
  g.add(moving);

  const top = new THREE.Vector3();
  return {
    object: g,
    lift(load) {
      moving.position.y = Math.max(0, Math.min(1, load)) * STACK_TRAVEL;
    },
    rodTop() {
      top.set(0, topY + rodLen + moving.position.y, 0);
      g.updateMatrix();
      top.applyMatrix4(g.matrix);
      return [top.x, top.y, top.z];
    },
  };
}

/** A pulley wheel at a point; `orient` turns it into the plane of the cable. */
function pulley(r = 0.05) {
  const m = M();
  const g = new THREE.Group();
  const wheel = mesh(pulleyGeo(r), m.steel);
  const cap = mesh(G().hex, m.chrome);
  cap.scale.set(0.009, 0.05, 0.009);
  const housing = mesh(roundedGeo([0.05, r * 2.4, r * 2.4], 0.01), m.frame);
  housing.scale.set(1, 1, 1);
  const inner = group(wheel, cap);
  inner.rotation.z = Math.PI / 2; // disc axis along local X
  g.add(inner);
  const side = new THREE.Group();
  for (const s of [1, -1]) {
    const plate = mesh(roundedGeo([0.006, r * 2.3, r * 2.3], 0.003), m.frame);
    plate.position.x = s * 0.02;
    side.add(plate);
  }
  g.add(side);
  return {
    object: g,
    /** Turns the wheel so both cable directions lie in its plane. */
    orient(a: V3, b: V3) {
      const axis = v(a).cross(v(b));
      if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
      g.quaternion.setFromUnitVectors(X, axis.normalize());
    },
  };
}

// ── Free weights ───────────────────────────────────────────────────────────

const plateGeos = new Map<string, THREE.BufferGeometry>();
/**
 * Moulded rubber plate profile, turned on a lathe: a raised rim, a recessed
 * face with a stepped ring, and a raised hub. Axis along Y, unit-free sizes.
 */
function plateGeo(r: number, t: number) {
  const k = `${r.toFixed(3)}:${t.toFixed(3)}`;
  let g = plateGeos.get(k);
  if (!g) {
    const h = t / 2;
    const hub = Math.min(0.05, r * 0.32);
    const e = Math.min(0.006, t * 0.12);
    // (radius, height) from the bore outward over the top face, round the rim, and back under.
    const top: [number, number][] = [
      [0.026, h * 0.92],
      [hub, h * 0.92],
      [hub + 0.006, h * 0.72],
      [r * 0.62, h * 0.72],
      [r * 0.64, h * 0.8],
      [r * 0.84, h * 0.8],
      [r * 0.87, h * 0.72],
      [r - 0.022, h * 0.72],
      [r - 0.012, h],
      [r - e, h],
      [r, h - e],
    ];
    const pts = [...top, ...top.map(([x, y]) => [x, -y] as [number, number]).reverse()].map(([x, y]) => new THREE.Vector2(x, y));
    g = new THREE.LatheGeometry(pts, 56);
    g.computeVertexNormals();
    plateGeos.set(k, g);
  }
  return g;
}

/** Bumper plate with a chrome bore sleeve, axis along X, its weight moulded on both faces. */
function plateDisc(r: number, t: number, kg: number) {
  const p = mesh(plateGeo(r, t), M().plate);
  p.rotation.z = Math.PI / 2;
  const g = group(p, xRod(t + 0.004, 0.03, M().chrome, G().disc));
  for (const s of [1, -1]) {
    for (const [y, size] of [[1, 0.24], [-1, 0.2]] as const) {
      const l = label(String(kg), r * size, "#C9CED8");
      l.position.set(s * ((t / 2) * 0.8 + 0.0004), y * r * 0.74, 0);
      l.rotation.y = (s * Math.PI) / 2;
      g.add(l);
    }
  }
  return g;
}

function barbell(style: "straight" | "ez" | "trap", length: number, plates: boolean): Built {
  const m = M();
  const g = new THREE.Group();
  if (style === "trap") {
    const r = 0.36;
    for (let k = 0; k < 6; k++) {
      const a0 = (k / 6) * Math.PI * 2 + Math.PI / 6;
      const a1 = ((k + 1) / 6) * Math.PI * 2 + Math.PI / 6;
      g.add(rod([Math.cos(a0) * r, 0, Math.sin(a0) * r * 1.15], [Math.cos(a1) * r, 0, Math.sin(a1) * r * 1.15], 0.018, m.chrome));
    }
    for (const s of [1, -1]) {
      g.add(rod([s * 0.27, 0, -0.1], [s * 0.27, 0, 0.1], 0.017, m.grip));
      g.add(rod([s * 0.36, 0, 0], [s * 0.95, 0, 0], 0.025, m.chrome));
      if (plates) {
        const p = plateDisc(0.225, 0.06, 20);
        p.position.x = s * 0.62;
        g.add(p);
      }
    }
  } else {
    g.add(xRod(length, 0.014, m.steel));
    const big = length >= 1.8;
    const sleeve = big ? 0.42 : 0.2;
    // Knurled grips: a smooth gap in the middle, smooth again by the collars.
    const k0 = big ? 0.085 : 0.05;
    const k1 = length / 2 - sleeve - (big ? 0.1 : 0.035);
    if (big) g.add(knurledRod(0.15, 0.0142));
    for (const s of [1, -1]) {
      if (k1 > k0) {
        const k = knurledRod(k1 - k0, 0.0142);
        k.position.x = (s * (k0 + k1)) / 2;
        g.add(k);
      }
      const sl = xRod(sleeve, 0.025, m.chrome, G().disc);
      sl.position.x = s * (length / 2 - sleeve / 2);
      const collar = xRod(0.03, 0.036, m.chrome, G().disc);
      collar.position.x = s * (length / 2 - sleeve);
      const ring = xRod(0.006, 0.0262, m.steel, G().disc);
      ring.position.x = s * (length / 2 - sleeve + 0.03);
      const end = xRod(0.008, 0.0235, m.steel, G().disc);
      end.position.x = s * (length / 2 + 0.004);
      g.add(sl, collar, ring, end);
      if (plates) {
        const t = big ? 0.06 : 0.04;
        const p = plateDisc(big ? 0.225 : 0.12, t, big ? 20 : 5);
        p.position.x = s * (length / 2 - sleeve + t / 2 + 0.02);
        g.add(p);
        const lock = xRod(0.02, 0.032, m.accent);
        lock.position.x = s * (length / 2 - sleeve + t + 0.035);
        g.add(lock);
      }
      if (style === "ez") {
        const k = xRod(0.05, 0.02, m.chrome);
        k.position.x = s * 0.12;
        g.add(k);
      }
    }
  }
  return {
    object: g,
    update(sk) {
      g.position.copy(v(mid(sk.hand[0], sk.hand[1])));
      if (style === "trap") {
        // Handles stay level; the frame turns with the body.
        g.rotation.set(0, yawOf(sk), 0);
        return;
      }
      const d = v(sub(sk.hand[0], sk.hand[1]));
      if (d.length() < 0.05) d.copy(X);
      g.quaternion.setFromUnitVectors(X, d.normalize());
    },
  };
}

function dumbbell(to: "handL" | "handR" | "hands", kg = 12): Built {
  const m = M();
  const g = new THREE.Group();
  const r = 0.06;
  const len = 0.074;
  const inner = 0.064;
  // Knurled grip between smooth steel shoulders.
  g.add(knurledRod(0.104, 0.0162));
  for (const s of [1, -1]) {
    const shoulder = xRod(inner - 0.052, 0.0168, m.steel);
    shoulder.position.x = (s * (0.052 + inner)) / 2;
    const flange = xRod(0.006, 0.024, m.chrome, G().disc);
    flange.position.x = s * (inner - 0.003);
    const head = mesh(hexHeadGeo(r, len), m.rubber);
    head.position.x = s * (inner + len / 2);
    // Chrome end cap with a recessed bolt.
    const cap = xRod(0.005, 0.027, m.chrome, G().disc);
    cap.position.x = s * (inner + len + 0.0015);
    const boltHead = xRod(0.004, 0.009, m.steel, G().hex);
    boltHead.position.x = s * (inner + len + 0.005);
    g.add(shoulder, flange, head, cap, boltHead);
    // Weight painted on the top and bottom flats.
    const flat = hexFlat(r) + 0.0003;
    for (const f of [1, -1]) {
      const l = label(String(kg), 0.046);
      l.position.set(s * (inner + len / 2), f * flat, 0);
      l.rotation.x = -f * (Math.PI / 2);
      g.add(l);
    }
  }
  return {
    object: g,
    update(sk) {
      const i = to === "handR" ? 1 : 0;
      const hand = to === "hands" ? mid(sk.hand[0], sk.hand[1]) : sk.hand[i];
      g.position.copy(v(hand));
      let axis: THREE.Vector3;
      if (to === "hands") axis = v(sub(sk.hand[0], sk.elbow[0])).add(v(sub(sk.hand[1], sk.elbow[1]))).normalize();
      else {
        // Across the palm: sideways, kept perpendicular to the forearm.
        const fore = v(sub(sk.hand[i], sk.elbow[i])).normalize();
        axis = v(sk.frame.left).addScaledVector(fore, -v(sk.frame.left).dot(fore));
        if (axis.length() < 0.1) axis = new THREE.Vector3(0, 0, 1);
        axis.normalize();
      }
      g.quaternion.setFromUnitVectors(X, axis);
    },
  };
}

let bellGeo: THREE.BufferGeometry | null = null;
/** Cast-iron bell turned on a lathe: a flat base ring, the ball, a shoulder. Centre at the origin. */
function kettlebellGeo() {
  if (!bellGeo) {
    const pts = [new THREE.Vector2(0, -0.087), new THREE.Vector2(0.044, -0.087), new THREE.Vector2(0.05, -0.084)];
    for (let i = 0; i <= 24; i++) {
      const a = rad(-57 + (i / 24) * 147);
      pts.push(new THREE.Vector2(Math.cos(a) * 0.099, Math.sin(a) * 0.096));
    }
    pts.push(new THREE.Vector2(0, 0.096));
    bellGeo = new THREE.LatheGeometry(pts, 56);
  }
  return bellGeo;
}
let decalGeo: THREE.BufferGeometry | null = null;
/** A w × w decal facing +Z wrapped onto a sphere of radius `r` about the origin, centred `y` above its equator. */
function sphereDecalGeo(r: number, w: number, y: number) {
  if (!decalGeo) {
    decalGeo = new THREE.PlaneGeometry(w, w, 10, 10);
    const pos = decalGeo.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i) + y;
      pos.setXYZ(i, px, py, Math.sqrt(Math.max(0, r * r - px * px - py * py)));
    }
    decalGeo.computeVertexNormals();
  }
  return decalGeo;
}
let handleGeo: THREE.BufferGeometry | null = null;
/** Window handle: horns rising from the shoulders to a round grip, the hand at the origin. */
function kettleHandleGeo() {
  if (!handleGeo) {
    const c = new THREE.CatmullRomCurve3(
      [[-0.052, -0.088], [-0.062, -0.05], [-0.055, -0.016], [-0.03, -0.002], [0, 0.0], [0.03, -0.002], [0.055, -0.016], [0.062, -0.05], [0.052, -0.088]].map(
        ([x, y]) => new THREE.Vector3(x, y, 0),
      ),
    );
    handleGeo = new THREE.TubeGeometry(c, 64, 0.0125, 14, false);
  }
  return handleGeo;
}

function kettlebell(p: Part & { kind: "kettlebell" }): Built {
  const m = M();
  const g = new THREE.Group();
  const bell = mesh(kettlebellGeo(), m.cast);
  bell.position.y = -0.13;
  const handle = mesh(kettleHandleGeo(), m.cast);
  // The weight, cast on the front: a decal bent onto the ball.
  const kg = new THREE.Mesh(sphereDecalGeo(0.0992, 0.04, 0.012), label("16", 1).material);
  kg.position.y = -0.13;
  g.add(bell, handle, kg);
  return {
    object: g,
    update(sk) {
      g.position.copy(v(add(anchorPoint(sk, p.to), p.offset ?? [0, 0, 0])));
      g.rotation.y = yawOf(sk);
    },
  };
}

// ── Cables ─────────────────────────────────────────────────────────────────

/** Lat bar, D-handle or rope at the end of a cable. */
function cableHandle(kind: "bar" | "rope" | "single" | "none") {
  const m = M();
  const g = new THREE.Group();
  const shaft = xRod(1, 0.013, m.chrome);
  const grips = [xRod(0.2, 0.017, m.grip), xRod(0.2, 0.017, m.grip)];
  const ropes = [mesh(G().cyl, m.grip), mesh(G().cyl, m.grip)];
  const knobs = [mesh(G().sphere, m.grip), mesh(G().sphere, m.grip)];
  const dRing = mesh(new THREE.TorusGeometry(0.06, 0.008, 8, 24, Math.PI), m.chrome);
  const dGrip = mesh(G().cyl, m.grip);
  if (kind === "bar") g.add(shaft, ...grips);
  if (kind === "single") g.add(dRing, dGrip);
  const world = new THREE.Group();
  world.add(g);
  if (kind === "rope") for (const r of [...ropes, ...knobs]) world.add(r);
  for (const k of knobs) k.scale.setScalar(0.024);
  return {
    object: world,
    /** Places the handle; returns where the cable meets it. */
    update(sk: Skeleton, from: V3): V3 {
      const hands = mid(sk.hand[0], sk.hand[1]);
      if (kind === "bar") {
        const d = v(sub(sk.hand[0], sk.hand[1]));
        const w = Math.max(d.length() + 0.3, 0.9);
        g.position.copy(v(hands));
        g.quaternion.setFromUnitVectors(X, d.length() < 0.05 ? X : d.normalize());
        shaft.scale.y = w;
        grips[0]!.position.x = w / 2 - 0.11;
        grips[1]!.position.x = -(w / 2 - 0.11);
        return hands;
      }
      if (kind === "single") {
        g.position.copy(v(hands));
        const toward = v(sub(from, hands)).normalize();
        g.quaternion.setFromUnitVectors(Y, toward);
        dRing.rotation.set(0, 0, 0);
        dGrip.position.set(0, 0, 0);
        dGrip.rotation.set(0, 0, Math.PI / 2);
        dGrip.scale.set(0.017, 0.11, 0.017);
        return add(hands, mul(norm(sub(from, hands)), 0.06));
      }
      if (kind === "rope") {
        const attach = add(hands, mul(norm(sub(from, hands)), 0.16));
        for (const i of [0, 1] as const) {
          span(ropes[i]!, attach, sk.hand[i], 0.012);
          knobs[i]!.position.copy(v(add(sk.hand[i], mul(norm(sub(sk.hand[i], attach)), 0.02))));
        }
        return attach;
      }
      return hands;
    },
  };
}

function cable(p: Part & { kind: "cable" }): Built {
  const m = M();
  const g = new THREE.Group();
  const from = p.from;
  const wire = mesh(G().cyl, m.cable, false);
  const handle = cableHandle(p.handle ?? "none");
  const wheel = pulley();
  wheel.object.position.copy(v(from));
  g.add(wire, handle.object, wheel.object);

  let stack: Stack | null = null;
  let up: THREE.Mesh | null = null;
  let topWheel: ReturnType<typeof pulley> | null = null;
  let colTop: V3 = from;
  if (p.tower) {
    // The column stands away from the user, beyond reach; a boom carries
    // high pulleys back over them (lat pulldown), low ones sit at its foot.
    const out = new THREE.Vector3(from[0], 0, from[2]);
    if (out.length() < 0.05) out.set(0, 0, 1);
    out.normalize();
    const reach = Math.max(Math.hypot(from[0], from[2]) + 0.14, from[1] > 1.2 ? 0.8 : 0);
    const cx = out.x * reach;
    const cz = out.z * reach;
    const top = Math.max(2.15, from[1] + 0.12);
    stack = weightStack([cx, 0, cz], top - 0.06);
    g.add(stack.object);
    colTop = [cx, top + 0.06, cz];
    if (from[1] > 1.2) {
      // A curved gooseneck from the column top out over the user to the pulley.
      const curve = new THREE.CubicBezierCurve3(
        v([cx, top + 0.06, cz]),
        v([cx + (from[0] - cx) * 0.55, top + 0.08, cz + (from[2] - cz) * 0.55]),
        v([from[0], top + 0.06, from[2]]),
        v([from[0], from[1] + 0.07, from[2]]),
      );
      g.add(mesh(new THREE.TubeGeometry(curve, 40, 0.036, 16), m.frame));
      g.add(rbox([cx, top + 0.06, cz], [0.1, 0.1, 0.1], m.frame, 0, 0.02));
      topWheel = pulley(0.055);
      topWheel.object.position.copy(v(colTop));
      topWheel.orient([from[0] - cx, 0, from[2] - cz], [0, -1, 0]);
      g.add(topWheel.object);
      up = mesh(G().cyl, m.cable, false);
      g.add(up, rod(from, colTop, 0.006, m.cable));
    } else {
      // Low pulley: the cable runs into the column at the pulley's height.
      g.add(rod(from, [cx, from[1], cz], 0.006, m.cable));
      g.add(beam([cx - out.z * 0.0, from[1], cz], from, 0.05));
      up = mesh(G().cyl, m.cable, false);
      g.add(up);
      colTop = [cx, from[1], cz];
    }
  }
  return {
    object: g,
    update(sk, ctx) {
      const attach = handle.update(sk, from);
      span(wire, from, attach, 0.006);
      wheel.orient(sub(attach, from), sub(colTop, from));
      if (stack) {
        stack.lift(ctx.load);
        if (up) span(up, colTop, stack.rodTop(), 0.006);
      }
    },
  };
}

// ── Machines ───────────────────────────────────────────────────────────────

/** Lever arm on a pivot, mounted to the machine frame; its tip follows a body anchor. */
function lever(p: Part & { kind: "lever" }): Built {
  const m = M();
  const g = new THREE.Group();
  const arm = mesh(roundedGeo([0.05, 1, 0.036], 0.012), m.frame);
  const hub = group(xRod(0.07, 0.045, m.frame, G().disc), xRod(0.08, 0.02, m.chrome, G().disc));
  hub.position.copy(v(p.pivot));
  g.add(arm, hub);
  const [px, py, pz] = p.pivot;
  // Mount: low pivots stand on their own post; high ones hang from a rear column.
  if (py < 0.7) g.add(post(px, pz, py, 0.06));
  else {
    const zBack = Math.min(pz - 0.2, -0.42);
    g.add(beam([px, py, pz], [px, py, zBack], 0.06), post(px, zBack, py + 0.06, 0.07));
  }
  const end = p.end ?? "handle";
  const width = p.width ?? 0;
  let tip: THREE.Object3D | null = null;
  if (end === "roller") tip = group(xRod(width || 0.36, 0.05, m.pad), xRod((width || 0.36) + 0.02, 0.014, m.chrome));
  else if (end === "pad") tip = mesh(roundedGeo([0.24, 0.06, 0.2], 0.025), m.pad);
  else if (end === "handle") tip = width ? xRod(width, 0.016, m.grip) : mesh(G().cyl, m.grip);
  if (tip) g.add(tip);
  return {
    object: g,
    update(sk) {
      const at = add(anchorPoint(sk, p.to), p.offset ?? [0, 0, 0]);
      span(arm, p.pivot, at, 1);
      if (!tip) return;
      if (end === "handle" && !width) span(tip, add(at, [0, -0.07, 0]), add(at, [0, 0.07, 0]), 0.019);
      else tip.position.copy(v(at));
    },
  };
}

/** Leg-press sled: rails rising at `angle`, a carriage with the foot plate and loaded plate horns. */
function sled(p: Part & { kind: "sled" }): Built {
  const m = M();
  const g = new THREE.Group();
  const a = rad(p.angle);
  const D: V3 = [0, Math.sin(a), Math.cos(a)]; // along the rails
  const N: V3 = [0, Math.cos(a), -Math.sin(a)]; // across, towards the user's side above the rails
  const off = p.offset ?? [0, 0, 0];
  // Rails pass under the carriage path. The path is fixed by the pattern, so
  // they are placed from the first frame (legs extended, the top of the
  // travel) and then left alone.
  const railFor = (sk: Skeleton) => {
    const c = add(anchorPoint(sk, p.to), off);
    return { lo: add(add(c, mul(D, -0.7)), mul(N, -0.16)), hi: add(add(c, mul(D, 0.3)), mul(N, -0.16)) };
  };
  const statics = new THREE.Group();
  g.add(statics);
  let built = false;

  const carriage = new THREE.Group();
  carriage.add(rbox([0, 0, 0], [0.62, 0.5, 0.04], m.shroud, 0, 0.015)); // moulded back panel
  carriage.add(rbox([0, 0, -0.03], [0.58, 0.46, 0.014], m.grip, 0, 0.006)); // non-slip foot plate
  carriage.add(rbox([0, -0.12, 0.08], [0.5, 0.06, 0.14], m.frame, 0, 0.01));
  for (const s of [1, -1]) {
    const horn = xRod(0.26, 0.024, m.chrome);
    horn.position.set(s * 0.44, -0.08, 0.1);
    carriage.add(horn);
    for (let k = 0; k < 2; k++) {
      const pl = plateDisc(0.2, 0.045, 20);
      pl.position.set(s * (0.37 + k * 0.05), -0.08, 0.1);
      carriage.add(pl);
    }
    // Bearings riding the rails.
    carriage.add(rbox([s * 0.31, -0.2, 0.1], [0.06, 0.08, 0.16], m.frame, 0, 0.012));
  }
  g.add(carriage);
  const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), v(N), v(D)); // X × N = D: a rotation

  return {
    object: g,
    update(sk) {
      if (!built) {
        built = true;
        const { lo, hi } = railFor(sk);
        for (const s of [1, -1]) {
          statics.add(beam([s * 0.31, lo[1], lo[2]], [s * 0.31, hi[1], hi[2]], 0.06));
          statics.add(rod([s * 0.31, lo[1] + 0.035, lo[2]], [s * 0.31, hi[1] + 0.035, hi[2]], 0.012, m.chrome));
          // Supports: the high end on a tall leg, the low end on a short one.
          statics.add(post(s * 0.31, hi[2], hi[1], 0.07), post(s * 0.31, lo[2], lo[1], 0.06));
          statics.add(beam([s * 0.31, 0.04, -0.45], [s * 0.31, 0.04, hi[2] + 0.1], 0.08));
        }
        statics.add(beam([0.35, 0.04, hi[2]], [-0.35, 0.04, hi[2]], 0.08), beam([0.35, 0.04, -0.45], [-0.35, 0.04, -0.45], 0.08));
      }
      const c = add(anchorPoint(sk, p.to), off);
      carriage.position.copy(v(c));
      carriage.quaternion.setFromRotationMatrix(basis);
    },
  };
}

function bench(p: Part & { kind: "bench" }): Built {
  const m = M();
  const g = new THREE.Group();
  const at = p.at ?? [0, 0.46, 0.08];
  const inc = rad(p.incline ?? 0);
  const L = p.length ?? 0.95;
  const t = 0.075;
  g.add(cushion([at[0], at[1] - t / 2, at[2] + 0.18], [0.3, t, 0.38]));
  const d: V3 = [0, Math.sin(inc), -Math.cos(inc)];
  const n: V3 = [0, Math.cos(inc), Math.sin(inc)];
  const c = add(add(at, mul(d, L / 2)), mul(n, -t / 2));
  const back = cushion(c, [0.3, t, L]);
  back.rotation.x = inc;
  g.add(back);
  // Frame: a spine under the pads, legs with wide feet at both ends.
  const lowY = at[1] - t - 0.02;
  const frontZ = at[2] + 0.3;
  const backMid = add(at, mul(d, Math.min(L * 0.6, 0.5)));
  const rearZ = Math.min(backMid[2], at[2] - 0.35);
  g.add(beam([at[0], lowY, frontZ], [at[0], 0.04, frontZ], 0.06));
  g.add(beam([at[0], 0.04, frontZ], [at[0], 0.04, rearZ], 0.07));
  g.add(beam([at[0], 0.04, rearZ], add(backMid, mul(n, -t)), 0.06));
  for (const z of [frontZ, rearZ]) g.add(beam([at[0] - 0.22, 0.03, z], [at[0] + 0.22, 0.03, z], 0.06));
  return { object: g };
}

function seat(p: Part & { kind: "seat" }): Built {
  const m = M();
  const g = new THREE.Group();
  const at = p.at;
  const w = p.width ?? 0.42;
  g.add(cushion([at[0], at[1] - 0.04, at[2] + 0.08], [w, 0.08, 0.4]));
  g.add(beam([at[0], at[1] - 0.08, at[2] + 0.05], [at[0], 0.04, at[2] + 0.05], 0.07));
  g.add(rbox([at[0], 0.025, at[2]], [0.5, 0.05, 0.7], m.frame, 0, 0.012));
  if (p.back !== undefined) {
    const b = rad(p.back);
    const up: V3 = [0, Math.cos(b), -Math.sin(b)];
    const c = add([at[0], at[1], at[2] - 0.15], mul(up, 0.34));
    const pad = cushion(c, [w, 0.62, 0.08]);
    pad.rotation.x = -b;
    g.add(pad);
    g.add(beam([at[0], at[1] - 0.08, at[2] - 0.05], add(c, mul([0, Math.sin(b), Math.cos(b)], -0.07)), 0.05));
  }
  return { object: g };
}

function pad(p: Part & { kind: "pad" }): Built {
  const m = M();
  const o = p.roller
    ? group(xRod(p.size[0], p.size[1] / 2 + 0.012, m.pad), xRod(p.size[0] + 0.02, 0.012, m.chrome))
    : cushion([0, 0, 0], p.size);
  return {
    object: o,
    update(sk) {
      o.position.copy(v(add(anchorPoint(sk, p.to), p.offset ?? [0, 0, 0])));
      if (!p.roller) o.rotation.set(rad(p.tilt ?? 0), yawOf(sk), 0);
    },
  };
}

// ── Stations ───────────────────────────────────────────────────────────────

function rack(p: Part & { kind: "rack" }): Built {
  const m = M();
  const w = (p.width ?? 1.2) / 2;
  const z = p.z ?? -0.1;
  const g = new THREE.Group();
  for (const s of [1, -1]) {
    g.add(post(s * w, z, 2.25, 0.07));
    g.add(beam([s * w, 0.035, z - 0.35], [s * w, 0.035, z + 0.35], 0.07));
    // J-hooks.
    g.add(rbox([s * (w - 0.03), p.height - 0.03, z + 0.07], [0.05, 0.05, 0.12], m.chrome, 0, 0.01));
    g.add(rbox([s * (w - 0.03), p.height, z + 0.125], [0.05, 0.06, 0.02], m.chrome, 0, 0.006));
  }
  g.add(beam([w, 2.22, z], [-w, 2.22, z], 0.06));
  return { object: g };
}

function smith(p: Part & { kind: "smith" }): Built {
  const m = M();
  const z = p.z ?? 0;
  const g = new THREE.Group();
  const carriages: THREE.Object3D[] = [];
  for (const s of [1, -1]) {
    g.add(post(s * 0.82, z, 2.3, 0.08));
    g.add(rod([s * 0.74, 0.05, z], [s * 0.74, 2.25, z], 0.012, m.chrome));
    g.add(beam([s * 0.82, 0.04, z - 0.45], [s * 0.82, 0.04, z + 0.45], 0.08));
    g.add(rod([s * 0.74, 0.08, z], [s * 0.74, 0.14, z], 0.022, m.grip)); // stoppers
    const c = group(rbox([0, 0, 0], [0.07, 0.12, 0.06], m.frame, 0, 0.012), rbox([0, -0.03, 0.04], [0.02, 0.05, 0.03], m.accent, 0, 0.004));
    c.position.set(s * 0.74, 1, z);
    carriages.push(c);
    g.add(c);
  }
  g.add(beam([0.82, 2.28, z], [-0.82, 2.28, z], 0.07));
  return {
    object: g,
    update(sk) {
      // The bar rides the guide rods: carriages follow its height.
      const y = mid(sk.hand[0], sk.hand[1])[1];
      for (const c of carriages) c.position.y = y;
    },
  };
}

function pullupBar(p: Part & { kind: "pullupBar" }): Built {
  const m = M();
  const z = p.z ?? 0.04;
  const bar = xRod(1.3, 0.016, m.chrome);
  bar.position.set(0, p.height, z);
  const g = group(bar);
  for (const s of [1, -1]) {
    g.add(post(s * 0.66, z, p.height + 0.1, 0.07));
    g.add(beam([s * 0.66, 0.035, z - 0.4], [s * 0.66, 0.035, z + 0.4], 0.07));
    const grip = xRod(0.2, 0.02, m.grip);
    grip.position.set(s * 0.42, p.height, z);
    g.add(grip);
  }
  return { object: g };
}

function dipBars(p: Part & { kind: "dipBars" }): Built {
  const m = M();
  const z = p.z ?? 0.05;
  const g = new THREE.Group();
  for (const s of [1, -1]) {
    g.add(rod([s * 0.27, p.height, z - 0.25], [s * 0.27, p.height, z + 0.35], 0.02, m.grip));
    g.add(post(s * 0.33, z - 0.25, p.height, 0.06), post(s * 0.33, z + 0.35, p.height, 0.06));
    g.add(beam([s * 0.27, p.height, z - 0.25], [s * 0.33, p.height, z - 0.25], 0.04));
    g.add(beam([s * 0.27, p.height, z + 0.35], [s * 0.33, p.height, z + 0.35], 0.04));
  }
  return { object: g };
}

/** A standalone weight stack beside a lever machine; it rises with the load. */
function stackPart(p: Part & { kind: "stack" }): Built {
  const s = weightStack(p.at);
  return { object: s.object, update: (_sk, ctx) => s.lift(ctx.load) };
}

export function buildPart(p: Part): Built {
  const m = M();
  switch (p.kind) {
    case "bench":
      return bench(p);
    case "seat":
      return seat(p);
    case "box":
      return { object: rbox(p.at, p.size, tone(p.tone ?? "frame"), p.tilt ?? 0, Math.min(...p.size) * 0.2) };
    case "pad":
      return pad(p);
    case "barbell":
      return barbell(p.style ?? "straight", p.length ?? 2.0, p.plates ?? true);
    case "dumbbell":
      return dumbbell(p.to);
    case "kettlebell":
      return kettlebell(p);
    case "cable":
      return cable(p);
    case "lever":
      return lever(p);
    case "sled":
      return sled(p);
    case "platform": {
      const o = group(rbox([0, 0, 0], [0.72, 0.62, 0.035], m.frame, 0, 0.012), rbox([0, 0, 0.02], [0.66, 0.56, 0.01], m.grip, 0, 0.004));
      o.rotation.x = rad(p.tilt);
      return { object: o, update: (sk) => o.position.copy(v(add(anchorPoint(sk, p.to), p.offset ?? [0, 0, 0]))) };
    }
    case "rack":
      return rack(p);
    case "smith":
      return smith(p);
    case "pullupBar":
      return pullupBar(p);
    case "dipBars":
      return dipBars(p);
    case "stack":
      return stackPart(p);
    case "band": {
      const b = mesh(G().cyl, m.band);
      return { object: b, update: (sk) => span(b, sk.hand[0], sk.hand[1], 0.012) };
    }
    case "treadmill":
      return {
        object: group(
          rbox([0, 0.085, -0.05], [0.82, 0.17, 1.8], m.shroud, 0, 0.05),
          rbox([0, 0.172, -0.05], [0.56, 0.008, 1.68], m.grip, 0, 0.003),
          beam([0.36, 0.17, 0.78], [0.36, 1.25, 0.66], 0.06),
          beam([-0.36, 0.17, 0.78], [-0.36, 1.25, 0.66], 0.06),
          rbox([0, 1.3, 0.68], [0.8, 0.12, 0.2], m.shroud, -20, 0.03),
          rod([0.36, 1.12, 0.66], [0.36, 1.12, 0.25], 0.02, m.grip),
          rod([-0.36, 1.12, 0.66], [-0.36, 1.12, 0.25], 0.02, m.grip),
        ),
      };
    case "bike": {
      const fly = xRod(0.05, 0.25, m.plate, G().disc);
      fly.position.set(0, 0.42, 0.72);
      return {
        object: group(
          rbox([0, 0.81, -0.08], [0.2, 0.06, 0.28], m.pad, 0, 0.025),
          beam([0, 0.78, -0.06], [0, 0.36, 0.3], 0.06),
          beam([0, 0.36, 0.33], [0, 1.0, 0.52], 0.07),
          rod([0.2, 1.02, 0.5], [-0.2, 1.02, 0.5], 0.018, m.grip),
          rod([0.13, 0.36, 0.33], [-0.13, 0.36, 0.33], 0.02, m.chrome),
          fly,
          rbox([0, 0.03, 0.3], [0.5, 0.06, 1.2], m.frame, 0, 0.015),
        ),
      };
    }
    case "rower": {
      const fly = mesh(G().disc, m.shroud);
      fly.position.set(0, 0.5, 1.05);
      fly.rotation.z = Math.PI / 2;
      fly.scale.set(0.24, 0.16, 0.24);
      return {
        object: group(
          rbox([0, 0.2, -0.15], [0.12, 0.08, 2.3], m.frame, 0, 0.02),
          rbox([0.12, 0.27, 0.36], [0.13, 0.03, 0.3], m.chrome, -55, 0.008),
          rbox([-0.12, 0.27, 0.36], [0.13, 0.03, 0.3], m.chrome, -55, 0.008),
          fly,
          post(0, -1.2, 0.2, 0.06),
          post(0, 0.95, 0.3, 0.08),
        ),
      };
    }
    case "elliptical":
      return {
        object: group(
          rbox([0, 0.06, 0.05], [0.5, 0.12, 1.5], m.shroud, 0, 0.04),
          beam([0, 0.1, 0.6], [0, 1.35, 0.55], 0.08),
          rbox([0, 1.4, 0.55], [0.36, 0.1, 0.16], m.shroud, 0, 0.03),
        ),
      };
    case "stairs":
      return {
        object: group(
          rbox([0, 0.08, 0.05], [0.7, 0.16, 0.9], m.shroud, 0, 0.04),
          beam([0, 0.16, 0.5], [0, 1.4, 0.45], 0.09),
          rbox([0, 1.42, 0.45], [0.42, 0.12, 0.16], m.shroud, 0, 0.03),
          rod([0.3, 1.32, 0.45], [0.3, 1.32, -0.05], 0.02, m.grip),
          rod([-0.3, 1.32, 0.45], [-0.3, 1.32, -0.05], 0.02, m.grip),
        ),
      };
  }
}
