import type { GameWorld } from './storage';
import type { Player, Realm } from '../shared/types';
import { blockDef } from '../shared/blocks';
import { machineAt, type BlockChange } from './mechanics';
import { growCrop } from './farming';
import { stepForge } from './containers';
import { stepCircuits } from './circuits';

const clocks = new WeakMap<GameWorld,number>();
export function stepMachines(g: GameWorld, dt: number, notify?: BlockChange, players?: Player[]): number {
  const change: BlockChange = (realm,x,y,z,id) => {
    g.world.set(realm,x,y,z,id);
    const m = machineAt(g,realm,x,y,z);
    if (m?.kind === 'crop') m.progress = id === 32 ? 90 : id === 52 ? 45 : 0;
    notify?.(realm,x,y,z,id);
  };
  for (const [key,m] of g.machines) {
    if (m.kind === 'crop') {
      const [realm,pos] = key.split(':'), [x,y,z] = pos.split(',').map(Number);
      if (!blockDef(g.world.get(realm as Realm,x,y,z)).crop) { g.machines.delete(key); continue; }
      growCrop(g,realm as Realm,x,y,z,m,dt,change);
    } else if (m.kind === 'forge') stepForge(m,dt);
  }
  const clock = (clocks.get(g) ?? 0)+dt;
  if (clock >= 0.5 - 1e-9) { const result = stepCircuits(g,change,players); clocks.set(g,Math.max(0,clock-0.5) % 0.5); return result; }
  clocks.set(g,clock);
  return 0;
}
