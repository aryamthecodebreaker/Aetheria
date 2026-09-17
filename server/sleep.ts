import { blockKey, distance } from '../shared/constants';
import type { Vec3 } from '../shared/types';
import type { Actions } from './actions';
import { mobDef } from './entities';
import { nearbySafe, safePosition } from './mechanics';
import { inventory, notice, type Session } from './session';

export function useBed(actions: Actions, s: Session, bed: Vec3) {
  const p = s.player!, g = s.game!;
  if (p.realm !== 'verdant') { notice(s,'Beds only offer restful sleep in Verdant.'); return; }
  const point = nearbySafe(g,p.realm,{ x:bed.x+0.5,y:bed.y,z:bed.z+0.5 },2);
  if (!point) { notice(s,'Clear safe standing space beside the bed.'); return; }
  p.spawn = { ...point,realm:p.realm };
  inventory(s);
  if (g.time < 0.55) { notice(s,'Spawn set. Return at night to sleep.'); return; }
  if (g.entities.some(e => e.realm === p.realm && e.hp > 0 && mobDef(e.kind).hostile && distance(e,p) < 16)) { notice(s,'Hostile creatures are too close to sleep.'); return; }
  const key = blockKey(p.realm,bed.x,bed.y,bed.z);
  if (actions.online(g).some(o => o !== s && o.sleeping?.key === key)) { notice(s,'This bed is already occupied.'); return; }
  s.sleeping = { key,point:{x:p.x,y:p.y,z:p.z} };
  notice(s,'Resting. Waiting for the group to sleep.');
  stepSleep(actions,g);
}
export function stepSleep(actions: Actions, g: NonNullable<Session['game']>) {
  const online = actions.online(g), eligible = online.filter(s => s.player!.hp > 0 && ['survival','adventure'].includes(s.player!.mode));
  for (const s of online) if (s.sleeping) {
    const p = s.player!, [realm,pos] = s.sleeping.key.split(':'), [x,y,z] = pos.split(',').map(Number);
    if (g.time < 0.55 || p.hp <= 0 || p.realm !== realm || distance(p,s.sleeping.point) > 0.5 || g.world.get('verdant',x,y,z) !== 49 || !safePosition(g,'verdant',p.spawn) || g.entities.some(e => e.realm === realm && e.hp > 0 && mobDef(e.kind).hostile && distance(e,p) < 16)) s.sleeping = undefined;
  }
  const sleepers = eligible.filter(s => s.sleeping), needed = Math.max(1,Math.ceil(eligible.length*g.rules.sleepPercent/100));
  if (g.time >= 0.55 && sleepers.length >= needed) {
    g.time = 0.25; g.weather = 'clear';
    for (const s of online) { s.sleeping = undefined; notice(s,'The group slept safely until dawn.'); }
  }
}
