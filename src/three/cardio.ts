import * as THREE from "three";
import { anchorPoint, type Skeleton } from "../rig.js";
import type { V3 } from "../types.js";
import { add, mid } from "../vec.js";
import { G, M, beam, cushion, mesh, rbox, rod, roundedGeo, span, v, xRod, type Built } from "./equipment.js";

// Cardio machines. Each is laid out around the path its exercise drives (the
// feet orbit a bike's crank on a 0.17 m circle about [0, 0.36, 0.33], an
// elliptical's pedals ride an oval about [0, 0.39, 0.1]), so the moving parts
// meet the body: cranks, pedal arms and stepper pedals follow the feet.

const feet = (sk: Skeleton): V3[] => [anchorPoint(sk, "footL"), anchorPoint(sk, "footR")];

/** A stabiliser foot across the machine, with levelling caps. */
function stabiliser(z: number, w: number, y = 0.04) {
  const m = M();
  const g = new THREE.Group();
  const t = xRod(w, 0.035, m.frame);
  t.position.set(0, y, z);
  g.add(t);
  for (const s of [1, -1]) {
    const c = mesh(roundedGeo([0.07, 0.05, 0.1], 0.02), m.cap);
    c.position.set((s * w) / 2, 0.025, z);
    g.add(c);
  }
  return g;
}

/** A console: a tilted housing with a dark screen and a lime start key. */
function console_(at: V3, w: number, tilt: number) {
  const m = M();
  const g = new THREE.Group();
  g.add(rbox([0, 0, 0], [w, 0.1, 0.24], m.shroud, 0, 0.035));
  g.add(rbox([0, 0.051, 0.01], [w * 0.62, 0.004, 0.13], m.cap, 0, 0.002));
  g.add(rbox([w * 0.38, 0.052, 0.02], [0.03, 0.006, 0.03], m.accent, 0, 0.004));
  for (const x of [-0.42, -0.36]) g.add(rbox([w * x, 0.052, 0.02], [0.025, 0.006, 0.025], m.welt, 0, 0.004));
  g.position.copy(v(at));
  g.rotation.x = (tilt * Math.PI) / 180;
  return g;
}

export function treadmill(): Built {
  const m = M();
  const g = new THREE.Group();
  const L = 1.82;
  // Deck: side rails with grip strips, the belt between them, end rollers.
  for (const s of [1, -1]) {
    g.add(rbox([s * 0.36, 0.1, -0.05], [0.1, 0.14, L], m.shroud, 0, 0.03));
    g.add(rbox([s * 0.36, 0.172, -0.1], [0.08, 0.006, L - 0.4], m.grip, 0, 0.002));
    g.add(rbox([s * 0.36, 0.165, -0.94], [0.1, 0.03, 0.04], m.accent, 0, 0.008));
  }
  g.add(rbox([0, 0.13, -0.05], [0.62, 0.05, L - 0.06], m.frame, 0, 0.01));
  g.add(rbox([0, 0.165, -0.05], [0.56, 0.012, L - 0.1], m.grip, 0, 0.004));
  for (const z of [-0.05 - L / 2 + 0.06, -0.05 + L / 2 - 0.3]) {
    const r = xRod(0.58, 0.035, m.steel);
    r.position.set(0, 0.135, z);
    g.add(r);
  }
  g.add(rbox([0, 0.1, -0.05 - L / 2 + 0.02], [0.82, 0.12, 0.06], m.cap, 0, 0.02));
  // Motor hood at the front.
  g.add(rbox([0, 0.15, 0.74], [0.84, 0.22, 0.36], m.shroud, 0, 0.08));
  g.add(rbox([0, 0.262, 0.72], [0.5, 0.004, 0.18], m.welt, 0, 0.002));
  // Uprights, console and handrails.
  for (const s of [1, -1]) {
    g.add(beam([s * 0.37, 0.2, 0.82], [s * 0.34, 1.22, 0.66], 0.065));
    g.add(rod([s * 0.34, 1.1, 0.66], [s * 0.34, 1.1, 0.3], 0.02, m.frame));
    g.add(rod([s * 0.34, 1.1, 0.56], [s * 0.34, 1.1, 0.34], 0.024, m.grip));
    g.add(rbox([s * 0.34, 1.1, 0.46], [0.052, 0.03, 0.06], m.steel, 0, 0.01)); // pulse sensor
  }
  g.add(console_([0, 1.27, 0.66], 0.78, -28));
  g.add(rod([0.3, 1.18, 0.6], [-0.3, 1.18, 0.6], 0.018, m.grip));
  return { object: g };
}

