// A seeded, animated raster field with an optional authored GPU preview.
// Three independent four-octave fields supply two domain-warp coordinates and
// the final two-color ramp. Integer lattice addresses keep sampling independent
// of draw order and raster resolution. CPU drawing remains the reference.
'use strict';

const W = 960;
const H = 540;

// Multiplication wraps at 32 bits on both paths. Keep the high 24 bits so every
// hash sample is exactly representable by WGSL's float32 arithmetic.
function lattice(seed, x, y, salt) {
  let h = seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77) ^ salt;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 8) / 16777216;
}

function valueNoise(seed, x, y, salt) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = lattice(seed, ix, iy, salt), b = lattice(seed, ix + 1, iy, salt);
  const c = lattice(seed, ix, iy + 1, salt), d = lattice(seed, ix + 1, iy + 1, salt);
  const top = a + (b - a) * ux, bottom = c + (d - c) * ux;
  return top + (bottom - top) * uy;
}

function field(seed, x, y, salt, prepared) {
  let sum = 0;
  for (let octave = 0; octave < prepared.weights.length; octave++) {
    const frequency = prepared.frequencies[octave];
    sum += prepared.weights[octave] * valueNoise(seed, x * frequency, y * frequency,
      salt ^ Math.imul(octave, 0x632be5ab));
  }
  return sum / prepared.normalization;
}

// This is the same authored arithmetic as the CPU field below. Float32 shader
// evaluation is approximate; native pixel comparisons establish its tolerance.
const WGSL = `
fn pfHash(cell: vec2i, salt: u32) -> f32 {
  var h = artifex.seed ^ (bitcast<u32>(cell.x) * 0x9e3779b1u)
    ^ (bitcast<u32>(cell.y) * 0x85ebca77u) ^ salt;
  h = (h ^ (h >> 16u)) * 0x7feb352du;
  h = (h ^ (h >> 15u)) * 0x846ca68bu;
  return f32((h ^ (h >> 16u)) >> 8u) / 16777216.0;
}

fn pfNoise(p: vec2f, salt: u32) -> f32 {
  let cell = vec2i(floor(p));
  let f = p - vec2f(cell);
  let u = f * f * (vec2f(3.0) - 2.0 * f);
  let a = pfHash(cell, salt);
  let b = pfHash(cell + vec2i(1, 0), salt);
  let c = pfHash(cell + vec2i(0, 1), salt);
  let d = pfHash(cell + vec2i(1, 1), salt);
  let top = a + (b - a) * u.x;
  let bottom = c + (d - c) * u.x;
  return top + (bottom - top) * u.y;
}

fn pfField(start: vec2f, salt: u32) -> f32 {
  var sum = 0.0;
  for (var octave = 0u; octave < 4u; octave++) {
    sum += artifex.values[1][octave] * pfNoise(start * artifex.values[2][octave],
      salt ^ (octave * 0x632be5abu));
  }
  return sum / artifex.values[0].z;
}

fn artifexPixel(position: vec2f) -> vec3f {
  let uv = position / vec2f(artifex.size);
  let frequency = artifex.values[0].x;
  let warp = artifex.values[0].y;
  let seconds = artifex.time.y;
  let p = vec2f((uv.x - 0.5) * (artifex.time.z / artifex.time.w), uv.y - 0.5)
    * frequency + vec2f(seconds * 0.125, seconds * -0.0625);
  let wx = pfField(p * 0.5 + vec2f(17.0, 29.0), 0xa511e9b3u) - 0.5;
  let wy = pfField(p * 0.5 + vec2f(-43.0, 7.0), 0x63d83595u) - 0.5;
  let n = pfField(p + warp * vec2f(wx, wy), 0xb5297a4du);
  let ramp = clamp((n - 0.2) / 0.6, 0.0, 1.0);
  let shade = ramp * ramp * (3.0 - 2.0 * ramp);
  // The palette is authored directly in encoded sRGB, as required by the ABI.
  return (vec3f(20.0, 28.0, 52.0) + vec3f(222.0, 154.0, 52.0) * shade) / 255.0;
}
`;

module.exports = {
  name: 'pixel-field',
  size: { w: W, h: H },
  seed: 1,
  time: { duration: 8, hz: 30, loop: false },
  outputs: ['raster'],
  params: {
    frequency: { min: 2, max: 12, value: 5, meaning: 'Spatial frequency of the flowing field' },
    warp: { min: 0, max: 2, value: 0.9, meaning: 'Strength of the field coordinate distortion' },
  },
  build: [['prepare field octaves', (s) => {
    const weights = [], frequencies = [];
    let weight = 0.5, frequency = 1, normalization = 0;
    for (let octave = 0; octave < 4; octave++) {
      weights.push(weight); frequencies.push(frequency); normalization += weight;
      weight *= 0.5; frequency *= 2;
    }
    // Both renderers consume this inspectable, immutable spectral preparation.
    s.field = Object.freeze({ weights: Object.freeze(weights), frequencies: Object.freeze(frequencies), normalization });
  }]],
  preview: {
    kind: 'webgpu-pixels',
    wgsl: WGSL,
    uniforms: (s) => [s.params.frequency, s.params.warp, s.field.normalization, 0,
      ...s.field.weights, ...s.field.frequencies],
  },
  draw(g, s, _t, clock) {
    // putImageData writes backing pixels and ignores Canvas2D transforms. A
    // real canvas supplies its actual rounded dimensions; diagnostic surfaces
    // without a canvas supply their current scale through getTransform().
    const m = g.getTransform ? g.getTransform() : { a: 1, b: 0, c: 0, d: 1 };
    const width = g.canvas ? g.canvas.width : Math.max(1, Math.round(W * Math.hypot(m.a, m.b)));
    const height = g.canvas ? g.canvas.height : Math.max(1, Math.round(H * Math.hypot(m.c, m.d)));
    const image = g.createImageData(width, height);
    const pixels = image.data;
    // Match float32 uniform inputs, while retaining JS reference arithmetic.
    const frequency = Math.fround(s.params.frequency), warp = Math.fround(s.params.warp);
    const seconds = Math.fround(clock.seconds), seed = s.seed;
    for (let y = 0; y < height; y++) {
      const py = ((y + 0.5) / height - 0.5) * frequency - seconds * 0.0625;
      for (let x = 0; x < width; x++) {
        const px = ((x + 0.5) / width - 0.5) * (W / H) * frequency + seconds * 0.125;
        const wx = field(seed, px * 0.5 + 17, py * 0.5 + 29, 0xa511e9b3, s.field) - 0.5;
        const wy = field(seed, px * 0.5 - 43, py * 0.5 + 7, 0x63d83595, s.field) - 0.5;
        const n = field(seed, px + warp * wx, py + warp * wy, 0xb5297a4d, s.field);
        const ramp = Math.max(0, Math.min(1, (n - 0.2) / 0.6));
        const shade = ramp * ramp * (3 - 2 * ramp);
        const i = (y * width + x) * 4;
        pixels[i] = Math.round(20 + 222 * shade);
        pixels[i + 1] = Math.round(28 + 154 * shade);
        pixels[i + 2] = Math.round(52 + 52 * shade);
        pixels[i + 3] = 255;
      }
    }
    g.putImageData(image, 0, 0);
  },
};
