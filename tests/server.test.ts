import { afterEach, describe, expect, it, vi } from 'vitest';
import * as blocks from '../shared/blocks';
import { BALANCE } from '../shared/constants';
import { INPUT_QUEUE_LIMIT, stepBody } from '../shared/physics';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/main';
import { Storage, hashToken } from '../server/storage';
import { parseMessage } from '../server/protocol';
import { Actions } from '../server/actions';
import { stepMachines } from '../server/machines';
import type { Machine } from '../shared/types';
import { idleInput, receiveInput, resetMotion, tickInput, type Session } from '../server/session';
import { emptyInventory } from '../shared/inventory';
import { decodeRLE } from '../shared/codec';
import type { ClientMessage, Player, ServerMessage } from '../shared/types';

const dirs: string[] = [];
const servers: Awaited<ReturnType<typeof createGameServer>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const s of servers.splice(0)) await s.close(); for (const d of dirs.splice(0)) await rm(d,{ recursive:true,force:true }); });
async function temp() { const d = await mkdtemp(join(tmpdir(),'aetheria-test-')); dirs.push(d); return d; }

function player(): Player {
  return { id:randomUUID(),name:'Tester',color:'#abcdef',x:0.5,y:70,z:0.5,vy:0,grounded:false,yaw:0,pitch:0,realm:'verdant',mode:'survival',hp:20,hunger:20,air:20,xp:0,inventory:emptyInventory(),selected:0,spawn:{ x:0.5,y:70,z:0.5,realm:'verdant' },achievements:[],deaths:0,mined:0,placed:0,seq:0 };
}
function fixture() {
  const storage = new Storage('unused'), g = storage.create('Test','test','survival',1,randomUUID()), p = player(), messages: ServerMessage[] = [];
  const s: Session = { socket:{ readyState:1,bufferedAmount:0,send:(raw:string) => messages.push(JSON.parse(raw)) } as unknown as WebSocket, game:g,player:p,profile:{ player:p,returns:{} },hash:g.admin,input:idleInput(),inputAt:0,subscriptions:new Set(['verdant:0,0']),lastAction:0,lastAttack:0,lastChat:0,lastPortal:0,survival:0,budget:160,chunks:32,refill:0 };
  const sessions = new Set([s]);
  return { storage,g,p,s,messages,sessions,actions:new Actions(sessions,storage) };
}

describe('protocol validation', () => {
  it('rejects malformed shapes, nonfinite values, invalid coordinates and oversized batches', () => {
    for (const value of [null,[],{},42,{type:'nope'},{type:'input',input:null},{type:'chunks',realm:'verdant',coords:[[0,0,1]]},{type:'chunks',realm:'verdant',coords:Array(17).fill([0,0])},{type:'action',action:{type:'mine',x:0,y:80,z:0}},{type:'action',action:{type:'craft',recipe:'planks',count:-1}}]) expect(parseMessage(JSON.stringify(value))).toBeNull();
    expect(parseMessage('{')).toBeNull();
    expect(parseMessage('{"type":"input","input":{"forward":1e999}}')).toBeNull();
    expect(parseMessage(JSON.stringify({type:'input',input:idleInput()}))).not.toBeNull();
    expect(parseMessage(JSON.stringify({type:'hello',token:'guessable',name:'x',color:'#ffffff',world:'x'}))).toBeNull();
    expect(parseMessage(JSON.stringify({type:'hello',token:randomUUID(),name:'x',color:'#ffffff',world:'x'}))).not.toBeNull();
  });
});

