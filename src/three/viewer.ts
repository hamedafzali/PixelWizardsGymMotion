import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { motionSpecFor } from "../catalog.js";
import { highlightFor, type Highlight } from "../muscles.js";
import { Spring } from "../spring.js";
import type { Frame } from "../timeline.js";
import type { ExerciseInput, MotionSpec } from "../types.js";
import { PALETTE } from "./equipment.js";
import { GymScene } from "./scene.js";

// A ready-made viewer: renderer, studio lighting, floor and camera around a
// GymScene, rendering only while it is on screen and something moves.

export type View = "front" | "angle" | "side";

export interface ExerciseWithMuscles extends ExerciseInput {
  secondaryMuscles?: readonly string[];
}

export interface GymViewerOptions {
  /** What to show: an exercise (its movement is looked up or inferred) … */
  exercise?: ExerciseWithMuscles;
  /** … or a motion spec directly. */
  spec?: MotionSpec;
  /** Muscles to colour. Defaults to the exercise's primary and secondary muscles. */
  highlight?: Highlight;
  /** Defaults to true, or false when the user prefers reduced motion. */
  playing?: boolean;
  speed?: number;
  /** A named view, or a yaw in degrees (0 = facing the figure). */
  view?: View | number;
  /** Canvas clear colour. */
  background?: string;
  /** Drag sideways to turn the camera. Default true. */
  interactive?: boolean;
  shadows?: boolean;
  /** Upper bound for devicePixelRatio. Default 2. */
  maxPixelRatio?: number;
  /** Accessible description of the canvas. */
  label?: string;
  /** The coaching cue changed, e.g. "Press". */
  onCue?(cue: string): void;
  /** Every rendered frame. */
  onFrame?(frame: Frame): void;
}

