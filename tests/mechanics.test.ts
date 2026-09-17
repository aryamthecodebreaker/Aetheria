import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { WebSocket } from 'ws';
import { Storage } from '../server/storage';
import { Actions } from '../server/actions';
import { stepMachines } from '../server/machines';
import { insertStack, transferOne } from '../server/containers';
import { bossSpawn, stepBoss } from '../server/bosses';
import { stepMob } from '../server/entities';
import { machineAt, respawnPoint, safePosition } from '../server/mechanics';
import { stepSleep } from '../server/sleep';
import { idleInput, type Session } from '../server/session';
import { parseMessage } from '../server/protocol';
import { emptyInventory, countItem } from '../shared/inventory';
import { blockDef } from '../shared/blocks';
import type { Action, Player, Realm, ServerMessage } from '../shared/types';

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir,{recursive:true,force:true}); });
function fixture() {
  const storage = new Storage('unused'), g = storage.create('Test','mechanics','survival',1,randomUUID());
  const p: Player = { id:randomUUID(),name:'Tester',color:'#abcdef',x:0.5,y:70,z:0.5,vy:0,grounded:false,yaw:0,pitch:0,realm:'verdant',mode:'survival',hp:20,hunger:20,air:20,xp:0,inventory:emptyInventory(),selected:0,spawn:{x:0.5,y:70,z:0.5,realm:'verdant'},achievements:[],deaths:0,mined:0,placed:0,seq:0 };
  const messages: ServerMessage[] = [], profile = {player:p,returns:{}};
  const s: Session = {socket:{readyState:1,bufferedAmount:0,send:(raw:string) => messages.push(JSON.parse(raw))} as unknown as WebSocket,game:g,player:p,profile,hash:g.admin,input:idleInput(),inputAt:0,subscriptions:new Set(['verdant:0,0']),lastAction:-10000,lastAttack:-10000,lastChat:0,lastPortal:0,survival:0,budget:160,chunks:32,refill:0};
  g.profiles.set('test',profile);
  const sessions = new Set([s]), actions = new Actions(sessions,storage);
  const set = (x:number,y:number,z:number,id:number,realm:Realm = 'verdant') => actions.set(g,realm,x,y,z,id);
  for (let x = -5; x <= 20; x++) for (let z = -5; z <= 5; z++) {
    g.world.set('verdant',x,69,z,3);
    for (let y = 70; y < 80; y++) g.world.set('verdant',x,y,z,0);
  }
  const act = (a:Action) => { s.lastAction = -10000; s.lastAttack = -10000; actions.handle(s,a); };
  const power = (x:number,y:number,z:number) => { set(x,y,z,40); machineAt(g,'verdant',x,y,z)!.powered = true; };
  return {storage,g,p,s,messages,sessions,actions,set,act,power};
}

describe('container-adjacent placement', () => {
  it.each([25,53])('places against block %i without opening it and consumes one carried block', id => {
    const {g,p,s,set,act} = fixture();
    set(2,70,0,id);
    p.inventory[0] = {id:129,count:2};
    act({type:'place',x:1,y:70,z:0});
    expect(g.world.get('verdant',1,70,0)).toBe(29);
    expect(g.world.get('verdant',2,70,0)).toBe(id);
    expect(p.inventory[0]?.count).toBe(1);
    expect(s.container).toBeUndefined();
  });
});

