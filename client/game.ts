import * as THREE from 'three';
import { blockDef, itemDef } from '../shared/blocks';
import { decodeRLE } from '../shared/codec';
import { BALANCE, CHUNK, HEIGHT, chunkCoord, chunkKey, distance } from '../shared/constants';
import { PLAYER, raycastVoxel, stepBody } from '../shared/physics';
import type { Action, Body, ClientMessage, Entity, Input, Player, ServerMessage, Vec3 } from '../shared/types';
import { WorldGen } from '../shared/worldgen';
import { Controls } from './input';
import { Net } from './net';
import { animateActor, bossKind, makeActor } from './rendering/actors';
import { WorldRenderer } from './rendering/world';
import { UI } from './ui';

type Actor = { entity: Entity | Player; group: THREE.Group; from: THREE.Vector3; to: THREE.Vector3; t: number; yaw: number; speed: number };
type Sound = 'place' | 'break' | 'hurt' | 'craft';
const vector = (p: Vec3) => new THREE.Vector3(p.x, p.y, p.z);
const bodyOf = (p: Player): Body => ({ x: p.x, y: p.y, z: p.z, vy: p.vy, grounded: p.grounded });
const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
export function usesBlock(id: number, heldId?: number): boolean {
  const block = blockDef(id), held = heldId === undefined ? undefined : itemDef(heldId);
  return !!block.container || !!block.crop || block.name === 'forge' || ['bed', 'lever', 'door', 'door open', 'aether portal', 'cinder portal'].includes(block.name)
    || [1, 2].includes(id) && held?.tool === 'hoe' || id === 31 && (heldId === 29 || heldId === 48);
}

class Audio {
  private context?: AudioContext;
  private master?: GainNode;
  private ambient?: GainNode;
  private tone?: OscillatorNode;
  private unavailable = false;

  unlock(volume: number): void {
    if (this.unavailable) return;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = volume;
        this.master.connect(this.context.destination);
        this.ambient = this.context.createGain();
        this.ambient.gain.value = 0;
        this.ambient.connect(this.master);
        this.tone = this.context.createOscillator();
        this.tone.type = 'sine';
        this.tone.frequency.value = 110;
        this.tone.connect(this.ambient);
        this.tone.start();
      }
      void this.context.resume().catch(() => {});
    } catch { this.unavailable = true; }
  }

  update(volume: number, day: number, active: boolean): void {
    if (!this.context || !this.master || !this.ambient || !this.tone) return;
    const now = this.context.currentTime;
    this.master.gain.setTargetAtTime(volume, now, 0.1);
    this.ambient.gain.setTargetAtTime(active ? 0.004 + day * 0.003 : 0, now, 0.5);
    this.tone.frequency.setTargetAtTime(82 + day * 28, now, 1);
  }

  play(sound: Sound): void {
    const ctx = this.context;
    if (!ctx || !this.master || ctx.state !== 'running') return;
    const oscillator = ctx.createOscillator(), gain = ctx.createGain();
    const frequency = { place: 260, break: 140, hurt: 90, craft: 660 }[sound];
    oscillator.type = sound === 'hurt' || sound === 'break' ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(sound === 'craft' ? 990 : frequency * 0.45, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.17);
    oscillator.connect(gain); gain.connect(this.master);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(); oscillator.stop(ctx.currentTime + 0.18);
  }

  dispose(): void { this.tone?.stop(); if (this.context) void this.context.close().catch(() => {}); }
}

class Puffs {
  private positions = new Float32Array(256 * 3);
  private colors = new Float32Array(256 * 3);
  private velocities = new Float32Array(256 * 3);
  private life = new Float32Array(256);
  private cursor = 0;
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;