describe('authoritative actions', () => {
  it('requires elapsed mining time, reach, line of sight and broadcasts subscribed edits', () => {
    const {g,p,s,actions,messages} = fixture();
    g.world.set('verdant',2,71,0,2);
    const mine = {type:'mine' as const,x:2,y:71,z:0};
    actions.handle(s,mine); actions.handle(s,mine);
    expect(g.world.get('verdant',2,71,0)).toBe(2);
    s.mine!.start -= 1000; actions.handle(s,mine);
    expect(g.world.get('verdant',2,71,0)).toBe(0);
    expect(p.inventory[0]).toEqual({id:102,count:1});
    expect(messages.some(m => m.type === 'block')).toBe(true);
    g.world.set('verdant',3,71,0,2); g.world.set('verdant',1,71,0,3);
    s.lastAction = 0; p.mode = 'creative'; actions.handle(s,{type:'mine',x:3,y:71,z:0});
    expect(g.world.get('verdant',3,71,0)).toBe(2);
    g.world.set('verdant',20,71,0,2); actions.handle(s,{type:'mine',x:20,y:71,z:0});
    expect(g.world.get('verdant',20,71,0)).toBe(2);
  });
  it('rejects occupied placement, remote containers and spectator inventory actions', () => {
    const {g,p,s,actions} = fixture();
    p.inventory[0] = {id:129,count:2}; g.world.set('verdant',0,69,0,3);
    actions.handle(s,{type:'place',x:0,y:70,z:0});
    expect(g.world.get('verdant',0,70,0)).toBe(0); expect(p.inventory[0]?.count).toBe(2);
    const key = 'verdant:20,70,0'; g.machines.set(key,{kind:'chest',slots:emptyInventory(27),fuel:0,progress:0,powered:false}); s.container = key;
    s.lastAction = 0; actions.handle(s,{type:'transfer',slot:0,toContainer:true,container:key}); expect(p.inventory[0]?.count).toBe(2);
    p.mode = 'spectator'; s.lastAction = 0; actions.handle(s,{type:'drop'}); expect(p.inventory[0]?.count).toBe(2);
  });
  it('enforces attack cooldown independently of selection and consumes tool durability', () => {
    const {g,p,s,actions} = fixture();
    p.inventory[0] = {id:11,count:1,durability:20};
    const mob = {id:'target',kind:'shambler',realm:'verdant' as const,x:2,y:70,z:0.5,hp:30,maxHp:30,yaw:0,state:'idle',age:0};
    g.entities.push(mob);
    s.lastAttack = -1000; s.lastAction = -1000;
    actions.handle(s,{type:'attack',id:mob.id});
    expect(mob.hp).toBe(23); expect(p.inventory[0]?.durability).toBe(19);
    actions.handle(s,{type:'select',slot:0}); s.lastAction = -1000;
    actions.handle(s,{type:'attack',id:mob.id});
    expect(mob.hp).toBe(23);
    s.lastAttack -= 500; s.lastAction = -1000;
    actions.handle(s,{type:'attack',id:mob.id}); expect(mob.hp).toBe(16);
  });
  it('drops inventory once on death and blocks noncreator commands', () => {
    const {g,p,s,actions} = fixture(); p.inventory[0] = {id:29,count:4};
    actions.damage(s,100); actions.damage(s,100);
    expect(g.entities).toHaveLength(1); expect(p.deaths).toBe(1); expect(p.inventory.every(x => x === null)).toBe(true);
    s.hash = hashToken(randomUUID()); actions.chat(s,'/mode creative'); expect(p.mode).toBe('survival');
    actions.handle(s,{type:'respawn'}); expect(p.hp).toBe(20);
  });
});

