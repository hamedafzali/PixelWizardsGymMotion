import * as THREE from "three";
import { anchorPoint } from "../rig.js";
import type { Part, V3 } from "../types.js";
import { add, mul, rad, sub } from "../vec.js";
import { G, M, beam, bolt, cushion, group, mesh, plateDisc, post, rbox, rod, roundedGeo, v, weightStack, xRod, type Built } from "./equipment.js";

// Machine stations: the frames around the body for the selectorised and
// plate-loaded machines that are more than a seat and a lever. Each is built
// around the poses its exercise reaches (anchor positions measured from the
// motion), so pads land where the body touches them. Parts that move with the
// body (a hack-squat carriage, a calf-raise yoke) follow an anchor each frame.

type Station = (Part & { kind: "station" })["type"];

/** Non-slip steel deck: a plate with a rubber top, raised `y` off the floor. */
function deck(at: V3, size: V3, tilt = 0) {
  const m = M();
  const g = group(rbox([0, 0, 0], size, m.frame, 0, 0.008), rbox([0, size[1] / 2 + 0.002, 0], [size[0] - 0.03, 0.006, size[2] - 0.03], m.grip, 0, 0.002));
  g.position.copy(v(at));
  g.rotation.x = rad(tilt);
  return g;
}

/** Floor frame: two side rails joined at both ends. */
function base(w: number, z0: number, z1: number, t = 0.07) {
  const g = new THREE.Group();
  for (const s of [1, -1]) g.add(beam([s * w, t / 2, z0], [s * w, t / 2, z1], t));
  for (const z of [z0, z1]) g.add(beam([w, t / 2, z], [-w, t / 2, z], t));
  for (const [sx, z] of [[1, z0], [-1, z0], [1, z1], [-1, z1]] as const) g.add(rbox([sx * w, 0.005, z], [0.12, 0.01, 0.12], M().grip, 0, 0.003));
  return g;
}

/** A pair of loaded plate horns along X at height y, `x` out from the centre. */
function horns(x: number, at: V3, plates = 2) {
  const m = M();
  const g = new THREE.Group();
  for (const s of [1, -1]) {
    const h = xRod(0.26, 0.025, m.chrome);
    h.position.set(at[0] + s * (x + 0.08), at[1], at[2]);
    const collar = xRod(0.03, 0.04, m.frame, G().disc);
    collar.position.set(at[0] + s * (x - 0.05), at[1], at[2]);
    g.add(h, collar);
    for (let k = 0; k < plates; k++) {
      const p = plateDisc(0.2, 0.04, 20);
      p.position.set(at[0] + s * (x + k * 0.046), at[1], at[2]);
      g.add(p);
    }
  }
  return g;
}

/** Horizontal grip with a rubber sleeve along X. */
function grip(at: V3, w: number) {
  const m = M();
  const g = group(xRod(w + 0.04, 0.014, m.chrome), xRod(w, 0.018, m.grip));
  g.position.copy(v(at));
  return g;
}

// ── Plate-loaded hack squat ────────────────────────────────────────────────

