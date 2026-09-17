import { distance } from '../shared/constants';
import type { Actions } from './actions';
import { bossSpawn } from './bosses';
import { nearbySafe } from './mechanics';
import { notice, type Session } from './session';
import type { GameWorld } from './storage';

export function stepEncounters(g: GameWorld, online: Session[], actions: Actions) {
  if (!g.rules.mobSpawning) return;
  for (const realm of ['cinder','aether'] as const) {
    const players = online.filter(s => s.player!.realm === realm && s.player!.hp > 0 && ['survival','adventure'].includes(s.player!.mode));
    if (!players.length) continue;
    const center = g.world.gen.spawn(realm);
    if (!players.some(s => distance(s.player!,center) < 48)) continue;
    const boss = bossSpawn(g,realm,center,players.length);
    if (boss) {
      g.entities.push(boss);
      for (const s of players) {
        actions.advance(s,`realm_${realm}`,`${realm} reached. A guardian guards the arrival grounds.`);
        notice(s,`${realm === 'cinder' ? 'Cinder Guardian' : 'Aether Crown'} awakens at ${Math.floor(boss.x)}, ${Math.floor(boss.z)}. Jump or leave the radial strike; sidestep the rush below half health.`);
      }
    }
  }
  for (const s of online) {
    const p = s.player!;
    if (p.realm !== 'verdant') continue;
    const cx = Math.floor(p.x/128), cz = Math.floor(p.z/128);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const st = g.world.gen.structureAt(cx+dx,cz+dz);
      if (st?.kind !== 'settlement' || Math.hypot(p.x-st.x,p.z-st.z) > 100 || g.entities.filter(e => e.kind === 'trader').length >= 16) continue;
      const id = `trader:${st.x},${st.z}`;
      if (g.entities.some(e => e.id === id)) continue;
      const point = nearbySafe(g,'verdant',{x:st.x+4.5,y:st.y+1,z:st.z+0.5},3);
      if (point) g.entities.push({...point,id,kind:'trader',realm:'verdant',hp:20,maxHp:20,yaw:0,state:'idle',age:0});
    }
  }
}
