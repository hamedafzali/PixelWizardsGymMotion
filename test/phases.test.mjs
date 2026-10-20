import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MOTIONS, checkPhases, cycleLength, peakTime, phasesOf, positionsOf, resolveMotion, sample, withTempo } from "../dist/index.js";

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const at = (y) => ({ pelvis: [0, y, 0], torso: [0, 0, 0], hands: [[0.3, y, 0.2], [-0.3, y, 0.2]], feet: [[0.1, 0.1, 0], [-0.1, 0.1, 0]] });
const keys = [at(1), at(0.8), at(0.6)];
const still = { alive: false };

describe("phases", () => {
  it("plays an old-style motion as go, hold, return, rest", () => {
    const old = { keys, kind: "rep", effort: "first", cues: ["Up", "Down"], tempo: [1, 0.5, 2, 0.5] };
    const ps = phasesOf(old);
    assert.deepEqual(ps.map((p) => p.name), ["go", "hold", "return", "rest"]);
    assert.deepEqual(ps.map((p) => p.time), [1, 0.5, 2, 0.5]);
    assert.equal(cycleLength(old), 4);
    assert.ok(dist(sample(old, 0, undefined, still).pose.pelvis, keys[0].pelvis) < 1e-9);
    assert.ok(dist(sample(old, 1.2, undefined, still).pose.pelvis, keys[2].pelvis) < 1e-9);
    assert.ok(dist(sample(old, 3.8, undefined, still).pose.pelvis, keys[0].pelvis) < 1e-9);
    const f = sample(old, 0.5);
    assert.equal(f.cue, "Up");
    assert.equal(f.phaseName, "go");
    assert.ok(f.working && f.pulse > 0.99);
    assert.equal(sample(old, 1.25).working, false);
    assert.equal(sample(old, 2).cue, "Down");
    // The old effort "second" puts the load's rest at the far end.
    const second = { ...old, effort: "second" };
    assert.equal(sample(second, 0).load, 1);
    assert.equal(sample(second, 1.2).load, 0);
  });

  it("names positions and holds between moves", () => {
    const m = {
      keys,
      kind: "rep",
      positions: { quarter: 0.25 },
      phases: [
        { name: "down", to: "quarter", time: 1, cue: "Sink", effort: 0.4 },
        { name: "pause", time: 2, effort: 0.8 },
        { name: "deep", to: "end", time: 1 },
        { name: "up", to: "start", time: 1, cue: "Drive", effort: 1 },
      ],
    };
    const ps = phasesOf(m);
    assert.deepEqual(ps.map((p) => [p.from, p.to]), [[0, 0.25], [0.25, 0.25], [0.25, 1], [1, 0]]);
    assert.deepEqual(ps.map((p) => p.start), [0, 1, 3, 4]);
    assert.equal(ps[1].cue, "Sink", "a missing cue carries over");
    assert.deepEqual(ps.map((p) => p.breath), ["out", "hold", "in", "out"]);
    const a = sample(m, 1.2, undefined, still).pose.pelvis;
    const b = sample(m, 2.8, undefined, still).pose.pelvis;
    assert.ok(dist(a, b) < 1e-9, "the pause holds still");
    const f = sample(m, 2);
    assert.equal(f.phaseIndex, 1);
    assert.equal(f.phaseName, "pause");
    assert.equal(f.effort, 0.8);
    assert.equal(f.working, true);
    assert.ok(Math.abs(f.phase - 0.5) < 1e-9);
    assert.equal(sample(m, 5 * 3 + 0.1).rep, 3);
    assert.equal(peakTime(m), 4, "the far end is reached at the end of 'deep'");
    assert.equal(positionsOf(m).quarter, 0.25);
  });

  it("reports what is wrong with bad phases", () => {
    const bad = {
      keys,
      kind: "rep",
      phases: [{ to: "nowhere", time: 1 }, { to: 1.5, time: -1 }, { name: "x", time: 0, effort: 2, keys: [] }],
    };
    const errors = checkPhases(bad);
    assert.ok(errors.some((e) => e.includes('unknown position "nowhere"') && e.includes("start, mid, end")));
    assert.ok(errors.some((e) => e.includes("outside 0 → 1")));
    assert.ok(errors.some((e) => e.includes("time must be")));
    assert.ok(errors.some((e) => e.startsWith("phase 3 (x): effort")));
    assert.ok(errors.some((e) => e.includes("keys must hold")));
    assert.deepEqual(checkPhases({ keys, kind: "rep", phases: [] }), ["a motion needs at least one phase"]);
    assert.deepEqual(checkPhases({ keys, kind: "rep", phases: [{ to: 1, time: 0 }] }), ["the phases must take some time"]);
    assert.throws(() => phasesOf(bad), /Invalid motion phases/);
    assert.throws(() => resolveMotion({ pattern: "squat", phases: [{ to: "nowhere", time: 1 }] }), /squat: .*nowhere/);
  });

  it("wraps loops forwards", () => {
    const m = { keys, kind: "loop", phases: [{ to: 0.5, time: 1, effort: 1 }, { to: 0, time: 1, effort: 1 }] };
    const ps = phasesOf(m);
    assert.deepEqual(ps.map((p) => [p.from, p.to]), [[0, 0.5], [0.5, 1]]);
    assert.equal(ps[0].breath, undefined, "loops breathe freely");
    assert.equal(sample(m, 0.5).load, 0);
    assert.equal(peakTime(m), 0);
    const a = sample(m, 0, undefined, still).pose.pelvis;
    const b = sample(m, 2 - 1e-9, undefined, still).pose.pelvis;
    assert.ok(dist(a, b) < 1e-6, "a lap ends where it began");
  });

  it("plays a phase's own keys", () => {
    const wave = [at(1), at(1.3), at(1)];
    const m = { keys, kind: "rep", phases: [{ to: 1, time: 1 }, { name: "wave", time: 1, keys: wave }, { to: 0, time: 1 }] };
    assert.ok(dist(sample(m, 1.5, undefined, still).pose.pelvis, [0, 1.3, 0]) < 1e-9);
  });

  it("times only the standard four phases from a tempo", () => {
    const { motion } = resolveMotion(MOTIONS["e-squat"]);
    const timed = withTempo(motion, [2, 1, 2, 1]);
    assert.deepEqual(phasesOf(timed).map((p) => p.time), [2, 1, 2, 1]);
    assert.equal(cycleLength(motion, [2, 1, 2, 1]), 6);
    const custom = { keys, kind: "rep", phases: [{ to: 1, time: 1 }, { to: 0, time: 1 }] };
    assert.equal(withTempo(custom, [2, 1, 2, 1]), custom);
    const old = { keys, kind: "rep", effort: "first" };
    assert.deepEqual(withTempo(old, [2, 1, 2, 1]).tempo, [2, 1, 2, 1]);
  });

  it("lets a spec replace a pattern's phases", () => {
    const { motion } = resolveMotion({
      pattern: "squat",
      positions: { parallel: 0.8 },
      phases: [
        { name: "sit", to: "parallel", time: 2, cue: "Sit back" },
        { name: "pause", time: 1, cue: "Stay tight", effort: 0.6 },
        { name: "stand", to: "start", time: 1, cue: "Drive up", effort: 1 },
      ],
    });
    assert.equal(cycleLength(motion), 4);
    assert.equal(sample(motion, 2.5).cue, "Stay tight");
    assert.equal(positionsOf(motion).parallel, 0.8);
  });

  it("gives the burpee and thruster their own parts", () => {
    const burpee = resolveMotion({ pattern: "burpee" }).motion;
    assert.equal(phasesOf(burpee).length, 7);
    assert.ok(Math.abs(cycleLength(burpee) - 4.1) < 1e-9);
    const thruster = resolveMotion({ pattern: "thruster" }).motion;
    assert.deepEqual(phasesOf(thruster).map((p) => p.name), ["lower", "squat", "hold", "drive", "press", "rest"]);
    assert.equal(sample(thruster, 2.2).phaseName, "drive");
    assert.equal(sample(thruster, 2.2).working, true);
  });

  it("every catalog motion passes its own checks", () => {
    for (const [id, spec] of Object.entries(MOTIONS)) assert.deepEqual(checkPhases(resolveMotion(spec).motion), [], id);
  });
});
