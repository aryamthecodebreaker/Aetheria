import { BLOCKS, blockDef } from '../../shared/blocks';
import { CHUNK, HEIGHT } from '../../shared/constants';
import { ATLAS_COLUMNS, ATLAS_HEIGHT, ATLAS_WIDTH, PAD, TILE, TILE_STRIDE, paddedIndex, tileIndex } from './layout';
import type { GeometryData, MeshJob, MeshResult } from './layout';

type V = [number, number, number];
type Bounds = [number, number, number, number, number, number];
type Builder = { position: number[]; normal: number[]; uv: number[]; color: number[]; index: number[] };
const directions: V[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const full = BLOCKS.map(b => b.opaque && !b.slab && !b.cross);
const builder = (): Builder => ({ position: [], normal: [], uv: [], color: [], index: [] });
const finish = (b: Builder): GeometryData => ({ position: new Float32Array(b.position), normal: new Float32Array(b.normal), uv: new Float32Array(b.uv), color: new Float32Array(b.color), index: new Uint32Array(b.index) });

export function meshChunk(job: MeshJob): MeshResult {
  const solid = builder(), water = builder();
  const get = (x: number, y: number, z: number) => y < 0 || y >= HEIGHT || x < -1 || x > CHUNK || z < -1 || z > CHUNK ? 0 : job.data[paddedIndex(x, y, z)];
  const occludes = (x: number, y: number, z: number) => full[get(x, y, z)] ? 1 : 0;
  const sky = new Int16Array(PAD * PAD).fill(-1);
  for (let z = -1; z <= CHUNK; z++) for (let x = -1; x <= CHUNK; x++) {
    for (let y = HEIGHT - 1; y >= 0; y--) if (occludes(x, y, z)) { sky[x + 1 + (z + 1) * PAD] = y; break; }
  }
  const quad = (out: Builder, points: V[], n: V, id: number, face: number, x: number, y: number, z: number, ao: boolean, double = false) => {
    const base = out.position.length / 3, tile = tileIndex(id, face);
    const u0 = ((tile % ATLAS_COLUMNS) * TILE_STRIDE + 1 + 0.5) / ATLAS_WIDTH;
    const v0 = 1 - (Math.floor(tile / ATLAS_COLUMNS) * TILE_STRIDE + 1 + TILE - 0.5) / ATLAS_HEIGHT;
    const du = (TILE - 1) / ATLAS_WIDTH, dv = (TILE - 1) / ATLAS_HEIGHT;
    const axes = [0, 1, 2].filter(a => n[a] === 0);
    const shades: number[] = [];
    const light = blockDef(id).light ?? 0;
    const column = sky[x + 1 + (z + 1) * PAD];
    const daylight = (0.67 + y / HEIGHT * 0.3) * (y >= column ? 1 : 0.58);
    const directional = face === 2 ? 1 : face === 3 ? 0.52 : face === 0 || face === 1 ? 0.78 : 0.88;
    for (let i = 0; i < 4; i++) {
      const p = points[i];
      let shade = daylight * directional;
      if (ao && axes.length === 2) {
        const a = axes[0], b = axes[1];
        const center: V = [x + n[0], y + n[1], z + n[2]];
        const sa = p[a] - [x, y, z][a] < 0.5 ? -1 : 1;
        const sb = p[b] - [x, y, z][b] < 0.5 ? -1 : 1;
        const sideA = [...center] as V, sideB = [...center] as V, corner = [...center] as V;
        sideA[a] += sa; sideB[b] += sb; corner[a] += sa; corner[b] += sb;
        const oa = occludes(...sideA), ob = occludes(...sideB), oc = occludes(...corner);
        shade *= 1 - (oa && ob ? 3 : oa + ob + oc) * 0.16;
      }
      shade = Math.max(shade, light > 0 ? 0.75 + light / 40 : 0.18);
      shades.push(shade);
      out.position.push(...p); out.normal.push(...n);
      out.uv.push(u0 + (i === 1 || i === 2 ? du : 0), v0 + (i >= 2 ? dv : 0));
      out.color.push(shade, shade, shade);
    }
    const order = shades[0] + shades[2] > shades[1] + shades[3] ? [0, 1, 3, 1, 2, 3] : [0, 1, 2, 0, 2, 3];
    for (const i of order) out.index.push(base + i);
    if (double) {
      const back = out.position.length / 3;
      for (let i = 0; i < 4; i++) {
        out.position.push(...points[i]); out.normal.push(-n[0], -n[1], -n[2]);
        out.uv.push(out.uv[(base + i) * 2], out.uv[(base + i) * 2 + 1]);
        out.color.push(shades[i], shades[i], shades[i]);
      }
      for (let i = 0; i < order.length; i += 3) out.index.push(back + order[i], back + order[i + 2], back + order[i + 1]);
    }
  };
  const box = (out: Builder, id: number, x: number, y: number, z: number, bounds: Bounds, cull: boolean) => {
    for (let f = 0; f < 6; f++) {
      const n = directions[f];
      let [x0, y0, z0, x1, y1, z1] = bounds;
      const neighbor = get(x + n[0], y + n[1], z + n[2]);
      const nb = blockDef(neighbor), block = blockDef(id);
      const edge = f === 0 ? x1 === 1 : f === 1 ? x0 === 0 : f === 2 ? y1 === 1 : f === 3 ? y0 === 0 : f === 4 ? z1 === 1 : z0 === 0;
      if (cull && edge) {
        if (full[neighbor]) continue;
        if (neighbor === id && !block.slab && !block.cross) continue;
        if (nb.slab) {
          if (f === 2) continue;
          if (f !== 3) { y0 = Math.max(y0, 0.5); if (y0 >= y1) continue; }
        }
      }
      if (block.liquid && f === 2 && nb.liquid) continue;
      x0 += x; x1 += x; y0 += y; y1 += y; z0 += z; z1 += z;
      const points: V[] = f === 0 ? [[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1]]
        : f === 1 ? [[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0]]
        : f === 2 ? [[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0]]
        : f === 3 ? [[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]]
        : f === 4 ? [[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]]
        : [[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0]];
      quad(out, points, n, id, f, x, y, z, cull && !block.liquid && !block.slab);
    }
  };
  for (let y = 0; y < HEIGHT; y++) for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
    const id = get(x, y, z), b = blockDef(id);
    if (!id || !b.id) continue;
    if (b.name === 'torch') {
      box(solid, id, x, y, z, [0.43, 0, 0.43, 0.57, 0.72, 0.57], false);
    } else if (b.name === 'door' || b.name === 'door open') {
      box(solid, id, x,y,z, b.name === 'door' ? [0,0,0.4,1,1,0.6] : [0,0,0,0.2,1,1], false);
    } else if (b.cross) {
      const h = b.crop ? b.name === 'crop young' ? 0.25 : b.name === 'crop middle' ? 0.5 : 0.85 : 0.9, q = Math.SQRT1_2;
      quad(solid, [[x+0.1,y,z+0.1],[x+0.9,y,z+0.9],[x+0.9,y+h,z+0.9],[x+0.1,y+h,z+0.1]], [-q,0,q], id, 4, x,y,z,false,true);
      quad(solid, [[x+0.9,y,z+0.1],[x+0.1,y,z+0.9],[x+0.1,y+h,z+0.9],[x+0.9,y+h,z+0.1]], [-q,0,-q], id, 4, x,y,z,false,true);
    } else if (b.liquid) {
      box(water, id, x, y, z, [0,0,0,1,get(x,y+1,z) ? 1 : 0.88,1], true);
    } else if (b.name === 'wire') {
      box(solid, id, x,y,z, [0,0,0.43,1,0.045,0.57], false);
      box(solid, id, x,y,z, [0.43,0,0,0.57,0.045,1], false);
    } else if (b.name === 'lever') {
      box(solid, id, x,y,z, [0.4,0,0.4,0.6,0.5,0.6], false);
    } else if (b.name === 'fence') {
      box(solid, id, x,y,z, [0.36,0,0.36,0.64,1,0.64], false);
      box(solid, id, x,y,z, [0,0.28,0.44,1,0.4,0.56], false);
      box(solid, id, x,y,z, [0,0.7,0.44,1,0.82,0.56], false);
    } else {
      box(solid, id, x,y,z, [0,0,0,1,b.slab ? 0.5 : 1,1], true);
    }
  }
  return { key: job.key, revision: job.revision, solid: finish(solid), water: finish(water) };
}