describe('carried armor', () => {
  it('uses only the strongest item per slot and wears only those pieces on combat hits', () => {
    const {p,s,actions} = fixture();
    p.inventory[0] = {id:15,count:1,durability:20};
    p.inventory[1] = {id:17,count:1,durability:20};
    p.inventory[2] = {id:17,count:1,durability:20};
    p.inventory[3] = {id:14,count:1};
    p.inventory[4] = {id:16,count:1};
    actions.damage(s,10,'combat');
    expect(p.hp).toBeCloseTo(14);
    expect(p.inventory[0]?.durability).toBe(20);
    expect(p.inventory[1]?.durability).toBe(19);
    expect(p.inventory[2]?.durability).toBe(20);
    expect(p.inventory[3]?.durability).toBe(179);
    expect(p.inventory[4]?.durability).toBe(159);
  });
  it('caps mitigation at eighty percent for future stronger armor definitions', () => {
    const {p,s,actions} = fixture(), itemDef = blocks.itemDef;
    vi.spyOn(blocks,'itemDef').mockImplementation(id => id === 17 ? {...itemDef(id),armor:30} : itemDef(id));
    p.inventory[0] = {id:17,count:1,durability:20};
    actions.damage(s,10,'combat');
    expect(p.hp).toBeCloseTo(18);
    expect(p.inventory[0]?.durability).toBe(19);
  });
  it('breaks depleted armor and automatically falls back on the next hit', () => {
    const {p,s,actions} = fixture();
    p.inventory[0] = {id:17,count:1,durability:1};
    p.inventory[1] = {id:15,count:1,durability:20};
    actions.damage(s,5,'combat');
    expect(p.hp).toBeCloseTo(16.2);
    expect(p.inventory[0]).toBeNull();
    actions.damage(s,5,'combat');
    expect(p.hp).toBeCloseTo(12);
    expect(p.inventory[1]?.durability).toBe(19);
  });
  it('does not mitigate environmental damage or wear armor for it and exempts creative and spectator', () => {
    const {p,s,actions} = fixture();
    p.inventory[0] = {id:17,count:1,durability:20};
    actions.damage(s,3);
    actions.damage(s,2);
    expect(p.hp).toBe(15);
    expect(p.inventory[0]?.durability).toBe(20);
    for (const mode of ['creative','spectator'] as const) {
      p.mode = mode;
      actions.damage(s,5,'combat');
      expect(p.hp).toBe(15);
      expect(p.inventory[0]?.durability).toBe(20);
    }
  });
  it('applies armor to enabled PvP but not disabled PvP', () => {
    const {g,p,s,sessions,actions} = fixture();
    const victim = {...player(),x:2,y:70};
    victim.inventory[0] = {id:17,count:1,durability:20};
    sessions.add({...s,player:victim});
    p.inventory[0] = {id:11,count:1,durability:20};
    s.lastAttack = s.lastAction = -1000;
    actions.handle(s,{type:'attack',id:victim.id});
    expect(victim.hp).toBe(20);
    expect(victim.inventory[0]?.durability).toBe(20);
    g.rules.pvp = true;
    s.lastAttack = s.lastAction = -1000;
    actions.handle(s,{type:'attack',id:victim.id});
    expect(victim.hp).toBeCloseTo(20 - 7 * 0.76);
    expect(victim.inventory[0]?.durability).toBe(19);
  });
});

describe('ordered server input', () => {
  it('keeps short press/release order and spends exactly one movement tick at a time', () => {
    const {s,p} = fixture();
    Object.assign(p,{y:0,grounded:true});
    const getBlock = (_x:number,y:number,_z:number) => y < 0 ? 3 : 0;
    const inputs = [true,false,true,false].map((jump,i) => ({...idleInput(),forward:1,jump,seq:i+1}));
    for (const input of inputs) expect(receiveInput(s,input,100)).toBe(true);
    expect(p.z).toBe(0.5);
    expect(s.inputQueue?.map(input => input.jump)).toEqual([true,false,true,false]);
    for (let i = 0; i < inputs.length; i++) {
      const input = tickInput(s,110+i*1000/30);
      expect(input.seq).toBe(i+1);
      stepBody(p,input,BALANCE.tick,{getBlock}); p.seq = input.seq;
      expect(p.z).toBeCloseTo(0.5-(i+1)*BALANCE.walk*BALANCE.tick);
    }
    expect(p.y).toBeGreaterThan(0);
    expect(s.inputQueue).toHaveLength(0);
    expect(tickInput(s,300).seq).toBe(4);
    expect(s.inputTicks).toBe(2);
  });
  it('coalesces unchanged pending samples and discards pending motion on timeout and reset', () => {
    const {s,p} = fixture();
    receiveInput(s,{...idleInput(),forward:1,seq:1},100);
    receiveInput(s,{...idleInput(),forward:1,seq:2},110);
    expect(s.inputQueue).toHaveLength(1);
    expect(tickInput(s,120).seq).toBe(2);
    p.seq = 2;
    receiveInput(s,{...idleInput(),jump:true,seq:3},130);
    expect(tickInput(s,1200)).toMatchObject({forward:0,jump:false,seq:3});
    expect(s.inputQueue).toHaveLength(0);
    receiveInput(s,{...idleInput(),jump:true,seq:4},1210);
    resetMotion(s);
    expect(s.inputQueue).toHaveLength(0);
    expect(s.activeInput).toBeUndefined();
    expect(s.inputTicks).toBe(0);
  });
  it('bounds pending transition storage without advancing the player', () => {
    const {s,p} = fixture(), before = {...p};
    for (let i = 0; i < INPUT_QUEUE_LIMIT; i++) expect(receiveInput(s,{...idleInput(),jump:i%2===0,seq:i+1},100+i)).toBe(true);
    expect(s.inputQueue).toHaveLength(INPUT_QUEUE_LIMIT);
    expect(receiveInput(s,{...idleInput(),jump:true,seq:INPUT_QUEUE_LIMIT+1},200)).toBe(false);
    expect(s.inputQueue).toHaveLength(INPUT_QUEUE_LIMIT);
    expect(p).toEqual(before);
  });
});