describe('circuits and transfers', () => {
  it('toggles lever use, broadcasts edits and preserves registry collision and light states', () => {
    const {g,set,act,messages} = fixture();
    set(2,70,0,40); set(3,70,0,39); set(4,70,0,27);
    act({type:'use',x:2,y:70,z:0});
    stepMachines(g,0.5,(realm,x,y,z,id) => messages.push({type:'block',realm,x,y,z,id}));
    expect(g.world.get('verdant',4,70,0)).toBe(41);
    expect(g.machines.get('verdant:3,70,0')?.powered).toBe(true);
    act({type:'use',x:2,y:70,z:0}); stepMachines(g,0.5);
    expect(g.world.get('verdant',4,70,0)).toBe(27);
    expect(blockDef(27).light).toBe(0); expect(blockDef(41).light).toBe(15);
    expect(blockDef(50).solid).toBe(false);
    expect(messages.some(m => m.type === 'block' && m.id === 41)).toBe(true);
  });
  it('bounds traversal at 512 even with loops and loses power across a broken wire', () => {
    const {g,set,power} = fixture(); power(0,70,0);
    for (let x = 1; x <= 600; x++) set(x,70,0,39);
    expect(stepMachines(g,0.5)).toBe(512);
    expect(g.machines.get('verdant:511,70,0')?.powered).toBe(true);
    expect(g.machines.get('verdant:512,70,0')?.powered).toBe(false);
    set(5,70,0,0); stepMachines(g,0.5);
    expect(g.machines.get('verdant:10,70,0')?.powered).toBe(false);
  });
  it('opens circuit doors, delays occupied closing and supports manual toggles', () => {
    const {g,p,set,power,act} = fixture(); set(2,70,0,33); power(3,70,0);
    stepMachines(g,0.5); expect(g.world.get('verdant',2,70,0)).toBe(50);
    p.x = 2.5; g.machines.get('verdant:3,70,0')!.powered = false;
    stepMachines(g,0.5); expect(g.world.get('verdant',2,70,0)).toBe(50);
    p.x = 0.5; stepMachines(g,0.5); expect(g.world.get('verdant',2,70,0)).toBe(33);
    act({type:'use',x:2,y:70,z:0}); expect(g.world.get('verdant',2,70,0)).toBe(50);
    stepMachines(g,0.5); expect(g.world.get('verdant',2,70,0)).toBe(50);
  });
  it('powers solar only in exposed daylight', () => {
    const {g,set} = fixture(); set(0,70,0,54); set(1,70,0,27);
    stepMachines(g,0.5); expect(g.world.get('verdant',1,70,0)).toBe(41);
    g.time = 0.75; stepMachines(g,0.5); expect(g.world.get('verdant',1,70,0)).toBe(27);
    g.time = 0.25; set(0,72,0,3); stepMachines(g,0.5); expect(g.world.get('verdant',1,70,0)).toBe(27);
  });
  it('transfers one item per half-second and conserves all items', () => {
    const {g,set,power} = fixture(); set(0,70,0,25); set(0,71,0,53); set(0,72,0,25); power(1,71,0);
    const upper = g.machines.get('verdant:0,72,0')!, hopper = g.machines.get('verdant:0,71,0')!, lower = g.machines.get('verdant:0,70,0')!;
    upper.slots[0] = {id:29,count:2};
    stepMachines(g,0.25); expect(countItem(upper.slots,29)).toBe(2);
    stepMachines(g,0.25); expect(countItem(upper.slots,29)).toBe(1); expect(countItem(hopper.slots,29)).toBe(1);
    stepMachines(g,0.5); expect(countItem(lower.slots,29)).toBe(1);
    stepMachines(g,0.5); expect(countItem(lower.slots,29)).toBe(2);
    expect(countItem(hopper.slots,29)+countItem(upper.slots,29)).toBe(0);
  });
  it('checks forge slots, extracts only output and preserves metadata atomically', () => {
    const {g,set} = fixture(); set(0,70,0,24); set(1,70,0,53);
    const forge = g.machines.get('verdant:0,70,0')!, hopper = g.machines.get('verdant:1,70,0')!;
    expect(insertStack(forge,{id:29,count:1})).toBe(false);
    expect(insertStack(forge,{id:21,count:1})).toBe(true);
    expect(insertStack(forge,{id:20,count:1})).toBe(true);
    expect(transferOne(forge,hopper)).toBe(false);
    for (let i = 0; i < 241; i++) stepMachines(g,1/30);
    expect(transferOne(forge,hopper)).toBe(true);
    expect(countItem(hopper.slots,22)).toBe(1); expect(forge.slots[2]).toBeNull();
    expect(transferOne(hopper,hopper)).toBe(false);
    hopper.slots = Array.from({length:5},() => ({id:29,count:64}));
    forge.slots[2] = {id:22,count:1}; expect(transferOne(forge,hopper)).toBe(false);
    expect(forge.slots[2].count).toBe(1);
  });
});

