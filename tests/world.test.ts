import { describe, expect, it, vi } from 'vitest';
import { World } from '../server/world';
import { BLOCK, BLOCKS, blockDef } from '../shared/blocks';
import { CHUNK, HEIGHT, SEA, chunkCoord, index, localCoord } from '../shared/constants';
import { decodeRLE, encodeRLE } from '../shared/codec';
import { fbm2, hash2, hash3, seedNum, valueNoise2, valueNoise3 } from '../shared/noise';
import { WorldGen } from '../shared/worldgen';
import type { Realm } from '../shared/types';

const realms: Realm[] = ['verdant', 'cinder', 'aether'];
const volume = CHUNK * CHUNK * HEIGHT;
const same = (a: Uint16Array, b: Uint16Array) => a.length === b.length && a.every((id, i) => id === b[i]);

function referenceHash(x: number, y: number, seed: number) {
  let h = Number(BigInt.asIntN(32, BigInt(x) * 374761393n + BigInt(y) * 668265263n + BigInt(seed) * 2147483647n));
  h ^= h >>> 13;
  h = Number(BigInt.asIntN(32, BigInt(h) * 1274126177n));
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

describe('integer hashing and coherent noise', () => {
  it('matches exact 32-bit arithmetic even with large signed seeds and coordinates', () => {
    for (const seed of [0, 1, -1, 2147483647, -2147483648, seedNum('test-seed')]) {
      for (const x of [0, -1, 16, -1000001, 2147483647]) for (const z of [0, -16, 65535, -2147483648]) {
        expect(hash2(x, z, seed)).toBe(referenceHash(x, z, seed));
      }
    }
  });

  it('does not collapse adjacent coordinates or the old 3D collision', () => {
    const seed = seedNum('precision-regression');
    expect(new Set(Array.from({ length: 2048 }, (_, x) => hash2(x - 1024, 9, seed))).size).toBe(2048);
    expect(hash3(0, 1, 0, seed)).not.toBe(hash3(0, 0, 913, seed));
    expect(hash2(9, -4, seed)).not.toBe(hash2(9, -4, seed + 1));
  });

  it('is bounded and continuous on negative lattice boundaries', () => {
    for (let i = -30; i <= 30; i++) {
      for (const n of [valueNoise2(i / 7, i / 11, 42), valueNoise3(i / 7, i / 9, i / 11, 42), fbm2(i / 9, i / 7, 42)]) {
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThan(1);
      }
      expect(Math.abs(valueNoise2(i - 1e-6, -3.7, 42) - valueNoise2(i + 1e-6, -3.7, 42))).toBeLessThan(0.00001);
      expect(Math.abs(valueNoise3(i - 1e-6, 4.1, -3.7, 42) - valueNoise3(i + 1e-6, 4.1, -3.7, 42))).toBeLessThan(0.00001);
    }
  });
});

describe('realm generation', () => {
  it.each(realms)('%s is deterministic, seed-dependent and independent of generation order', realm => {
    const a = new WorldGen('test-seed'), b = new WorldGen('test-seed');
    const first = a.chunk(-3, -7, realm);
    a.chunk(0, 0, realm);
    b.chunk(17, -1, realm);
    expect(first).toBeInstanceOf(Uint16Array);
    expect(first.length).toBe(volume);
    expect(same(first, b.chunk(-3, -7, realm))).toBe(true);
    expect(same(first, a.chunk(-3, -7, realm))).toBe(true);
    expect(same(a.chunk(0, 0, realm), new WorldGen('another seed').chunk(0, 0, realm))).toBe(false);
    expect(first.every(id => Boolean(BLOCKS[id]))).toBe(true);
  });

  it('keeps column coordinates continuous across positive and negative chunk boundaries', () => {
    const gen = new WorldGen('test-seed');
    for (const realm of realms) for (const x of [-33, -17, -16, -1, 0, 15, 16, 31]) for (const z of [-17, -1, 0, 16]) {
      const column = gen.column(chunkCoord(x), chunkCoord(z), localCoord(x), localCoord(z), realm);
      expect(column).toEqual(gen.column(0, 0, x, z, realm));
      expect(column.height).toBe(gen.surface(x, z, realm));
    }
    expect(same(gen.chunk(1, -1), gen.chunk(1, -1, 'verdant'))).toBe(true);
  });

  it('has verdant coasts, rolling land, caves and all ordinary ores', () => {
    const gen = new WorldGen('test-seed');
    const seen = new Set<number>();
    let cave = false, water = false;
    const heights = new Set<number>();
    for (let cx = -8; cx <= 8; cx += 4) for (let cz = -8; cz <= 8; cz += 4) {
      const data = gen.chunk(cx, cz);
      for (const id of data) seen.add(id);
      for (let x = 0; x < CHUNK; x++) for (let z = 0; z < CHUNK; z++) {
        const h = gen.column(cx, cz, x, z).height;
        heights.add(h);
        expect(data[index(x, 0, z)]).toBe(BLOCK.BEDROCK);
        for (let y = 4; y < h - 5; y++) if (data[index(x, y, z)] === BLOCK.AIR) cave = true;
        if (h < SEA && data[index(x, SEA, z)] === BLOCK.WATER) water = true;
      }
    }
    expect(cave).toBe(true);
    expect(water).toBe(true);
    expect(heights.size).toBeGreaterThan(15);
    for (const id of [BLOCK.GRASS, BLOCK.SAND, BLOCK.LOG, BLOCK.LEAVES, BLOCK.COAL_ORE, BLOCK.COPPER_ORE, BLOCK.IRON_ORE, BLOCK.GOLD_ORE, BLOCK.SAPPHIRE_ORE]) expect(seen.has(id)).toBe(true);
    expect(seen.has(BLOCK.RADIANT_ORE)).toBe(false);
    expect(seen.has(BLOCK.AETHERSTONE)).toBe(false);
  });

  it('builds cinder floors and ceilings around an open cavern with unique ore', () => {
    const gen = new WorldGen('test-seed'), data = gen.chunk(0, 0, 'cinder');
    const seen = new Set(data);
    for (const id of [BLOCK.CINDERSTONE, BLOCK.CINDER_ASH, BLOCK.RADIANT_ORE, BLOCK.MAGMA]) expect(seen.has(id)).toBe(true);
    for (const id of [BLOCK.GRASS, BLOCK.WATER, BLOCK.LEAVES, BLOCK.AETHERSTONE]) expect(seen.has(id)).toBe(false);
    for (let x = 0; x < 8; x++) for (let z = 0; z < 8; z++) {
      const c = gen.column(0, 0, x, z, 'cinder');
      expect(data[index(x, 0, z)]).toBe(BLOCK.BEDROCK);
      expect(data[index(x, HEIGHT - 1, z)]).toBe(BLOCK.BEDROCK);
      expect(blockDef(data[index(x, c.height, z)]).solid).toBe(true);
      expect(blockDef(data[index(x, c.ceiling!, z)]).solid).toBe(true);
      expect(data[index(x, 45, z)]).toBe(BLOCK.AIR);
    }
  });

  it('builds finite aether islands surrounded by void, with air underneath', () => {
    const gen = new WorldGen('test-seed');
    const seen = new Set<number>();
    let islands = 0, voids = 0;
    for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
      const data = gen.chunk(cx, cz, 'aether');
      for (const id of data) seen.add(id);
      for (let x = 0; x < CHUNK; x++) for (let z = 0; z < CHUNK; z++) {
        const c = gen.column(cx, cz, x, z, 'aether');
        if (c.height === -1) {
          voids++;
          let empty = true;
          for (let y = 0; y < HEIGHT; y++) if (data[index(x, y, z)] !== BLOCK.AIR) empty = false;
          expect(empty).toBe(true);
        } else {
          islands++;
          expect(data[index(x, c.height, z)]).toBe(BLOCK.GRASS);
          expect(data[index(x, c.bottom! - 1, z)]).toBe(BLOCK.AIR);
          expect(data[index(x, 0, z)]).toBe(BLOCK.AIR);
        }
      }
    }
    expect(islands).toBeGreaterThan(0);
    expect(voids).toBeGreaterThan(0);
    expect(seen.has(BLOCK.AETHERSTONE)).toBe(true);
    expect(seen.has(BLOCK.VERDANT_CRYSTAL)).toBe(true);
    expect(seen.has(BLOCK.RADIANT_ORE)).toBe(false);
    expect(seen.has(BLOCK.BEDROCK)).toBe(false);
  });

  it.each(realms)('finds deterministic safe spawn footing and headroom in %s', realm => {
    for (const seed of ['test-seed', 'ocean', '42', 'negative', '']) {
      const world = new World(seed), spawn = world.gen.spawn(realm);
      expect(spawn).toEqual(new WorldGen(seed).spawn(realm));
      const x = Math.floor(spawn.x), z = Math.floor(spawn.z);
      expect(spawn.y).toBe(world.gen.surface(x, z, realm) + 1);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const id = world.get(realm, x + dx, spawn.y - 1, z + dz);
        expect(blockDef(id).solid).toBe(true);
        expect([BLOCK.MAGMA, BLOCK.LEAVES, BLOCK.CACTUS, BLOCK.LOG]).not.toContain(id);
        for (let dy = 0; dy <= 1; dy++) {
          const def = blockDef(world.get(realm, x + dx, spawn.y + dy, z + dz));
          expect(Boolean(def.solid || def.liquid)).toBe(false);
        }
      }
      spawn.y = -99;
      expect(world.gen.spawn(realm).y).toBeGreaterThan(0);
    }
  });

  it('retains complete crowns in later columns and across both axes of chunk borders', () => {
    const world = new World('test-seed');
    let tested = 0;
    const axes = new Set<string>();
    for (let x = -96; x <= 96 && tested < 12; x++) for (let z = -96; z <= 96 && tested < 12; z++) {
      if (localCoord(x) !== 0 && localCoord(x) !== 15 && localCoord(z) !== 0 && localCoord(z) !== 15) continue;
      const tree = world.gen.treeAt(x, z);
      if (!tree) continue;
      if (localCoord(x) === 0 || localCoord(x) === 15) axes.add('x');
      if (localCoord(z) === 0 || localCoord(z) === 15) axes.add('z');
      for (let dy = 0; dy < tree.height; dy++) expect(world.get('verdant', x, tree.y + dy, z)).toBe(BLOCK.LOG);
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx) + Math.abs(dz) > 3) continue;
        const y = tree.y + tree.height;
        if (world.gen.surface(x + dx, z + dz) >= y) continue;
        expect([BLOCK.LEAVES, BLOCK.LOG]).toContain(world.get('verdant', x + dx, y, z + dz));
      }
      tested++;
    }
    expect(tested).toBe(12);
    expect(axes.size).toBe(2);
  });

  it('generates deterministic settlements and ruins with foundations and usable interiors', () => {
    const world = new World('test-seed');
    const found = new Set<string>();
    for (let x = -12; x <= 12 && found.size < 2; x++) for (let z = -12; z <= 12 && found.size < 2; z++) {
      const s = world.gen.structureAt(x, z);
      if (!s || found.has(s.kind)) continue;
      expect(s).toEqual(new WorldGen('test-seed').structureAt(x, z));
      expect(world.gen.structures(chunkCoord(s.x), chunkCoord(s.z))).toContainEqual(s);
      found.add(s.kind);
      if (s.kind === 'ruin') {
        expect(world.get('verdant', s.x, s.y, s.z)).toBe(BLOCK.STONE_BRICKS);
        expect(world.get('verdant', s.x, s.y + 1, s.z)).toBe(BLOCK.CHEST);
      } else {
        for (const [dx, dz] of [[-8, -8], [8, -8], [-8, 8]]) {
          expect(world.get('verdant', s.x + dx, s.y, s.z + dz)).toBe(BLOCK.COBBLE);
          expect(world.get('verdant', s.x + dx, s.y + 1, s.z + dz)).toBe(BLOCK.AIR);
          expect(world.get('verdant', s.x + dx, s.y + 1, s.z + dz + 3)).toBe(BLOCK.AIR);
          expect(world.get('verdant', s.x + dx, s.y + 5, s.z + dz)).toBe(BLOCK.PLANKS);
          expect(world.get('verdant', s.x + dx - 2, s.y + 1, s.z + dz - 2)).toBe(BLOCK.CHEST);
        }
      }
    }
    expect([...found].sort()).toEqual(['ruin', 'settlement']);
  });
});

