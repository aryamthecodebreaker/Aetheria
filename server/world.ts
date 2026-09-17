import type { Realm } from '../shared/types';
import { BALANCE, CHUNK, HEIGHT, chunkCoord, chunkKey, index, localCoord } from '../shared/constants';
import { WorldGen } from '../shared/worldgen';

export { encodeRLE, decodeRLE } from '../shared/codec';

const VOLUME = CHUNK * CHUNK * HEIGHT;

export class World {
  gen: WorldGen;
  edits = new Map<string, Map<number, number>>();
  dirty = new Set<string>();
  readonly cache = new Map<string, Uint16Array>();
  constructor(seed: string) { this.gen = new WorldGen(seed); }

  private generated(realm: Realm, cx: number, cz: number): Uint16Array {
    const key = `${realm}:${chunkKey(cx, cz)}`;
    let data = this.cache.get(key);
    if (data) this.cache.delete(key);
    else data = this.gen.chunk(cx, cz, realm);
    this.cache.set(key, data);
    while (this.cache.size > Math.min(384, BALANCE.maxChunks)) this.cache.delete(this.cache.keys().next().value!);
    return data;
  }

  get(realm: Realm, x: number, y: number, z: number): number {
    if (![x, y, z].every(Number.isFinite)) return 0;
    y = Math.floor(y);
    if (y < 0 || y >= HEIGHT) return 0;
    return this.block(realm, chunkCoord(x), chunkCoord(z), index(localCoord(x), y, localCoord(z)));
  }

  set(realm: Realm, x: number, y: number, z: number, id: number): void {
    if (![x, y, z].every(Number.isFinite)) return;
    y = Math.floor(y);
    if (y < 0 || y >= HEIGHT) return;
    this.setBlock(realm, chunkCoord(x), chunkCoord(z), index(localCoord(x), y, localCoord(z)), id);
  }

  block(realm: Realm, cx: number, cz: number, idx: number): number {
    if (!Number.isInteger(idx) || idx < 0 || idx >= VOLUME) return 0;
    const data = this.generated(realm, cx, cz);
    return this.edits.get(`${realm}:${chunkKey(cx, cz)}`)?.get(idx) ?? data[idx];
  }

  setBlock(realm: Realm, cx: number, cz: number, idx: number, id: number): void {
    if (!Number.isInteger(idx) || idx < 0 || idx >= VOLUME) return;
    if (!Number.isInteger(id) || id < 0 || id > 65535) throw new RangeError('Block id must be an unsigned 16-bit integer');
    const key = `${realm}:${chunkKey(cx, cz)}`;
    let edits = this.edits.get(key);
    if (!edits) { edits = new Map(); this.edits.set(key, edits); }
    edits.set(idx, id);
    this.dirty.add(key);
  }

  editedChunks(): string[] { return [...this.edits.keys()]; }

  fullChunk(realm: Realm, cx: number, cz: number): Uint16Array {
    const data = this.generated(realm, cx, cz).slice();
    const edits = this.edits.get(`${realm}:${chunkKey(cx, cz)}`);
    if (edits) for (const [i, id] of edits) data[i] = id;
    return data;
  }
}
