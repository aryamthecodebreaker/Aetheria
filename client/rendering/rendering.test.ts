import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { BLOCKS } from '../../shared/blocks';
import { CHUNK, HEIGHT, index } from '../../shared/constants';
import { PAD, paddedIndex } from './layout';
import type { GeometryData, MeshJob, MeshResult } from './layout';
import { meshChunk } from './mesher';
import { makeActor, animateActor } from './actors';
import { makeAtlas } from './atlas';
import { WorldRenderer } from './world';
import { usesBlock } from '../game';
import type { ClientMessage, Player, Stack } from '../../shared/types';
import { repairCost, UI } from '../ui';

const volume = () => new Uint16Array(CHUNK * CHUNK * HEIGHT);
function mesh(blocks: [number, number, number, number][]) {
  const data = new Uint16Array(PAD * PAD * HEIGHT);
  for (const [x, y, z, id] of blocks) data[paddedIndex(x, y, z)] = id;
  return meshChunk({ key: '0,0', revision: 1, data });
}
function winding(data: GeometryData) {
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), normal = new THREE.Vector3();
  for (let i = 0; i < data.index.length; i += 3) {
    a.fromArray(data.position, data.index[i] * 3);
    b.fromArray(data.position, data.index[i + 1] * 3);
    c.fromArray(data.position, data.index[i + 2] * 3);
    normal.fromArray(data.normal, data.index[i] * 3);
    expect(b.sub(a).cross(c.sub(a)).dot(normal)).toBeGreaterThan(0);
  }
}
function canvasMock() {
  const images: Uint8ClampedArray[] = [];
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (image: { data: Uint8ClampedArray }) => images.push(image.data)
  }) }) });
  return images;
}
class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage?: (event: MessageEvent<MeshResult>) => void;
  onerror?: (event: ErrorEvent) => void;
  job?: MeshJob;
  terminated = false;
  constructor() { FakeWorker.all.push(this); }
  postMessage(job: MeshJob, transfer: Transferable[]) { this.job = structuredClone(job, { transfer }); }
  terminate() { this.terminated = true; }
  complete() {
    const result = meshChunk(this.job!);
    this.job = undefined;
    this.onmessage?.({ data: result } as MessageEvent<MeshResult>);
  }
}
const flush = () => new Promise<void>(resolve => queueMicrotask(resolve));
function drain() {
  for (let guard = 0; guard < 100; guard++) {
    const worker = FakeWorker.all.find(worker => worker.job && !worker.terminated);
    if (!worker) return;
    worker.complete();
  }
  throw new Error('Jobs did not drain');
}
function renderer() {
  canvasMock(); FakeWorker.all = [];
  vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
  vi.stubGlobal('Worker', FakeWorker);
  return new WorldRenderer(new THREE.Scene());
}
afterEach(() => vi.unstubAllGlobals());

