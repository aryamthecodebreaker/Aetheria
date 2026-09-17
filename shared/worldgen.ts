import { CHUNK, HEIGHT, SEA, chunkCoord, index, localCoord } from './constants';
import { fbm2, hash2, hash3, seedNum, valueNoise3 } from './noise';
import { BLOCK, blockDef } from './blocks';
import type { Realm, Vec3 } from './types';

export type Biome = 'meadow' | 'forest' | 'birchwood' | 'desert' | 'tundra' | 'mountains' | 'ocean' | 'beach' | 'swamp' | 'savanna' | 'cavern' | 'island' | 'void';
export type ColumnInfo = { biome: Biome; height: number; bottom?: number; ceiling?: number };
export type Structure = { kind: 'settlement' | 'ruin'; x: number; y: number; z: number; radius: number };
export type Tree = { x: number; y: number; z: number; height: number };

export class WorldGen {
  seed: number;
  private spawns = new Map<Realm, Vec3>();
  constructor(seed: string) { this.seed = seedNum(seed); }

  column(cx: number, cz: number, lx: number, lz: number, realm: Realm = 'verdant'): ColumnInfo {
    const x = Math.floor(cx * CHUNK + lx), z = Math.floor(cz * CHUNK + lz);
    if (realm === 'cinder') {
      return {
        biome: 'cavern',
        height: Math.round(13 + fbm2(x * 0.025, z * 0.025, this.seed + 610, 3) * 19),
        ceiling: Math.round(59 + fbm2(x * 0.018, z * 0.018, this.seed + 611, 3) * 13)
      };
    }
    if (realm === 'aether') {
      let height = -1, bottom = -1;
      const cellX = Math.floor(x / 64), cellZ = Math.floor(z / 64);
      for (let ix = cellX - 1; ix <= cellX + 1; ix++) for (let iz = cellZ - 1; iz <= cellZ + 1; iz++) {
        const home = ix === 0 && iz === 0;
        const ax = home ? 0 : ix * 64 + 12 + hash2(ix, iz, this.seed + 710) * 40;
        const az = home ? 0 : iz * 64 + 12 + hash2(ix, iz, this.seed + 711) * 40;
        const radius = 19 + hash2(ix, iz, this.seed + 712) * 11;
        const shape = 1 - ((x - ax) / radius) ** 2 - ((z - az) / (radius * 0.85)) ** 2;
        if (shape <= 0.08) continue;
        const top = Math.round(44 + hash2(ix, iz, this.seed + 713) * 17 + shape * 4 + fbm2(x * 0.07, z * 0.07, this.seed + 714, 2) * 3);
        if (top > height) { height = top; bottom = top - 3 - Math.round(shape * 17); }
      }
      return { biome: height < 0 ? 'void' : 'island', height, bottom };
    }
    const continent = fbm2(x * 0.004, z * 0.004, this.seed, 4);
    const hills = fbm2(x * 0.025, z * 0.025, this.seed + 77, 3);
    const mountains = Math.max(0, continent - 0.62) * 55;
    let base = SEA - 19 + continent * 43 + (hills - 0.5) * 12 + mountains;
    const home = Math.max(0, 1 - Math.hypot(x, z) / 64);
    base = Math.max(base, SEA + 5 + hills * 3 - (1 - home) * 24);
    const height = Math.max(5, Math.min(HEIGHT - 12, Math.round(base)));
    const temp = fbm2(x * 0.003, z * 0.003, this.seed + 333, 3);
    const humidity = fbm2(x * 0.005, z * 0.005, this.seed + 555, 3);
    let biome: Biome = 'meadow';
    if (height < SEA - 2) biome = 'ocean';
    else if (height <= SEA + 1) biome = 'beach';
    else if (height > 52) biome = 'mountains';
    else if (temp < 0.27) biome = 'tundra';
    else if (temp > 0.7 && humidity < 0.43) biome = 'desert';
    else if (temp > 0.62 && humidity < 0.48) biome = 'savanna';
    else if (humidity > 0.7 && height < SEA + 5) biome = 'swamp';
    else if (humidity > 0.48) biome = 'forest';
    else if (humidity > 0.41) biome = 'birchwood';
    return { biome, height };
  }

  surface(x: number, z: number, realm: Realm = 'verdant'): number {
    return this.column(0, 0, x, z, realm).height;
  }

