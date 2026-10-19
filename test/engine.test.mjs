import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BODY, DEVICE, EXERCISE_IDS, MACHINE, MOTIONS, motionSpecFor, resolveMotion, sample, solve } from "../dist/index.js";

const finite = (v) => v.every(Number.isFinite);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** How far the solved chain ends land from their targets, in metres. */
function reachError(key) {
  const sk = solve(key);
  return Math.max(...[0, 1].flatMap((i) => [dist(sk.hand[i], key.hands[i]), dist(sk.ankle[i], key.feet[i])]));
}

describe("movement engine", () => {
  it("has an entry for every exercise id", () => {
    assert.ok(EXERCISE_IDS.length >= 100);
    assert.deepEqual(EXERCISE_IDS, Object.keys(MOTIONS));
  });

  for (const id of EXERCISE_IDS) {
    it(`${id} solves cleanly`, () => {
      const { motion } = resolveMotion(MOTIONS[id]);
      assert.ok(motion.keys.length > 1);
      for (const key of motion.keys) {
        const sk = solve(key);
        for (const p of [sk.pelvis, sk.head, ...sk.hand, ...sk.elbow, ...sk.knee, ...sk.ankle, ...sk.toe]) assert.ok(finite(p));
        // Bones keep their length.
        for (const i of [0, 1]) {
          assert.ok(Math.abs(dist(sk.shoulder[i], sk.elbow[i]) - BODY.upperArm) < 1e-3);
          assert.ok(Math.abs(dist(sk.hip[i], sk.knee[i]) - BODY.thigh) < 1e-3);
        }
        // Hands and feet land where the pattern put them.
        assert.ok(reachError(key) < 0.04, `reach ${reachError(key)}`);
        // Nothing sinks into the floor.
        assert.ok(Math.min(sk.ankle[0][1], sk.ankle[1][1], sk.pelvis[1]) > 0.02);
      }
      for (let t = 0; t < 8; t += 0.37) {
        const f = sample(motion, t);
        assert.ok(finite(f.pose.pelvis));
        assert.equal(typeof f.cue, "string");
        assert.ok(f.load >= 0 && f.load <= 1);
      }
    });
  }

  it("shows every free-weight lift on its machine version", () => {
    for (const [free, machine] of Object.entries(MACHINE)) {
      assert.ok(MOTIONS[free], free);
      assert.ok(DEVICE[machine], machine);
    }
    const squat = motionSpecFor({ id: "e-squat", name: "Back squat", equipment: "barbell", primaryMuscle: "quads" });
    assert.equal(squat.device, "Smith machine");
    assert.ok(squat.equipment?.some((p) => p.kind === "smith"));
    const curl = motionSpecFor({ id: "custom-4", name: "Dumbbell curl", equipment: "dumbbell", primaryMuscle: "biceps" });
    assert.equal(curl.device, "Biceps curl machine");
  });

  it("infers a movement for exercises outside the catalog", () => {
    const spec = motionSpecFor({ id: "custom-1", name: "Incline Dumbbell Fly", equipment: "dumbbell", primaryMuscle: "chest" });
    assert.equal(spec.pattern, "armArc");
    assert.equal(spec.device, "Pec deck");
    assert.ok(!spec.equipment?.some((p) => p.kind === "dumbbell"));
    assert.equal(motionSpecFor({ id: "custom-2", name: "Mystery move", equipment: "machine", primaryMuscle: "lats" }).pattern, "pulldown");
    assert.equal(motionSpecFor({ id: "custom-3", name: "Thing", equipment: "other", primaryMuscle: null }).pattern, "squat");
  });

  it("lifts the load during the working half and rests it after", () => {
    const { motion } = resolveMotion(MOTIONS["e-legpress"]);
    const [a, h1, b] = motion.tempo ?? [1.2, 0.3, 1.8, 0.3];
    assert.equal(motion.effort, "second");
    // Leg press: keys[0] is the extended (lifted) end, so load starts high.
    assert.ok(sample(motion, 0).load > 0.99);
    assert.ok(sample(motion, a + h1 * 0.5).load < 0.01);
    assert.ok(sample(motion, a + h1 + b).load > 0.99);
    const loop = resolveMotion(MOTIONS[EXERCISE_IDS.find((id) => resolveMotion(MOTIONS[id]).motion.kind === "loop")]).motion;
    assert.equal(sample(loop, 0.4).load, 0);
  });
});
