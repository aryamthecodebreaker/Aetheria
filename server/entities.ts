import { randomUUID } from 'node:crypto';
import { BALANCE, distance } from '../shared/constants';
import { blockDef } from '../shared/blocks';
import type { Entity, Player, Realm, Stack } from '../shared/types';
import type { World } from './world';
import { clearSight, isBoss, moveMob, stepBoss } from './bosses';

export { bossSpawn } from './bosses';
export type ServerEntity = Entity & { vy: number; wanderT: number; pathT: number };
export const eid = () => randomUUID();
export function spawnDrop(_world: World, realm: Realm, x: number, y: number, z: number, stack: Stack): ServerEntity {
  return { id: eid(), kind: 'drop', realm, x, y, z, vy: 0, wanderT: 0, pathT: 0, hp: 1, maxHp: 1, yaw: 0, state: 'idle', age: 0, stack: { ...stack } };
}
export function mobDef(kind: string) {
  const defs: Record<string, { hp: number; speed: number; damage: number; hostile: boolean; boss?: boolean; drops: [string, number, number][]; xp: number }> = {
    grazer: { hp: 8, speed: 1.2, damage: 2, hostile: false, drops: [['raw_meat', 1, 2], ['hide', 1, 1]], xp: 2 },
    peep: { hp: 4, speed: 1, damage: 0, hostile: false, drops: [['raw_meat', 1, 1]], xp: 1 },
    shambler: { hp: 16, speed: 1.9, damage: 4, hostile: true, drops: [['essence', 1, 1], ['bone', 1, 2]], xp: 6 },
    cinder_guardian: { hp: 80, speed: 2.2, damage: 7, hostile: true, boss: true, drops: [['radiant', 2, 4]], xp: 60 },
    aether_crown: { hp: 140, speed: 1.8, damage: 9, hostile: true, boss: true, drops: [['radiant', 4, 6], ['sapphire', 2, 3]], xp: 120 },
    skitter: { hp: 8, speed: 3.2, damage: 2, hostile: true, drops: [['silk', 1, 2]], xp: 4 },
    wisp: { hp: 10, speed: 2.2, damage: 3, hostile: true, drops: [['essence', 1, 2]], xp: 6 },
    emberling: { hp: 20, speed: 2.4, damage: 6, hostile: true, drops: [['coal', 1, 3]], xp: 10 }
  };
  return defs[kind] ?? { hp: 20, speed: 0, damage: 0, hostile: false, drops: [], xp: 0 };
}
export function groundHeight(world: World, realm: Realm, x: number, z: number, from: number): number {
  for (let y = Math.min(79, Math.floor(from)); y >= 0; y--) if (blockDef(world.get(realm, x, y, z)).solid) return y + 1;
  return -20;
}
export function stepMob(e: Entity, world: World, players: Player[], dt: number, r: () => number, hit: (p: Player, n: number) => void = () => {}) {
  const mob = e as ServerEntity;
  mob.vy ??= 0; mob.wanderT ??= 0; mob.pathT ??= 0;
  e.age += dt; mob.pathT -= dt;
  if (isBoss(e.kind)) { stepBoss(e,world,players,dt,hit); return; }
  if (e.kind === 'drop') {
    mob.vy -= BALANCE.gravity*dt;
    const ground = groundHeight(world,e.realm,e.x,e.z,e.y);
    e.y = Math.max(ground,e.y+mob.vy*dt);
    if (e.y === ground) mob.vy = 0;
    return;
  }
  if (e.kind === 'trader') return;
  const def = mobDef(e.kind);
  e.aggroTime = Math.max(0,(e.aggroTime ?? 0)-dt);
  const target = players.filter(p => p.realm === e.realm && p.hp > 0 && ['survival','adventure'].includes(p.mode) && distance(p,e) < 18 && (def.hostile || e.aggroTime! > 0 && e.owner === p.id)).sort((a,b) => distance(a,e)-distance(b,e))[0];
  mob.wanderT -= dt;
  if (target) {
    e.yaw = Math.atan2(target.x-e.x,target.z-e.z); e.state = 'walk';
    if (e.kind === 'peep') e.yaw += Math.PI;
  } else if (mob.wanderT <= 0) { mob.wanderT = 3+r()*3; e.yaw = r()*Math.PI*2; e.state = r() > 0.4 ? 'walk' : 'idle'; }
  if (e.kind === 'wisp' && target) {
    const d = distance(target,e);
    if (e.state === 'walk' && d <= 10) {
      e.yaw += d < 5 ? Math.PI : Math.PI/2;
      if (mob.pathT <= 0) { e.state = 'windup'; e.attackTimer = 0.8; e.aggro = {x:target.x,y:target.y,z:target.z}; mob.pathT = 2.5; }
    }
    if (e.attackTimer !== undefined && e.aggro) {
      e.state = 'windup'; e.attackTimer -= dt;
      if (e.attackTimer <= 0) {
        if (distance(target,e.aggro) < 1.2 && clearSight(world,e.realm,{...e,y:e.y+1},{...target,y:target.y+1})) hit(target,def.damage);
        e.attackTimer = undefined; e.state = 'walk';
      }
    }
  }
  if (e.state === 'walk') {
    const speed = def.speed*(e.aggroTime! > 0 ? 1.8 : 1);
    moveMob(e,world,Math.sin(e.yaw)*speed*dt,Math.cos(e.yaw)*speed*dt);
  }
  if (target && e.kind !== 'wisp' && def.damage && distance(target,e) < 1.7 && mob.pathT <= 0 && clearSight(world,e.realm,{...e,y:e.y+1},{...target,y:target.y+1})) { hit(target,def.damage); mob.pathT = 1.2; }
}
