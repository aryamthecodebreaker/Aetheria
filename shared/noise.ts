export function hash2(x: number, y: number, seed: number) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = (h ^ (h >>> 13)) | 0; h = Math.imul(h, 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function hash3(x: number, y: number, z: number, seed: number) {
  return hash2(x, y, seed ^ Math.imul(z, 1597334677));
}
export function seedNum(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h | 0; }
const fade = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function valueNoise2(x: number, y: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = fade(xf), v = fade(yf);
  return lerp(lerp(hash2(xi, yi, seed), hash2(xi + 1, yi, seed), u), lerp(hash2(xi, yi + 1, seed), hash2(xi + 1, yi + 1, seed), u), v);
}
export function valueNoise3(x: number, y: number, z: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
  const a = lerp(lerp(hash3(xi, yi, zi, seed), hash3(xi + 1, yi, zi, seed), u), lerp(hash3(xi, yi + 1, zi, seed), hash3(xi + 1, yi + 1, zi, seed), u), v);
  const b = lerp(lerp(hash3(xi, yi, zi + 1, seed), hash3(xi + 1, yi, zi + 1, seed), u), lerp(hash3(xi, yi + 1, zi + 1, seed), hash3(xi + 1, yi + 1, zi + 1, seed), u), v);
  return lerp(a, b, w);
}
export function fbm2(x: number, y: number, seed: number, octaves = 4, lac = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) { sum += amp * valueNoise2(x * freq, y * freq, seed + o * 1013); norm += amp; amp *= gain; freq *= lac; }
  return sum / norm;
}
export function ridge2(x: number, y: number, seed: number, octaves = 4) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) { sum += amp * (1 - Math.abs(2 * valueNoise2(x * freq, y * freq, seed + o * 601) - 1)); norm += amp; amp *= 0.5; freq *= 2; }
  return sum / norm;
}
export function rng(seed: number) { let s = seed | 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s |= 0; return ((s >>> 0) + 1) / 4294967297; }; }
