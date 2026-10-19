// pixelwizards-gym-motion — core. Pure data and maths, no dependencies:
// exercise catalog → movement pattern → key poses → timeline → solved skeleton.
// Draw the skeleton yourself, or use the three.js renderer in `/three`.

export * from "./types.js";
export { MUSCLES, highlightFor, type Highlight, type Level } from "./muscles.js";
export { MOTIONS, MACHINE, DEVICE, EXERCISE_IDS, motionSpecFor, resolveMotion } from "./catalog.js";
export { buildMotion, PATTERN_IDS } from "./patterns.js";
export { solve, anchorPoint, BODY, frameOf, type Skeleton } from "./rig.js";
export { sample, cycleLength, lerpPose, type Frame } from "./timeline.js";
export { Spring, type SpringSpec } from "./spring.js";
