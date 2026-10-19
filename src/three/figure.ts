import * as THREE from "three";
import { MUSCLES, type Highlight } from "../muscles.js";
import type { Skeleton } from "../rig.js";
import { BONE_COUNT, boneFrames, buildBody, HELPERS, MAIN_BONES, PAINT_COUNT, PAINTS, type BodyMesh, type BoneFrame } from "./body.js";

// The figure: one skinned mesh of the procedural body (see body.ts), driven
// straight from the IK skeleton. Muscle groups are painted into vertex
// colours, so highlighting is a recolour of the shared, cached mesh.

export type { Highlight };

export const SKIN = {
  skin: "#A9B0C4",
  shorts: "#262C4A",
  shoe: "#323A63",
  sole: "#E9ECF5",
  sock: "#DDE2EE",
  hair: "#20263F",
  primary: "#CDF542",
  secondary: "#86A23A",
};

// ── Material ───────────────────────────────────────────────────────────────

function skinMaterial(pulse: { value: number }) {
  const m = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0,
    sheen: 0.25,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color("#E8ECFF"),
    clearcoat: 0.06,
    clearcoatRoughness: 0.5,
  });
  m.onBeforeCompile = (shader) => {
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
  m.customProgramCacheKey = () => "pwgm-skin";
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
  const mat = skinMaterial(pulse);
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
      geo.dispose();
    },
  };
}
