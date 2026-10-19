// A damped spring on one number, for motion that settles instead of stopping
// dead: a weight stack landing, a cable swinging, the camera easing between
// views. Adapted from the `Spring` in pixel-wizards-charachters (MIT, same author).

/**
 * `freq` is the natural frequency in Hz (how fast it gets there). `damping` is
 * the damping ratio: 1 arrives without overshoot, below 1 overshoots and
 * wobbles, above 1 is sluggish.
 */
export interface SpringSpec {
  freq: number;
  damping: number;
}

const REST = 1e-4;
/** Largest integration step, seconds. Keeps stiff springs stable at low fps. */
const MAX_H = 1 / 240;

export class Spring {
  value: number;
  velocity = 0;
  spec: SpringSpec;

  constructor(spec: SpringSpec, value = 0) {
    this.spec = spec;
    this.value = value;
  }

  /** Advance `dt` seconds toward `target`; returns the new value. */
  step(target: number, dt: number): number {
    if (!(dt > 0) || !Number.isFinite(target)) return this.value;
    const w = 2 * Math.PI * Math.max(0.01, this.spec.freq);
    const z = Math.max(0, this.spec.damping);
    const n = Math.max(1, Math.ceil(dt / MAX_H));
    const h = dt / n;
    // Semi-implicit Euler in small substeps: a frame hitch is many small
    // steps, not one large one that makes a stiff spring explode.
    for (let i = 0; i < n; i++) {
      const a = -w * w * (this.value - target) - 2 * z * w * this.velocity;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    if (Math.abs(this.value - target) < REST && Math.abs(this.velocity) < REST * 10) this.snap(target);
    return this.value;
  }

  /** Land on `v` with no velocity: scene cuts, reduced motion, scrubbing. */
  snap(v: number): void {
    this.value = v;
    this.velocity = 0;
  }

  /** At rest on `target`, within `eps`. */
  settled(target: number, eps = 1e-3): boolean {
    return Math.abs(this.value - target) < eps && Math.abs(this.velocity) < eps;
  }
}