describe('voxel meshing', () => {
  it('emits outward triangles for every block shape and both plant sides', () => {
    for (const block of BLOCKS.slice(1)) {
      const result = mesh([[4, 30, 4, block.id]]);
      winding(result.solid); winding(result.water);
      expect(result.solid.index.length + result.water.index.length).toBeGreaterThan(0);
    }
  });
  it('culls interior faces and padded neighbor boundaries', () => {
    expect(mesh([[4, 30, 4, 3]]).solid.index.length / 3).toBe(12);
    expect(mesh([[4, 30, 4, 3], [5, 30, 4, 3]]).solid.index.length / 3).toBe(20);
    expect(mesh([[15, 30, 4, 3], [16, 30, 4, 3]]).solid.index.length / 3).toBe(10);
  });
  it('keeps slab tops and only the exposed upper half of adjacent cubes', () => {
    const result = mesh([[4, 30, 4, 34], [5, 30, 4, 3]]).solid;
    expect(result.index.length / 3).toBe(22);
    let upperFace = 0;
    for (let i = 0; i < result.position.length; i += 3) {
      if (result.position[i] === 5 && result.normal[i] === -1) {
        expect(result.position[i + 1]).toBeGreaterThanOrEqual(30.5); upperFace++;
      }
    }
    expect(upperFace).toBe(4);
    expect(mesh([[4, 30, 4, 34], [5, 30, 4, 34]]).solid.index.length / 3).toBe(20);
  });
  it('renders fixed perpendicular thin doors, a half-height bed and ascending crop stages', () => {
    const bounds = (id: number) => {
      const positions = mesh([[0, 0, 0, id]]).solid.position;
      return [0, 1, 2].map(axis => {
        const values = positions.filter((_, i) => i % 3 === axis);
        return [Math.min(...values), Math.max(...values)];
      });
    };
    const closed = bounds(33), open = bounds(50);
    expect(closed[0]).toEqual([0, 1]);
    expect(closed[1]).toEqual([0, 1]);
    expect(closed[2][0]).toBeCloseTo(0.4);
    expect(closed[2][1]).toBeCloseTo(0.6);
    expect(open[0][0]).toBe(0);
    expect(open[0][1]).toBeCloseTo(0.2);
    expect(open[1]).toEqual([0, 1]);
    expect(open[2]).toEqual([0, 1]);
    expect(bounds(49)[1]).toEqual([0, 0.5]);
    for (const [id, height] of [[51, 0.25], [52, 0.5], [32, 0.85]]) expect(bounds(id)[1][1]).toBeCloseTo(height);
  });
  it('separates water, suppresses internal water faces, and makes a lowered surface', () => {
    const result = mesh([[4, 30, 4, 5], [5, 30, 4, 5]]);
    expect(result.solid.index.length).toBe(0);
    expect(result.water.index.length / 3).toBe(20);
    const ys = result.water.position.filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBeCloseTo(30.88);
  });
  it('applies AO, directional brightness and a light-block brightness floor', () => {
    const plain = mesh([[4, 30, 4, 3]]).solid;
    const shadow = mesh([[4, 30, 4, 3], [5, 31, 4, 3], [4, 31, 5, 3]]).solid;
    expect(Math.min(...shadow.color)).toBeLessThan(Math.min(...plain.color));
    expect(Math.min(...mesh([[4, 1, 4, 41]]).solid.color)).toBeGreaterThan(1);
    expect(Math.max(...mesh([[4, 1, 4, 27]]).solid.color)).toBeLessThan(1);
  });
  it('generates a deterministic atlas without external images', () => {
    const images = canvasMock();
    const a = makeAtlas(), b = makeAtlas();
    expect(images[0]).toEqual(images[1]);
    expect(a.magFilter).toBe(THREE.NearestFilter);
    expect(images[0].some((value, i) => i % 4 === 3 && value === 0)).toBe(true);
    a.dispose(); b.dispose();
  });
});

