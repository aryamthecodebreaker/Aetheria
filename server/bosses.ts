import { blockDef } from '../shared/blocks';
import { distance } from '../shared/constants';
import type { Entity, Player, Realm, Vec3 } from '../shared/types';
import type { GameWorld } from './storage';
import type { World } from './world';
import { eid, groundHeight, mobDef } from './entities';
import { safePosition } from './mechanics';

export const isBoss = (kind: string) => kind === 'cinder_guardian' || kind === 'aether_crown';
export function bossSpawn(g: GameWorld, realm: Realm, center: Vec3, players: number): Entity | undefined {
  if (realm === 'verdant' || g.bossDefeated.includes(realm) || g.entities.some(e => isBoss(e.kind) && e.realm === realm)) return;
  const kind = realm === 'cinder' ? 'cinder_guardian' : 'aether_crown';
  for (let radius = 0; radius <= 12; radius++) for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
    if (Math.max(Math.abs(dx),Math.abs(dz)) !== radius) continue;
    const x = Math.floor(center.x)+12+dx+0.5, z = Math.floor(center.z)+dz+0.5;
    const y = groundHeight(g.world,realm,x,z,g.world.gen.surface(x,z,realm)+3);
    if (!safePosition(g,realm,{x,y,z})) continue;
    const maxHp = Math.round(mobDef(kind).hp*(1+0.35*Math.max(0,players-1)));
    return { id:eid(),kind,realm,x,y,z,hp:maxHp,maxHp,yaw:0,state:'idle',age:0,phase:1,attackTimer:2,home:{x,y,z} };
  }
}
export function clearSight(world: World, realm: Realm, a: Vec3, b: Vec3) {
  const d = distance(a,b);
  for (let t = 0.2; t < d; t += 0.2) if (blockDef(world.get(realm,a.x+(b.x-a.x)*t/d,a.y+(b.y-a.y)*t/d,a.z+(b.z-a.z)*t/d)).solid) return false;
  return true;
}
export function moveMob(e: Entity, world: World, dx: number, dz: number) {
  const steps = Math.max(1,Math.ceil(Math.hypot(dx,dz)/0.2));
  for (let i = 0; i < steps; i++) {
    const x = e.x+dx/steps, z = e.z+dz/steps, y = groundHeight(world,e.realm,x,z,e.y+0.6);
    if (y < e.y-1 || y > e.y+1 || [17,38].includes(world.get(e.realm,x,y-1,z)) || blockDef(world.get(e.realm,x,y,z)).liquid || blockDef(world.get(e.realm,x,y+1,z)).solid) break;
    Object.assign(e,{x,y,z});
  }
}
export function stepBoss(e: Entity, world: World, players: Player[], dt: number, hit: (p: Player,n: number) => void) {
  const eligible = players.filter(p => p.realm === e.realm && p.hp > 0 && ['survival','adventure'].includes(p.mode));
  const target = eligible.filter(p => distance(p,e) < 28).sort((a,b) => distance(a,e)-distance(b,e))[0];
  const phase = e.hp <= e.maxHp/2 ? 2 : 1;
  e.phase = phase;
  e.attackTimer = (e.attackTimer ?? 2)-dt;
  if (e.home && distance(e,e.home) > 32) { Object.assign(e,e.home); e.state = 'idle'; e.attackTimer = 2; return; }
  if (e.state === 'windup_radial' || e.state === 'windup_rush') {
    if (e.attackTimer! > 0) return;
    if (e.state === 'windup_radial') {
      for (const p of eligible) if (Math.hypot(p.x-e.x,p.z-e.z) < 4.5 && Math.abs(p.y-e.y) < 1.2 && clearSight(world,e.realm,{...e,y:e.y+1},{...p,y:p.y+1})) hit(p,mobDef(e.kind).damage);
      e.state = 'recover'; e.attackTimer = 1.4;
    } else { e.state = 'rush'; e.attackTimer = 0.7; }
    return;
  }
  if (e.state === 'rush') {
    moveMob(e,world,Math.sin(e.yaw)*12*dt,Math.cos(e.yaw)*12*dt);
    for (const p of eligible) if (distance(p,e) < 1.6) { hit(p,mobDef(e.kind).damage+2); e.attackTimer = 0; break; }
    if (e.attackTimer! <= 0) { e.state = 'recover'; e.attackTimer = 1.6; }
    return;
  }
  if (e.state === 'recover') { if (e.attackTimer! <= 0) { e.state = 'idle'; e.attackTimer = 1; } return; }
  if (!target) { e.state = 'idle'; e.attackTimer = Math.max(1,e.attackTimer!); return; }
  e.yaw = Math.atan2(target.x-e.x,target.z-e.z);
  if (e.attackTimer! <= 0 && distance(target,e) < (phase === 2 ? 16 : 6)) {
    e.state = phase === 2 ? 'windup_rush' : 'windup_radial'; e.attackTimer = phase === 2 ? 1 : 1.2;
    return;
  }
  e.state = 'walk';
  moveMob(e,world,Math.sin(e.yaw)*2*dt,Math.cos(e.yaw)*2*dt);
}