export function bike(): Built {
  const m = M();
  const g = new THREE.Group();
  const crank: V3 = [0, 0.3, 0.37];
  g.add(stabiliser(-0.42, 0.52), stabiliser(0.72, 0.5));
  // Main tube from the rear foot up through the crank to the head tube.
  g.add(beam([0, 0.06, -0.42], crank, 0.07), beam(crank, [0, 0.06, 0.72], 0.07));
  g.add(beam([0, 0.3, 0.37], [0, 0.98, 0.5], 0.075));
  // Seat post with an adjust knob, and the saddle.
  g.add(beam([0, 0.38, 0.12], [0, 0.78, -0.08], 0.06), beam([0, 0.75, -0.07], [0, 0.78, -0.08], 0.05));
  g.add(rbox([0, 0.55, 0.06], [0.03, 0.03, 0.05], m.accent, 0, 0.01));
  g.add(cushion([0, 0.81, -0.1], [0.2, 0.06, 0.16]), cushion([0, 0.81, 0.02], [0.1, 0.05, 0.14]));
  // Flywheel under a shroud, in front of the crank.
  const fly = xRod(0.08, 0.26, m.shroud, G().disc);
  fly.position.set(0, 0.44, 0.56);
  const flyRim = xRod(0.084, 0.21, m.steel, G().disc);
  flyRim.position.copy(fly.position);
  const hubCap = xRod(0.09, 0.05, m.cap, G().disc);
  hubCap.position.copy(fly.position);
  g.add(fly, flyRim, hubCap);
  // Bars: a stem and a curved bullhorn with grips.
  g.add(beam([0, 0.98, 0.5], [0, 1.02, 0.58], 0.05));
  for (const s of [1, -1]) g.add(rod([0, 1.02, 0.58], [s * 0.2, 1.02, 0.52], 0.018, m.frame), rod([s * 0.2, 1.02, 0.52], [s * 0.2, 1.06, 0.38], 0.02, m.grip));
  g.add(console_([0, 1.08, 0.62], 0.2, -30));
  // Crank arms and pedals ride the feet.
  const hub = xRod(0.12, 0.05, m.steel, G().disc);
  hub.position.copy(v(crank));
  const chainring = xRod(0.012, 0.1, m.chrome, G().disc);
  chainring.position.set(-0.07, crank[1], crank[2]);
  g.add(hub, chainring);
  const arms = [mesh(roundedGeo([1, 1, 1], 0.2), m.chrome), mesh(roundedGeo([1, 1, 1], 0.2), m.chrome)];
  const pedals = [rbox([0, 0, 0], [0.09, 0.025, 0.11], m.grip, 0, 0.008), rbox([0, 0, 0], [0.09, 0.025, 0.11], m.grip, 0, 0.008)];
  pedals.forEach((p) => (p.name = "bike:pedal"));
  g.add(...arms, ...pedals);
  return {
    object: g,
    update(sk) {
      feet(sk).forEach((f, i) => {
        const p = add(f, [0, -0.06, 0.04]);
        const s = i === 0 ? 1 : -1;
        const a: V3 = [s * 0.09, crank[1], crank[2]];
        const b: V3 = [s * 0.09, p[1], p[2]];
        const arm = arms[i]!;
        span(arm, a, b, 1);
        arm.scale.set(0.022, Math.hypot(b[1] - a[1], b[2] - a[2]), 0.034);
        pedals[i]!.position.set(s * 0.13, p[1], p[2]);
      });
    },
  };
}

