import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { BALANCE, chunkCoord, distance } from '../shared/constants';
import { encodeRLE } from '../shared/codec';
import { addItem, emptyInventory } from '../shared/inventory';
import { stepMachines } from './machines';
import type { Player } from '../shared/types';
import { stepBody as sharedStepBody } from '../shared/physics';
import { Storage, hashToken } from './storage';
import { parseMessage } from './protocol';
import { idleInput, inventory, send, type Session } from './session';
import { Actions } from './actions';
import { eid, mobDef, stepMob } from './entities';
import { stepEncounters } from './encounters';
import { stepSleep } from './sleep';

export async function createGameServer({ port = 7777, saveDir = resolve('saves'), stepBody = sharedStepBody }: { port?: number; saveDir?: string; stepBody?: typeof sharedStepBody } = {}) {
  const storage = new Storage(saveDir);
  await storage.load();
  const sessions = new Set<Session>(), actions = new Actions(sessions, storage);
  const dist = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
  const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
  const http = createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
      const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
      if (path === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}'); return; }
      let file = resolve(dist, '.' + path);
      if (file !== dist && !file.startsWith(dist + sep)) { res.writeHead(403).end(); return; }
      if (file === dist || (await stat(file).catch(() => null))?.isDirectory()) file = resolve(file, 'index.html');
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(404).end('Not found. Build the client with npm run build.'); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16384, perMessageDeflate: false });
  http.on('upgrade', (req, socket, head) => {
    const origin = req.headers.origin;
    let allowed = true;
    try { if (origin) allowed = new URL(origin).host === req.headers.host; } catch { allowed = false; }
    if (req.url !== '/ws' || !allowed || sessions.size >= 64) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  wss.on('connection', socket => {
    const s: Session = { socket, input: idleInput(), inputAt: 0, subscriptions: new Set(), lastAction: 0, lastAttack: 0, lastChat: 0, lastPortal: 0, survival: 0, budget: 160, chunks: 32, refill: performance.now() };
    sessions.add(s);
    const authTimer = setTimeout(() => { if (!s.player) socket.close(1008, 'Join a world'); }, 60000);
    socket.on('error', () => socket.close());
    socket.on('close', () => { clearTimeout(authTimer); sessions.delete(s); });
    socket.on('message', raw => {
      const now = performance.now(), elapsed = (now - s.refill) / 1000;
      s.budget = Math.min(160, s.budget + elapsed * 80); s.chunks = Math.min(32, s.chunks + elapsed * 16); s.refill = now;
      if (--s.budget < 0) { socket.close(1008, 'Rate limit'); return; }
      const msg = parseMessage(raw.toString());
      if (!msg) { send(s, { type: 'error', text: 'Invalid message' }); return; }
      try {
        if (msg.type === 'ping') { send(s, { type: 'pong', time: msg.time }); return; }
        if (msg.type === 'list') { send(s, { type: 'worlds', worlds: [...storage.worlds.values()].map(g => ({ ...g.meta, players: actions.online(g).length })) }); return; }
        if (msg.type === 'create') {
          if (storage.worlds.size >= 64 || s.player || s.budget < 40) { send(s, { type: 'error', text: 'World creation unavailable' }); return; }
          s.budget -= 40;
          const g = storage.create(msg.name, msg.seed, msg.mode, msg.difficulty, msg.token);
          void storage.save().then(() => send(s, { type: 'created', world: g.meta }), () => send(s, { type: 'error', text: 'Save failed' }));
          return;
        }
        if (msg.type === 'hello') {
          if (s.player) return;
          const g = storage.worlds.get(msg.world), hash = hashToken(msg.token);
          if (!g || actions.online(g).length >= BALANCE.maxPlayers) { send(s, { type: 'error', text: 'World unavailable or full' }); return; }
          if (actions.online(g).some(o => o.hash === hash)) { send(s, { type: 'error', text: 'Profile already connected' }); return; }
          let profile = g.profiles.get(hash);
          if (!profile) {
            const point = g.world.gen.spawn('verdant');
            const player: Player = { ...point, id: randomUUID(), name: msg.name.trim() || 'Explorer', color: msg.color, vy: 0, grounded: false, yaw: 0, pitch: 0, realm: 'verdant', mode: g.meta.mode, hp: 20, hunger: 20, air: 20, xp: 0, inventory: emptyInventory(), selected: 0, spawn: { ...point, realm: 'verdant' }, achievements: [], deaths: 0, mined: 0, placed: 0, seq: 0 };
            addItem(player.inventory, { id: 33, count: 4 });
            profile = { player, returns: {} }; g.profiles.set(hash, profile);
          }
          s.hash = hash; s.game = g; s.profile = profile; s.player = profile.player = { ...profile.player }; s.player.name = msg.name.trim() || 'Explorer'; s.player.color = msg.color; s.input.seq = s.player.seq;
          clearTimeout(authTimer);
          send(s, { type: 'welcome', player: s.player, world: g.meta, time: g.time, rules: g.rules }); return;
        }
        if (!s.player || !s.game) { send(s, { type: 'error', text: 'Join a world first' }); return; }
        if (msg.type === 'input') { if (msg.input.seq > s.player.seq && msg.input.seq > s.input.seq) { s.input = { ...msg.input }; s.inputAt = now; } }
        else if (msg.type === 'chunks') {
          if (msg.realm !== s.player.realm || msg.coords.length > s.chunks) return;
          s.chunks -= msg.coords.length;
          const cx = chunkCoord(s.player.x), cz = chunkCoord(s.player.z);
          for (const [x,z] of msg.coords) if (Math.max(Math.abs(x-cx),Math.abs(z-cz)) <= 8) {
            const key = `${msg.realm}:${x},${z}`;
            s.subscriptions.add(key);
            send(s, { type: 'chunk', cx: x, cz: z, realm: msg.realm, data: encodeRLE(s.game.world.fullChunk(msg.realm, x,z)) });
          }
        } else if (msg.type === 'action') actions.handle(s, msg.action);
      } catch (e) { console.error('Message processing failed', e instanceof Error ? e.message : 'error'); send(s, { type: 'error', text: 'Action could not be completed' }); }
    });
  });
  let tick = 0;
  const timer = setInterval(() => {
    tick++;
    for (const g of storage.worlds.values()) {
      const online = actions.online(g);
      if (!online.length) continue;
      g.meta.played += BALANCE.tick; g.meta.players = online.length;
      if (g.rules.daylight) g.time = (g.time + BALANCE.tick / BALANCE.daySeconds) % 1;
      for (const s of online) {
        const p = s.player!;
        if (p.hp <= 0) continue;
        const input = performance.now() - s.inputAt < 1000 ? s.input : { ...idleInput(), yaw: p.yaw, pitch: p.pitch, seq: p.seq };
        const result = stepBody(p, input, BALANCE.tick, { getBlock: (x,y,z) => g.world.get(p.realm,x,y,z), mode: p.mode === 'adventure' ? 'survival' : p.mode });
        if (result.fallDamage) actions.damage(s, result.fallDamage);
        p.yaw = input.yaw; p.pitch = input.pitch; p.seq = input.seq;
        if (Math.abs(p.x) > 100000 || Math.abs(p.z) > 100000) { p.x = Math.max(-100000,Math.min(100000,p.x)); p.z = Math.max(-100000,Math.min(100000,p.z)); }
        if (p.y < -12) actions.damage(s, 100);
        s.survival += BALANCE.tick;
        if (s.survival >= 1) {
          s.survival -= 1;
          if (p.mode === 'survival' || p.mode === 'adventure') {
            p.hunger = Math.max(0, p.hunger - (input.sprint ? 0.04 : 0.015));
            p.air = g.world.get(p.realm,p.x,p.y+1.6,p.z) === 5 ? Math.max(0,p.air-1) : Math.min(20,p.air+4);
            if (!p.air) actions.damage(s,2);
            if (!p.hunger) actions.damage(s,1);
            if (p.hunger > 16 && p.hp > 0 && p.hp < 20) { p.hp = Math.min(20,p.hp+1); p.hunger -= 0.3; }
            if ([17,38].includes(g.world.get(p.realm,p.x,p.y-0.1,p.z))) actions.damage(s,2);
            inventory(s);
          }
          for (const key of s.subscriptions) { const [realm,pos] = key.split(':'), [x,z] = pos.split(',').map(Number); if (realm !== p.realm || Math.max(Math.abs(x-chunkCoord(p.x)),Math.abs(z-chunkCoord(p.z))) > 8) s.subscriptions.delete(key); }
        }
      }
      for (const e of [...g.entities]) {
        if (!online.some(s => s.player!.realm === e.realm && distance(s.player!,e) < 128)) continue;
        stepMob(e,g.world,online.map(s => s.player!),BALANCE.tick,Math.random,(p,n) => { const s = online.find(s => s.player === p); if (s && g.meta.difficulty > 0) actions.damage(s,n * (0.5 + g.meta.difficulty * 0.5)); });
        if (e.kind === 'drop' && e.age > 1 && e.stack) for (const s of online) if (s.player!.hp > 0 && s.player!.mode !== 'spectator' && s.player!.realm === e.realm && distance(s.player!,e) < 1.8) { const left = addItem(s.player!.inventory,e.stack); if (left !== e.stack.count) inventory(s); e.stack.count = left; if (!left) break; }
        if (e.kind === 'drop' && (e.age > 300 || !e.stack?.count || e.y < -10)) g.entities.splice(g.entities.indexOf(e),1);
      }
      if (tick % 300 === 0 && g.rules.mobSpawning && g.entities.filter(e => e.kind !== 'drop').length < BALANCE.maxEntities) {
        const p = online[tick / 300 % online.length | 0].player!, x = p.x + 10 + Math.random()*12, z = p.z + (Math.random()-0.5)*30, y = g.world.gen.surface(x,z,p.realm)+1;
        const kind = p.realm === 'cinder' ? 'emberling' : p.realm === 'aether' ? 'wisp' : g.time > 0.55 && g.meta.difficulty > 0 ? Math.random() < 0.5 ? 'shambler' : 'skitter' : Math.random() < 0.7 ? 'grazer' : 'peep';
        if (y > 1 && y < 76 && g.world.get(p.realm,x,y,z) === 0) g.entities.push({ id: eid(),kind,realm:p.realm,x,y,z,hp:mobDef(kind).hp,maxHp:mobDef(kind).hp,yaw:0,state:'idle',age:0 });
      }
      stepMachines(g,BALANCE.tick,(realm,x,y,z,id) => { for (const s of online) if (s.player!.realm === realm && s.subscriptions.has(`${realm}:${Math.floor(x/16)},${Math.floor(z/16)}`)) send(s,{type:'block',realm,x,y,z,id}); },online.map(s => s.player!));
      stepSleep(actions,g);
      if (tick % 30 === 0) stepEncounters(g,online,actions);
      if (tick % 30 === 0) for (const [key,m] of g.machines) if (m.slots.length) actions.syncContainer(g,key);
      if (tick % 3 === 0) for (const s of online) {
        const p = s.player!;
        send(s,{ type:'snapshot',players:online.map(o => o.player!).filter(o => o.realm === p.realm && distance(o,p) <= 128).map(o => ({ ...o,inventory:[] })),entities:g.entities.filter(e => e.realm === p.realm && distance(e,p) <= 128),time:g.time,weather:g.weather,tick });
      }
    }
  },1000/30);
  const autosave = setInterval(() => { void storage.save().catch(e => console.error('Autosave failed',e)); },BALANCE.autosave*1000);
  try {
    await new Promise<void>((resolve,reject) => { http.once('error',reject); http.listen(port,() => { http.off('error',reject); resolve(); }); });
  } catch (error) {
    clearInterval(timer); clearInterval(autosave); wss.close(); throw error;
  }
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => { clearInterval(timer); clearInterval(autosave); for (const s of sessions) s.socket.terminate(); await new Promise<void>(resolve => wss.close(() => resolve())); await new Promise<void>((resolve,reject) => http.close(e => e ? reject(e) : resolve())); await storage.save(); })();
  return { http, wss, storage, sessions, actions, port: (http.address() as { port:number }).port, close };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createGameServer({ port: Number(process.env.PORT ?? 7777),saveDir:process.env.SAVE_DIR ?? resolve('saves') }).then(server => {
    console.log(`Aetheria listening on port ${server.port}`);
    const shutdown = () => { void server.close().then(() => process.exit(0),e => { console.error(e); process.exit(1); }); };
    process.once('SIGINT',shutdown); process.once('SIGTERM',shutdown);
  }).catch(e => { console.error(e); process.exitCode = 1; });
}