describe('renderer lifecycle', () => {
  it('sends use for every server-usable block, place otherwise, and never invents reach', () => {
    const usable: [number, number | undefined, boolean][] = [[23, undefined, true], [24, undefined, true], [25, undefined, true], [53, undefined, true], [49, undefined, true], [40, undefined, true], [33, undefined, true], [50, undefined, true], [42, undefined, true], [43, undefined, true], [26, undefined, false], [32, undefined, true], [51, undefined, true], [52, undefined, true], [1, 13, true], [2, 13, true], [31, 29, true], [31, 48, true], [31, 13, false], [39, undefined, false], [3, undefined, false], [17, undefined, false], [49, 18, true], [50, undefined, true], [51, 35, true], [52, 35, true], [1, 48, false], [28, undefined, false]];
    for (const [id, held, expected] of usable) expect(usesBlock(id, held)).toBe(expected);
    expect(usesBlock(27, undefined)).toBe(false);
    expect(usesBlock(41, undefined)).toBe(false);
  });
  it('repair UI mirrors the server repair action exactly', () => {
    const stack: Stack = { id: 1, count: 1, durability: 10 };
    const cost = repairCost(stack)!;
    expect(cost).toEqual({ material: 129, count: 2, xp: 3, restore: 24 });
    expect(repairCost({ id: 48, count: 1 })).toBeUndefined();
    expect(repairCost({ id: 3, count: 1, durability: 200 })).toEqual({ material: 22, count: 2, xp: 3, restore: Math.min(60, 104) });
  });
  it('hopper containers render 5 slots and route container-slot transfers through transfer', () => {
    const fakeElement = () => ({ innerHTML: '', scrollTop: 0, hidden: false, inert: false, appendChild: () => {}, remove: () => {}, children: [] as unknown[], firstElementChild: undefined, contains: () => false, querySelector: () => undefined, querySelectorAll: () => [] as unknown[], focus: () => {}, dataset: {}, style: {}, classList: { add: () => {}, remove: () => {} }, getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }), setAttribute: () => {}, removeAttribute: () => {} });
    const elements = new Map<string, ReturnType<typeof fakeElement>>();
    const captured: Record<string, (event: { target: unknown }) => void> = {};
    vi.stubGlobal('location', { origin: 'http://ui.test' });
    vi.stubGlobal('window', { setTimeout: () => 0, addEventListener: () => {} });
    const root = { getElementById: () => root, appendChild: () => {}, addEventListener: (type: string, fn: (event: { target: unknown }) => void) => { captured[type] = fn; }, querySelector: (s: string) => elements.get(s) ?? (elements.set(s, fakeElement()), elements.get(s)!), querySelectorAll: () => [], classList: { add: () => {}, remove: () => {} } } as unknown as HTMLElement;
    vi.stubGlobal('document', { getElementById: () => root, createElement: () => ({ getContext: () => null }), body: root, activeElement: undefined, pointerLockElement: undefined });
    const sent: ClientMessage[] = [];
    const ui = new UI(msg => sent.push(msg), () => {}, () => {});
    ui.welcome({ ...({} as Player), id: 'p1', hp: 20, mode: 'survival', selected: 0, xp: 0, inventory: [] }, { id: 'w1', name: 'W', seed: 's', mode: 'survival', difficulty: 2, created: 0, played: 0, players: 0 });
    ui.container('verdant:1,2,3', { kind: 'hopper', slots: [null, null, null, null, null], progress: 0, fuel: 0, powered: true });
    const content = elements.get('.ae-container-content')!;
    expect(content.innerHTML).toContain('Hopper');
    for (const i of [0, 1, 2, 3, 4]) expect(content.innerHTML).toContain(`data-container-slot="${i}"`);
    captured['click']({ target: { closest: () => ({ dataset: { containerSlot: '2' }, disabled: false }) } });
    expect(sent).toContainEqual({ type: 'action', action: { type: 'transfer', slot: 2, toContainer: false, container: 'verdant:1,2,3' } });
  });
  it('preserves voxel storage through transfer and handles negative coordinates and height bounds', async () => {
    const world = renderer(), data = volume(); data[index(15, 30, 15)] = 3;
    world.setChunk(-1, -1, data); await flush();
    expect(data.byteLength).toBe(CHUNK * CHUNK * HEIGHT * 2);
    expect(world.getBlock(-0.1, 30, -0.1)).toBe(3);
    expect(world.getBlock(0, 30, 0)).toBe(21);
    expect(world.getBlock(0, -1, 0)).toBe(0);
    expect(world.getBlock(0, HEIGHT, 0)).toBe(0);
    world.setBlock(-1, 30, -1, 27); drain();
    expect(world.getBlock(-1, 30, -1)).toBe(27);
    expect(world.stats.triangles).toBe(12); world.clear();
  });
  it('rebuilds adjacent chunks on arrival and eviction, disposing old geometry', async () => {
    const world = renderer(), a = volume(), b = volume();
    a[index(15, 30, 4)] = 3; b[index(0, 30, 4)] = 3;
    world.setChunk(0, 0, a); await flush(); drain();
    const dispose = vi.fn(); [...world.meshes][0].geometry.addEventListener('dispose', dispose);
    world.setChunk(1, 0, b); await flush(); drain();
    expect(world.stats.triangles).toBe(20); expect(dispose).toHaveBeenCalledOnce();
    world.update({ x: 0, y: 30, z: 0 }, 0); await flush(); drain();
    expect(world.stats.chunks).toBe(1); expect(world.stats.triangles).toBe(12);
    world.clear();
  });
  it('bounds active workers and rejects stale results after edits, clear and reload', async () => {
    const world = renderer(), data = volume(); data[index(4, 30, 4)] = 3;
    for (let i = 0; i < 10; i++) world.setChunk(i, 0, data);
    await flush(); expect(FakeWorker.all).toHaveLength(2);
    const first = FakeWorker.all[0];
    world.setBlock(4, 30, 4, 0); first.complete();
    expect(world.stats.triangles).toBe(0);
    const old = FakeWorker.all[1]; world.clear();
    world.setChunk(1, 0, data); await flush(); old.complete();
    expect(world.stats.triangles).toBe(0);
    drain(); expect(world.stats).toEqual({ chunks: 1, triangles: 12, jobs: 0 });
    world.clear(); expect(world.group.children).toHaveLength(0);
    expect(world.stats).toEqual({ chunks: 0, triangles: 0, jobs: 0 });
  });
});

