import * as THREE from "three";

// Procedural surface detail: tileable height fields turned into normal maps,
// and a rubber gym floor. Generated once on the CPU, no image assets.

/** Deterministic 0–1 hash of integer lattice coordinates. */
function hash(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Tileable value noise with `cells` lattice cells across the texture. */
function valueNoise(u: number, v: number, cells: number, seed: number) {
  const x = u * cells;
  const y = v * cells;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const w = (i: number) => ((i % cells) + cells) % cells;
  const a = hash(w(x0), w(y0), seed);
  const b = hash(w(x0 + 1), w(y0), seed);
  const c = hash(w(x0), w(y0 + 1), seed);
  const d = hash(w(x0 + 1), w(y0 + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Tileable cellular noise: distance to the nearest cell border (F2 − F1). */
function cellBorder(u: number, v: number, cells: number, seed: number) {
  const x = u * cells;
  const y = v * cells;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let f1 = Infinity;
  let f2 = Infinity;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i;
      const cy = yi + j;
      const wx = ((cx % cells) + cells) % cells;
      const wy = ((cy % cells) + cells) % cells;
      const px = cx + hash(wx, wy, seed);
      const py = cy + hash(wx, wy, seed + 7);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) f2 = d;
    }
  return f2 - f1;
}

function normalMap(size: number, height: (u: number, v: number) => number, strength: number) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = height(x / size, y / size);
  const data = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const o = (y * size + x) * 4;
      data[o] = ((-dx / l) * 0.5 + 0.5) * 255;
      data[o + 1] = ((-dy / l) * 0.5 + 0.5) * 255;
      data[o + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      data[o + 3] = 255;
    }
  return texture(data, size, false);
}

function texture(data: Uint8Array, size: number, colour: boolean) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  if (colour) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Diamond knurl: two crossed helical grooves, 16 pyramids per tile edge. */
function knurl(u: number, v: number) {
  const n = 16;
  const a = Math.abs(((u + v) * n) % 1 - 0.5) * 2;
  const b = Math.abs((((u - v) * n) % 1 + 1) % 1 - 0.5) * 2;
  return Math.min(a, b);
}

let cache: { powder: THREE.Texture; leather: THREE.Texture; rubber: THREE.Texture; knurl: THREE.Texture } | null = null;

/** Normal maps shared by the equipment materials. */
export function surfaceMaps() {
  return (cache ??= {
    // Powder coat: a fine orange-peel ripple.
    powder: normalMap(128, (u, v) => valueNoise(u, v, 24, 1) * 0.7 + valueNoise(u, v, 48, 2) * 0.3, 1.6),
    // Upholstery: pebbled grain, raised cells with soft grooves between.
    leather: normalMap(256, (u, v) => Math.min(1, cellBorder(u, v, 40, 3) * 3) + valueNoise(u, v, 64, 4) * 0.15, 1.2),
    // Moulded rubber: a soft mottle.
    rubber: normalMap(128, (u, v) => valueNoise(u, v, 16, 5) * 0.6 + valueNoise(u, v, 40, 6) * 0.4, 0.8),
    // Machined steel grip: crossed grooves leaving sharp pyramids.
    knurl: normalMap(256, knurl, 3),
  });
}

/** A copy of a shared map with its own repeat (same image, no new upload). */
export function repeated(t: THREE.Texture, u: number, v: number) {
  const c = t.clone();
  c.repeat.set(u, v);
  c.needsUpdate = true;
  return c;
}

// Seven-segment strokes in a 0–1 cell (x right, y down): a b c d e f g.
const SEGMENTS: [number, number, number, number][] = [
  [0.18, 0.1, 0.82, 0.1],
  [0.82, 0.1, 0.82, 0.5],
  [0.82, 0.5, 0.82, 0.9],
  [0.18, 0.9, 0.82, 0.9],
  [0.18, 0.5, 0.18, 0.9],
  [0.18, 0.1, 0.18, 0.5],
  [0.18, 0.5, 0.82, 0.5],
];
const DIGITS: Record<string, string> = {
  "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc",
  "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcdfg",
};

function segDist(x: number, y: number, [ax, ay, bx, by]: [number, number, number, number]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - dx * t, y - ay - dy * t);
}

const labels = new Map<string, THREE.Texture>();
/**
 * Painted numerals for weight markings: rounded strokes in white on a clear
 * background, `text` of digits. Use as a decal map.
 */
export function labelTexture(text: string) {
  let t = labels.get(text);
  if (t) return t;
  const cw = 48;
  const w = cw * text.length;
  const h = 64;
  // Sized for at least two digits, so "5" and "10" print at the same height.
  const size = 1 << Math.ceil(Math.log2(Math.max(cw * Math.max(2, text.length), h)));
  const data = new Uint8Array(size * size * 4);
  const ox = (size - w) / 2;
  const oy = (size - h) / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = Math.floor((x - ox) / cw);
      const ch = text[i];
      let a = 0;
      if (ch && DIGITS[ch] && y >= oy && y < oy + h) {
        const sx = (x - ox - i * cw) / cw;
        const sy = (y - oy) / h;
        let d = Infinity;
        for (const s of DIGITS[ch]) d = Math.min(d, segDist(sx, sy * 1.35, SEGMENTS[s.charCodeAt(0) - 97].map((c, k) => (k % 2 ? c * 1.35 : c)) as [number, number, number, number]));
        a = Math.max(0, Math.min(1, (0.085 - d) * 60));
      }
      const o = ((size - 1 - y) * size + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = 255;
      data[o + 3] = a * 255;
    }
  t = texture(data, size, true);
  labels.set(text, t);
  return t;
}

/**
 * Rubber gym flooring, one 1 m tile per repeat: a dark base with coloured
 * granule flecks and a seam at the tile edge. Returns colour and roughness.
 */
export function floorTexture(base = "#121821") {
  const size = 512;
  const col = new Uint8Array(size * size * 4);
  const b = new THREE.Color(base);
  const flecks = ["#252D3A", "#323C4C", "#1B222D", "#4A5566", "#55621F"].map((c) => new THREE.Color(c));
  const weights = [0.42, 0.26, 0.2, 0.08, 0.04];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      // Granules about 3 mm: one lattice cell per 1.5 px, flecked at random.
      const g = hash(Math.floor(x / 1.5), Math.floor(y / 1.5), 11);
      let c = b;
      if (g < 0.22) {
        let r = hash(x, y, 12);
        let i = 0;
        while (i < weights.length - 1 && r > weights[i]) r -= weights[i++];
        c = flecks[i];
      }
      const mottle = 0.92 + valueNoise(x / size, y / size, 8, 13) * 0.16;
      const edge = Math.min(x, y, size - 1 - x, size - 1 - y);
      const seam = edge < 1 ? 0.45 : edge < 2 ? 0.75 : 1;
      col[o] = Math.min(255, c.r * 255 * mottle * seam);
      col[o + 1] = Math.min(255, c.g * 255 * mottle * seam);
      col[o + 2] = Math.min(255, c.b * 255 * mottle * seam);
      col[o + 3] = 255;
    }
  // Colour bytes were computed in linear space; store as linear data.
  const t = new THREE.DataTexture(col, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = THREE.LinearSRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
