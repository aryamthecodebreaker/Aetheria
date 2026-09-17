import * as THREE from 'three';
import { CHUNK, HEIGHT, chunkCoord, chunkKey, index, localCoord } from '../../shared/constants';
import type { Vec3 } from '../../shared/types';
import { makeAtlas } from './atlas';
import { PAD, paddedIndex } from './layout';
import type { GeometryData, MeshJob, MeshResult } from './layout';

type ChunkMesh = { cx: number; cz: number; meshes: THREE.Mesh[]; triangles: number };
type WorkerSlot = { worker: Worker; job?: MeshJob; failed: boolean };

export class WorldRenderer {
  readonly group = new THREE.Group();
  readonly chunks = new Map<string, Uint16Array>();
  readonly stats = { chunks: 0, triangles: 0, jobs: 0 };
  private rendered = new Map<string, ChunkMesh>();
  private revisions = new Map<string, number>();
  private dirty = new Set<string>();
  private workers: WorkerSlot[] = [];
  private serial = 0;
  private scheduled = false;
  private center = { x: 0, z: 0 };
  private texture?: THREE.CanvasTexture;
  private material?: THREE.MeshBasicMaterial;
  private waterMaterial?: THREE.MeshBasicMaterial;

  constructor(readonly scene: THREE.Scene) {
    this.group.name = 'voxel-world';
    scene.add(this.group);
  }

  get meshes(): Iterable<THREE.Mesh> {
    return this.group.children as THREE.Mesh[];
  }

  setChunk(cx: number, cz: number, data: Uint16Array): void {
    if (!Number.isSafeInteger(cx) || !Number.isSafeInteger(cz)) throw new RangeError('Invalid chunk coordinate');
    if (data.length !== CHUNK * CHUNK * HEIGHT) throw new RangeError('Invalid chunk volume');
    this.chunks.set(chunkKey(cx, cz), data.slice());
    this.stats.chunks = this.chunks.size;
    this.invalidateAround(cx, cz);
    this.schedule();
  }

  setBlock(x: number, y: number, z: number, id: number): void {
    if (![x, y, z].every(Number.isFinite)) return;
    y = Math.floor(y);
    if (y < 0 || y >= HEIGHT) return;
    if (!Number.isInteger(id) || id < 0 || id > 65535) throw new RangeError('Invalid block id');
    const cx = chunkCoord(x), cz = chunkCoord(z), lx = localCoord(x), lz = localCoord(z);
    const data = this.chunks.get(chunkKey(cx, cz));
    if (!data || data[index(lx, y, lz)] === id) return;
    data[index(lx, y, lz)] = id;
    const dx = lx === 0 ? -1 : lx === CHUNK - 1 ? 1 : 0;
    const dz = lz === 0 ? -1 : lz === CHUNK - 1 ? 1 : 0;
    this.invalidate(cx, cz);
    if (dx) this.invalidate(cx + dx, cz);
    if (dz) this.invalidate(cx, cz + dz);
    if (dx && dz) this.invalidate(cx + dx, cz + dz);
    this.schedule();
  }

  getBlock(x: number, y: number, z: number): number {
    if (![x, y, z].every(Number.isFinite)) return 0;
    y = Math.floor(y);
    if (y < 0 || y >= HEIGHT) return 0;
    return this.chunks.get(chunkKey(chunkCoord(x), chunkCoord(z)))?.[index(localCoord(x), y, localCoord(z))] ?? 21;
  }

  update(player: Vec3, radius: number): void {
    if (![player.x, player.z, radius].every(Number.isFinite)) return;
    this.center = { x: chunkCoord(player.x), z: chunkCoord(player.z) };
    radius = Math.max(0, Math.floor(radius));
    const removed: [number, number][] = [];
    for (const key of this.chunks.keys()) {
      const [cx, cz] = key.split(',').map(Number);
      if (Math.max(Math.abs(cx - this.center.x), Math.abs(cz - this.center.z)) <= radius) continue;
      this.chunks.delete(key); this.revisions.delete(key); this.dirty.delete(key);
      this.removeMesh(key);
      removed.push([cx, cz]);
    }
    for (const [cx, cz] of removed) this.invalidateAround(cx, cz);
    this.stats.chunks = this.chunks.size;
    this.schedule();
  }

  clear(): void {
    for (const slot of this.workers) slot.worker.terminate();
    this.workers = [];
    for (const key of this.rendered.keys()) this.removeMesh(key);
    this.chunks.clear(); this.dirty.clear(); this.revisions.clear();
    this.material?.dispose(); this.waterMaterial?.dispose(); this.texture?.dispose();
    this.material = undefined; this.waterMaterial = undefined; this.texture = undefined;
    this.stats.chunks = 0; this.stats.triangles = 0; this.stats.jobs = 0;
  }

  private invalidate(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    if (!this.chunks.has(key)) return;
    this.revisions.set(key, ++this.serial);
    this.dirty.add(key);
  }