describe('actors', () => {
  it('uses distinct boss rigs and server-timed warnings without making warnings attack targets', () => {
    for (const kind of ['cinder_guardian', 'aether_crown']) {
      const actor = makeActor(kind);
      expect(actor.getObjectByName(kind === 'cinder_guardian' ? 'furnace-heart' : 'prism-heart')).toBeDefined();
      expect(actor.getObjectByName('coat')).toBeUndefined();
      expect(new THREE.Box3().setFromObject(actor.getObjectByName('rig')!).getSize(new THREE.Vector3()).y).toBeGreaterThan(2.5);
      const radial = actor.getObjectByName('radial-warning')!, rush = actor.getObjectByName('rush-warning')!, charge = actor.getObjectByName('charge-progress')!;
      animateActor(actor, 1, 0, 'windup_radial', 1, 0.6);
      expect(radial.visible).toBe(true); expect(rush.visible).toBe(false);
      expect(charge.scale.x).toBeCloseTo(2.25);
      animateActor(actor, 1, 0, 'windup_rush', 2, 0.5);
      expect(radial.visible).toBe(false); expect(rush.visible).toBe(true);
      expect(charge.scale.x).toBeCloseTo(0.8);
      rush.traverse(node => expect(node.userData.telegraph).toBe(true));
      animateActor(actor, 1, 0, 'recover', 2, 1);
      expect(radial.visible || rush.visible || charge.visible).toBe(false);
    }
    const guardian = makeActor('cinder_guardian');
    animateActor(guardian, 1, 0, 'windup_radial', 1, 0.1);
    expect(guardian.getObjectByName('hammer:1')!.rotation.x).toBeLessThan(-1);
    const crown = makeActor('aether_crown');
    animateActor(crown, 1, 0, 'idle', 1, 1);
    const first = crown.getObjectByName('crown-spire:0')!.position.clone();
    animateActor(crown, 1, 0, 'windup_rush', 2, 0.1);
    expect(crown.getObjectByName('crown-spire:0')!.position.equals(first)).toBe(false);
  });
  it('shares geometry and materials, has original detailed parts, and animates without drift', () => {
    for (const kind of ['player', 'grazer', 'peep', 'shambler', 'skitter', 'wisp', 'emberling', 'trader', 'drop']) {
      const a = makeActor(kind), b = makeActor(kind);
      const meshes: THREE.Mesh[] = [], others: THREE.Mesh[] = [];
      a.traverse(node => { if (node instanceof THREE.Mesh) meshes.push(node); });
      b.traverse(node => { if (node instanceof THREE.Mesh) others.push(node); });
      expect(meshes[0].geometry).toBe(others[0].geometry);
      expect(meshes[0].material).toBe(others[0].material);
      a.position.set(20, 40, 60); a.rotation.y = 1.2;
      animateActor(a, 2, 3, 'walk'); a.updateMatrixWorld(true);
      const matrices: number[][] = []; a.traverse(node => matrices.push(node.matrixWorld.toArray()));
      for (let i = 0; i < 20; i++) animateActor(a, 2, 3, 'walk');
      a.updateMatrixWorld(true);
      let i = 0; a.traverse(node => expect(node.matrixWorld.toArray()).toEqual(matrices[i++]));
      animateActor(a, 3, 0, 'dead'); animateActor(a, 2, 3, 'walk');
      expect(a.position.toArray()).toEqual([20, 40, 60]); expect(a.rotation.y).toBe(1.2);
    }
  });
});
