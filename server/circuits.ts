import { blockKey } from '../shared/constants';
import type { Player, Realm } from '../shared/types';
import type { GameWorld } from './storage';
import { machineAt, neighbors, skyVisible, type BlockChange } from './mechanics';
import { transferOne } from './containers';
import { harvestInto } from './farming';

export const CIRCUIT_LIMIT = 512;
export function stepCircuits(g: GameWorld, change: BlockChange, players: Player[] = [...g.profiles.values()].map(p => p.player)) {
  const powered = new Set<string>(), queued = new Set<string>();
  const queue: { realm: Realm; x: number; y: number; z: number }[] = [];
  for (const [key,m] of g.machines) {
    if (!['lever','solar'].includes(m.kind)) continue;
    const [r,pos] = key.split(':'), [x,y,z] = pos.split(',').map(Number), realm = r as Realm;
    if (g.world.get(realm,x,y,z) !== (m.kind === 'lever' ? 40 : 54)) { g.machines.delete(key); continue; }
    if (m.kind === 'solar') m.powered = g.time < 0.55 && g.weather !== 'storm' && skyVisible(g,realm,x,y,z);
    if (m.powered && queue.length < CIRCUIT_LIMIT) { queue.push({realm,x,y,z}); queued.add(key); }
  }
  for (let i = 0; i < queue.length; i++) {
    const {realm,x,y,z} = queue[i];
    for (const [dx,dy,dz] of neighbors) {
      const nx = x+dx, ny = y+dy, nz = z+dz, id = g.world.get(realm,nx,ny,nz), key = blockKey(realm,nx,ny,nz);
      if (![39,27,41,33,50,53].includes(id)) continue;
      if (id === 39 && !queued.has(key)) {
        if (queue.length >= CIRCUIT_LIMIT) continue;
        queue.push({realm,x:nx,y:ny,z:nz}); queued.add(key);
      }
      powered.add(key); machineAt(g,realm,nx,ny,nz);
    }
  }
  for (const [key,m] of g.machines) {
    if (!['wire','lamp','door','hopper'].includes(m.kind)) continue;
    const [r,pos] = key.split(':'), [x,y,z] = pos.split(',').map(Number), realm = r as Realm;
    const was = m.powered; m.powered = powered.has(key);
    const id = g.world.get(realm,x,y,z);
    if (m.kind === 'lamp' && [27,41].includes(id) && id !== (m.powered ? 41 : 27)) change(realm,x,y,z,m.powered ? 41 : 27);
    if (m.kind === 'door' && [33,50].includes(id) && was !== m.powered) {
      const occupied = players.some(p => p.realm === realm && p.hp > 0 && p.mode !== 'spectator' && Math.abs(p.x-x-0.5) < 0.8 && Math.abs(p.z-z-0.5) < 0.8 && p.y < y+1 && p.y+1.8 > y);
      if (m.powered || !occupied) change(realm,x,y,z,m.powered ? 50 : 33);
      else m.powered = was;
    }
  }
  for (const [key,m] of g.machines) {
    if (m.kind !== 'hopper' || !m.powered) continue;
    const [r,pos] = key.split(':'), [x,y,z] = pos.split(',').map(Number), realm = r as Realm;
    const below = machineAt(g,realm,x,y-1,z), above = machineAt(g,realm,x,y+1,z);
    if (below) transferOne(m,below);
    if (above) transferOne(above,m);
    for (const [dx,dy,dz] of neighbors) if (harvestInto(g,realm,x+dx,y+dy,z+dz,m.slots,change)) break;
  }
  return queue.length;
}
