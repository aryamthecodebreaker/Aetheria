import { blockDef } from '../shared/blocks';
import { BALANCE } from '../shared/constants';
import { addItem } from '../shared/inventory';
import type { Inventory, Machine, Realm, Stack } from '../shared/types';
import type { GameWorld } from './storage';
import { skyVisible, type BlockChange } from './mechanics';

export const cropDrops = (id: number): Stack[] => id === 32 ? [{ id:29,count:3 },{ id:48,count:2 }] : [{ id:48,count:1 }];
export function cropCanGrow(g: GameWorld, realm: Realm, x: number, y: number, z: number) {
  if (g.world.get(realm,x,y-1,z) !== 31) return false;
  let water = false;
  for (let dx = -4; dx <= 4 && !water; dx++) for (let dz = -4; dz <= 4 && !water; dz++) water = g.world.get(realm,x+dx,y-1,z+dz) === 5;
  if (!water) return false;
  if (g.time < 0.55 && skyVisible(g,realm,x,y,z)) return true;
  for (let dx = -3; dx <= 3; dx++) for (let dy = -1; dy <= 3; dy++) for (let dz = -3; dz <= 3; dz++) {
    if ((blockDef(g.world.get(realm,x+dx,y+dy,z+dz)).light ?? 0) - Math.abs(dx) - Math.abs(dy) - Math.abs(dz) >= 8) return true;
  }
  return false;
}
export function growCrop(g: GameWorld, realm: Realm, x: number, y: number, z: number, m: Machine, dt: number, change: BlockChange) {
  const id = g.world.get(realm,x,y,z);
  if (!blockDef(id).crop) return;
  if (id === 32) { m.progress = BALANCE.cropSeconds; return; }
  if (!cropCanGrow(g,realm,x,y,z)) return;
  m.progress = Math.min(BALANCE.cropSeconds,m.progress+dt);
  const next = m.progress >= BALANCE.cropSeconds ? 32 : m.progress >= BALANCE.cropSeconds/2 ? 52 : 51;
  if (next !== id) {
    const progress = m.progress;
    change(realm,x,y,z,next);
    m.progress = progress;
  }
}
export function harvestInto(g: GameWorld, realm: Realm, x: number, y: number, z: number, slots: Inventory, change: BlockChange) {
  if (g.world.get(realm,x,y,z) !== 32) return false;
  const next = slots.map(s => s ? { ...s } : null);
  for (const stack of [{ id:29,count:3 },{ id:48,count:1 }]) if (addItem(next,stack)) return false;
  slots.splice(0,slots.length,...next);
  change(realm,x,y,z,51);
  return true;
}