describe('world access and persistence', () => {
  it.each(realms)('applies edits including air and 16-bit IDs through every %s API', realm => {
    const world = new World('edits');
    for (const [x, z] of [[-17, -16], [-1, -1], [0, 0], [15, 16], [32, -33]]) {
      const cx = chunkCoord(x), cz = chunkCoord(z), idx = index(localCoord(x), 30, localCoord(z));
      const base = world.gen.chunk(cx, cz, realm)[idx];
      expect(world.get(realm, x, 30, z)).toBe(base);
      world.set(realm, x + 0.8, 30.2, z + 0.8, 4096);
      expect(world.block(realm, cx, cz, idx)).toBe(4096);
      expect(world.fullChunk(realm, cx, cz)[idx]).toBe(4096);
      expect(world.dirty.has(`${realm}:${cx},${cz}`)).toBe(true);
      world.setBlock(realm, cx, cz, idx, 0);
      expect(world.get(realm, x, 30, z)).toBe(0);
      expect(world.fullChunk(realm, cx, cz)[idx]).toBe(0);
      expect(world.gen.chunk(cx, cz, realm)[idx]).toBe(base);
    }
    expect(world.editedChunks().length).toBe(5);
    const restored = new World('edits');
    const saved = JSON.parse(JSON.stringify([...world.edits].map(([key, entries]) => [key, [...entries]]))) as [string, [number, number][]][];
    restored.edits = new Map(saved.map(([key, entries]) => [key, new Map(entries)]));
    expect(same(restored.fullChunk(realm, -2, -1), world.fullChunk(realm, -2, -1))).toBe(true);
  });

  it('isolates realm overlays and returns chunk snapshots without leaking mutations', () => {
    const world = new World('edits');
    realms.forEach((realm, i) => world.set(realm, -1, 40, 0, 1000 + i));
    realms.forEach((realm, i) => {
      expect(world.get(realm, -1, 40, 0)).toBe(1000 + i);
      const chunk = world.fullChunk(realm, -1, 0);
      chunk.fill(65535);
      expect(world.get(realm, -1, 40, 0)).toBe(1000 + i);
      expect(world.fullChunk(realm, -1, 0)[0]).not.toBe(65535);
    });
    world.edits.get('cinder:-1,0')!.set(index(15, 40, 0), 512);
    expect(world.get('cinder', -1, 40, 0)).toBe(512);
    expect(world.fullChunk('cinder', -1, 0)[index(15, 40, 0)]).toBe(512);
  });

  it('bounds the LRU across realms, refreshes on reads, and preserves edits on eviction', () => {
    const world = new World('cache');
    const generate = vi.spyOn(world.gen, 'chunk');
    world.set('cinder', 0, 10, 0, 65535);
    world.set('aether', 0, 10, 0, 0);
    world.fullChunk('cinder', 0, 0);
    world.fullChunk('aether', 0, 0);
    world.fullChunk('verdant', 0, 0);
    const saved = world.fullChunk('cinder', 0, 0);
    expect(generate).toHaveBeenCalledTimes(3);
    for (let i = 1; i <= 381; i++) world.fullChunk('aether', i, 0);
    expect(world.cache.size).toBe(384);
    world.get('aether', 0, 10, 0);
    world.fullChunk('verdant', 1, 1);
    expect(world.cache.has('verdant:0,0')).toBe(false);
    expect(world.cache.has('aether:0,0')).toBe(true);
    world.fullChunk('verdant', 2, 1);
    expect(world.cache.has('cinder:0,0')).toBe(false);
    expect(same(world.fullChunk('cinder', 0, 0), saved)).toBe(true);
    expect(world.get('aether', 0, 10, 0)).toBe(0);
    expect(world.cache.size).toBe(384);
  });

  it('handles vertical boundaries and rejects invalid IDs without corrupting edits', () => {
    const world = new World('bounds');
    for (const y of [-1, HEIGHT, NaN, Infinity]) {
      expect(world.get('verdant', 0, y, 0)).toBe(0);
      world.set('verdant', 0, y, 0, 5);
    }
    for (const idx of [-1, volume, 0.5, NaN]) {
      expect(world.block('verdant', 0, 0, idx)).toBe(0);
      world.setBlock('verdant', 0, 0, idx, 5);
    }
    for (const id of [-1, 65536, 1.5, NaN, Infinity]) expect(() => world.set('verdant', 0, 3, 0, id)).toThrow(RangeError);
    expect(world.edits.size).toBe(0);
    expect(world.cache.size).toBe(0);
    world.set('verdant', 0, HEIGHT - 1, 0, 65535);
    expect(world.get('verdant', 0, HEIGHT - 1, 0)).toBe(65535);
  });
});