  private invalidateAround(cx: number, cz: number): void {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.invalidate(cx + dx, cz + dz);
  }

  private schedule(): void {
    this.countJobs();
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => { this.scheduled = false; this.pump(); });
  }

  private countJobs(): void {
    this.stats.jobs = this.dirty.size + this.workers.filter(slot => slot.job).length;
  }

  private startWorkers(): void {
    if (this.workers.length) return;
    const count = Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1));
    for (let i = 0; i < count; i++) {
      const worker = new Worker(new URL('../mesh.worker.ts', import.meta.url), { type: 'module' });
      const slot: WorkerSlot = { worker, failed: false };
      worker.onmessage = ({ data }: MessageEvent<MeshResult>) => {
        if (!this.workers.includes(slot)) return;
        const job = slot.job;
        slot.job = undefined;
        if (job && data.key === job.key && data.revision === job.revision && this.revisions.get(data.key) === data.revision) this.apply(data);
        this.pump();
      };
      worker.onerror = event => {
        if (!this.workers.includes(slot)) return;
        if (slot.job && this.chunks.has(slot.job.key)) this.dirty.add(slot.job.key);
        slot.job = undefined; slot.failed = true; worker.terminate();
        console.error('Voxel meshing worker failed', event.message);
        this.pump();
      };
      this.workers.push(slot);
    }
  }

  private pump(): void {
    if (!this.dirty.size) { this.countJobs(); return; }
    this.startWorkers();
    const busy = new Set(this.workers.flatMap(slot => slot.job ? [slot.job.key] : []));
    const keys = [...this.dirty].filter(key => !busy.has(key));
    keys.sort((a, b) => {
      const [ax, az] = a.split(',').map(Number), [bx, bz] = b.split(',').map(Number);
      return (ax - this.center.x) ** 2 + (az - this.center.z) ** 2 - (bx - this.center.x) ** 2 - (bz - this.center.z) ** 2;
    });
    for (const slot of this.workers) {
      if (slot.job || slot.failed) continue;
      const key = keys.shift();
      if (!key) break;
      this.dirty.delete(key);
      const [cx, cz] = key.split(',').map(Number);
      const data = new Uint16Array(PAD * PAD * HEIGHT);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const neighbor = this.chunks.get(chunkKey(cx + dx, cz + dz));
        if (!neighbor) continue;
        const x0 = dx < 0 ? -1 : dx > 0 ? CHUNK : 0, x1 = dx === 0 ? CHUNK - 1 : x0;
        const z0 = dz < 0 ? -1 : dz > 0 ? CHUNK : 0, z1 = dz === 0 ? CHUNK - 1 : z0;
        for (let y = 0; y < HEIGHT; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
          data[paddedIndex(x, y, z)] = neighbor[index(localCoord(x), y, localCoord(z))];
        }
      }
      const job: MeshJob = { key, revision: this.revisions.get(key)!, data };
      slot.job = job;
      slot.worker.postMessage(job, [data.buffer]);
    }
    this.countJobs();
  }

  private removeMesh(key: string): void {
    const chunk = this.rendered.get(key);
    if (!chunk) return;
    for (const mesh of chunk.meshes) { this.group.remove(mesh); mesh.geometry.dispose(); }
    this.stats.triangles -= chunk.triangles;
    this.rendered.delete(key);
  }

  private geometry(data: GeometryData): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(data.uv, 2));
    geometry.setAttribute('color', new THREE.BufferAttribute(data.color, 3));
    geometry.setIndex(new THREE.BufferAttribute(data.index, 1));
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    return geometry;
  }

  private apply(result: MeshResult): void {
    if (!this.material) {
      this.texture = makeAtlas();
      this.material = new THREE.MeshBasicMaterial({ map: this.texture, vertexColors: true, alphaTest: 0.5 });
      this.waterMaterial = new THREE.MeshBasicMaterial({ map: this.texture, vertexColors: true, transparent: true, opacity: 0.64, depthWrite: false, side: THREE.DoubleSide });
      this.material.toneMapped = false; this.waterMaterial.toneMapped = false;
    }
    this.removeMesh(result.key);
    const [cx, cz] = result.key.split(',').map(Number);
    const chunk: ChunkMesh = { cx, cz, meshes: [], triangles: 0 };
    for (const [part, material] of [[result.solid, this.material], [result.water, this.waterMaterial!]] as const) {
      if (!part.index.length) continue;
      const mesh = new THREE.Mesh(this.geometry(part), material);
      mesh.position.set(cx * CHUNK, 0, cz * CHUNK);
      mesh.name = `${result.key}:${part === result.water ? 'water' : 'solid'}`;
      mesh.userData.chunk = result.key;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      chunk.meshes.push(mesh); chunk.triangles += part.index.length / 3;
      this.group.add(mesh);
    }
    this.rendered.set(result.key, chunk);
    this.stats.triangles += chunk.triangles;
  }
}