const FOV = 30;
const DEFAULT_YAW = 50;
const YAW_SPRING = { freq: 1.4, damping: 1 };

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export class GymViewer {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 30);
  readonly three = new THREE.Scene();
  scene!: GymScene;

  private opts: GymViewerOptions;
  private playing: boolean;
  private speed: number;
  private view: View | number;
  private yawTarget = DEFAULT_YAW;
  private yaw = new Spring(YAW_SPRING, DEFAULT_YAW);
  private visible = true;
  private raf = 0;
  private last = 0;
  private dirty = true;
  private cue = "";
  private drag: { x: number; yaw: number; id: number } | null = null;
  private cleanups: (() => void)[] = [];

  constructor(
    readonly container: HTMLElement,
    options: GymViewerOptions = {},
  ) {
    this.opts = options;
    this.speed = options.speed ?? 1;
    this.view = options.view ?? "angle";
    const reduce = reducedMotion();
    this.playing = options.playing ?? !reduce;

    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("role", "img");
    Object.assign(this.canvas.style, { display: "block", width: "100%", height: "100%", touchAction: "pan-y" });
    container.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: "low-power" });
    this.renderer.setClearColor(options.background ?? PALETTE.background);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = options.shadows ?? true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.lights();
    this.setContent(options);
    if (reduce && options.playing === undefined) this.scene.seek(this.scene.peakTime);

    this.observe();
    if (options.interactive ?? true) this.dragging();
    this.resize();
    this.wake();
  }

  // ── Public controls ──────────────────────────────────────────────────────

  /** Show another exercise or spec. Keeps the play state and view. */
  setContent({ exercise, spec, highlight, label }: Pick<GymViewerOptions, "exercise" | "spec" | "highlight" | "label">): void {
    const s = spec ?? (exercise ? motionSpecFor(exercise) : this.scene?.spec);
    if (!s) throw new Error("GymViewer: pass an `exercise` or a `spec`.");
    const h = highlight ?? (exercise ? highlightFor(exercise.primaryMuscle, exercise.secondaryMuscles) : {});
    this.scene?.dispose();
    this.scene = new GymScene({ spec: s, highlight: h });
    this.three.add(this.scene.root);
    const name = exercise?.name ?? "the exercise";
    this.canvas.setAttribute(
      "aria-label",
      label ?? `Animated 3D guide showing how to do ${name}${s.device ? ` on the ${s.device.toLowerCase()}` : ""}.`,
    );
    this.setView(this.view, true);
    this.cue = "";
    this.wake();
  }

  play(): void {
    this.playing = true;
    this.wake();
  }
  pause(): void {
    this.playing = false;
  }
  toggle(): boolean {
    if (this.playing) this.pause();
    else this.play();
    return this.playing;
  }
  get isPlaying(): boolean {
    return this.playing;
  }
  setSpeed(speed: number): void {
    this.speed = speed;
  }
  /** Turn the camera to a named view or a yaw in degrees. `instant` skips the ease. */
  setView(view: View | number, instant = false): void {
    this.view = view;
    const angle = this.scene?.spec.camera?.yaw ?? DEFAULT_YAW;
    this.yawTarget = typeof view === "number" ? view : view === "front" ? 0 : view === "side" ? 90 : angle;
    if (instant) this.yaw.snap(this.yawTarget);
    this.wake();
  }
  /** Jump to a time in seconds. */
  seek(time: number): void {
    this.scene.seek(time);
    this.wake();
  }
  /** Seconds per rep, or null for loops and holds. */
  get repSeconds(): number | null {
    const m = this.scene.motion;
    if (m.kind !== "rep") return null;
    return (this.scene.spec.tempo ?? m.tempo ?? [1.2, 0.3, 1.8, 0.3]).reduce((a, b) => a + b, 0);
  }

  /** Re-measure the container. Called automatically on resize. */
  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, this.opts.maxPixelRatio ?? 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.wake();
  }

  /** Draw one frame now, whether or not the loop is running. */
  render(): void {
    this.placeCamera();
    this.renderer.render(this.three, this.camera);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    for (const c of this.cleanups) c();
    this.scene.dispose();
    this.three.environment?.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private lights() {
    const s = this.three;
    s.add(new THREE.HemisphereLight("#E4E8FF", "#1E2448", 0.4));
    const key = new THREE.DirectionalLight("#ffffff", 2.2);
    key.position.set(-2.6, 4, 2.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.radius = 4;
    key.shadow.bias = -0.0004;
    Object.assign(key.shadow.camera, { left: -2.5, right: 2.5, top: 2.5, bottom: -2.5 });
    const rim = new THREE.DirectionalLight("#B8C4FF", 0.7);
    rim.position.set(2.8, 2.2, -2.6);
    s.add(key, rim);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 64),
      new THREE.MeshStandardMaterial({ color: PALETTE.floor, roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);
    // Soft studio reflections so the body and chrome read as rounded, not flat.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    s.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    s.environmentIntensity = 0.25;
    pmrem.dispose();
  }

  private placeCamera() {
    const { centre, radius } = this.scene.framing;
    const cam = this.scene.spec.camera;
    const pitch = THREE.MathUtils.degToRad(cam?.pitch ?? 14);
    const y = THREE.MathUtils.degToRad(this.yaw.value);
    // Fit the bounding sphere in the narrower of the two fields of view.
    const vHalf = THREE.MathUtils.degToRad(FOV / 2);
    const half = Math.min(vHalf, Math.atan(Math.tan(vHalf) * this.camera.aspect));
    const d = (radius / Math.sin(half)) * (cam?.zoom ?? 1) * 1.02;
    this.camera.position.set(
      centre.x + d * Math.sin(y) * Math.cos(pitch),
      centre.y + d * Math.sin(pitch),
      centre.z + d * Math.cos(y) * Math.cos(pitch),
    );
    this.camera.lookAt(centre);
  }

  private wake() {
    this.dirty = true;
    if (!this.raf && this.visible && typeof requestAnimationFrame === "function") {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  private tick = (now: number) => {
    this.raf = 0;
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const f = this.playing ? this.scene.step(dt, this.speed) : this.scene.step(0);
    if (!this.drag) this.yaw.step(this.yawTarget, dt);
    if (f.cue !== this.cue) {
      this.cue = f.cue;
      this.opts.onCue?.(f.cue);
    }
    this.render();
    this.opts.onFrame?.(f);
    this.dirty = false;
    // Keep going while something moves; a paused, settled view costs nothing.
    const moving = this.playing || !!this.drag || !this.yaw.settled(this.yawTarget, 0.02);
    if (this.visible && (moving || this.dirty)) this.raf = requestAnimationFrame(this.tick);
  };

  private observe() {
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => this.resize());
      ro.observe(this.container);
      this.cleanups.push(() => ro.disconnect());
    }
    if (typeof IntersectionObserver !== "undefined") {
      const io = new IntersectionObserver(
        ([e]) => {
          this.visible = !!e?.isIntersecting;
          if (this.visible) this.wake();
          else {
            cancelAnimationFrame(this.raf);
            this.raf = 0;
          }
        },
        { rootMargin: "100px" },
      );
      io.observe(this.container);
      this.cleanups.push(() => io.disconnect());
    }
  }

  /** Horizontal drags orbit; vertical drags still scroll the page. */
  private dragging() {
    const c = this.canvas;
    c.style.cursor = "grab";
    const down = (e: PointerEvent) => {
      this.drag = { x: e.clientX, yaw: this.yaw.value, id: e.pointerId };
      c.setPointerCapture?.(e.pointerId);
      c.style.cursor = "grabbing";
      this.wake();
    };
    const move = (e: PointerEvent) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const yaw = this.drag.yaw - (e.clientX - this.drag.x) * 0.5;
      this.yaw.snap(yaw);
      this.yawTarget = yaw;
      this.view = yaw;
      this.wake();
    };
    const up = () => {
      this.drag = null;
      c.style.cursor = "grab";
    };
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    this.cleanups.push(() => {
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("pointercancel", up);
    });
  }
}