function hack(): Built {
  const m = M();
  const g = new THREE.Group();
  // The shoulders travel down and back along this line (60° from the floor).
  const a = rad(60);
  const D: V3 = [0, Math.sin(a), Math.cos(a)];
  const B: V3 = [0, Math.cos(a), -Math.sin(a)]; // behind the back, off the rails
  const statics = new THREE.Group();
  g.add(statics, deck([0, 0.04, 0.26], [0.74, 0.03, 0.56], -14));
  // Platform supports.
  for (const s of [1, -1]) g.add(beam([s * 0.3, 0.02, 0.05], [s * 0.3, 0.1, 0.5], 0.05));
  let p0: V3 | null = null;
  const car = new THREE.Group();
  for (const s of [1, -1]) {
    car.add(rbox([s * 0.3, 0, 0], [0.1, 0.24, 0.1], m.shroud, 0, 0.014));
    car.add(rbox([s * 0.3, 0, 0.055], [0.06, 0.18, 0.01], m.accent, 0, 0.003));
    // Handles beside the shoulders.
    car.add(rod([s * 0.3, 0.2, 0.05], [s * 0.3, 0.26, 0.22], 0.016, m.grip));
  }
  car.add(rbox([0, -0.05, 0.035], [0.52, 0.68, 0.03], m.shroud, 0, 0.01));
  const cross = xRod(0.66, 0.03, m.frame);
  cross.position.set(0, 0.12, 0);
  car.add(cross, horns(0.4, [0, -0.18, -0.02]));
  g.add(car);
  const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), v(D), v(mul(B, -1)));
  car.quaternion.setFromRotationMatrix(basis);
  return {
    object: g,
    update(sk) {
      const at = add(anchorPoint(sk, "upperBack"), mul(B, 0.13));
      if (!p0) {
        p0 = at;
        // Rails from the floor to above the shoulders, on a tall rear leg.
        const lo = add(p0, mul(D, (0.14 - p0[1]) / D[1]));
        const hi = add(p0, mul(D, (1.85 - p0[1]) / D[1]));
        for (const s of [1, -1]) {
          statics.add(beam([s * 0.3, lo[1], lo[2]], [s * 0.3, hi[1], hi[2]], 0.075));
          statics.add(rod(add([s * 0.3, lo[1], lo[2]], mul(B, -0.045)), add([s * 0.3, hi[1], hi[2]], mul(B, -0.045)), 0.012, m.chrome));
          statics.add(post(s * 0.3, hi[2] - 0.06, hi[1], 0.075));
          statics.add(beam([s * 0.3, 0.035, lo[2] - 0.1], [s * 0.3, 0.035, 0.55], 0.07));
          // Rubber stops at the bottom of the travel.
          statics.add(rod(add([s * 0.3, lo[1], lo[2]], mul(D, 0.25)), add([s * 0.3, lo[1], lo[2]], mul(D, 0.33)), 0.03, m.grip));
        }
        statics.add(beam([0.34, hi[1] - 0.02, hi[2]], [-0.34, hi[1] - 0.02, hi[2]], 0.07));
        for (const z of [lo[2] - 0.1, 0.55]) statics.add(beam([0.34, 0.035, z], [-0.34, 0.035, z], 0.07));
      }
      const t = (at[1] - p0[1]) * D[1] + (at[2] - p0[2]) * D[2];
      car.position.copy(v(add(p0, mul(D, t))));
    },
  };
}

// ── Standing and seated calf ───────────────────────────────────────────────

function calf(): Built {
  const m = M();
  const g = new THREE.Group();
  const z = -0.3;
  for (const s of [1, -1]) g.add(post(s * 0.42, z, 2.1, 0.075), rod([s * 0.42, 0.1, z + 0.045], [s * 0.42, 2.0, z + 0.045], 0.011, m.chrome));
  g.add(beam([0.46, 2.08, z], [-0.46, 2.08, z], 0.075), base(0.42, -0.55, 0.42));
  // Toe block with a rounded front lip.
  g.add(rbox([0, 0.05, 0.16], [0.6, 0.1, 0.24], m.frame, 0, 0.014), rbox([0, 0.102, 0.16], [0.56, 0.006, 0.2], m.grip, 0, 0.002));
  const lip = xRod(0.6, 0.03, m.frame);
  lip.position.set(0, 0.07, 0.28);
  g.add(lip);
  const s = weightStack([0, 0, -0.62], 1.75, 0);
  g.add(s.object);
  // The yoke rides the uprights with the shoulders.
  const yoke = new THREE.Group();
  for (const k of [1, -1]) {
    yoke.add(rbox([k * 0.42, 0, z], [0.12, 0.18, 0.12], m.shroud, 0, 0.016));
    yoke.add(beam([k * 0.33, 0.02, z], [k * 0.3, 0.02, 0.0], 0.06));
    yoke.add(rod([k * 0.4, -0.05, z + 0.08], [k * 0.4, -0.05, z + 0.24], 0.016, m.grip));
  }
  yoke.add(beam([0.42, 0.02, z], [-0.42, 0.02, z], 0.06));
  g.add(yoke);
  return {
    object: g,
    update(sk, ctx) {
      yoke.position.y = anchorPoint(sk, "shoulders")[1] + 0.05;
      s.lift(ctx.load);
    },
  };
}