describe('shared RLE chunk codec', () => {
  it.each(realms)('round-trips %s chunks over JSON with value/count pairs', realm => {
    const data = new WorldGen('codec').chunk(-1, 2, realm);
    const encoded = encodeRLE(data);
    expect(encoded.length).toBeLessThan(data.length);
    expect(same(decodeRLE(JSON.parse(JSON.stringify(encoded))), data)).toBe(true);
  });

  it('round-trips empty, uniform, alternating and full uint16 values', () => {
    expect(encodeRLE(new Uint16Array())).toEqual([]);
    expect(decodeRLE([], 0).length).toBe(0);
    expect(encodeRLE(new Uint16Array([5, 5, 0, 65535, 65535]))).toEqual([5, 2, 0, 1, 65535, 2]);
    for (const data of [new Uint16Array(volume), new Uint16Array(volume).fill(65535), Uint16Array.from({ length: volume }, (_, i) => i % 2 ? 4096 : 0)]) {
      expect(same(decodeRLE(encodeRLE(data)), data)).toBe(true);
    }
  });

  it('rejects malformed, truncated and oversized payloads before allocation', () => {
    for (const data of [[1], [0, 0], [1, -2], [-1, volume], [65536, volume], [0.5, volume], [0, 1.5], [0, NaN], [NaN, volume], [0, Infinity], [0, volume + 1], [0, volume - 1], [0, volume, 1, 1], []]) {
      expect(() => decodeRLE(data)).toThrow(RangeError);
    }
    for (const length of [-1, 0.5, NaN, Infinity, volume + 1]) expect(() => decodeRLE([], length)).toThrow(RangeError);
  });
});