describe('farming and benches', () => {
  it('grows visible stages with water and sky, blocks dark growth and accepts bone fertilizer', () => {
    const {g,set,act,p} = fixture(); set(2,69,0,31); set(3,69,0,5); set(2,70,0,51);
    stepMachines(g,45); expect(g.world.get('verdant',2,70,0)).toBe(52);
    set(2,72,0,3); stepMachines(g,45); expect(g.world.get('verdant',2,70,0)).toBe(52);
    set(2,72,0,0); p.inventory[0] = {id:35,count:1};
    act({type:'use',x:2,y:70,z:0}); expect(g.world.get('verdant',2,70,0)).toBe(32); expect(countItem(p.inventory,35)).toBe(0);
    act({type:'use',x:2,y:70,z:0}); expect(g.world.get('verdant',2,70,0)).toBe(51);
    expect(countItem(p.inventory,29)).toBe(3); expect(countItem(p.inventory,48)).toBe(1);
    act({type:'use',x:2,y:70,z:0}); expect(countItem(p.inventory,29)).toBe(3);
  });
  it('harvests adjacent crops once and never loses produce to full hoppers', () => {
    const {g,set,power} = fixture(); set(0,70,0,53); power(-1,70,0); set(1,69,0,31); set(1,70,0,32);
    const hopper = g.machines.get('verdant:0,70,0')!;
    hopper.slots = Array.from({length:5},() => ({id:3,count:1,durability:10}));
    stepMachines(g,0.5); expect(g.world.get('verdant',1,70,0)).toBe(32);
    hopper.slots = emptyInventory(5); stepMachines(g,0.5);
    expect(g.world.get('verdant',1,70,0)).toBe(51);
    expect(countItem(hopper.slots,29)).toBe(3); expect(countItem(hopper.slots,48)).toBe(1);
    stepMachines(g,0.5); expect(countItem(hopper.slots,29)).toBe(3);
  });
  it('repairs at a bench for materials and XP and improves enhanced mining speed', () => {
    const {g,set,p,act,s} = fixture(); set(2,70,0,23); p.xp = 20;
    p.inventory[0] = {id:3,count:1,durability:10}; p.inventory[1] = {id:22,count:2};
    act({type:'repair',slot:0}); expect(p.inventory[0]?.durability).toBe(114); expect(p.xp).toBe(17); expect(countItem(p.inventory,22)).toBe(0);
    p.inventory[1] = {id:28,count:1}; act({type:'enhance',slot:0}); expect(p.inventory[0]?.enhancement).toBe(1);
    set(2,71,1,3); act({type:'mine',x:2,y:71,z:1});
    s.mine!.start -= 125; act({type:'mine',x:2,y:71,z:1}); expect(g.world.get('verdant',2,71,1)).toBe(0);
  });
});