function seatedCalf(): Built {
  const m = M();
  const g = group(base(0.28, -0.3, 0.8));
  g.add(rbox([0, 0.06, 0.68], [0.5, 0.08, 0.22], m.frame, 0, 0.014), rbox([0, 0.102, 0.68], [0.46, 0.006, 0.18], m.grip, 0, 0.002));
  // Plate horn and its arm on the front of the knee lever.
  const front = new THREE.Group();
  front.add(beam([0.32, 0, -0.02], [0.32, 0, 0.2], 0.05), beam([-0.32, 0, -0.02], [-0.32, 0, 0.2], 0.05), horns(0.36, [0, 0, 0.2], 1));
  g.add(front);
  // Release lever by the right knee.
  g.add(rod([-0.36, 0.6, -0.1], [-0.42, 0.85, 0.0], 0.012, m.chrome), rbox([-0.42, 0.87, 0.0], [0.03, 0.06, 0.03], m.accent, 0, 0.008));
  return {
    object: g,
    update(sk) {
      front.position.copy(v(add(anchorPoint(sk, "knees"), [0, 0.1, 0])));
    },
  };
}

// ── Glute kickback ─────────────────────────────────────────────────────────

function kickback(): Built {
  const m = M();
  const g = group(base(0.3, -0.35, 0.72));
  // Standing deck under the support foot.
  g.add(deck([0.05, 0.065, 0.04], [0.42, 0.09, 0.5]));
  // Front column with the chest support, forearm pads and handles.
  g.add(post(0, 0.64, 1.18, 0.09));
  g.add(beam([0, 1.02, 0.64], [0, 1.02, 0.42], 0.07));
  for (const s of [1, -1]) {
    g.add(beam([0, 0.98, 0.6], [s * 0.2, 0.98, 0.5], 0.05));
    g.add(cushion([s * 0.2, 1.02, 0.42], [0.11, 0.06, 0.34]));
    g.add(rod([s * 0.2, 0.98, 0.6], [s * 0.16, 1.0, 0.62], 0.018, m.grip));
  }
  g.add(grip([0, 1.0, 0.6], 0.3));
  // Gauge plate on the column.
  g.add(rbox([0, 0.7, 0.69], [0.07, 0.3, 0.006], m.accent, 0, 0.003));
  const s = weightStack([0.62, 0, -0.5], 1.6);
  g.add(s.object);
  return { object: g, update: (_sk, ctx) => s.lift(ctx.load) };
}

// ── Lying leg curl ─────────────────────────────────────────────────────────

function legCurl(): Built {
  const m = M();
  const g = group(base(0.22, -0.4, 0.82));
  // Hip pad with the hump under the pelvis, then the chest pad lower ahead.
  g.add(cushion([0, 0.69, -0.12], [0.36, 0.08, 0.58], -4));
  g.add(cushion([0, 0.67, 0.5], [0.36, 0.08, 0.5], 6));
  // Spine under the pads on two legs.
  g.add(beam([0, 0.6, -0.42], [0, 0.6, 0.78], 0.08));
  for (const z of [-0.36, 0.72]) g.add(beam([0, 0.6, z], [0, 0.04, z], 0.08));
  // Handles under the front of the chest pad.
  for (const s of [1, -1]) g.add(beam([0, 0.6, 0.74], [s * 0.2, 0.62, 0.78], 0.04), rod([s * 0.2, 0.62, 0.72], [s * 0.2, 0.62, 0.88], 0.018, m.grip));
  const s = weightStack([0.66, 0, -0.42], 1.55);
  g.add(s.object);
  return { object: g, update: (_sk, ctx) => s.lift(ctx.load) };
}

// ── 45° hyperextension ─────────────────────────────────────────────────────

