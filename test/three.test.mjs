import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { anchorPoint, EXERCISE_IDS, MOTIONS, solve } from "../dist/index.js";
import { bodyReady, buildPart, GymScene, preloadBody } from "../dist/three/index.js";
import { readFileSync } from "node:fs";

// No WebGL needed: scenes are plain object graphs.

function finiteGraph(o) {
  let ok = true;
  o.updateMatrixWorld(true);
  o.traverse((c) => {
    if (!c.matrixWorld.elements.every(Number.isFinite)) ok = false;
  });
  return ok;
}

describe("three.js scene", () => {
  it("builds the body without a worker where there is none", async () => {
    assert.equal(typeof Worker, "undefined");
    const p = preloadBody();
    assert.equal(bodyReady(), false, "returns before building");
    const body = await p;
    assert.ok(bodyReady());
    assert.equal(await preloadBody(), body, "builds once");
  });

  it("keeps three.js out of the body worker", () => {
    // The worker loads body.js and what it imports; none of it may need three.
    const seen = new Set();
    const walk = (url) => {
      if (seen.has(url.href)) return;
      seen.add(url.href);
      for (const [, spec] of readFileSync(url, "utf8").matchAll(/^import .* from "([^"]+)";/gm)) {
        assert.ok(spec.startsWith("."), `${url.pathname} imports ${spec}`);
        walk(new URL(spec, url));
      }
    };
    walk(new URL("../dist/three/body-worker.js", import.meta.url));
    assert.ok(seen.size > 3);
  });

  for (const id of EXERCISE_IDS) {
    it(`${id} builds and animates`, () => {
      const scene = new GymScene({ spec: MOTIONS[id], highlight: { chest: 2 } });
      for (let i = 0; i < 90; i++) scene.step(1 / 30);
      assert.ok(finiteGraph(scene.root), "every transform is finite");
      assert.ok(scene.framing.radius > 0.5);
      scene.dispose();
    });
  }

  it("raises a weight stack with the load", () => {
    const part = { kind: "cable", from: [0, 2.3, 0.08], handle: "bar", tower: true };
    const built = buildPart(part);
    const sk = solve(resolveFirstKey("e-pulldown"));
    const topPlateY = () => {
      built.object.updateMatrixWorld(true);
      return new THREE.Vector3().setFromMatrixPosition(built.object.getObjectByName("stack:lifted").matrixWorld).y;
    };
    built.update(sk, { load: 0 });
    const rest = topPlateY();
    built.update(sk, { load: 1 });
    assert.ok(topPlateY() > rest + 0.2, "lifted plates rise");
  });

  it("keeps the cable column out of a seated user's way", () => {
    const built = buildPart({ kind: "cable", from: [0, 2.3, 0.08], handle: "bar", tower: true });
    const box = new THREE.Box3();
    built.object.updateMatrixWorld(true);
    // Uprights (tall, thin meshes) must stand at least 0.6 m from the body axis.
    built.object.traverse((c) => {
      if (!c.isMesh) return;
      box.setFromObject(c);
      const size = box.getSize(new THREE.Vector3());
      if (size.y > 1.2 && size.x < 0.2 && size.z < 0.2) {
        const centre = box.getCenter(new THREE.Vector3());
        assert.ok(Math.hypot(centre.x, centre.z) > 0.6, `upright at ${centre.x.toFixed(2)},${centre.z.toFixed(2)}`);
      }
    });
  });

  it("builds every machine part kind", () => {
    const sk = solve(resolveFirstKey("e-squat"));
    const parts = [
      { kind: "crossover", from: [1.15, 2.05, -0.1] },
      { kind: "padStand", at: [0, 0.9, 0.3], size: [0.4, 0.05, 0.3], tilt: 30 },
      { kind: "benchBox", at: [0, 0.45, -0.3], size: [0.4, 0.45, 0.4] },
      ...["tbar", "hack", "calf", "seatedCalf", "kickback", "legCurl", "hyper", "hipThrust", "rotary", "captain", "rowBench"].map((type) => ({ kind: "station", type })),
    ];
    for (const part of parts) {
      const built = buildPart(part);
      for (let i = 0; i < 3; i++) built.update?.(sk, { load: i / 2 });
      assert.ok(finiteGraph(built.object), `${part.type ?? part.kind} is finite`);
      let meshes = 0;
      built.object.traverse((c) => (meshes += c.isMesh ? 1 : 0));
      assert.ok(meshes > 4, `${part.type ?? part.kind} has detail (${meshes} meshes)`);
    }
  });

  it("puts each crossover handle in its own hand", () => {
    const scene = new GymScene({ spec: MOTIONS["e-cablefly"] });
    for (let i = 0; i < 40; i++) scene.step(1 / 30);
    const sk = scene.skeleton;
    for (const [from, to, hand] of [[[1.15, 2.05, -0.1], "handL", sk.hand[0]], [[-1.15, 2.05, -0.1], "handR", sk.hand[1]]]) {
      const built = buildPart({ kind: "cable", from, to, handle: "single", tower: true });
      built.update(sk, { load: 0.5 });
      built.object.updateMatrixWorld(true);
      // The cable's lower end must reach the hand, not the midpoint between the hands.
      let end = null;
      built.object.traverse((c) => {
        if (!c.isMesh || c.geometry.type !== "TorusGeometry") return;
        end = new THREE.Vector3().setFromMatrixPosition(c.matrixWorld);
      });
      assert.ok(end, "has a D-handle");
      const d = end.distanceTo(new THREE.Vector3(...hand));
      assert.ok(d < 0.05, `${to} handle ${d.toFixed(2)} m from the hand`);
    }
    scene.dispose();
  });

  it("keeps a bike's pedals under the feet", () => {
    const built = buildPart({ kind: "bike" });
    const scene = new GymScene({ spec: MOTIONS["e-bike"] });
    for (let i = 0; i < 20; i++) scene.step(1 / 30);
    built.update(scene.skeleton, { load: 0 });
    built.object.updateMatrixWorld(true);
    const feet = ["footL", "footR"].map((a) => new THREE.Vector3(...anchorPoint(scene.skeleton, a)));
    const pedals = [];
    built.object.traverse((c) => {
      if (c.name === "bike:pedal") pedals.push(new THREE.Box3().setFromObject(c).getCenter(new THREE.Vector3()));
    });
    assert.equal(pedals.length, 2);
    for (const f of feet) {
      const d = Math.min(...pedals.map((p) => p.distanceTo(f)));
      assert.ok(d < 0.15, `pedal ${d.toFixed(2)} m from a foot`);
    }
    scene.dispose();
  });

  it("holds a lat bar horizontal", () => {
    const built = buildPart({ kind: "cable", from: [0, 2.3, 0.08], handle: "bar", tower: true });
    const sk = solve(resolveFirstKey("e-pulldown"));
    built.update(sk, { load: 0 });
    built.object.updateMatrixWorld(true);
    let widest = null;
    built.object.traverse((c) => {
      if (!c.isMesh) return;
      const s = new THREE.Box3().setFromObject(c).getSize(new THREE.Vector3());
      if (!widest || s.x > widest.x) widest = s;
    });
    assert.ok(widest.x > 0.8 && widest.y < 0.1, `bar ${widest.x.toFixed(2)}×${widest.y.toFixed(2)}`);
  });
});

import { resolveMotion } from "../dist/index.js";
function resolveFirstKey(id) {
  return resolveMotion(MOTIONS[id]).motion.keys[0];
}
