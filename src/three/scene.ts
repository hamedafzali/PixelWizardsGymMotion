import * as THREE from "three";
import { resolveMotion } from "../catalog.js";
import type { Highlight } from "../muscles.js";
import { solve, type Skeleton } from "../rig.js";
import { Spring, type SpringSpec } from "../spring.js";
import { peakTime, sample, type Frame } from "../timeline.js";
import type { Motion, MotionSpec, Part } from "../types.js";
import { buildPart, type Built } from "./equipment.js";
import { buildFigure, type Figure } from "./figure.js";

// One exercise as a three.js group: the figure, its equipment, and a clock.
// It needs no renderer, so it can be stepped and inspected anywhere (tests,
// offline rendering, your own render loop).

export interface GymSceneOptions {
  spec: MotionSpec;
  /** Muscles to colour on the figure. */
  highlight?: Highlight;
  /** How weight stacks follow the rep. A little underdamped so they settle. */
  loadSpring?: SpringSpec;
}

export interface Framing {
  centre: THREE.Vector3;
  /** Radius of a sphere holding every key pose, in metres. */
  radius: number;
}

const LOAD_SPRING: SpringSpec = { freq: 3.2, damping: 0.72 };

/** Centre and radius that contain every key pose, for framing a camera. */
export function framingOf(m: Motion): Framing {
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  for (const k of m.keys) {
    const sk = solve(k);
    for (const q of [sk.head, sk.pelvis, ...sk.hand, ...sk.elbow, ...sk.knee, ...sk.toe, ...sk.ankle]) box.expandByPoint(p.set(q[0], q[1], q[2]));
  }
  box.expandByPoint(p.set(box.min.x, 0, box.min.z)); // keep the floor contact in view
  box.expandByScalar(0.16);
  return { centre: box.getCenter(new THREE.Vector3()), radius: Math.max(box.getSize(p).length() / 2, 0.6) };
}

/**
 * Grows a framing to show the equipment around the body, up to 0.8 m
 * past the poses: enough for a bench end or a pulley tower, not a whole rig.
 */
function withEquipment(f: Framing, parts: Built[]): Framing {
  const box = new THREE.Box3().setFromCenterAndSize(f.centre, new THREE.Vector3().setScalar((f.radius * 2) / Math.sqrt(3)));
  const reach = box.clone().expandByScalar(0.8);
  const eq = new THREE.Box3();
  for (const p of parts) {
    p.object.updateMatrixWorld(true);
    eq.expandByObject(p.object);
  }
  if (eq.isEmpty()) return f;
  box.union(eq.intersect(reach));
  const size = box.getSize(new THREE.Vector3());
  return { centre: box.getCenter(new THREE.Vector3()), radius: Math.max(f.radius, size.length() / 2) };
}

export class GymScene {
  readonly root = new THREE.Group();
  readonly spec: MotionSpec;
  readonly motion: Motion;
  readonly equipment: Part[];
  framing: Framing;
  /** Seconds into the animation. */
  time = 0;
  /** The last sampled frame and skeleton. */
  frame!: Frame;
  skeleton!: Skeleton;

  private figure: Figure;
  private parts: Built[];
  private load: Spring;

  constructor({ spec, highlight = {}, loadSpring = LOAD_SPRING }: GymSceneOptions) {
    this.spec = spec;
    const { motion, equipment } = resolveMotion(spec);
    this.motion = motion;
    this.equipment = equipment;
    this.framing = framingOf(motion);
    this.figure = buildFigure(highlight);
    this.parts = equipment.map(buildPart);
    this.load = new Spring(loadSpring);
    this.root.add(this.figure.group, ...this.parts.map((p) => p.object));
    this.seek(0);
    this.framing = withEquipment(this.framing, this.parts);
  }

  /** Advance the clock by `dt` seconds (scaled by `speed`) and pose everything. */
  step(dt: number, speed = 1): Frame {
    const h = Math.min(Math.max(dt, 0), 0.1);
    this.time += h * speed;
    return this.pose(h);
  }

  /** Jump to `time` seconds with springs at rest: scrubbing, reduced motion. */
  seek(time: number): Frame {
    this.time = time;
    const f = this.pose(0);
    this.load.snap(f.load);
    return this.pose(0);
  }

  /** Time of the working end of the rep: a good still frame. */
  get peakTime(): number {
    return peakTime(this.motion);
  }

  private pose(dt: number): Frame {
    const f = sample(this.motion, this.time);
    const sk = solve(f.pose);
    this.frame = f;
    this.skeleton = sk;
    this.figure.update(sk, f.pulse);
    const ctx = { load: dt > 0 ? this.load.step(f.load, dt) : this.load.value };
    for (const p of this.parts) p.update?.(sk, ctx);
    return f;
  }

  /** Frees the figure's geometry and material. Equipment shares cached geometry. */
  dispose(): void {
    this.figure.dispose();
    this.root.removeFromParent();
  }
}