function hyper(): Built {
  const m = M();
  const g = group(base(0.24, -0.8, 0.32));
  const a = rad(45);
  const D: V3 = [0, Math.sin(a), Math.cos(a)]; // up the body line
  const F: V3 = [0, -Math.cos(a), Math.sin(a)]; // out of the front of the body
  // Main spine from the foot plate up under the hip pad.
  const lo: V3 = [0, 0.16, -0.8];
  const hi: V3 = add([0, 0.8, 0.02], mul(F, -0.08));
  g.add(beam(lo, hi, 0.08));
  g.add(beam(hi, [0, 0.04, hi[2] + 0.22], 0.07));
  // Foot plate and ankle rollers behind the heels.
  g.add(deck([0, 0.24, -0.63], [0.4, 0.03, 0.3], -45));
  g.add(beam([0, 0.24, -0.63], add([0, 0.24, -0.63], mul(F, -0.1)), 0.05));
  const rollerAt = add(add([0, 0.32, -0.62], mul(D, 0.16)), mul(F, -0.08));
  for (const s of [1, -1]) {
    const r = group(xRod(0.15, 0.045, m.pad), xRod(0.17, 0.01, m.chrome));
    r.position.copy(v(add(rollerAt, [s * 0.09, 0, 0])));
    g.add(r);
  }
  g.add(beam(add(rollerAt, mul(F, 0.0)), add(rollerAt, mul(F, 0.15)), 0.04));
  // Hip pad on its post, with handles at the sides.
  g.add(cushion([0, 0.8, 0.02], [0.45, 0.08, 0.36], -45));
  for (const s of [1, -1]) {
    g.add(beam(hi, [s * 0.3, 0.74, -0.02], 0.04));
    g.add(rod([s * 0.3, 0.74, -0.02], [s * 0.33, 0.86, 0.06], 0.018, m.grip));
  }
  return { object: g };
}

// ── Hip thrust ─────────────────────────────────────────────────────────────

function hipThrust(): Built {
  const m = M();
  const g = group(base(0.42, -0.78, 0.6));
  g.add(benchBox({ kind: "benchBox", at: [0, 0.22, -0.72], size: [0.9, 0.44, 0.36] }).object);
  g.add(deck([0, 0.05, 0.42], [0.7, 0.03, 0.42], -6));
  // Pivot towers for the hip lever, with plate horns behind them.
  for (const s of [1, -1]) g.add(post(s * 0.42, 0.35, 0.36, 0.07), beam([s * 0.36, 0.32, 0.35], [s * 0.42, 0.32, 0.35], 0.05));
  return { object: g };
}

// ── Rotary torso ───────────────────────────────────────────────────────────

function rotary(): Built {
  const m = M();
  const g = new THREE.Group();
  // Turntable under the seat.
  const table = mesh(G().disc, m.frame);
  table.scale.set(0.34, 0.05, 0.34);
  table.position.y = 0.03;
  const ring = mesh(G().disc, m.grip);
  ring.scale.set(0.36, 0.012, 0.36);
  ring.position.y = 0.006;
  g.add(ring, table);
  // Front column with the arm that carries the chest pads.
  g.add(post(0, 0.6, 1.25, 0.09), base(0.26, 0.45, 0.95));
  const arm = mesh(roundedGeo([0.06, 1, 0.06], 0.015), m.frame);
  const yoke = new THREE.Group();
  for (const s of [1, -1]) yoke.add(rod([s * 0.2, -0.1, 0], [s * 0.2, 0.1, 0], 0.018, m.grip));
  yoke.add(xRod(0.44, 0.02, m.frame));
  g.add(arm, yoke);
  const s = weightStack([0.62, 0, -0.55], 1.55);
  g.add(s.object);
  const hub: V3 = [0, 1.15, 0.6];
  return {
    object: g,
    update(sk, ctx) {
      const at = add(anchorPoint(sk, "chest"), [0, -0.12, 0.17]);
      const d = sub(at, hub);
      const l = Math.hypot(...d);
      arm.position.copy(v(add(hub, mul(d, 0.5))));
      arm.scale.set(1, l, 1);
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v(d).normalize());
      yoke.position.copy(v(at));
      yoke.rotation.y = Math.atan2(sk.frame.fwd[0], sk.frame.fwd[2]);
      s.lift(ctx.load);
    },
  };
}

