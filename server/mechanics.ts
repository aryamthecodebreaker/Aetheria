import { blockDef } from '../shared/blocks';
import { blockKey, HEIGHT } from '../shared/constants';
import { emptyInventory } from '../shared/inventory';
import type { Machine, Realm, Vec3 } from '../shared/types';
import type { GameWorld } from './storage';

export type BlockChange = (realm: Realm, x: number, y: number, z: number, id: number) => void;
export const neighbors = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
export function machineAt(g: GameWorld, realm: Realm, x: number, y: number, z: number): Machine | undefined {
  const id = g.world.get(realm,x,y,z), def = blockDef(id);
  const kind = def.crop ? 'crop' : id === 40 ? 'lever' : id === 39 ? 'wire' : [27,41].includes(id) ? 'lamp' : [33,50].includes(id) ? 'door' : def.machine ?? def.container;
  if (!kind) return;
  const key = blockKey(realm,x,y,z);
  let m = g.machines.get(key);
  if (!m || m.kind !== kind) {
    m = { kind, slots: emptyInventory(kind === 'forge' ? 3 : kind === 'chest' ? 27 : kind === 'hopper' ? 5 : 0), progress: id === 32 ? 90 : id === 52 ? 45 : 0, fuel: 0, powered: false };
    g.machines.set(key,m);
  }
  return m;
}
export function skyVisible(g: GameWorld, realm: Realm, x: number, y: number, z: number) {
  for (let h = y + 1; h < HEIGHT; h++) if (blockDef(g.world.get(realm,x,h,z)).opaque) return false;
  return true;
}
export function safePosition(g: GameWorld, realm: Realm, p: Vec3) {
  if (![p.x,p.y,p.z].every(Number.isFinite) || Math.abs(p.x) > 100000 || Math.abs(p.z) > 100000 || p.y < 1 || p.y + 1.8 >= HEIGHT) return false;
  for (const x of [p.x - 0.3,p.x + 0.3]) for (const z of [p.z - 0.3,p.z + 0.3]) {
    const ground = g.world.get(realm,x,p.y - 0.05,z);
    if (!blockDef(ground).solid || [17,38,49].includes(ground)) return false;
    for (const y of [p.y,p.y + 0.9,p.y + 1.79]) {
      const def = blockDef(g.world.get(realm,x,y,z));
      if (def.solid || def.liquid) return false;
    }
  }
  return true;
}
export function nearbySafe(g: GameWorld, realm: Realm, p: Vec3, radius = 4): Vec3 | undefined {
  if (safePosition(g,realm,p)) return { ...p };
  for (let r = 0; r <= radius; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    if (Math.max(Math.abs(dx),Math.abs(dz)) !== r) continue;
    for (const dy of [0,1,-1,2,-2]) {
      const point = { x: Math.floor(p.x) + dx + 0.5, y: Math.floor(p.y) + dy, z: Math.floor(p.z) + dz + 0.5 };
      if (safePosition(g,realm,point)) return point;
    }
  }
}
export function respawnPoint(g: GameWorld, realm: Realm, p: Vec3): Vec3 {
  const saved = nearbySafe(g,realm,p);
  if (saved) return saved;
  const generated = g.world.gen.spawn(realm), fallback = nearbySafe(g,realm,generated,12);
  if (fallback) return fallback;
  for (let r = 0; r <= 12; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    if (Math.max(Math.abs(dx),Math.abs(dz)) !== r) continue;
    for (let y = HEIGHT-3; y > 0; y--) {
      const point = {x:Math.floor(generated.x)+dx+0.5,y,z:Math.floor(generated.z)+dz+0.5};
      if (safePosition(g,realm,point)) return point;
    }
  }
  throw new Error('No safe respawn space remains near the arrival grounds');
}
