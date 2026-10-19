import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Spring, highlightFor } from "../dist/index.js";

describe("Spring", () => {
  it("settles on the target without overshoot when critically damped", () => {
    const s = new Spring({ freq: 2, damping: 1 });
    let max = 0;
    for (let i = 0; i < 240; i++) max = Math.max(max, s.step(1, 1 / 60));
    assert.ok(max <= 1 + 1e-6);
    assert.ok(s.settled(1));
  });

  it("overshoots when underdamped", () => {
    const s = new Spring({ freq: 3, damping: 0.3 });
    let max = 0;
    for (let i = 0; i < 120; i++) max = Math.max(max, s.step(1, 1 / 60));
    assert.ok(max > 1.2);
  });

  it("stays stable through a long frame hitch", () => {
    const s = new Spring({ freq: 12, damping: 0.5 });
    s.step(1, 2);
    assert.ok(Number.isFinite(s.value) && Math.abs(s.value - 1) < 0.01);
  });

  it("ignores bad input and snaps", () => {
    const s = new Spring({ freq: 2, damping: 1 }, 0.5);
    assert.equal(s.step(NaN, 1 / 60), 0.5);
    assert.equal(s.step(1, -1), 0.5);
    s.snap(3);
    assert.ok(s.settled(3));
  });
});

describe("highlightFor", () => {
  it("marks primary and secondary muscles, ignoring unknown names", () => {
    const h = highlightFor("chest", ["triceps", "not-a-muscle"]);
    assert.equal(h.chest, 2);
    assert.equal(h.triceps, 1);
    assert.equal(Object.keys(h).length, 2);
  });
});