  constructor(scene: THREE.Scene) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.positions.fill(-10000);
    this.points = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  burst(x: number, y: number, z: number, color: number): void {
    const tint = new THREE.Color(color);
    for (let n = 0; n < 18; n++) {
      const i = this.cursor++ % this.life.length, j = i * 3;
      this.life[i] = 0.4 + Math.random() * 0.3;
      this.positions.set([x + Math.random(), y + Math.random(), z + Math.random()], j);
      this.velocities.set([(Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3], j);
      this.colors.set([tint.r, tint.g, tint.b], j);
    }
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  update(dt: number): void {
    for (let i = 0; i < this.life.length; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const j = i * 3;
      this.velocities[j + 1] -= 8 * dt;
      for (let axis = 0; axis < 3; axis++) this.positions[j + axis] += this.velocities[j + axis] * dt;
      if (this.life[i] <= 0) this.positions[j + 1] = -10000;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  clear(): void { this.life.fill(0); this.positions.fill(-10000); this.points.geometry.attributes.position.needsUpdate = true; }
  dispose(): void { this.points.geometry.dispose(); this.points.material.dispose(); }
}

export class Game {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(75, 1, 0.05, 600);
  readonly world = new WorldRenderer(this.scene);
  readonly net: Net;
  readonly ui: UI;
  readonly controls: Controls;
  private renderer: THREE.WebGLRenderer;
  private player?: Player;
  private body?: Body;
  private actors = new Map<string, Actor>();
  private actorMeshes: THREE.Mesh[] = [];
  private pendingChunks = new Map<string, number>();
  private chunkCredit = 16;
  private chunkAt = performance.now();
  private requestAt = 0;
  private time = 0.25;
  private weather = 'clear';
  private gen = new WorldGen('aetheria-preview');
  private preview: [number, number][] = [];
  private audio = new Audio();
  private puffs = new Puffs(this.scene);
  private ambient = new THREE.HemisphereLight(0xcfe5ff, 0x433c32, 2);
  private sunlight = new THREE.DirectionalLight(0xffedd0, 1.4);
  private sun = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffe4a0, fog: false, depthWrite: false }));
  private moon = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xd7e5ff, fog: false, depthWrite: false }));
  private stars: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private rain: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.006, 1.006, 1.006)), new THREE.LineBasicMaterial({ color: 0xffeed0, transparent: true, opacity: 0.65 }));
  private fog = new THREE.Fog(0x8bb5d0, 20, 90);
  private skyColor = new THREE.Color(0x8bb5d0);
  private ray = new THREE.Raycaster();
  private direction = new THREE.Vector3();
  private correction = new THREE.Vector3();
  private history: { seq: number; body: Body }[] = [];
  private lastInput?: Input;
  private inputAt = 0;
  private mine?: { key: string; start: number; duration: number };
  private mineAt = -Infinity;
  private attackAt = -Infinity;
  private useAt = -Infinity;
  private portalTime = 0;
  private portalReady = true;
  private resetRequested = false;
  private crafting?: { inventory: string; at: number };
  private debug = document.createElement('pre');
  private debugEnabled = false;
  private fps = 60;
  private hudAt = 0;
  private previous = performance.now();
  private elapsed = 0;
  private frameId = 0;
  private events = new AbortController();

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera.rotation.order = 'YXZ';
    this.scene.background = this.skyColor;
    this.scene.fog = this.fog;
    this.scene.add(this.ambient, this.sunlight, this.sunlight.target, this.sun, this.moon, this.outline);
    this.sun.scale.setScalar(11); this.moon.scale.setScalar(7);
    this.outline.visible = false;
    const starPositions = new Float32Array(600 * 3);
    for (let i = 0; i < starPositions.length; i += 3) {
      const azimuth = Math.random() * Math.PI * 2, y = Math.random(), r = Math.sqrt(1 - y * y);
      starPositions.set([Math.cos(azimuth) * r * 260, y * 260, Math.sin(azimuth) * r * 260], i);
    }
    this.stars = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xdce9ff, size: 0.65, fog: false, transparent: true, depthWrite: false }));
    this.stars.geometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const rainPositions = new Float32Array(800 * 3);
    for (let i = 0; i < rainPositions.length; i += 3) rainPositions.set([(Math.random() - 0.5) * 36, Math.random() * 24 - 6, (Math.random() - 0.5) * 36], i);
    this.rain = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xa6c3db, size: 0.075, transparent: true, opacity: 0.6, depthWrite: false }));
    this.rain.geometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
    this.rain.frustumCulled = false;
    this.scene.add(this.stars, this.rain);
    this.net = new Net(message => this.receive(message), (connected, text) => {
      if (!connected) this.leave();
      this.ui.notice(text);
    });
    this.ui = new UI(message => this.send(message), address => {
      try {
        if (this.player) this.leave();
        this.net.connect(address);
      } catch { this.ui.notice('Enter a valid server address.'); }
    }, () => this.controls?.lock());
    this.controls = new Controls(canvas, this.ui, () => !!this.player && this.player.hp > 0, code => this.command(code), () => this.sendInput(true), button => this.interact(button), () => this.audio.unlock(this.ui.settings.volume));
    this.debug.hidden = true;
    this.debug.setAttribute('aria-label', 'Performance statistics');
    this.debug.style.cssText = 'position:fixed;left:16px;top:90px;padding:12px;background:#101e1cdd;color:#efe5ce;font:12px/1.6 monospace;pointer-events:none;margin:0';
    document.getElementById('ui')!.appendChild(this.debug);
    this.preparePreview();
    const options = { signal: this.events.signal };
    window.addEventListener('resize', () => this.resize(), options);
    window.addEventListener('pagehide', () => this.dispose(), options);
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      this.controls.clear();
      this.ui.notice('Graphics context lost. Waiting for recovery…');
    }, options);
    canvas.addEventListener('webglcontextrestored', () => this.ui.notice('Graphics restored.'), options);
    this.resize();
    this.frameId = requestAnimationFrame(now => this.frame(now));
    this.net.connect();
  }

  private send(message: ClientMessage): void {
    if (!this.net.send(message)) { this.ui.notice('Not connected. Wait for reconnection, then try again.'); return; }
    if (message.type !== 'action') return;
    if (message.action.type === 'select') { this.ui.selected = message.action.slot; this.mine = undefined; }
    if (message.action.type === 'craft' && this.player) this.crafting = { inventory: JSON.stringify(this.player.inventory), at: performance.now() };
    if (message.action.type === 'chat' && /^\/tp\s/.test(message.action.text)) this.resetRequested = true;
  }

  private action(action: Action): void { this.send({ type: 'action', action }); }

  private receive(message: ServerMessage): void {
    switch (message.type) {
      case 'worlds': this.ui.setWorlds(message.worlds); break;
      case 'created':
        this.send({ type: 'hello', token: this.ui.token, name: this.ui.name, color: this.ui.color, world: message.world.id });
        break;
      case 'welcome':
        this.clearWorld();
        this.player = message.player;
        this.body = bodyOf(message.player);
        this.gen = new WorldGen(message.world.seed);
        this.preview = [];
        this.time = message.time;
        this.weather = 'clear';
        this.controls.seq = message.player.seq;
        this.controls.yaw = message.player.yaw;
        this.controls.pitch = message.player.pitch;
        this.lastInput = undefined;
        this.chunkCredit = 16;
        this.chunkAt = performance.now();
        this.portalReady = true;
        this.ui.welcome(message.player, message.world);
        this.ui.notice('Click the world to look around. E: pack · Enter: chat · F3: debug');
        this.requestChunks(performance.now());
        this.sendInput(true);
        break;
      case 'inventory':
        if (!this.player || message.player.id !== this.player.id) break;
        if (this.crafting) {
          if (performance.now() - this.crafting.at < 1500 && JSON.stringify(message.player.inventory) !== this.crafting.inventory) this.audio.play('craft');
          this.crafting = undefined;
        }
        this.acceptPlayer(message.player, false);
        this.ui.selected = message.player.selected;
        this.updateHUD(performance.now(), true);
        break;
      case 'snapshot': {
        if (!this.player) break;
        this.time = message.time;
        this.weather = message.weather;
        const local = message.players.find(p => p.id === this.player!.id);
        if (local) this.acceptPlayer(local, true);
        this.syncActors([...message.entities, ...message.players.filter(p => p.id !== this.player!.id)]);
        break;
      }
      case 'chunk': {
        if (!this.player || message.realm !== this.player.realm) break;
        const key = chunkKey(message.cx, message.cz);
        this.pendingChunks.delete(key);
        if (this.inRange(message.cx, message.cz)) this.world.setChunk(message.cx, message.cz, decodeRLE(message.data));
        break;
      }
      case 'block': {
        if (!this.player || message.realm !== this.player.realm) break;
        const before = this.world.getBlock(message.x, message.y, message.z);
        this.world.setBlock(message.x, message.y, message.z, message.id);
        if (distance(this.body!, message) < 16 && before !== message.id) {
          if (message.id === 0 && before !== 21) { this.puffs.burst(message.x, message.y, message.z, blockDef(before).color); this.audio.play('break'); }
          else if (message.id !== 0) this.audio.play('place');
        }
        if (this.mine?.key.startsWith(`${message.x},${message.y},${message.z}:`)) this.mine = undefined;
        break;
      }
      case 'container': if (this.player) { this.controls.clear(); this.ui.container(message.key, message.machine); } break;
      case 'chat': this.ui.chat(message.name, message.text); break;
      case 'error': this.resetRequested = false; this.crafting = undefined; this.ui.notice(message.text); break;
      case 'notice': this.ui.notice(message.text); break;
      case 'pong': break;
    }
  }

  private acceptPlayer(next: Player, snapshot: boolean): void {
    const previous = this.player!;
    const realmChanged = next.realm !== previous.realm;
    const respawned = next.hp > 0 && previous.hp <= 0;
    const teleported = distance(previous, next) > 8 || (!snapshot && this.resetRequested);
    const reset = realmChanged || respawned || teleported;
    if (next.hp < previous.hp) this.audio.play('hurt');
    this.player = { ...next, inventory: next.inventory.length ? next.inventory : previous.inventory };
    this.controls.seq = Math.max(this.controls.seq, next.seq);
    if (reset) {
      this.clearWorld();
      this.body = bodyOf(next);
      this.controls.clear();
      this.controls.yaw = next.yaw;
      this.controls.pitch = next.pitch;
      this.resetRequested = false;
      if (realmChanged) { if (this.ui.isOpen && next.hp > 0) this.ui.close(); this.ui.notice(`Entering ${next.realm}.`); }
      this.requestChunks(performance.now());
    } else if (next.mode !== previous.mode) {
      this.body = bodyOf(next);
      this.history = [];
      this.correction.set(0, 0, 0);
      this.controls.clear();
    } else if (snapshot && this.body) {
      const historical = this.history.find(entry => entry.seq === next.seq);
      const reference = historical?.body ?? this.body;
      const error = vector(next).sub(vector(reference));
      if (error.length() > 4) { Object.assign(this.body, bodyOf(next)); this.correction.set(0, 0, 0); }
      else if (error.length() > 0.3) this.correction.copy(error);
      if (Math.abs(next.vy - this.body.vy) > 8) this.body.vy = next.vy;
      this.history = this.history.filter(entry => entry.seq >= next.seq);
    }
    if (next.hp <= 0) { this.mine = undefined; this.controls.clear(); }
  }

  private syncActors(entities: (Entity | Player)[]): void {
    const present = new Set<string>();
    for (const entity of entities) {
      if (entity.realm !== this.player?.realm || 'mode' in entity && entity.mode === 'spectator') continue;
      present.add(entity.id);
      let actor = this.actors.get(entity.id);
      const kind = 'kind' in entity ? entity.kind : 'player';
      if (actor && ('kind' in actor.entity ? actor.entity.kind : 'player') !== kind) { this.removeActor(entity.id); actor = undefined; }
      if (!actor) {
        const color = 'color' in entity ? entity.color : entity.stack ? `#${blockDef(itemDef(entity.stack.id).block ?? 2).color.toString(16).padStart(6, '0')}` : undefined;
        const group = makeActor(kind, color);
        group.userData.id = entity.id;
        group.traverse(node => { if (node instanceof THREE.Mesh) node.userData.entityId = entity.id; });
        if ('name' in entity) {
          const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 64;
          const context = canvas.getContext('2d');
          if (context) {
            context.font = '600 28px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
            context.fillStyle = '#101e1ccc'; context.fillRect(0, 0, 512, 64);
            context.fillStyle = '#efe5ce'; context.fillText(entity.name, 256, 32, 490);
            const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
            const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
            label.position.y = 2.25; label.scale.set(2.8, 0.35, 1); group.add(label);
          }
        }
        group.position.copy(vector(entity)); group.rotation.y = entity.yaw + ('name' in entity ? Math.PI : 0);
        this.scene.add(group);
        actor = { entity, group, from: vector(entity), to: vector(entity), t: 1, yaw: group.rotation.y, speed: 0 };
        this.actors.set(entity.id, actor);
      }
      actor.from.copy(actor.group.position);
      actor.to.copy(vector(entity));
      actor.speed = actor.to.distanceTo(actor.from) / 0.1;
      actor.yaw = actor.group.rotation.y;
      actor.t = 0;
      actor.entity = entity;
      if (actor.from.distanceTo(actor.to) > 8) actor.from.copy(actor.to);
    }
    for (const id of this.actors.keys()) if (!present.has(id)) this.removeActor(id);
    this.actorMeshes = [];
    for (const actor of this.actors.values()) {
      if ('kind' in actor.entity && actor.entity.kind === 'drop') continue;
      actor.group.traverse(node => { if (node instanceof THREE.Mesh && !node.userData.telegraph) this.actorMeshes.push(node); });
    }
  }

  private removeActor(id: string): void {
    const actor = this.actors.get(id);
    if (!actor) return;
    this.scene.remove(actor.group);
    actor.group.traverse(node => { if (node instanceof THREE.Sprite) { node.material.map?.dispose(); node.material.dispose(); } });
    this.actors.delete(id);
  }

  private inRange(cx: number, cz: number): boolean {
    const p = this.body;
    return !!p && Math.max(Math.abs(cx - chunkCoord(p.x)), Math.abs(cz - chunkCoord(p.z))) <= this.ui.settings.distance;
  }

  private requestChunks(now: number): void {
    if (!this.player || !this.body || !this.net.connected) return;
    this.chunkCredit = Math.min(16, this.chunkCredit + (now - this.chunkAt) / 1000 * 12);
    this.chunkAt = now;
    this.world.update(this.body, this.ui.settings.distance);
    for (const [key, sent] of this.pendingChunks) {
      const [x, z] = key.split(',').map(Number);
      if (!this.inRange(x, z) || now - sent > 5000) this.pendingChunks.delete(key);
    }
    const cx = chunkCoord(this.body.x), cz = chunkCoord(this.body.z), coords: [number, number][] = [];
    const add = (x: number, z: number) => {
      if (Math.abs(x) > 6250 || Math.abs(z) > 6250 || coords.length >= Math.floor(this.chunkCredit)) return;
      const key = chunkKey(x, z);
      if (!this.world.chunks.has(key) && !this.pendingChunks.has(key)) coords.push([x, z]);
    };
    add(cx, cz);
    for (let r = 1; r <= this.ui.settings.distance; r++) {
      for (let x = -r; x < r; x++) add(cx + x, cz - r);
      for (let z = -r; z < r; z++) add(cx + r, cz + z);
      for (let x = r; x > -r; x--) add(cx + x, cz + r);
      for (let z = r; z > -r; z--) add(cx - r, cz + z);
    }
    if (coords.length && this.net.send({ type: 'chunks', coords, realm: this.player.realm })) {
      this.chunkCredit -= coords.length;
      for (const [x, z] of coords) this.pendingChunks.set(chunkKey(x, z), now);
    }
  }

  private sendInput(force = false): void {
    if (!this.player || !this.controls || !this.net.connected) return;
    const now = performance.now(), input = this.controls.sample();
    const last = this.lastInput;
    const changed = !last || input.forward !== last.forward || input.strafe !== last.strafe || input.jump !== last.jump || input.crouch !== last.crouch || input.sprint !== last.sprint;
    if (!force && !changed && now - this.inputAt < 50) return;
    input.seq = ++this.controls.seq;
    if (this.net.send({ type: 'input', input })) {
      this.lastInput = input; this.inputAt = now;
      if (this.body) this.history.push({ seq: input.seq, body: { ...this.body } });
      if (this.history.length > 180) this.history.shift();
    }
  }

  private command(code: string): void {
    if (code === 'KeyE') { this.controls.clear(); this.ui.toggleInventory(); }
    else if (code === 'KeyT' || code === 'Enter') { this.controls.clear(); this.ui.openChat(); }
    else if (code === 'KeyQ') this.action({ type: 'drop' });
    else if (code === 'F3') this.debugEnabled = !this.debugEnabled;
    else if (code === 'KeyF') this.ui.hideHUD = !this.ui.hideHUD;
    else {
      const slot = code === 'NextSlot' ? (this.ui.selected + 1) % 9 : code === 'PreviousSlot' ? (this.ui.selected + 8) % 9 : Number(code.slice(5)) - 1;
      if (Number.isInteger(slot) && slot >= 0 && slot <= 8) this.action({ type: 'select', slot });
    }
  }

  private getBlock = (x: number, y: number, z: number) => this.world.getBlock(x, y, z);

  private targets() {
    this.camera.updateMatrixWorld();
    this.camera.getWorldDirection(this.direction);
    const block = raycastVoxel(this.camera.position, this.direction, BALANCE.reach, (x, y, z) => {
      const id = this.getBlock(x, y, z);
      return blockDef(id).liquid ? 0 : id;
    }, true);
    this.ray.set(this.camera.position, this.direction); this.ray.far = Math.min(BALANCE.reach, block?.dist ?? BALANCE.reach);
    for (const actor of this.actors.values()) actor.group.updateMatrixWorld(true);
    const hit = this.ray.intersectObjects(this.actorMeshes, false)[0];
    const actor = hit ? this.actors.get(hit.object.userData.entityId as string) : undefined;
    return { block, actor };
  }

  private interact(button: number): void {
    if (!this.player || this.player.hp <= 0 || this.player.mode === 'spectator' || this.ui.isOpen || !this.controls.locked) return;
    this.updateCamera(0);
    const now = performance.now(), { block, actor } = this.targets();
    if (button === 0) {
      if (actor) {
        this.mine = undefined;
        if (now - this.attackAt >= 400) { this.action({ type: 'attack', id: actor.entity.id }); this.attackAt = now; }
        return;
      }
      if (!block || block.id === 21 || this.player.mode === 'adventure' || block.y < 0 || block.y >= HEIGHT) { this.mine = undefined; return; }
      const key = `${block.x},${block.y},${block.z}:${block.id}:${this.ui.selected}`;
      if (!this.mine || this.mine.key !== key) {
        const stack = this.player.inventory[this.ui.selected], tool = stack ? itemDef(stack.id) : undefined, def = blockDef(block.id);
        this.mine = { key, start: now, duration: Math.max(120, def.hardness * 700 / (tool?.tool === def.tool ? tool?.speed ?? 1 : 1)) };
        this.mineAt = -Infinity;
      }
      if (now - this.mineAt >= 300) { this.action({ type: 'mine', x: block.x, y: block.y, z: block.z }); this.mineAt = now; }
    } else if (button === 2 && now - this.useAt >= 200) {
      this.useAt = now;
      if (actor && 'kind' in actor.entity && actor.entity.kind === 'trader') { this.controls.clear(); this.ui.trade(actor.entity.id); return; }
      const stack = this.player.inventory[this.ui.selected], held = stack ? itemDef(stack.id) : undefined;
      if (block && usesBlock(block.id, stack?.id)) {
        this.action({ type: 'use', x: block.x, y: block.y, z: block.z });
        if ([42, 43].includes(block.id)) this.portalReady = false;
        return;
      }
      if (held?.food) { this.action({ type: 'eat' }); return; }
      if (!block || held?.block === undefined || this.player.mode === 'adventure') return;
      const x = block.x + block.face[0], y = block.y + block.face[1], z = block.z + block.face[2];
      const existing = blockDef(this.getBlock(x, y, z));
      if (y < 0 || y >= HEIGHT || Math.abs(x) > 100000 || Math.abs(z) > 100000 || existing.solid || existing.liquid || !block.face.some(Boolean)) return;
      const overlaps = (p: Vec3, width = 0.6, height = 1.8) => p.x + width / 2 > x && p.x - width / 2 < x + 1 && p.z + width / 2 > z && p.z - width / 2 < z + 1 && p.y + height > y && p.y < y + 1;
      if (blockDef(held.block).solid && (overlaps(this.body!) || [...this.actors.values()].some(a => !('kind' in a.entity && a.entity.kind === 'drop') && overlaps(a.group.position, 1, 1.8)))) return;
      this.action({ type: 'place', x, y, z });
    }
  }

  private updateCamera(dt: number): void {
    if (!this.body) return;
    const input = this.controls.sample();
    const moving = input.forward !== 0 || input.strafe !== 0;
    const bob = this.ui.settings.bob && moving && this.body.grounded ? Math.sin(this.elapsed * (input.sprint ? 13 : 9)) * 0.035 : 0;
    this.camera.position.set(this.body.x, this.body.y + PLAYER.eye - (input.crouch ? 0.22 : 0) + bob, this.body.z);
    this.camera.rotation.set(this.controls.pitch, this.controls.yaw, 0, 'YXZ');
    const fov = this.ui.settings.fov + (input.sprint && moving ? 8 : 0);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, fov, Math.min(1, dt * 10));
    this.camera.updateProjectionMatrix();
  }

  private updateEnvironment(dt: number): void {
    const realm = this.player?.realm ?? 'verdant';
    const angle = this.time * Math.PI * 2;
    const day = THREE.MathUtils.smoothstep(Math.sin(angle), -0.15, 0.4);
    const wet = realm === 'verdant' && this.weather !== 'clear';
    const color = realm === 'cinder' ? new THREE.Color(0x35222b) : realm === 'aether' ? new THREE.Color(0x8898cd) : new THREE.Color(0x0b132a).lerp(new THREE.Color(0x8bb5d0), day);
    if (wet) color.lerp(new THREE.Color(0x4e5d6a), this.weather === 'storm' ? 0.7 : 0.4);
    const underwater = this.player && this.getBlock(this.camera.position.x, this.camera.position.y, this.camera.position.z) === 5;
    if (underwater) color.set(0x244b77);
    this.skyColor.lerp(color, Math.min(1, dt * 4));
    this.fog.color.copy(this.skyColor);
    const reach = this.player ? this.ui.settings.distance * CHUNK : 42;
    this.fog.near = underwater ? 1 : reach * 0.35;
    this.fog.far = underwater ? 12 : reach * (wet ? 0.95 : 1.15);
    this.ambient.intensity = realm === 'cinder' ? 1.0 : 0.45 + day * 1.7;
    this.sunlight.intensity = 0.15 + day * (wet ? 0.5 : 1.4);
    this.sun.position.copy(this.camera.position).add(new THREE.Vector3(Math.cos(angle) * 200, Math.sin(angle) * 200, -60));
    this.moon.position.copy(this.camera.position).add(new THREE.Vector3(-Math.cos(angle) * 200, -Math.sin(angle) * 200, 60));
    this.sunlight.position.copy(this.sun.position); this.sunlight.target.position.copy(this.camera.position);
    this.sun.visible = realm !== 'cinder' && !wet && !underwater;
    this.moon.visible = this.sun.visible;
    this.stars.visible = realm !== 'cinder' && !wet && !underwater;
    this.stars.material.opacity = 1 - day;
    this.stars.position.copy(this.camera.position);
    this.rain.visible = wet && !underwater;
    if (this.rain.visible) {
      this.rain.position.copy(this.camera.position);
      const positions = this.rain.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < positions.count; i++) {
        const y = positions.getY(i) - dt * (this.weather === 'storm' ? 25 : 17);
        positions.setY(i, y < -6 ? y + 24 : y);
      }
      positions.needsUpdate = true;
    }
    this.audio.update(this.ui.settings.volume, day, !!this.player && !document.hidden);
  }

  private updateHUD(now: number, force = false): void {
    if (!this.player || !this.body || !force && now - this.hudAt < 100) return;
    this.hudAt = now;
    const biome = this.gen.column(0, 0, this.body.x, this.body.z, this.player.realm).biome;
    const boss = [...this.actors.values()].map(a => a.entity).filter((e): e is Entity => 'kind' in e && bossKind(e.kind) && e.hp > 0 && distance(e, this.body!) < 32).sort((a, b) => distance(a, this.body!) - distance(b, this.body!))[0];
    this.ui.update({ ...this.player, ...this.body }, { boss, fps: this.fps, ping: this.net.ping, chunks: this.world.stats.chunks, entities: this.actors.size, time: this.time, weather: this.weather, biome, players: [this.player.name, ...[...this.actors.values()].flatMap(a => 'name' in a.entity ? [a.entity.name] : [])] });
    this.debug.hidden = !this.debugEnabled || this.ui.hideHUD;
    if (!this.debug.hidden) this.debug.textContent = `${Math.round(this.fps)} FPS | ${Math.round(this.net.ping)} ms\nChunks ${this.world.stats.chunks} | meshes pending ${this.world.stats.jobs}\nEntities ${this.actors.size} | triangles ${this.world.stats.triangles}\nXYZ ${this.body.x.toFixed(2)} ${this.body.y.toFixed(2)} ${this.body.z.toFixed(2)}\n${this.player.realm} / ${biome} / ${this.weather}\nInput ${this.controls.seq} / acknowledged ${this.player.seq}`;
  }

  private frame(now: number): void {
    const raw = Math.max(0.001, (now - this.previous) / 1000), dt = Math.min(0.05, raw);
    this.previous = now; this.elapsed += dt; this.fps += (1 / raw - this.fps) * 0.05;
    if (this.player && this.body) {
      const input = this.controls.sample();
      if (this.player.hp > 0 && this.world.chunks.has(chunkKey(chunkCoord(this.body.x), chunkCoord(this.body.z)))) {
        const blend = Math.min(1, dt * 8);
        this.body.x += this.correction.x * blend; this.body.y += this.correction.y * blend; this.body.z += this.correction.z * blend;
        this.correction.multiplyScalar(1 - blend);
        stepBody(this.body, input, dt, { getBlock: this.getBlock, mode: this.player.mode === 'adventure' ? 'survival' : this.player.mode });
      }
      this.sendInput();
      this.updateCamera(dt);
      if (now - this.requestAt >= 100) { this.requestAt = now; this.requestChunks(now); }
      for (const actor of this.actors.values()) {
        actor.t = Math.min(1, actor.t + dt / 0.1);
        actor.group.position.lerpVectors(actor.from, actor.to, actor.t);
        const yaw = actor.entity.yaw + ('name' in actor.entity ? Math.PI : 0);
        actor.group.rotation.y = actor.yaw + angleDelta(actor.yaw, yaw) * actor.t;
        const entity = actor.entity;
        if ('kind' in entity && bossKind(entity.kind) && ['windup_radial', 'windup_rush', 'rush'].includes(entity.state)) actor.group.rotation.y = entity.yaw;
        animateActor(actor.group, this.elapsed, actor.t < 1 ? actor.speed : 0, entity.hp <= 0 ? 'dead' : 'state' in entity ? entity.state : actor.speed > 0.1 ? 'walk' : 'idle', 'phase' in entity ? entity.phase : 1, 'attackTimer' in entity ? entity.attackTimer : 0);
      }
      if (this.controls.left && !this.ui.isOpen) this.interact(0);
      else this.mine = undefined;
      if (!this.ui.isOpen && this.controls.locked && this.player.hp > 0) {
        const { block, actor } = this.targets();
        this.outline.visible = !!block && !actor && block.id !== 21;
        if (block) this.outline.position.set(block.x + 0.5, block.y + 0.5, block.z + 0.5);
        const name = actor ? 'name' in actor.entity ? actor.entity.name : actor.entity.kind : block && block.id !== 21 ? blockDef(block.id).name : '';
        this.ui.target(name, this.mine && this.player.mode !== 'creative' ? Math.min(0.99, (now - this.mine.start) / this.mine.duration) : 0);
      } else { this.outline.visible = false; this.ui.target('', 0); }
      this.updatePortal(dt);
      this.updateHUD(now);
    } else {
      if (this.preview.length) {
        const [cx, cz] = this.preview.shift()!;
        this.world.setChunk(cx, cz, this.gen.chunk(cx, cz, 'verdant'));
      }
      const angle = this.elapsed * 0.035, height = this.gen.surface(0, 0);
      this.camera.position.set(Math.cos(angle) * 15, height + 13, Math.sin(angle) * 15);
      this.camera.lookAt(0, height + 1, 0);
    }
    this.updateEnvironment(dt);
    this.puffs.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.frameId = requestAnimationFrame(time => this.frame(time));
  }

  private updatePortal(dt: number): void {
    if (!this.player || !this.body) return;
    const x = Math.floor(this.body.x), y = Math.floor(this.body.y), z = Math.floor(this.body.z);
    const loaded = this.world.chunks.has(chunkKey(chunkCoord(x), chunkCoord(z)));
    if (!loaded) { this.portalTime = 0; return; }
    const portal = [42, 43].includes(this.getBlock(x, y, z));
    if (!portal) { this.portalTime = 0; this.portalReady = true; return; }
    if (!this.portalReady || this.ui.isOpen || this.player.mode === 'spectator' || this.player.hp <= 0) { this.portalTime = 0; return; }
    this.portalTime += dt;
    if (this.portalTime > 1) { this.action({ type: 'use', x, y, z }); this.portalReady = false; }
  }

  private preparePreview(): void {
    this.gen = new WorldGen('aetheria-preview');
    this.preview = [];
    for (let z = -2; z <= 2; z++) for (let x = -2; x <= 2; x++) this.preview.push([x, z]);
    this.preview.sort((a, b) => a[0] ** 2 + a[1] ** 2 - b[0] ** 2 - b[1] ** 2);
    this.time = 0.25; this.weather = 'clear';
  }

  private clearWorld(): void {
    this.world.clear();
    for (const id of this.actors.keys()) this.removeActor(id);
    this.actorMeshes = []; this.pendingChunks.clear(); this.history = [];
    this.correction.set(0, 0, 0); this.puffs.clear(); this.mine = undefined; this.outline.visible = false;
    this.portalTime = 0;
  }

  private leave(): void {
    this.player = undefined; this.body = undefined;
    this.controls?.clear();
    this.clearWorld();
    this.ui.showTitle(); this.debug.hidden = true;
    this.preparePreview();
    this.lastInput = undefined;
    this.resetRequested = false; this.crafting = undefined;
  }

  private resize(): void {
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    cancelAnimationFrame(this.frameId);
    this.events.abort(); this.net.disconnect(); this.controls.dispose(); this.audio.dispose(); this.clearWorld();
    this.puffs.dispose(); this.stars.geometry.dispose(); this.stars.material.dispose(); this.rain.geometry.dispose(); this.rain.material.dispose();
    this.sun.material.dispose(); this.moon.material.dispose(); this.outline.geometry.dispose(); this.outline.material.dispose();
    this.renderer.dispose(); this.debug.remove();
  }
}