describe('machine simulation', () => {
  it('consumes fuel and input exactly once, blocks full output, and advances crop maturity', () => {
    const {g} = fixture();
    const forge: Machine = {kind:'forge',slots:[{id:21,count:2},{id:20,count:1},null],progress:0,fuel:0,powered:false};
    g.machines.set('verdant:1,70,0',forge);
    for (let i = 0; i < 241; i++) stepMachines(g,1/30);
    expect(forge.slots[0]?.count).toBe(1); expect(forge.slots[1]).toBeNull(); expect(forge.slots[2]).toEqual({id:22,count:1});
    forge.slots[2]!.count = 64;
    for (let i = 0; i < 300; i++) stepMachines(g,1/30);
    expect(forge.slots[0]?.count).toBe(1); expect(forge.slots[2]?.count).toBe(64);
    g.world.set('verdant',2,69,0,31); g.world.set('verdant',2,70,0,32);
    const crop: Machine = {kind:'crop',slots:[],progress:0,fuel:0,powered:false}; g.machines.set('verdant:2,70,0',crop);
    stepMachines(g,90); expect(crop.progress).toBe(90);
  });
});

describe('durable saves', () => {
  it('serializes concurrent saves, hashes secrets, and restores from a rolling backup', async () => {
    const dir = await temp(), store = new Storage(dir); await store.load();
    const token = randomUUID(), g = store.create('Named world','seed','survival',2,token), p = player();
    g.profiles.set(hashToken(token),{player:p,returns:{aether:{x:2,y:55,z:3}}});
    g.world.set('cinder',-1,20,-1,25); g.time = 0.7; g.rules.keepInventory = true;
    g.machines.set('cinder:-1,20,-1',{kind:'chest',slots:[{id:29,count:3}],progress:0,fuel:0,powered:false});
    await Promise.all([store.save(),store.save(),store.save()]);
    const path = join(dir,g.meta.id+'.json');
    expect(await readFile(path,'utf8')).not.toContain(token);
    await writeFile(path,'corrupt');
    const restored = new Storage(dir); await restored.load();
    const saved = restored.worlds.get(g.meta.id)!;
    expect(saved.world.get('cinder',-1,20,-1)).toBe(25);
    expect(saved.profiles.get(hashToken(token))?.player.id).toBe(p.id);
    expect(saved.machines.get('cinder:-1,20,-1')?.slots[0]?.count).toBe(3);
    expect(saved.rules.keepInventory).toBe(true); expect(saved.time).toBe(0.7);
  });
});