// ── Captain's chair ────────────────────────────────────────────────────────

function captain(): Built {
  const m = M();
  const g = group(base(0.34, -0.42, 0.52));
  for (const s of [1, -1]) {
    g.add(post(s * 0.32, -0.3, 2.2, 0.07));
    // Arm rests on a strut, braced down to the front foot.
    g.add(beam([s * 0.32, 1.14, -0.3], [s * 0.24, 1.14, 0.3], 0.05));
    g.add(beam([s * 0.24, 1.12, 0.22], [s * 0.34, 0.04, 0.52], 0.06));
    g.add(cushion([s * 0.24, 1.2, 0.06], [0.11, 0.06, 0.4]));
    g.add(rod([s * 0.24, 1.17, 0.3], [s * 0.24, 1.28, 0.32], 0.02, m.grip));
    // Foot step on the back frame.
    g.add(beam([s * 0.32, 0.42, -0.3], [s * 0.18, 0.42, -0.12], 0.04));
  }
  g.add(cushion([0, 1.18, -0.27], [0.42, 0.62, 0.07]));
  g.add(cushion([0, 0.86, -0.27], [0.3, 0.08, 0.06]));
  for (const y of [0.9, 1.5, 2.17]) g.add(beam([0.32, y, -0.3], [-0.32, y, -0.3], 0.06));
  g.add(rbox([0, 0.43, -0.12], [0.36, 0.03, 0.12], m.grip, 0, 0.006));
  // Pull-up handles over the top.
  for (const s of [1, -1]) g.add(beam([s * 0.32, 2.17, -0.3], [s * 0.38, 2.17, 0.1], 0.05), rod([s * 0.38, 2.17, 0.1], [s * 0.38, 2.17, 0.32], 0.02, m.grip));
  return { object: g };
}

// ── Seated cable row bench ─────────────────────────────────────────────────

function rowBench(): Built {
  const m = M();
  const g = new THREE.Group();
  g.add(cushion([0, 0.36, 0.08], [0.32, 0.07, 1.0]));
  g.add(beam([0, 0.3, -0.42], [0, 0.3, 0.98], 0.08));
  for (const z of [-0.36, 0.4]) g.add(beam([0, 0.3, z], [0, 0.04, z], 0.08), beam([0.22, 0.035, z], [-0.22, 0.035, z], 0.07));
  g.add(beam([0, 0.035, -0.36], [0, 0.035, 1.12], 0.07));
  // Two angled foot plates with heel lips on an upright.
  g.add(beam([0, 0.035, 0.84], [0, 0.42, 0.82], 0.07));
  for (const s of [1, -1]) {
    g.add(deck([s * 0.14, 0.32, 0.79], [0.2, 0.025, 0.3], -70));
    g.add(beam([0, 0.3, 0.84], [s * 0.14, 0.3, 0.84], 0.04));
  }
  return { object: g };
}

/** Upholstered pad on a steel stand: chest pads, preacher and arm pads. */
export function padStand(p: Part & { kind: "padStand" }): Built {
  const g = new THREE.Group();
  const c = cushion([0, 0, 0], p.size);
  const ax = p.size.indexOf(Math.min(...p.size));
  // A pad facing the user (thin along Z) keeps its board away from them.
  if (ax === 2) c.rotation.y = Math.PI;
  const holder = group(c);
  holder.position.copy(v(p.at));
  holder.rotation.x = rad(p.tilt ?? 0);
  g.add(holder);
  holder.updateMatrixWorld(true);
  const back = new THREE.Vector3();
  back.setComponent(ax, -(p.size[ax] / 2 + 0.03));
  if (ax === 2) back.z = -back.z;
  holder.localToWorld(back);
  const b: V3 = [back.x, back.y, back.z];
  const foot: V3 = [p.at[0], 0, p.at[2] + 0.24];
  const knee: V3 = [foot[0], Math.max(0.3, b[1] - 0.2), foot[2]];
  g.add(post(foot[0], foot[2], knee[1], 0.07), beam(knee, b, 0.06));
  // Height-adjust sleeve with a lime pop-pin.
  g.add(rbox([knee[0], knee[1] - 0.12, knee[2]], [0.1, 0.12, 0.1], M().shroud, 0, 0.014));
  g.add(rbox([knee[0], knee[1] - 0.12, knee[2] + 0.06], [0.025, 0.025, 0.03], M().accent, 0, 0.008));
  g.add(rbox([0, 0.005, p.at[2] + 0.24], [0.5, 0.01, 0.14], M().grip, 0, 0.003));
  return { object: g };
}

