import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { MOTIONS, resolveMotion, solve } from "../dist/index.js";
import { bodyMesh, buildFigure, dualQuaternionSkinning } from "../dist/three/figure.js";
import { BONE_COUNT, FLEX_CHANNELS, PAINT_COUNT } from "../dist/three/body.js";
import { MUSCLES } from "../dist/muscles.js";

describe("procedural body", () => {
  const t0 = performance.now();
  const b = bodyMesh();
  const ms = performance.now() - t0;
  const nv = b.position.length / 3;

  it("builds within budget", () => {
    assert.ok(ms < 6000, `built in ${ms.toFixed(0)} ms`);
    assert.ok(nv > 20000 && nv < 250000, `${nv} vertices`);
  });

  it("is a closed surface", () => {
    const edges = new Map();
    for (let i = 0; i < b.index.length; i += 3)
      for (let j = 0; j < 3; j++) {
        const a = b.index[i + j];
        const c = b.index[i + ((j + 1) % 3)];
        const k = a < c ? a * nv + c : c * nv + a;
        edges.set(k, (edges.get(k) ?? 0) + 1);
      }
    let open = 0;
    for (const n of edges.values()) if (n === 1) open++;
    assert.equal(open, 0);
  });

  it("has normalised skin weights on real bones", () => {
    for (let v = 0; v < nv; v++) {
      let s = 0;
      for (let j = 0; j < 4; j++) {
        s += b.skinWeight[v * 4 + j];
        assert.ok(b.skinIndex[v * 4 + j] < BONE_COUNT);
      }
      assert.ok(Math.abs(s - 1) < 1e-4, `vertex ${v} weights sum to ${s}`);
    }
  });

  it("has normalised paint weights", () => {
    for (let v = 0; v < nv; v++) {
      let s = 0;
      for (let j = 0; j < PAINT_COUNT; j++) s += b.paints[v * PAINT_COUNT + j];
      assert.ok(Math.abs(s - 1) < 1e-4);
    }
  });

  it("skins to finite positions in a deep pose", () => {
    const f = buildFigure({ quads: 2 });
    f.update(solve(resolveMotion(MOTIONS["e-squat"]).motion.keys.at(-1)), 0.5);
    f.group.updateMatrixWorld(true);
    const mesh = f.group.children.find((c) => c.isSkinnedMesh);
    mesh.skeleton.update();
    const out = new THREE.Vector3();
    for (let v = 0; v < nv; v += 53) {
      mesh.getVertexPosition(v, out);
      assert.ok(Number.isFinite(out.x + out.y + out.z));
      assert.ok(out.y > -0.1 && out.y < 2.2, `vertex ${v} at y ${out.y}`);
    }
    f.dispose();
  });

  it("bakes bounded muscle flex on both sides", () => {
    const biceps = MUSCLES.indexOf("biceps");
    const out = [0, 0];
    for (let v = 0; v < nv; v++)
      for (let j = 0; j < 2; j++) {
        const ch = b.flexChannel[v * 2 + j];
        if (ch === 255) continue;
        assert.ok(ch < FLEX_CHANNELS);
        const o = (j ? b.flexB : b.flexA).subarray(v * 4, v * 4 + 4);
        assert.ok(o[3] >= -0.0031 && o[3] <= 0.0091, `vertex ${v} moves ${o[3]}`);
        assert.ok(Math.hypot(o[0], o[1], o[2]) < 2.01);
        if (ch >> 1 === biceps && o[3] > 0.003) out[ch & 1]++;
      }
    assert.ok(out[0] > 100 && out[1] > 100, `biceps bulge on ${out}`);
  });

  it("replaces every skinning chunk with dual quaternions", () => {
    const shader = { vertexShader: THREE.ShaderLib.physical.vertexShader, uniforms: {} };
    dualQuaternionSkinning(shader);
    for (const c of ["skinnormal_vertex", "skinning_vertex"]) assert.ok(!shader.vertexShader.includes(`#include <${c}>`), c);
    assert.ok(shader.vertexShader.includes("dqRotate(dqReal, transformed)"));
  });
});