async function connect(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`), queue: ServerMessage[] = [];
  ws.on('message',raw => queue.push(JSON.parse(raw.toString())));
  await new Promise<void>((resolve,reject) => { ws.once('open',resolve); ws.once('error',reject); });
  return { ws,send:(m:ClientMessage) => ws.send(JSON.stringify(m)),async next<T extends ServerMessage['type']>(type:T): Promise<ServerMessage & {type:T}> {
    const deadline = Date.now()+5000;
    while (Date.now()<deadline) { const i = queue.findIndex(m => m.type === type); if (i >= 0) return queue.splice(i,1)[0] as ServerMessage & {type:T}; await new Promise(r => setTimeout(r,10)); }
    throw new Error(`Timed out waiting for ${type}`);
  } };
}

describe('WebSocket integration with shared physics', () => {
  it('moves from held input, collides with terrain and applies landing damage exactly once', async () => {
    const server = await createGameServer({port:0,saveDir:await temp()}); servers.push(server);
    const token = randomUUID(), g = server.storage.create('Physics','physics-test','survival',0,token);
    g.rules.mobSpawning = false;
    for (let x = -2; x <= 8; x++) for (let z = -2; z <= 2; z++) {
      g.world.set('verdant',x,60,z,3);
      for (let y = 61; y <= 75; y++) g.world.set('verdant',x,y,z,x === 3 ? 3 : 0);
    }
    const p = player(); Object.assign(p,{y:67,hunger:10});
    p.inventory[0] = {id:17,count:1,durability:20};
    g.profiles.set(hashToken(token),{player:p,returns:{}});
    const client = await connect(server.port);
    client.send({type:'hello',token,world:g.meta.id,name:'Physics',color:'#123456'});
    await client.next('welcome');
    client.send({type:'input',input:{...idleInput(),forward:1,yaw:-Math.PI/2,seq:1}});
    let landed: Player | undefined;
    for (let i = 0; i < 30; i++) {
      const snapshot = await client.next('snapshot');
      landed = snapshot.players.find(v => v.id === p.id);
      if (landed?.grounded) break;
    }
    expect(landed?.grounded).toBe(true);
    expect(landed?.y).toBeCloseTo(61);
    expect(landed?.x).toBeGreaterThan(0.5);
    expect(landed?.x).toBeLessThanOrEqual(2.700001);
    expect(landed?.hp).toBe(17);
    expect([...server.sessions][0].player?.inventory[0]?.durability).toBe(20);
    client.send({type:'input',input:{...idleInput(),forward:1,yaw:-Math.PI/2,seq:2}});
    for (let i = 0; i < 6; i++) {
      const snapshot = await client.next('snapshot');
      const current = snapshot.players.find(v => v.id === p.id)!;
      expect(current.hp).toBe(17);
      expect(current.x).toBeLessThanOrEqual(2.700001);
      expect(Number.isFinite(current.y)).toBe(true);
    }
  },15000);
  it('jumps, swims and ignores held jump for creative double-press flight', async () => {
    const server = await createGameServer({port:0,saveDir:await temp()}); servers.push(server);
    const token = randomUUID(), g = server.storage.create('Mobility','mobility-test','survival',0,token);
    g.rules.mobSpawning = false;
    for (let x = -2; x <= 6; x++) for (let z = -2; z <= 2; z++) { g.world.set('verdant',x,60,z,3); g.world.set('verdant',x,61,z,3); }
    for (let y = 62; y <= 65; y++) for (let z = -2; z <= 2; z++) g.world.set('verdant',5,y,z,5);
    const p = player(); p.mode = 'creative'; Object.assign(p,{y:62});
    g.profiles.set(hashToken(token),{player:p,returns:{}});
    const client = await connect(server.port);
    client.send({type:'hello',token,world:g.meta.id,name:'Jumper',color:'#123456'});
    await client.next('welcome');
    client.send({type:'input',input:{...idleInput(),forward:1,yaw:-Math.PI/2,jump:true,seq:1}});
    client.send({type:'input',input:{...idleInput(),forward:1,yaw:-Math.PI/2,jump:true,seq:2}});
    let peak = 0;
    for (let i = 0; i < 20; i++) {
      const snapshot = await client.next('snapshot');
      const current = snapshot.players.find(v => v.id === p.id)!;
      peak = Math.max(peak,current.y);
      expect(current.hp).toBe(20);
    }
    expect(peak).toBeGreaterThan(62.5);
    expect(peak).toBeLessThan(66);
  },15000);
  it('shows a short jump to a second player while every movement step retains the server tick budget', async () => {
    const steps: {id:string; seq:number; jump:boolean; dt:number; x:number; y:number}[] = [];
    const server = await createGameServer({port:0,saveDir:await temp(),stepBody:(body,input,dt,opts) => {
      const result = stepBody(body,input,dt,opts);
      steps.push({id:(body as Player).id,seq:input.seq,jump:input.jump,dt,x:body.x,y:body.y});
      return result;
    }}); servers.push(server);
    const token = randomUUID(), observerToken = randomUUID(), g = server.storage.create('Short jump','short-jump','survival',0,token);
    g.rules.mobSpawning = false;
    for (let x = -3; x <= 12; x++) for (let z = -3; z <= 3; z++) {
      g.world.set('verdant',x,60,z,3);
      for (let y = 61; y < 80; y++) g.world.set('verdant',x,y,z,0);
    }
    const p = {...player(),y:61,hunger:10}, observer = {...player(),y:61,z:2.5,hunger:10};
    g.profiles.set(hashToken(token),{player:p,returns:{}});
    g.profiles.set(hashToken(observerToken),{player:observer,returns:{}});
    const a = await connect(server.port), b = await connect(server.port);
    a.send({type:'hello',token,world:g.meta.id,name:'Jumper',color:'#123456'});
    b.send({type:'hello',token:observerToken,world:g.meta.id,name:'Observer',color:'#654321'});
    await a.next('welcome'); await b.next('welcome');
    a.send({type:'input',input:{...idleInput(),forward:1,yaw:-Math.PI/2,jump:true,seq:1}});
    a.send({type:'input',input:{...idleInput(),forward:1,yaw:-Math.PI/2,jump:false,seq:2}});
    let peak = 61, landed = false;
    for (let i = 0; i < 20; i++) {
      const snapshot = await b.next('snapshot'), jumper = snapshot.players.find(current => current.id === p.id)!;
      peak = Math.max(peak,jumper.y);
      if (peak > 61.2 && jumper.grounded) { landed = true; break; }
    }
    expect(peak).toBeGreaterThan(61.5);
    expect(landed).toBe(true);
    const movement = steps.filter(step => step.id === p.id && step.seq > 0);
    expect(movement[0]).toMatchObject({seq:1,jump:true});
    expect(movement[1]).toMatchObject({seq:2,jump:false});
    expect(movement.filter(step => step.jump)).toHaveLength(1);
    for (const step of steps) expect(step.dt).toBe(BALANCE.tick);
    expect(movement.at(-1)!.x-p.x).toBeCloseTo(movement.length*BALANCE.walk*BALANCE.tick);
    const own = await a.next('snapshot');
    expect(own.motion?.input.seq).toBe(own.players.find(current => current.id === p.id)?.seq);
    expect(own.motion?.ticks).toBeGreaterThan(0);
  },15000);
  it.each(['drowning','mob'] as const)('keeps %s damage classification correct in the live server', async source => {
    const server = await createGameServer({port:0,saveDir:await temp()}); servers.push(server);
    const token = randomUUID(), g = server.storage.create('Armor','armor-live','survival',1,token);
    g.rules.mobSpawning = false;
    for (let x = -2; x <= 3; x++) for (let z = -2; z <= 2; z++) {
      g.world.set('verdant',x,60,z,3);
      for (let y = 61; y < 80; y++) g.world.set('verdant',x,y,z,source === 'drowning' && y < 67 ? 5 : 0);
    }
    const p = {...player(),y:61,hunger:10,air:source === 'drowning' ? 0 : 20};
    p.inventory[0] = {id:17,count:1,durability:20};
    g.profiles.set(hashToken(token),{player:p,returns:{}});
    if (source === 'mob') g.entities.push({id:'shambler',kind:'shambler',realm:'verdant',x:1.5,y:61,z:0.5,hp:16,maxHp:16,yaw:0,state:'idle',age:0});
    const client = await connect(server.port);
    client.send({type:'hello',token,world:g.meta.id,name:'Armored',color:'#123456'});
    await client.next('welcome');
    const hit = await client.next('inventory');
    expect(hit.player.hp).toBeCloseTo(source === 'drowning' ? 18 : 20-4*0.76);
    expect(hit.player.inventory[0]?.durability).toBe(source === 'drowning' ? 20 : 19);
  },15000);
  it('creates, joins, streams private snapshots and chunks, and reconnects after restart', async () => {
    const saveDir = await temp(), server = await createGameServer({port:0,saveDir,stepBody:() => ({})}); servers.push(server);
    const a = await connect(server.port), token = randomUUID();
    a.send({type:'create',token,name:'Integration',seed:'network-test',mode:'survival',difficulty:1});
    const {world} = await a.next('created');
    a.send({type:'hello',token,world:world.id,name:'Alice',color:'#123456'});
    const welcome = await a.next('welcome'); expect(welcome.player.inventory.length).toBe(36);
    const b = await connect(server.port);
    b.send({type:'hello',token:randomUUID(),world:world.id,name:'Bob',color:'#654321'});
    await b.next('welcome');
    const snap = await b.next('snapshot'); expect(snap.players.every(p => p.inventory.length === 0)).toBe(true);
    const p = welcome.player, cx = Math.floor(p.x/16), cz = Math.floor(p.z/16);
    a.send({type:'chunks',realm:'verdant',coords:[[cx,cz]]}); const chunk = await a.next('chunk'); expect(decodeRLE(chunk.data).length).toBe(20480);
    const c = await connect(server.port); c.send({type:'hello',token,world:world.id,name:'Imposter',color:'#ffffff'}); expect((await c.next('error')).text).toContain('already');
    await server.close(); servers.splice(servers.indexOf(server),1);
    const restart = await createGameServer({port:0,saveDir,stepBody:() => ({})}); servers.push(restart);
    const d = await connect(restart.port); d.send({type:'hello',token,world:world.id,name:'Alice',color:'#123456'}); expect((await d.next('welcome')).player.id).toBe(welcome.player.id);
    expect((await fetch(`http://127.0.0.1:${restart.port}/health`)).status).toBe(200);
  },20000);
});
