import { BLOCKS, blockDef, itemDef, itemIdForBlock } from '../shared/blocks';
import { machineAt, respawnPoint } from './mechanics';
import { cropDrops, growCrop } from './farming';
import { insertStack } from './containers';
import { useBed } from './sleep';
import { BALANCE, blockKey, chunkCoord, distance } from '../shared/constants';
import { addItem, consumeItems, craft, emptyInventory, exchangeItems, moveItem, transferItem, validItem } from '../shared/inventory';
import { RECIPES, itemNameToId } from '../shared/recipes';
import type { Action, Machine, Player, Realm, Stack, Vec3 } from '../shared/types';
import { mobDef, spawnDrop } from './entities';
import { inventory, notice, resetMotion, send, type Session } from './session';
import type { GameWorld, Storage } from './storage';
import { modes } from './protocol';

export class Actions {
  constructor(readonly sessions: Set<Session>, readonly storage: Storage) {}
  online(g: GameWorld) { return [...this.sessions].filter(s => s.game === g && s.player); }
  set(g: GameWorld, realm: Realm, x: number, y: number, z: number, id: number) {
    g.world.set(realm, x, y, z, id);
    const m = machineAt(g,realm,x,y,z);
    if (m?.kind === 'crop') m.progress = id === 32 ? BALANCE.cropSeconds : id === 52 ? BALANCE.cropSeconds/2 : 0;
    if (!m) g.machines.delete(blockKey(realm,x,y,z));
    for (const s of this.online(g)) if (s.player!.realm === realm && s.subscriptions.has(`${realm}:${chunkCoord(x)},${chunkCoord(z)}`)) send(s, { type: 'block', realm, x, y, z, id });
  }
  visible(g: GameWorld, p: Player, target: Vec3, block = false) {
    const eye = { x: p.x, y: p.y + 1.6, z: p.z }, d = distance(eye, target);
    if (d > BALANCE.reach) return false;
    for (let t = 0.1; t < d - 0.1; t += 0.12) {
      const x = eye.x + (target.x - eye.x) * t / d, y = eye.y + (target.y - eye.y) * t / d, z = eye.z + (target.z - eye.z) * t / d;
      if (block && Math.floor(x) === Math.floor(target.x) && Math.floor(y) === Math.floor(target.y) && Math.floor(z) === Math.floor(target.z)) continue;
      if (blockDef(g.world.get(p.realm, x, y, z)).solid) return false;
    }
    return true;
  }
  drop(g: GameWorld, p: Vec3 & { realm: Realm }, stack: Stack) {
    g.entities.push(spawnDrop(g.world, p.realm, p.x, p.y + 0.2, p.z, stack));
  }
  give(s: Session, stack: Stack) {
    const left = addItem(s.player!.inventory, stack);
    if (left) this.drop(s.game!, s.player!, { ...stack, count: left });
  }
  wear(p: Player) {
    const stack = p.inventory[p.selected];
    if (!stack || p.mode === 'creative') return;
    const max = itemDef(stack.id).durability;
    if (max) { stack.durability = (stack.durability ?? max) - 1; if (stack.durability <= 0) p.inventory[p.selected] = null; }
  }
  damage(s: Session, n: number, source: 'environment' | 'combat' = 'environment') {
    const p = s.player!;
    if (p.hp <= 0 || p.mode === 'creative' || p.mode === 'spectator' || n <= 0) return;
    if (source === 'combat') {
      const equipped = new Map<string, { index: number; armor: number }>();
      p.inventory.forEach((stack, index) => {
        if (!stack || stack.count <= 0) return;
        const def = itemDef(stack.id);
        if (!def.slot || !def.armor || (stack.durability ?? def.durability ?? 0) <= 0) return;
        if (def.armor > (equipped.get(def.slot)?.armor ?? 0)) equipped.set(def.slot, { index, armor: def.armor });
      });
      let armor = 0;
      for (const piece of equipped.values()) {
        armor += piece.armor;
        const stack = p.inventory[piece.index]!;
        stack.durability = (stack.durability ?? itemDef(stack.id).durability!) - 1;
        if (stack.durability <= 0) p.inventory[piece.index] = null;
      }
      n *= 1 - Math.min(0.8, armor * 0.04);
    }
    p.hp = Math.max(0, p.hp - n);
    s.sleeping = undefined;
    if (!p.hp) {
      p.deaths++; s.mine = undefined; s.container = undefined;
      if (!s.game!.rules.keepInventory) { for (const stack of p.inventory) if (stack) this.drop(s.game!, p, stack); p.inventory = emptyInventory(); }
      notice(s, 'You died. Respawn to continue.');
    }
    inventory(s);
  }
  container(s: Session, key: string): Machine | undefined {
    if (s.container !== key || !s.player || s.player.hp <= 0 || s.player.mode === 'spectator') return;
    const [realm, pos] = key.split(':'), [x, y, z] = (pos ?? '').split(',').map(Number);
    if (realm !== s.player!.realm || !this.visible(s.game!, s.player!, { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, true)) return;
    const id = s.game!.world.get(s.player!.realm, x, y, z);
    if (![23, 24, 25, 53].includes(id)) return;
    return s.game!.machines.get(key);
  }
  syncContainer(g: GameWorld, key: string) {
    const machine = g.machines.get(key);
    if (machine) for (const s of this.online(g)) if (this.container(s, key)) send(s, { type: 'container', key, machine });
  }
  nearBlock(s: Session, id: number) {
    const p = s.player!, g = s.game!;
    for (let x = Math.floor(p.x) - 3; x <= p.x + 3; x++) for (let y = Math.floor(p.y) - 2; y <= p.y + 2; y++) for (let z = Math.floor(p.z) - 3; z <= p.z + 3; z++) if (g.world.get(p.realm, x, y, z) === id && this.visible(g, p, { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, true)) return true;
    return false;
  }
  handle(s: Session, a: Action) {
    const p = s.player!, g = s.game!, now = performance.now();
    if (a.type === 'chat') { this.chat(s, a.text); return; }
    if (a.type === 'closeContainer') { s.container = undefined; return; }
    if (a.type === 'respawn') {
      if (p.hp > 0) return;
      const point = respawnPoint(g,p.spawn.realm,p.spawn);
      Object.assign(p, point, { realm: p.spawn.realm, hp: 20, hunger: 20, air: 20, vy: 0, grounded: false });
      resetMotion(s); s.subscriptions.clear(); inventory(s); return;
    }
    if (p.hp <= 0 || p.mode === 'spectator') return;
    if (a.type === 'select') { p.selected = a.slot; s.mine = undefined; inventory(s); return; }
    if (a.type === 'mine' || a.type === 'place' || a.type === 'use') {
      const { x, y, z } = a, target = { x: x + 0.5, y: y + 0.5, z: z + 0.5 };
      if (!this.visible(g, p, target, true)) { s.mine = undefined; return; }
      const id = g.world.get(p.realm, x, y, z), def = blockDef(id), key = blockKey(p.realm, x, y, z);
      const stack = p.inventory[p.selected], tool = stack ? itemDef(stack.id) : undefined;
      if (a.type === 'mine') {
        if (p.mode === 'adventure' || id === 0 || id === 21 || def.liquid) return;
        if (!s.mine || s.mine.key !== key || s.mine.id !== id || s.mine.slot !== p.selected || now - s.mine.last > 750) s.mine = { key, id, slot: p.selected, start: now, last: now };
        s.mine.last = now;
        const speed = tool && tool.tool === def.tool ? (tool.speed ?? 1) * (1 + (stack?.enhancement ?? 0) * 0.35) : 1;
        if (p.mode !== 'creative' && now - s.mine.start < Math.max(120, def.hardness * 700 / speed)) return;
        if (now - s.lastAction < 120) return;
        s.lastAction = now; s.mine = undefined;
        const machine = g.machines.get(key);
        if (machine) { for (const item of machine.slots) if (item) this.drop(g, { ...target, realm: p.realm }, item); g.machines.delete(key); }
        this.set(g, p.realm, x, y, z, 0); p.mined++;
        if (p.mode !== 'creative') {
          if (!def.tier || tool && tool.tool === def.tool && (tool.tier ?? 0) >= def.tier) {
            if (def.crop) for (const drop of cropDrops(id)) this.give(s,drop);
            else {
              const drop = id === 37 ? 48 : id === 3 ? itemNameToId('cobble') : def.drop === '' ? 0 : def.drop ? itemNameToId(def.drop) : itemIdForBlock(id);
              if (drop) this.give(s, { id: drop, count: def.dropCount ?? 1 });
            }
            if (id === 6) this.advance(s,'first_log','Timber gathered. Make planks, a workbench and a wooden pick.');
            if (id === 9) this.advance(s,'first_copper','Copper discovered. Smelt it in a forge; gold and copper unlock the Cinder portal.');
          }
          this.wear(p);
        }
        inventory(s); return;
      }
      if (now - s.lastAction < 180) return;
      s.lastAction = now;
      if (a.type === 'place') {
        if (p.mode === 'adventure' || !stack || tool?.block === undefined || tool.block <= 0 || !BLOCKS[tool.block] || tool.block === 21 || def.solid || def.liquid) return;
        const placed = tool.block;
        if (![[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([dx,dy,dz]) => blockDef(g.world.get(p.realm, x+dx, y+dy, z+dz)).solid)) return;
        if (blockDef(placed).crop && g.world.get(p.realm, x, y - 1, z) !== 31) return;
        if (def.crop || def.machine || def.container || [39,40,50].includes(id)) return;
        if (blockDef(placed).solid && this.online(g).some(o => { const b = o.player!; return b.realm === p.realm && b.mode !== 'spectator' && b.x + 0.3 > x && b.x - 0.3 < x + 1 && b.z + 0.3 > z && b.z - 0.3 < z + 1 && b.y + 1.8 > y && b.y < y + 1; })) return;
        this.set(g, p.realm, x, y, z, placed); p.placed++;
        if (p.mode !== 'creative' && --stack.count === 0) p.inventory[p.selected] = null;
        inventory(s); return;
      }
      if (id === 42 || id === 43) {
        if (now - s.lastPortal < 1500) return;
        s.lastPortal = now;
        const realm: Realm = p.realm === 'verdant' ? id === 42 ? 'aether' : 'cinder' : 'verdant';
        s.profile!.returns[p.realm] = { x: p.x, y: p.y, z: p.z };
        const dest = respawnPoint(g,realm,s.profile!.returns[realm] ?? g.world.gen.spawn(realm));
        this.advance(s,`realm_${realm}`,realm === 'cinder' ? 'Cinder reached. A guardian waits near the arrival grounds; dodge its telegraphed strikes for radiant.' : realm === 'aether' ? 'Aether reached. Seek the Crown near arrival; step out of its charged attacks.' : 'Returned to Verdant.');
        Object.assign(p, dest, { realm, vy: 0, grounded: false }); resetMotion(s); s.subscriptions.clear(); s.container = undefined; inventory(s); return;
      }
      if ([23,24,25,53].includes(id)) {
        const machine = machineAt(g,p.realm,x,y,z)!;
        s.container = key; send(s, { type: 'container', key, machine }); return;
      }
      if (id === 49) { useBed(this,s,{x,y,z}); return; }
      if (id === 40) { const m = machineAt(g,p.realm,x,y,z)!; m.powered = !m.powered; notice(s,m.powered ? 'Lever on.' : 'Lever off.'); return; }
      if (id === 33 || id === 50) {
        if (id === 50 && this.online(g).some(o => { const b = o.player!; return b.realm === p.realm && Math.abs(b.x-x-0.5) < 0.8 && Math.abs(b.z-z-0.5) < 0.8 && b.y < y+1 && b.y+1.8 > y; })) return;
        this.set(g,p.realm,x,y,z,id === 33 ? 50 : 33); return;
      }
      if (def.crop && p.mode !== 'adventure') {
        if (id === 32) { this.set(g,p.realm,x,y,z,51); this.give(s,{id:29,count:3}); this.give(s,{id:48,count:1}); inventory(s); }
        else if (stack?.id === 35) {
          const m = machineAt(g,p.realm,x,y,z)!, before = m.progress;
          growCrop(g,p.realm,x,y,z,m,45,(realm,bx,by,bz,next) => this.set(g,realm,bx,by,bz,next));
          if (m.progress > before && p.mode !== 'creative' && --stack.count === 0) p.inventory[p.selected] = null;
          inventory(s);
        }
        return;
      }
      if ((id === 1 || id === 2) && tool?.tool === 'hoe' && p.mode !== 'adventure' && !blockDef(g.world.get(p.realm,x,y+1,z)).solid) { this.set(g, p.realm, x, y, z, 31); this.wear(p); inventory(s); }
      if (id === 31 && y < 78 && stack && [29,48].includes(stack.id) && g.world.get(p.realm, x, y + 1, z) === 0 && p.mode !== 'adventure') { this.set(g, p.realm, x, y + 1, z, 51); if (p.mode !== 'creative' && --stack.count === 0) p.inventory[p.selected] = null; inventory(s); }
      return;
    }
    if (now - s.lastAction < 100) return;
    s.lastAction = now;
    if (a.type === 'craft') {
      const recipe = RECIPES.find(r => r.out === a.recipe);
      if (recipe && (!recipe.needs3 || this.nearBlock(s, 23)) && craft(p.inventory, recipe, a.count)) inventory(s);
    } else if (a.type === 'creative') {
      if (p.mode === 'creative' && validItem(a.item)) { p.inventory[p.selected] = null; this.give(s, { id: a.item, count: itemDef(a.item).stack }); inventory(s); }
    } else if (a.type === 'moveItem') {
      const m = a.container ? this.container(s, a.container) : undefined;
      if (a.container && (!m || m.kind === 'forge')) return;
      if (moveItem(m?.slots ?? p.inventory, a.from, a.to, a.split)) { inventory(s); if (a.container) this.syncContainer(g, a.container); }
    } else if (a.type === 'transfer') {
      const m = this.container(s, a.container);
      if (!m) return;
      const oldInput = m.slots[0]?.id;
      if (a.toContainer && m.kind === 'forge') {
        const stack = p.inventory[a.slot];
        if (!stack) return;
        if (insertStack(m,stack)) p.inventory[a.slot] = null;
      } else transferItem(a.toContainer ? p.inventory : m.slots, a.toContainer ? m.slots : p.inventory, a.slot);
      if (m.kind === 'forge' && oldInput !== m.slots[0]?.id) m.progress = 0;
      inventory(s); this.syncContainer(g, a.container);
    } else if (a.type === 'eat') {
      const stack = p.inventory[p.selected], food = stack && itemDef(stack.id).food;
      if (stack && food && p.hunger < 20) { p.hunger = Math.min(20, p.hunger + food); if (--stack.count === 0) p.inventory[p.selected] = null; inventory(s); }
    } else if (a.type === 'drop') {
      const stack = p.inventory[p.selected];
      if (stack) { this.drop(g, p, stack); p.inventory[p.selected] = null; inventory(s); }
    } else if (a.type === 'attack') {
      if (now - s.lastAttack < 400) return;
      s.lastAttack = now;
      s.mine = undefined;
      const entity = g.entities.find(e => e.id === a.id && e.realm === p.realm && e.kind !== 'drop' && e.kind !== 'trader');
      const victim = this.online(g).find(o => o.player!.id === a.id && o !== s && o.player!.realm === p.realm);
      const target = entity ?? victim?.player;
      if (!target || !this.visible(g, p, { x: target.x, y: target.y + 1, z: target.z })) return;
      const stack = p.inventory[p.selected], damage = (stack ? itemDef(stack.id).damage ?? 1 : 1) + (stack?.enhancement ?? 0);
      if (entity) {
        entity.hp -= damage;
        entity.owner = p.id; entity.aggroTime = 12;
        if (entity.hp <= 0) {
          g.entities.splice(g.entities.indexOf(entity), 1); const def = mobDef(entity.kind); p.xp += def.xp;
          for (const [name, min, max] of def.drops) this.drop(g, entity, { id: itemNameToId(name), count: min + Math.floor(Math.random() * (max - min + 1)) });
          if (def.boss && !g.bossDefeated.includes(entity.realm)) {
            g.bossDefeated.push(entity.realm);
            this.give(s, { id: 148, count: 1 });
            this.give(s, { id: itemNameToId('gem_blade'), count: 1 });
            for (const ally of this.online(g)) if (ally.player!.realm === entity.realm && ally.player!.hp > 0 && distance(ally.player!,entity) < 48) {
              this.advance(ally,`boss_${entity.realm}`,entity.kind === 'cinder_guardian' ? 'Cinder Guardian felled. The trophy hums with radiant heat.' : 'Aether Crown taken. The realm rests.');
              inventory(ally);
            }
          }
        }
      } else if (victim && g.rules.pvp) this.damage(victim, damage, 'combat'); else return;
      this.wear(p); inventory(s);
    } else if (a.type === 'trade') {
      const npc = g.entities.find(e => e.id === a.npc && e.kind === 'trader' && e.realm === p.realm);
      const offers = [{ cost: 29, n: 8, out: 46, count: 1 }, { cost: 46, n: 1, out: 30, count: 3 }, { cost: 46, n: 3, out: 22, count: 2 }];
      const offer = offers[a.offer];
      if (offer && npc && this.visible(g, p, { ...npc, y: npc.y + 1 }) && exchangeItems(p.inventory, [{ id: offer.cost, count: offer.n }], { id: offer.out, count: offer.count })) inventory(s);
    } else if (a.type === 'enhance') {
      const stack = p.inventory[a.slot];
      if (stack && itemDef(stack.id).durability && (stack.enhancement ?? 0) < 3 && p.xp >= 10 && this.nearBlock(s, 23) && consumeItems(p.inventory, [{ id: 28, count: 1 }])) { stack.enhancement = (stack.enhancement ?? 0) + 1; p.xp -= 10; inventory(s); }
    } else if (a.type === 'repair') {
      const stack = p.inventory[a.slot], def = stack && itemDef(stack.id);
      if (stack && def?.durability && (stack.durability ?? def.durability) < def.durability && p.xp >= 3 && this.nearBlock(s,23)) {
        const material = def.tier === 5 ? 28 : def.tier === 4 || stack.id === 17 ? 27 : def.tier === 3 || def.armor ? 22 : def.tier === 2 ? 130 : stack.id === 18 ? 37 : stack.id === 43 ? 28 : 129;
        if (consumeItems(p.inventory,[{id:material,count:2}])) { stack.durability = Math.min(def.durability,(stack.durability ?? 0)+Math.ceil(def.durability*0.4)); p.xp -= 3; inventory(s); }
      }
    } else if (a.type === 'sleep') {
      for (let x = Math.floor(p.x)-3; x <= p.x+3; x++) for (let y = Math.floor(p.y)-2; y <= p.y+2; y++) for (let z = Math.floor(p.z)-3; z <= p.z+3; z++) if (g.world.get(p.realm,x,y,z) === 49 && this.visible(g,p,{x:x+0.5,y:y+0.5,z:z+0.5},true)) { useBed(this,s,{x,y,z}); return; }
      notice(s,'Use a nearby bed to set your spawn and sleep.');
    }
  }
  advance(s: Session, flag: string, text: string) {
    if (s.player!.achievements.includes(flag)) return;
    s.player!.achievements.push(flag); notice(s,`Advancement: ${text}`);
  }
  chat(s: Session, text: string) {
    const now = Date.now(), p = s.player!, g = s.game!;
    if (now - s.lastChat < 500) return;
    s.lastChat = now;
    if (!text.startsWith('/')) { for (const o of this.online(g)) send(o, { type: 'chat', name: p.name, text, time: now }); return; }
    const [command, ...args] = text.slice(1).trim().split(/\s+/);
    if (command === 'help') { notice(s, '/help /time day|night /weather clear|rain|storm /mode survival|creative|adventure|spectator /give item count /save /tp x y z /locate /rules key value'); return; }
    if (g.admin !== s.hash) { notice(s, 'Only the world creator can use admin commands.'); return; }
    if (command === 'save') { void this.storage.save().then(() => notice(s, 'World saved.'), () => notice(s, 'Save failed.')); return; }
    if (command === 'time' && ['day', 'night'].includes(args[0])) g.time = args[0] === 'day' ? 0.25 : 0.75;
    else if (command === 'weather' && ['clear', 'rain', 'storm'].includes(args[0])) g.weather = args[0];
    else if (command === 'mode' && modes.includes(args[0])) { p.mode = args[0] as Player['mode']; resetMotion(s); inventory(s); }
    else if (command === 'give') { const id = itemNameToId(args[0] ?? ''), count = Number(args[1] ?? 1); if (validItem(id) && Number.isInteger(count) && count >= 1 && count <= 2304) { this.give(s, { id, count }); inventory(s); } else notice(s, 'Invalid item or count.'); }
    else if (command === 'tp') { const [x,y,z] = args.map(Number); if (args.length === 3 && [x,y,z].every(Number.isFinite) && Math.abs(x) <= 100000 && Math.abs(z) <= 100000 && y >= 1 && y < 80) { Object.assign(p, { x,y,z,vy:0 }); resetMotion(s); s.subscriptions.clear(); inventory(s); } }
    else if (command === 'locate') { const x = Math.floor(p.x / 128), z = Math.floor(p.z / 128); let found = false; for (let r = 0; r < 8 && !found; r++) for (let dx = -r; dx <= r && !found; dx++) for (let dz = -r; dz <= r && !found; dz++) { const v = g.world.gen.structureAt(x+dx,z+dz); if (v) { notice(s, `${v.kind}: ${v.x} ${v.y + 1} ${v.z} (verdant)`); found = true; } } if (!found) notice(s, 'No nearby structure found.'); }
    else if (command === 'rules') { const [key,value] = args; if (key === 'sleepPercent' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100) g.rules.sleepPercent = Number(value); else if (['pvp','keepInventory','daylight','mobSpawning'].includes(key) && ['true','false'].includes(value)) Object.assign(g.rules, { [key]: value === 'true' }); notice(s, JSON.stringify(g.rules)); }
    else notice(s, 'Invalid command. Use /help.');
  }
}
