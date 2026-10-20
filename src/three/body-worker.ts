import { buildBody } from "./body.js";

// Builds the body mesh off the main thread (see preloadBody in figure.ts) and
// hands the buffers back without copying them.

const b = buildBody();
const transfer = [b.position, b.normal, b.index, b.skinIndex, b.skinWeight, b.paints, b.muscleA, b.weightA, b.muscleB, b.weightB, b.flexChannel, b.flexA, b.flexB].map(
  (a) => a.buffer,
);
(self as unknown as { postMessage(message: unknown, transfer: ArrayBufferLike[]): void }).postMessage(b, transfer);