/** Padded box bench (hip thrust, bench dips, split squats, step-ups). */
export function benchBox(p: Part & { kind: "benchBox" }): Built {
  const g = new THREE.Group();
  const [x, y, z] = p.at;
  const [w, h, d] = p.size;
  const top = y + h / 2;
  g.add(cushion([x, top - 0.04, z], [w, 0.08, d]));
  const ly = top - 0.09;
  const ix = w / 2 - 0.05;
  const iz = d / 2 - 0.05;
  for (const sx of [1, -1]) for (const sz of [1, -1]) g.add(beam([x + sx * ix, 0, z + sz * iz], [x + sx * ix, ly, z + sz * iz], 0.05));
  for (const sz of [1, -1]) g.add(beam([x + ix, ly, z + sz * iz], [x - ix, ly, z + sz * iz], 0.05), beam([x + ix, 0.03, z + sz * iz], [x - ix, 0.03, z + sz * iz], 0.04));
  for (const sx of [1, -1]) g.add(beam([x + sx * ix, ly, z + iz], [x + sx * ix, ly, z - iz], 0.05));
  for (const sx of [1, -1]) for (const sz of [1, -1]) g.add(bolt([x + sx * ix, 0.0, z + sz * iz], 0.012));
  return { object: g };
}

/** T-bar row: a grip platform with angled foot plates, a landmine base at the
 *  bar's pivot and a 20 kg plate that rides the lever towards the handle. */
function tbar(): Built {
  const m = M();
  const g = new THREE.Group();
  g.add(deck([0, 0.03, 0], [0.74, 0.06, 0.56]));
  for (const s of [1, -1]) {
    g.add(deck([s * 0.2, 0.09, 0.04], [0.2, 0.025, 0.3], -12));
    g.add(rbox([s * 0.375, 0.05, 0], [0.008, 0.02, 0.5], m.accent, 0, 0.003));
  }
  // Landmine base: a floor plate with gussets around the pivot post.
  const pivot: V3 = [0, 0.04, -1.05];
  g.add(rbox([0, 0.008, pivot[2]], [0.34, 0.016, 0.34], m.frame, 0, 0.006));
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.add(bolt([x! * 0.13, 0.016, pivot[2] + z! * 0.13], 0.012));
  // Loading sleeve and plate, placed along pivot → handle every frame.
  const load = group(plateDisc(0.225, 0.05, 20), xRod(0.2, 0.026, m.chrome));
  const collar = xRod(0.03, 0.036, m.accent, G().disc);
  load.add(collar);
  collar.position.x = 0.04;
  g.add(load);
  const X = new THREE.Vector3(1, 0, 0);
  return {
    object: g,
    update(sk) {
      const at = add(anchorPoint(sk, "hands"), [0, -0.04, 0.08]);
      const d = sub(at, pivot);
      const len = Math.hypot(...d);
      const u = mul(d, 1 / len);
      load.position.copy(v(add(pivot, mul(u, len - 0.3))));
      load.quaternion.setFromUnitVectors(X, v(u).multiplyScalar(-1));
    },
  };
}

const STATIONS: Record<Station, () => Built> = { tbar, hack, calf, seatedCalf, kickback, legCurl, hyper, hipThrust, rotary, captain, rowBench };

export function station(p: Part & { kind: "station" }): Built {
  return STATIONS[p.type]();
}