  structureAt(cellX: number, cellZ: number): Structure | null {
    const x = cellX * 128 + 24 + Math.floor(hash2(cellX, cellZ, this.seed + 800) * 80);
    const z = cellZ * 128 + 24 + Math.floor(hash2(cellX, cellZ, this.seed + 801) * 80);
    const kind = hash2(cellX, cellZ, this.seed + 802) > 0.48 ? 'settlement' : 'ruin';
    const radius = kind === 'settlement' ? 14 : 5;
    const y = this.surface(x, z);
    if (y <= SEA + 2 || y > HEIGHT - 10) return null;
    for (const dx of [-radius, 0, radius]) for (const dz of [-radius, 0, radius]) {
      const h = this.surface(x + dx, z + dz);
      if (h <= SEA || Math.abs(h - y) > 4) return null;
    }
    return { kind, x, y, z, radius };
  }

  structures(cx: number, cz: number): Structure[] {
    const out: Structure[] = [];
    const x = cx * CHUNK, z = cz * CHUNK;
    for (let ix = Math.floor((x - 18) / 128); ix <= Math.floor((x + CHUNK + 18) / 128); ix++) {
      for (let iz = Math.floor((z - 18) / 128); iz <= Math.floor((z + CHUNK + 18) / 128); iz++) {
        const s = this.structureAt(ix, iz);
        if (s && s.x + s.radius + 4 >= x && s.x - s.radius - 4 < x + CHUNK && s.z + s.radius + 4 >= z && s.z - s.radius - 4 < z + CHUNK) out.push(s);
      }
    }
    return out;
  }

  treeAt(x: number, z: number): Tree | null {
    const r = hash2(x, z, this.seed + 31337);
    if (r < 0.965) return null;
    const { biome, height } = this.column(0, 0, x, z);
    const threshold = biome === 'forest' || biome === 'birchwood' ? 0.965 : biome === 'meadow' ? 0.993 : 1;
    if (r < threshold || height <= SEA + 1 || height > HEIGHT - 10) return null;
    for (let ix = Math.floor((x - 18) / 128); ix <= Math.floor((x + 18) / 128); ix++) {
      for (let iz = Math.floor((z - 18) / 128); iz <= Math.floor((z + 18) / 128); iz++) {
        const s = this.structureAt(ix, iz);
        if (s && Math.abs(x - s.x) <= s.radius + 3 && Math.abs(z - s.z) <= s.radius + 3) return null;
      }
    }
    return { x, y: height + 1, z, height: 4 + Math.floor(hash2(x, z, this.seed + 31338) * 3) };
  }

