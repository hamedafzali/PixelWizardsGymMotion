import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { EXERCISE_IDS, MOTIONS, solve } from "../dist/index.js";
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
