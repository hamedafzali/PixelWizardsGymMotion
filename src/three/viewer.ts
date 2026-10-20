import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { motionSpecFor } from "../catalog.js";
import { highlightFor, type Highlight } from "../muscles.js";
import { musclesFor } from "../targets.js";
import { Spring } from "../spring.js";
import type { Frame } from "../timeline.js";
import type { ExerciseInput, MotionSpec } from "../types.js";
import { PALETTE } from "./equipment.js";
import { dualQuaternionSkinning } from "./figure.js";
import { GymScene } from "./scene.js";
import { floorTexture } from "./textures.js";

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
  /**
   * "high" adds ambient occlusion and multisampled post-processing, so
   * contact areas (armpits, under the bench, between plates) darken the way
   * they do under studio light. "standard" renders straight to the canvas,
   * cheaper on low-end phones. Default "high".
   */
  quality?: "high" | "standard";
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
  private key!: THREE.DirectionalLight;
  private fog!: THREE.Fog;
  private composer: EffectComposer | null = null;
  private ao: GTAOPass | null = null;

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
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = options.shadows ?? true;
    // Plain PCF honours shadow.radius, so shadows get a soft penumbra.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.lights();
    if ((options.quality ?? "high") === "high") this.postProcessing();
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
    const t = exercise?.primaryMuscle ? { primary: exercise.primaryMuscle, secondary: exercise.secondaryMuscles ?? [] } : musclesFor(s);
    const h = highlight ?? highlightFor(t.primary, t.secondary);
    this.scene?.dispose();
    this.scene = new GymScene({ spec: s, highlight: h });
    this.three.add(this.scene.root);
    const name = exercise?.name ?? "the exercise";
    this.canvas.setAttribute(
      "aria-label",
      label ?? `Animated 3D guide showing how to do ${name}${s.device ? ` on the ${s.device.toLowerCase()}` : ""}.`,
    );
    this.fitShadow();
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
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.wake();
  }

  /** Draw one frame now, whether or not the loop is running. */
  render(): void {
    this.placeCamera();
    if (this.composer) this.composer.render();
    else this.renderer.render(this.three, this.camera);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    for (const c of this.cleanups) c();
    this.scene.dispose();
    this.ao?.dispose();
    this.composer?.dispose();
    this.three.environment?.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private lights() {
    const s = this.three;
    const bg = this.opts.background ?? PALETTE.background;
    s.add(new THREE.HemisphereLight("#E4E8FF", "#1E2448", 0.25));
    const key = new THREE.DirectionalLight("#ffffff", 2.1);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 4;
    key.shadow.blurSamples = 16;
    key.shadow.bias = -0.0003;
    key.shadow.normalBias = 0.01;
    this.key = key;
    const rim = new THREE.DirectionalLight("#B8C4FF", 0.8);
    rim.position.set(2.8, 2.2, -2.6);
    s.add(key, key.target, rim);

    // Rubber tile floor that fades into the background instead of ending.
    const tex = floorTexture();
    tex.repeat.set(16, 16);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 16),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88, metalness: 0, envMapIntensity: 0.4 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);
    // Fog is tone mapped like every lit surface; pre-invert the curve so the
    // floor fades into exactly the requested background colour.
    this.fog = new THREE.Fog(untoneMapped(new THREE.Color(bg), this.renderer.toneMappingExposure), 4, 10);
    s.fog = this.fog;
    this.cleanups.push(() => {
      tex.dispose();
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
    });

    // Studio reflections: softbox strips overhead and a key panel, so the
    // body, chrome and powder coat read as rounded, not flat.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const studio = studioScene();
    s.environment = pmrem.fromScene(studio, 0.03).texture;
    s.environmentIntensity = 0.55;
    studio.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    pmrem.dispose();
  }

  /**
   * Scene → multisampled half-float target → ground-truth ambient occlusion
   * (GTAO, denoised) → tone mapping and sRGB output.
   */
  private postProcessing() {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.three, this.camera));
    const ao = new GTAOPass(this.three, this.camera, 1, 1);
    ao.updateGtaoMaterial({ radius: 0.18, distanceExponent: 1.6, thickness: 1.2, scale: 1.1, samples: 16 });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    ao.blendIntensity = 0.9;
    // Its normal pass overrides every material; skin it like the figure.
    ao.normalMaterial.onBeforeCompile = dualQuaternionSkinning;
    ao.normalMaterial.customProgramCacheKey = () => "pwgm-normal-dq";
    composer.addPass(ao);
    composer.addPass(new OutputPass());
    // Through the composer the clear colour would be encoded twice; draw the
    // background as a scene colour, tone mapped along with the fog.
    this.three.background = this.fog.color.clone();
    this.composer = composer;
    this.ao = ao;
  }

  /** Keeps the key light's shadow tight around the exercise. */
  private fitShadow() {
    const { centre, radius } = this.scene.framing;
    const r = radius + 0.7;
    this.key.target.position.copy(centre);
    this.key.position.copy(centre).add(new THREE.Vector3(-2.6, 4, 2.2));
    Object.assign(this.key.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 0.5, far: 12 });
    this.key.shadow.camera.updateProjectionMatrix();
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
    // The floor fades out a little beyond the exercise.
    this.fog.near = d + radius * 0.6;
    this.fog.far = d + radius * 0.6 + 6;
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

/** A dim room lit by softboxes, for image-based lighting. */
function studioScene() {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(14, 7, 14), new THREE.MeshBasicMaterial({ color: "#1A1F28", side: THREE.BackSide }));
  room.position.y = 3.5;
  scene.add(room);
  const panel = (w: number, h: number, at: [number, number, number], power: number, tint = "#ffffff") => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(tint).multiplyScalar(power), side: THREE.DoubleSide }));
    m.position.set(...at);
    m.lookAt(0, 1, 0);
    scene.add(m);
  };
  for (const x of [-2, 0, 2]) panel(0.5, 6, [x, 6.8, 0], 3); // overhead strips
  panel(3, 2.4, [-5, 3, 4], 6); // key softbox
  panel(1, 4, [5.5, 2.6, -3.5], 4, "#C4CEFF"); // cool rim strip
  panel(6, 1.2, [0, 1.2, -6.8], 0.8); // faint back wall bounce
  return scene;
}

// ACES filmic as three.js applies it (exposure / 0.6, input matrix, RRT+ODT
// fit, output matrix), in linear RGB.
function aces([r, g, b]: number[], exposure: number) {
  const k = exposure / 0.6;
  [r, g, b] = [r * k, g * k, b * k];
  const i = [0.59719 * r + 0.35458 * g + 0.04823 * b, 0.076 * r + 0.90834 * g + 0.01566 * b, 0.0284 * r + 0.13383 * g + 0.83777 * b];
  const f = i.map((v) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081));
  return [
    1.60475 * f[0] - 0.53108 * f[1] - 0.07367 * f[2],
    -0.10208 * f[0] + 1.10813 * f[1] - 0.00605 * f[2],
    -0.00327 * f[0] - 0.07276 * f[1] + 1.07602 * f[2],
  ].map((v) => Math.min(1, Math.max(0, v)));
}

/** The linear colour that ACES maps onto `target`, found by fixed-point iteration. */
function untoneMapped(target: THREE.Color, exposure: number) {
  const t = [target.r, target.g, target.b];
  let c = [...t];
  for (let n = 0; n < 40; n++) {
    const m = aces(c, exposure);
    c = c.map((v, j) => Math.max(1e-6, v + (t[j] - m[j]) * 1.5));
  }
  return new THREE.Color(c[0], c[1], c[2]);
}