  chunk(cx: number, cz: number, realm: Realm = 'verdant'): Uint16Array {
    const data = new Uint16Array(CHUNK * HEIGHT * CHUNK);
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const put = (x: number, y: number, z: number, id: number) => {
      x -= ox; z -= oz;
      if (x >= 0 && x < CHUNK && z >= 0 && z < CHUNK && y >= 0 && y < HEIGHT) data[index(x, y, z)] = id;
    };
    for (let lx = 0; lx < CHUNK; lx++) for (let lz = 0; lz < CHUNK; lz++) {
      const x = ox + lx, z = oz + lz;
      const { biome, height, bottom = 0, ceiling = HEIGHT } = this.column(cx, cz, lx, lz, realm);
      const pillar = realm === 'cinder' && Math.hypot(x, z) > 8 && fbm2(x * 0.045, z * 0.045, this.seed + 612, 2) > 0.76;
      const magma = realm === 'cinder' && Math.hypot(x, z) > 8 && height < 22 && fbm2(x * 0.08, z * 0.08, this.seed + 613, 2) > 0.58;
      for (let y = 0; y < HEIGHT; y++) {
        let b = BLOCK.AIR;
        const depth = height - y;
        if (realm === 'cinder') {
          if (y === 0 || y === HEIGHT - 1) b = BLOCK.BEDROCK;
          else if (y <= height || y >= ceiling || pillar) {
            b = y === height && !pillar ? (magma ? BLOCK.MAGMA : BLOCK.CINDER_ASH) : BLOCK.CINDERSTONE;
            if (b === BLOCK.CINDERSTONE) {
              const ore = hash3(x, y, z, this.seed + 620);
              if (ore > 0.985) b = BLOCK.RADIANT_ORE;
              else if (ore > 0.975) b = BLOCK.GOLD_ORE;
              else if (ore < 0.018) b = BLOCK.MAGMA;
            }
          }
        } else if (realm === 'aether') {
          if (height >= 0 && y >= bottom && y <= height) {
            b = depth === 0 ? BLOCK.GRASS : depth < 3 ? BLOCK.DIRT : BLOCK.AETHERSTONE;
            if (depth >= 3 && hash3(x, y, z, this.seed + 720) > 0.979) b = BLOCK.VERDANT_CRYSTAL;
          }
        } else if (y === 0) b = BLOCK.BEDROCK;
        else if (y <= height) {
          const sandy = biome === 'beach' || biome === 'desert' || biome === 'ocean';
          if (depth === 0) b = sandy ? (height < SEA - 4 ? BLOCK.GRAVEL : BLOCK.SAND) : biome === 'tundra' ? BLOCK.SNOW : biome === 'mountains' ? BLOCK.STONE : BLOCK.GRASS;
          else if (depth < 4) b = sandy ? BLOCK.SAND : BLOCK.DIRT;
          else b = BLOCK.STONE;
          if (y > 3 && depth > 5 && valueNoise3(x * 0.065, y * 0.09, z * 0.065, this.seed + 900) > 0.67) b = BLOCK.AIR;
          if (b === BLOCK.STONE) {
            const ore = hash3(x, y, z, this.seed + 4242);
            if (y < 14 && ore > 0.995) b = BLOCK.SAPPHIRE_ORE;
            else if (y < 25 && ore > 0.989) b = BLOCK.GOLD_ORE;
            else if (ore > 0.979) b = BLOCK.IRON_ORE;
            else if (ore > 0.967) b = BLOCK.COPPER_ORE;
            else if (ore > 0.95) b = BLOCK.COAL_ORE;
          }
        } else if (y <= SEA) b = BLOCK.WATER;
        data[index(lx, y, lz)] = b;
      }
      if (height < 0 || height + 1 >= HEIGHT || data[index(lx, height + 1, lz)] !== BLOCK.AIR) continue;
      const r = hash2(x, z, this.seed + 330);
      const ground = data[index(lx, height, lz)];
      if (realm === 'aether' && r > 0.82) put(x, height + 1, z, BLOCK.GLOW_LILY);
      else if (realm === 'cinder' && ground === BLOCK.CINDER_ASH && r > 0.92) put(x, height + 1, z, BLOCK.EMBER_BLOOM);
      else if (realm === 'verdant' && ground === BLOCK.GRASS) {
        if (r > 0.85) put(x, height + 1, z, BLOCK.TALLGRASS);
        else if (r > 0.81) put(x, height + 1, z, BLOCK.FLOWER);
      } else if (biome === 'desert' && r > 0.989) {
        for (let dy = 1; dy <= 3; dy++) put(x, height + dy, z, BLOCK.CACTUS);
      }
    }
    if (realm === 'verdant') {
      for (let x = ox - 2; x < ox + CHUNK + 2; x++) for (let z = oz - 2; z < oz + CHUNK + 2; z++) {
        const tree = this.treeAt(x, z);
        if (tree) this.tree(data, x - ox, tree.y, z - oz, (tree.height - 4) / 100, false);
      }
      for (const structure of this.structures(cx, cz)) this.buildStructure(structure, put);
    }
    return data;
  }

  tree(data: Uint16Array, lx: number, y: number, lz: number, r: number, _birch: boolean) {
    const h = 4 + Math.floor(r * 100) % 3;
    const place = (x: number, yy: number, z: number, id: number) => {
      if (x < 0 || x >= CHUNK || z < 0 || z >= CHUNK || yy < 0 || yy >= HEIGHT) return;
      const i = index(x, yy, z), old = data[i];
      if (old === BLOCK.AIR || old === BLOCK.TALLGRASS || old === BLOCK.FLOWER || (id === BLOCK.LOG && old === BLOCK.LEAVES)) data[i] = id;
    };
    for (let dy = 0; dy < h; dy++) place(lx, y + dy, lz, BLOCK.LOG);
    for (let dy = h - 2; dy <= h + 1; dy++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      if (Math.abs(dx) + Math.abs(dz) + Math.abs(dy - h) <= 3) place(lx + dx, y + dy, lz + dz, BLOCK.LEAVES);
    }
  }

