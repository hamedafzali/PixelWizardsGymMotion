import * as THREE from "three";
import { MUSCLES, type Highlight } from "../muscles.js";
import type { Skeleton } from "../rig.js";
import { BONE_COUNT, boneFrames, buildBody, FLEX_CHANNELS, HELPERS, MAIN_BONES, PAINT_COUNT, PAINTS, type BodyMesh, type BoneFrame } from "./body.js";

// The figure: one skinned mesh of the procedural body (see body.ts), driven
// straight from the IK skeleton. Muscle groups are painted into vertex
// colours, so highlighting is a recolour of the shared, cached mesh.

export type { Highlight };

export const SKIN = {
  skin: "#C9A08A",
  shorts: "#262C4A",
  shoe: "#323A63",
  sole: "#E9ECF5",
  sock: "#DDE2EE",
  hair: "#2A211C",
  eye: "#E9E5E0",
  iris: "#3A2A1F",
  lips: "#A9776F",
  brow: "#2A211C",
  primary: "#CDF542",
  secondary: "#86A23A",
};

// ── Skinning ───────────────────────────────────────────────────────────────

// Dual-quaternion skinning: every bone transform is rigid, so each becomes a
// unit dual quaternion, and blending those keeps the skin's volume where
// linear blending would pinch it (a bent elbow, a twisted forearm).
const DQ_PARS = /* glsl */ `
#ifdef USE_SKINNING
vec4 dqQuat(mat4 m) {
  float t = m[0][0] + m[1][1] + m[2][2];
  float s;
  if (t > 0.0) {
    s = sqrt(t + 1.0) * 2.0;
    return vec4(m[1][2] - m[2][1], m[2][0] - m[0][2], m[0][1] - m[1][0], 0.25 * s * s) / s;
  }
  if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    s = sqrt(1.0 + m[0][0] - m[1][1] - m[2][2]) * 2.0;
    return vec4(0.25 * s * s, m[1][0] + m[0][1], m[2][0] + m[0][2], m[1][2] - m[2][1]) / s;
  }
  if (m[1][1] > m[2][2]) {
    s = sqrt(1.0 + m[1][1] - m[0][0] - m[2][2]) * 2.0;
    return vec4(m[1][0] + m[0][1], 0.25 * s * s, m[2][1] + m[1][2], m[2][0] - m[0][2]) / s;
  }
  s = sqrt(1.0 + m[2][2] - m[0][0] - m[1][1]) * 2.0;
  return vec4(m[2][0] + m[0][2], m[2][1] + m[1][2], 0.25 * s * s, m[0][1] - m[1][0]) / s;
}
vec4 dqMul(vec4 a, vec4 b) {
  return vec4(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz));
}
vec3 dqRotate(vec4 q, vec3 v) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}
void dqAdd(mat4 m, float w, vec4 r0, inout vec4 real, inout vec4 dual) {
  vec4 r = dqQuat(m);
  if (dot(r, r0) < 0.0) w = -w;
  real += w * r;
  dual += w * 0.5 * dqMul(vec4(m[3].xyz, 0.0), r);
}
#endif
`;

const DQ_BASE = /* glsl */ `
#include <skinbase_vertex>
#ifdef USE_SKINNING
  vec4 dqReal = vec4(0.0);
  vec4 dqDual = vec4(0.0);
  vec4 dqR0 = dqQuat(boneMatX);
  dqAdd(boneMatX, skinWeight.x, dqR0, dqReal, dqDual);
  dqAdd(boneMatY, skinWeight.y, dqR0, dqReal, dqDual);
  dqAdd(boneMatZ, skinWeight.z, dqR0, dqReal, dqDual);
  dqAdd(boneMatW, skinWeight.w, dqR0, dqReal, dqDual);
  float dqLen = length(dqReal);
  dqReal /= dqLen;
  dqDual /= dqLen;
  vec3 dqMove = 2.0 * (dqReal.w * dqDual.xyz - dqDual.w * dqReal.xyz + cross(dqReal.xyz, dqDual.xyz));
#endif
`;

const DQ_NORMAL = /* glsl */ `
#ifdef USE_SKINNING
  objectNormal = dqRotate(dqReal, objectNormal);
  #ifdef USE_TANGENT
    objectTangent = dqRotate(dqReal, objectTangent);
  #endif
#endif
`;

const DQ_POSITION = /* glsl */ `
#ifdef USE_SKINNING
  transformed = dqRotate(dqReal, transformed) + dqMove;
#endif
`;

// Muscle flex: the baked offsets (body.ts) scaled by each channel's activation.
const FLEX_PARS = /* glsl */ `
#ifdef USE_SKINNING
attribute vec2 flexChannel;
attribute vec4 flexA;
attribute vec4 flexB;
uniform float uAct[${FLEX_CHANNELS}];
float flexAct(float c) {
  return c < ${FLEX_CHANNELS}.0 ? uAct[int(c)] : 0.0;
}
#endif
`;