describe('beds, bosses and saving', () => {
  it('sets a safe beside-bed spawn and respawns to saved coordinates', () => {
    const {g,set,p,act,s} = fixture(); set(2,70,0,49); act({type:'use',x:2,y:70,z:0});
    const saved = {...p.spawn}; expect(safePosition(g,'verdant',saved)).toBe(true); expect(saved.x).not.toBe(0.5);
    p.hp = 0; p.x = 50; act({type:'respawn'}); expect(s.player!.x).toBe(saved.x); expect(s.player!.z).toBe(saved.z);
    set(Math.floor(saved.x),69,Math.floor(saved.z),0);
    expect(safePosition(g,'verdant',respawnPoint(g,'verdant',saved))).toBe(true);
  });
  it('requires the group threshold and cancels sleep after movement', () => {
    const {g,set,act,s,sessions,actions,p} = fixture(); set(2,70,0,49); g.time = 0.75; g.rules.sleepPercent = 100;
    const other:Session = {...s,player:{...p,id:'other',x:3.5},sleeping:undefined}; sessions.add(other);
    act({type:'use',x:2,y:70,z:0}); expect(g.time).toBe(0.75); expect(s.sleeping).toBeDefined();
    p.x += 1; stepSleep(actions,g); expect(s.sleeping).toBeUndefined();
    p.x = 0.5; act({type:'use',x:2,y:70,z:0}); other.lastAction = -10000;
    actions.handle(other,{type:'use',x:2,y:70,z:0}); expect(g.time).toBe(0.75);
    set(4,70,0,49); other.lastAction = -10000;
    actions.handle(other,{type:'use',x:4,y:70,z:0}); expect(g.time).toBe(0.25);
  });
  it('spawns one scaled boss near realm arrival, telegraphs radial and rush attacks with dodge windows', () => {
    const {g,p} = fixture(), center = g.world.gen.spawn('cinder');
    const boss = bossSpawn(g,'cinder',center,2)!; expect(boss).toBeDefined(); expect(boss.maxHp).toBe(108);
    g.entities.push(boss); expect(bossSpawn(g,'cinder',center,1)).toBeUndefined();
    Object.assign(boss,{realm:'verdant',x:5.5,y:70,z:0.5,home:{x:5.5,y:70,z:0.5},attackTimer:0});
    p.x = 7.5; let hits = 0;
    stepBoss(boss,g.world,[p],0.1,() => hits++); expect(boss.state).toBe('windup_radial'); expect(hits).toBe(0);
    p.x = 12; stepBoss(boss,g.world,[p],1.3,() => hits++); expect(hits).toBe(0);
    boss.hp = 40; boss.state = 'idle'; boss.attackTimer = 0; p.x = 9;
    stepBoss(boss,g.world,[p],0.1,() => hits++); expect(boss.state).toBe('windup_rush'); expect(boss.phase).toBe(2);
    p.z = 4; stepBoss(boss,g.world,[p],1.1,() => hits++);
    for (let i = 0; i < 30; i++) stepBoss(boss,g.world,[p],1/30,() => hits++);
    expect(hits).toBe(0);
  });
  it('persists boss defeat, trophy, blade, spawn and circuit/crop state', async () => {
    const {g,storage,set,p,act} = fixture();
    const dir = await mkdtemp(join(tmpdir(),'aetheria-mechanics-')); dirs.push(dir);
    const store = new Storage(dir); store.worlds = storage.worlds;
    const boss = {id:'boss',kind:'cinder_guardian',realm:'verdant' as const,x:2.5,y:70,z:0.5,hp:1,maxHp:80,yaw:0,state:'idle',age:0};
    g.entities.push(boss); act({type:'attack',id:boss.id});
    expect(countItem(p.inventory,148)).toBe(1); expect(countItem(p.inventory,42)).toBe(1);
    expect(g.entities.filter(e => e.kind === 'drop').some(e => e.stack?.id === 28)).toBe(true);
    expect(p.achievements).toContain('boss_verdant');
    set(3,70,0,50); set(4,70,0,52); set(5,70,0,40); g.machines.get('verdant:5,70,0')!.powered = true;
    p.spawn = {x:9.5,y:70,z:0.5,realm:'verdant'};
    await store.save(); const restored = new Storage(dir); await restored.load();
    const saved = restored.worlds.get(g.meta.id)!;
    expect(saved.bossDefeated).toContain('verdant'); expect(saved.world.get('verdant',3,70,0)).toBe(50);
    expect(saved.world.get('verdant',4,70,0)).toBe(52); expect(saved.machines.get('verdant:5,70,0')?.powered).toBe(true);
    expect(saved.profiles.get('test')?.player.spawn.x).toBe(9.5);
  });
  it('retaliates with grazers, flees with peeps and lets players dodge wisp shots', () => {
    const {g,p} = fixture(); p.x = 3;
    const grazer = {id:'g',kind:'grazer',realm:'verdant' as const,x:1,y:70,z:0.5,hp:8,maxHp:8,yaw:0,state:'idle',age:0,owner:p.id,aggroTime:10};
    stepMob(grazer,g.world,[p],0.2,() => 0); expect(grazer.x).toBeGreaterThan(1);
    const peep = {...grazer,kind:'peep',x:1}; stepMob(peep,g.world,[p],0.2,() => 0); expect(peep.x).toBeLessThan(1);
    const wisp = {...grazer,kind:'wisp',x:8,pathT:0}; let hits = 0;
    stepMob(wisp,g.world,[p],0.1,() => 0,() => hits++); expect(wisp.state).toBe('windup');
    p.z = 4; stepMob(wisp,g.world,[p],0.8,() => 0,() => hits++); expect(hits).toBe(0);
  });
  it('accepts registered new items and repair, rejecting nonexistent IDs', () => {
    for (const item of [148,149,150,151,152,153,154,48]) expect(parseMessage(JSON.stringify({type:'action',action:{type:'creative',item}}))).not.toBeNull();
    expect(parseMessage(JSON.stringify({type:'action',action:{type:'creative',item:155}}))).toBeNull();
    expect(parseMessage(JSON.stringify({type:'action',action:{type:'repair',slot:2}}))).not.toBeNull();
  });
});