  private buildStructure(s: Structure, put: (x: number, y: number, z: number, id: number) => void) {
    const foundation = (x: number, z: number, top: number, id: number) => {
      const ground = this.surface(x, z);
      for (let y = Math.min(ground, top); y <= top; y++) put(x, y, z, id);
      for (let y = top + 1; y <= Math.max(ground + 1, top + 6); y++) put(x, y, z, BLOCK.AIR);
    };
    if (s.kind === 'ruin') {
      for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
        const x = s.x + dx, z = s.z + dz;
        foundation(x, z, s.y, BLOCK.STONE_BRICKS);
        if (Math.abs(dx) === 4 || Math.abs(dz) === 4) {
          const h = Math.floor(hash2(x, z, this.seed + 810) * 5);
          for (let dy = 1; dy <= h; dy++) put(x, s.y + dy, z, BLOCK.STONE_BRICKS);
        }
      }
      put(s.x, s.y + 1, s.z, BLOCK.CHEST);
      put(s.x + 2, s.y + 1, s.z + 2, BLOCK.LAMP);
      return;
    }
    for (let dx = -13; dx <= 13; dx++) for (let dz = -13; dz <= 13; dz++) {
      if (Math.abs(dx) <= 1 || Math.abs(dz) <= 1) foundation(s.x + dx, s.z + dz, s.y, BLOCK.GRAVEL);
    }
    for (const [hx, hz] of [[-8, -8], [8, -8], [-8, 8]]) {
      const x = s.x + hx, z = s.z + hz;
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
        foundation(x + dx, z + dz, s.y, BLOCK.COBBLE);
        for (let dy = 1; dy <= 4; dy++) {
          const edge = Math.abs(dx) === 3 || Math.abs(dz) === 3;
          let b = edge ? BLOCK.PLANKS : BLOCK.AIR;
          if (Math.abs(dx) === 3 && Math.abs(dz) === 3) b = BLOCK.LOG;
          else if (edge && dy === 2 && (dx === 0 || dz === 0)) b = BLOCK.GLASS;
          if (dx === 0 && dz === 3 && dy <= 2) b = BLOCK.AIR;
          put(x + dx, s.y + dy, z + dz, b);
        }
      }
      for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) put(x + dx, s.y + 5, z + dz, BLOCK.PLANKS);
      put(x - 2, s.y + 1, z - 2, BLOCK.CHEST);
      put(x + 2, s.y + 1, z - 2, BLOCK.WORKBENCH);
      put(x, s.y + 4, z, BLOCK.LAMP);
    }
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      put(s.x + dx, s.y, s.z + dz, BLOCK.COBBLE);
      put(s.x + dx, s.y + 1, s.z + dz, Math.abs(dx) === 2 || Math.abs(dz) === 2 ? BLOCK.COBBLE : BLOCK.WATER);
    }
  }

  spawn(realm: Realm = 'verdant'): Vec3 {
    const cached = this.spawns.get(realm);
    if (cached) return { ...cached };
    const chunks = new Map<string, Uint16Array>();
    const get = (x: number, y: number, z: number) => {
      if (y < 0 || y >= HEIGHT) return BLOCK.AIR;
      const cx = chunkCoord(x), cz = chunkCoord(z), key = `${cx},${cz}`;
      let data = chunks.get(key);
      if (!data) {
        data = this.chunk(cx, cz, realm);
        if (chunks.size >= 16) chunks.delete(chunks.keys().next().value!);
        chunks.set(key, data);
      }
      return data[index(localCoord(x), y, localCoord(z))];
    };
    for (let radius = 0; radius <= 256; radius++) for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) {
      if (Math.max(Math.abs(x), Math.abs(z)) !== radius) continue;
      const ground = this.surface(x, z, realm);
      if (ground < 1 || ground + 3 >= HEIGHT) continue;
      let safe = true;
      for (let dx = -1; dx <= 1 && safe; dx++) for (let dz = -1; dz <= 1 && safe; dz++) {
        const id = get(x + dx, ground, z + dz);
        if (!blockDef(id).solid || id === BLOCK.MAGMA || id === BLOCK.CACTUS || id === BLOCK.LEAVES || id === BLOCK.LOG || id === BLOCK.ICE) safe = false;
        for (let dy = 1; dy <= 2 && safe; dy++) {
          const b = blockDef(get(x + dx, ground + dy, z + dz));
          if (b.solid || b.liquid) safe = false;
        }
      }
      if (safe) {
        const spawn = { x: x + 0.5, y: ground + 1, z: z + 0.5 };
        this.spawns.set(realm, spawn);
        return { ...spawn };
      }
    }
    throw new Error(`No safe spawn found in ${realm}`);
  }
}