type Shader = { vertexShader: string; uniforms: Record<string, { value: unknown }> };

/** Swaps three's linear blend skinning for dual quaternions. */
export function dualQuaternionSkinning(shader: Shader) {
  shader.vertexShader = shader.vertexShader
    .replace("#include <skinning_pars_vertex>", "#include <skinning_pars_vertex>\n" + DQ_PARS)
    .replace("#include <skinbase_vertex>", DQ_BASE)
    .replace("#include <skinnormal_vertex>", DQ_NORMAL)
    .replace("#include <skinning_vertex>", DQ_POSITION);
}

/** Dual-quaternion skinning plus the muscle flex offsets, driven by `act`. */
function skinAndFlex(shader: Shader, act: { value: Float32Array }) {
  dualQuaternionSkinning(shader);
  shader.uniforms.uAct = act;
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\n" + FLEX_PARS)
    .replace(
      "#include <beginnormal_vertex>",
      `#include <beginnormal_vertex>
#ifdef USE_SKINNING
  float flexWA = flexAct(flexChannel.x);
  float flexWB = flexAct(flexChannel.y);
  objectNormal = normalize(objectNormal + flexWA * flexA.xyz + flexWB * flexB.xyz);
#endif`,
    )
    .replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
#ifdef USE_SKINNING
  transformed += normal * (flexAct(flexChannel.x) * flexA.w + flexAct(flexChannel.y) * flexB.w);
#endif`,
    );
}

// ── Material ───────────────────────────────────────────────────────────────

function skinMaterial(pulse: { value: number }, act: { value: Float32Array }) {
  const m = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0,
    sheen: 0.25,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color("#FFE9DC"),
    clearcoat: 0.06,
    clearcoatRoughness: 0.5,
  });
  m.onBeforeCompile = (shader) => {
    skinAndFlex(shader, act);
    shader.uniforms.uPulse = pulse;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float glow;\nvarying float vGlow;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = glow;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vGlow;\nuniform float uPulse;")
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.62, 0.78, 0.12) * vGlow * (0.12 + 0.45 * uPulse);",
      );
  };
  m.customProgramCacheKey = () => "pwgm-skin-dq";
  return m;
}

/** The shadow caster, skinned and flexed the same way so shadows match the skin. */
function depthMaterial(act: { value: Float32Array }) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (shader) => skinAndFlex(shader, act);
  m.customProgramCacheKey = () => "pwgm-depth-dq";
  return m;
}

// ── Shared mesh ──────────────────────────────────────────────────────────────

let body: BodyMesh | null = null;
let shared: Record<string, THREE.BufferAttribute> | null = null;
const bindInverse: THREE.Matrix4[] = [];

const basis = (f: BoneFrame, m: THREE.Matrix4) =>
  m.set(f.x[0], f.y[0], f.z[0], f.o[0], f.x[1], f.y[1], f.z[1], f.o[1], f.x[2], f.y[2], f.z[2], f.o[2], 0, 0, 0, 1);

/** Builds the body mesh once; every figure shares it. */
export function bodyMesh(): BodyMesh {
  if (!body) {
    body = buildBody();
    for (const f of body.bind) bindInverse.push(basis(f, new THREE.Matrix4()).invert());
    shared = {
      position: new THREE.BufferAttribute(body.position, 3),
      normal: new THREE.BufferAttribute(body.normal, 3),
      skinIndex: new THREE.Uint16BufferAttribute(body.skinIndex, 4),
      skinWeight: new THREE.BufferAttribute(body.skinWeight, 4),
      flexChannel: new THREE.Uint8BufferAttribute(body.flexChannel, 2),
      flexA: new THREE.BufferAttribute(body.flexA, 4),
      flexB: new THREE.BufferAttribute(body.flexB, 4),
    };
  }
  return body;
}

function paintColours(b: BodyMesh, highlight: Highlight) {
  const n = b.position.length / 3;
  const col = new Float32Array(n * 3);
  const glow = new Float32Array(n);
  const base = PAINTS.map((p) => new THREE.Color(SKIN[p]));
  const hi1 = new THREE.Color(SKIN.secondary);
  const hi2 = new THREE.Color(SKIN.primary);
  const level = MUSCLES.map((m) => highlight[m] ?? 0);
  const skin = new THREE.Color();
  for (let v = 0; v < n; v++) {
    let w1 = 0;
    let w2 = 0;
    for (const [m, w] of [
      [b.muscleA[v], b.weightA[v]],
      [b.muscleB[v], b.weightB[v]],
    ]) {
      const l = m === 255 ? 0 : level[m];
      if (l === 2) w2 = Math.max(w2, w);
      else if (l === 1) w1 = Math.max(w1, w);
    }
    skin.copy(base[0]).lerp(hi1, w1 * 0.9).lerp(hi2, w2);
    // Shorts, shoes and hair cover the muscles beneath them.
    let r = 0;
    let g = 0;
    let bl = 0;
    for (let j = 0; j < PAINT_COUNT; j++) {
      const w = b.paints[v * PAINT_COUNT + j];
      if (!w) continue;
      const c = j === 0 ? skin : base[j];
      r += c.r * w;
      g += c.g * w;
      bl += c.b * w;
    }
    col.set([r, g, bl], v * 3);
    glow[v] = w2 * b.paints[v * PAINT_COUNT];
  }
  return { col, glow };
}