export function elliptical(): Built {
  const m = M();
  const g = new THREE.Group();
  const crank: V3 = [0, 0.42, -0.62];
  g.add(stabiliser(-0.75, 0.6), stabiliser(0.62, 0.56));
  g.add(beam([0, 0.07, -0.75], [0, 0.07, 0.62], 0.09));
  // Rear drive housing.
  const housing = mesh(roundedGeo([0.22, 0.6, 0.6], 0.1), m.shroud);
  housing.position.set(0, 0.4, -0.66);
  const disc = xRod(0.24, 0.17, m.steel, G().disc);
  disc.position.copy(v(crank));
  g.add(housing, disc, rbox([0, 0.72, -0.66], [0.16, 0.012, 0.3], m.accent, 0, 0.004));
  // Front mast with the console and the fixed grips.
  g.add(beam([0, 0.07, 0.52], [0, 1.38, 0.5], 0.09));
  g.add(console_([0, 1.42, 0.52], 0.34, -30));
  for (const s of [1, -1]) g.add(rod([0, 1.18, 0.5], [s * 0.1, 1.18, 0.38], 0.018, m.grip));
  // Pedal arms: from the rear crank, under each pedal, forward to the swing arm.
  const rear = [mesh(roundedGeo([1, 1, 1], 0.2), m.frame), mesh(roundedGeo([1, 1, 1], 0.2), m.frame)];
  const front = [mesh(roundedGeo([1, 1, 1], 0.2), m.frame), mesh(roundedGeo([1, 1, 1], 0.2), m.frame)];
  g.add(...rear, ...front);
  return {
    object: g,
    update(sk) {
      feet(sk).forEach((f, i) => {
        const s = i === 0 ? 1 : -1;
        const p: V3 = [s * 0.12, f[1] - 0.12, f[2] + 0.02];
        const c: V3 = [s * 0.13, crank[1] + (p[1] - 0.39) * 0.6, crank[2]];
        const pivot: V3 = [s * 0.27, 0.55, 0.45];
        span(rear[i]!, c, p, 1);
        rear[i]!.scale.set(0.045, Math.hypot(...p.map((x, k) => x - c[k]!)), 0.03);
        span(front[i]!, p, pivot, 1);
        front[i]!.scale.set(0.04, Math.hypot(...p.map((x, k) => x - pivot[k]!)), 0.03);
      });
    },
  };
}

export function stairs(): Built {
  const m = M();
  const g = new THREE.Group();
  g.add(stabiliser(-0.35, 0.7), stabiliser(0.55, 0.7));
  for (const s of [1, -1]) g.add(beam([s * 0.3, 0.04, -0.35], [s * 0.3, 0.04, 0.55], 0.07));
  // Front column with the console and the wrap-around rails.
  g.add(rbox([0, 0.18, 0.5], [0.5, 0.3, 0.2], m.shroud, 0, 0.06));
  g.add(beam([0, 0.3, 0.52], [0, 1.36, 0.46], 0.1));
  g.add(console_([0, 1.42, 0.46], 0.42, -30));
  for (const s of [1, -1]) {
    g.add(beam([s * 0.12, 1.3, 0.46], [s * 0.3, 1.32, 0.38], 0.04));
    g.add(rod([s * 0.3, 1.32, 0.38], [s * 0.3, 1.32, -0.05], 0.022, m.grip));
  }
  // Stepper pedals hinge at the front; a damper cylinder under each.
  const arms = [mesh(roundedGeo([1, 1, 1], 0.2), m.frame), mesh(roundedGeo([1, 1, 1], 0.2), m.frame)];
  const cyl = [mesh(G().cyl, m.chrome), mesh(G().cyl, m.chrome)];
  const body = [mesh(G().cyl, m.cap), mesh(G().cyl, m.cap)];
  g.add(...arms, ...cyl, ...body);
  return {
    object: g,
    update(sk) {
      feet(sk).forEach((f, i) => {
        const s = i === 0 ? 1 : -1;
        const hinge: V3 = [s * 0.11, 0.24, 0.48];
        const p: V3 = [s * 0.11, f[1] - 0.12, f[2] - 0.12];
        span(arms[i]!, hinge, p, 1);
        arms[i]!.scale.set(0.05, Math.hypot(...p.map((x, k) => x - hinge[k]!)), 0.035);
        const low: V3 = [s * 0.11, 0.06, 0.05];
        const top = mid(p, hinge);
        span(body[i]!, low, mid(low, top), 0.022);
        span(cyl[i]!, low, top, 0.01);
      });
    },
  };
}