// ── Figure ─────────────────────────────────────────────────────────────────

export interface Figure {
  group: THREE.Group;
  update(sk: Skeleton, pulse: number): void;
  dispose(): void;
}

export function buildFigure(highlight: Highlight): Figure {
  const b = bodyMesh();
  const group = new THREE.Group();
  const pulse = { value: 0 };
  const act = { value: new Float32Array(FLEX_CHANNELS) };
  const mat = skinMaterial(pulse, act);
  const depth = depthMaterial(act);
  const geo = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(shared!)) geo.setAttribute(k, a);
  const { col, glow } = paintColours(b, highlight);
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("glow", new THREE.BufferAttribute(glow, 1));
  geo.setIndex(new THREE.BufferAttribute(b.index, 1));

  // Bones hold the skinning transform itself (current × inverse bind), so the
  // skeleton's inverses are identities.
  const bones = Array.from({ length: BONE_COUNT }, () => {
    const bone = new THREE.Bone();
    bone.matrixAutoUpdate = false;
    group.add(bone);
    return bone;
  });
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.bind(
    new THREE.Skeleton(
      bones,
      bones.map(() => new THREE.Matrix4()),
    ),
    new THREE.Matrix4(),
  );
  mesh.customDepthMaterial = depth;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  group.add(mesh);

  const cur = new THREE.Matrix4();
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  const j0 = new THREE.Vector3();
  const j1 = new THREE.Vector3();
  const helperBind = HELPERS.map((h) => {
    const p = h.joint(b.bindSkeleton);
    return new THREE.Vector3(p[0], p[1], p[2]);
  });

  return {
    group,
    update(sk, p) {
      pulse.value = p;
      activate(act.value, highlight, sk, p);
      const frames = boneFrames(sk);
      for (let i = 0; i < MAIN_BONES; i++) {
        bones[i].matrix.multiplyMatrices(basis(frames[i], cur), bindInverse[i]);
        bones[i].matrixWorldNeedsUpdate = true;
      }
      // Helpers: half-way rotation, pinned to the joint.
      HELPERS.forEach((h, i) => {
        qa.setFromRotationMatrix(bones[h.parent].matrix);
        qb.setFromRotationMatrix(bones[h.child].matrix);
        qa.slerp(qb, 0.5);
        const m = bones[MAIN_BONES + i].matrix.makeRotationFromQuaternion(qa);
        const jp = h.joint(sk);
        j0.copy(helperBind[i]).applyQuaternion(qa);
        j1.set(jp[0], jp[1], jp[2]).sub(j0);
        m.setPosition(j1);
        bones[MAIN_BONES + i].matrixWorldNeedsUpdate = true;
      });
    },
    dispose() {
      mat.dispose();
      depth.dispose();
      geo.dispose();
    },
  };
}

// ── Muscle activation ─────────────────────────────────────────────────────

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Angle in degrees at `b` between the segments to `a` and `c`, 0 when straight. */
function bend(a: readonly number[], b: readonly number[], c: readonly number[]) {
  const u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v) || 1);
  return 180 - (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

const MI = (m: (typeof MUSCLES)[number]) => MUSCLES.indexOf(m);

/**
 * How flexed each muscle is this frame (0 → 1, per side). Worked muscles hold
 * some tone and tighten through the effort; a bent joint also bunches the
 * muscle that bends it (the biceps at the top of a curl), loaded or not.
 */
function activate(out: Float32Array, highlight: Highlight, sk: Skeleton, pulse: number) {
  MUSCLES.forEach((m, j) => {
    const level = highlight[m] ?? 0;
    const a = level === 2 ? 0.35 + 0.65 * pulse : level === 1 ? 0.5 * (0.35 + 0.65 * pulse) : 0;
    out[j * 2] = out[j * 2 + 1] = a;
  });
  for (const i of [0, 1] as const) {
    const elbow = bend(sk.shoulder[i], sk.elbow[i], sk.hand[i]);
    const knee = bend(sk.hip[i], sk.knee[i], sk.ankle[i]);
    const set = (m: number, a: number) => (out[m * 2 + i] = Math.max(out[m * 2 + i], a));
    set(MI("biceps"), 0.8 * smoothstep(40, 130, elbow));
    set(MI("forearms"), 0.3 * smoothstep(60, 130, elbow));
    set(MI("hamstrings"), 0.5 * smoothstep(50, 120, knee));
    set(MI("calves"), 0.3 * smoothstep(60, 120, knee));
  }
}
