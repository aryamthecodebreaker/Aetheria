import { BLOCK, blockDef } from './blocks';
import { BALANCE } from './constants';
import type { Body, Input, Mode, Vec3 } from './types';

export const PLAYER = { w: 0.6, h: 1.8, eye: 1.62 };

type GetBlock = (x: number, y: number, z: number) => number;
type Hit = { x: number; y: number; z: number; face: [number, number, number]; id: number; dist: number };
type State = { height: number; coyote: number; held: boolean; tap: number; flying: boolean; peak: number };
const states = new WeakMap<Body, State>();
const EPS = 1e-7;
const LIMIT = 1e6;
const finite = (n: number) => Number.isNaN(n) ? 0 : Math.max(-LIMIT, Math.min(LIMIT, n));
const timeStep = (dt: number) => Math.max(0, Math.min(0.05, finite(dt)));

function sanitize(body: Body) {
  body.x = finite(body.x);
  body.y = finite(body.y);
  body.z = finite(body.z);
  body.vy = finite(body.vy);
}

function overlaps(x: number, y: number, z: number, height: number, getBlock: GetBlock): boolean {
  const r = PLAYER.w / 2;
  for (let bx = Math.max(-LIMIT, Math.floor(x - r + EPS)); bx <= Math.min(LIMIT, Math.floor(x + r - EPS)); bx++) {
    for (let by = Math.max(-LIMIT, Math.floor(y + EPS)); by <= Math.min(LIMIT, Math.floor(y + height - EPS)); by++) {
      for (let bz = Math.max(-LIMIT, Math.floor(z - r + EPS)); bz <= Math.min(LIMIT, Math.floor(z + r - EPS)); bz++) {
        const def = blockDef(getBlock(bx, by, bz));
        if (def.solid && y < by + (def.slab ? 0.5 : 1) - EPS) return true;
      }
    }
  }
  return false;
}

function sweep(body: Body, height: number, axis: 'x' | 'y' | 'z', delta: number, getBlock: GetBlock): number {
  delta = finite(body[axis] + finite(delta)) - body[axis];
  if (!delta) return 0;
  const r = PLAYER.w / 2;
  const x0 = body.x - r, x1 = body.x + r;
  const y0 = body.y, y1 = body.y + height;
  const z0 = body.z - r, z1 = body.z + r;
  const dx = axis === 'x' ? delta : 0, dy = axis === 'y' ? delta : 0, dz = axis === 'z' ? delta : 0;
  const minX = Math.max(-LIMIT, Math.floor(x0 + Math.min(0, dx) + EPS));
  const maxX = Math.min(LIMIT, Math.floor(x1 + Math.max(0, dx) - EPS));
  const minY = Math.max(-LIMIT, Math.floor(y0 + Math.min(0, dy) + EPS));
  const maxY = Math.min(LIMIT, Math.floor(y1 + Math.max(0, dy) - EPS));
  const minZ = Math.max(-LIMIT, Math.floor(z0 + Math.min(0, dz) + EPS));
  const maxZ = Math.min(LIMIT, Math.floor(z1 + Math.max(0, dz) - EPS));
  let allowed = delta;
  for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) for (let z = minZ; z <= maxZ; z++) {
    const def = blockDef(getBlock(x, y, z));
    if (!def.solid) continue;
    const top = y + (def.slab ? 0.5 : 1);
    if (axis !== 'x' && (x1 <= x + EPS || x0 >= x + 1 - EPS)) continue;
    if (axis !== 'y' && (y1 <= y + EPS || y0 >= top - EPS)) continue;
    if (axis !== 'z' && (z1 <= z + EPS || z0 >= z + 1 - EPS)) continue;
    const low = axis === 'x' ? x0 : axis === 'y' ? y0 : z0;
    const high = axis === 'x' ? x1 : axis === 'y' ? y1 : z1;
    const blockLow = axis === 'x' ? x : axis === 'y' ? y : z;
    const blockHigh = axis === 'x' ? x + 1 : axis === 'y' ? top : z + 1;
    if (delta > 0 && high <= blockLow + EPS) allowed = Math.min(allowed, Math.max(0, blockLow - high));
    if (delta < 0 && low >= blockHigh - EPS) allowed = Math.max(allowed, Math.min(0, blockHigh - low));
  }
  return allowed;
}

function supported(body: Body, height: number, getBlock: GetBlock): boolean {
  return sweep(body, height, 'y', -0.001, getBlock) > -0.001 + EPS;
}

function vertical(body: Body, dt: number, height: number, getBlock: GetBlock): { grounded: boolean; hitHead: boolean } {
  const delta = body.vy * dt;
  const moved = sweep(body, height, 'y', delta, getBlock);
  body.y = finite(body.y + moved);
  const hitHead = delta > 0 && moved < delta - EPS;
  body.grounded = delta <= 0 && supported(body, height, getBlock);
  if (hitHead || body.grounded) body.vy = 0;
  return { grounded: body.grounded, hitHead };
}

export function collide(body: Body, dt: number, getBlock: GetBlock): { grounded: boolean; hitHead: boolean } {
  sanitize(body);
  return vertical(body, timeStep(dt), states.get(body)?.height ?? PLAYER.h, getBlock);
}

function horizontal(body: Body, height: number, axis: 'x' | 'z', delta: number, getBlock: GetBlock, step: boolean, edge: boolean) {
  const start = body[axis], baseY = body.y;
  const moved = sweep(body, height, axis, delta, getBlock);
  if (step && Math.abs(moved - delta) > EPS) {
    const lift = sweep(body, height, 'y', 0.6, getBlock);
    body.y += lift;
    const raised = sweep(body, height, axis, delta, getBlock);
    body[axis] = finite(start + raised);
    const down = sweep(body, height, 'y', -lift - 0.001, getBlock);
    body.y += down;
    if (Math.abs(raised) > Math.abs(moved) + EPS && body.y > baseY + EPS && body.y <= baseY + 0.6 + EPS && supported(body, height, getBlock)) return;
    body[axis] = start;
    body.y = baseY;
  }
  body[axis] = finite(start + moved);
  if (edge && !supported(body, height, getBlock)) {
    let low = 0, high = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (low + high) / 2;
      body[axis] = finite(start + moved * mid);
      if (supported(body, height, getBlock)) low = mid;
      else high = mid;
    }
    body[axis] = finite(start + moved * low);
  }
}

function inWater(body: Body, height: number, getBlock: GetBlock): boolean {
  const x = Math.floor(body.x), z = Math.floor(body.z);
  return getBlock(x, Math.floor(body.y + EPS), z) === BLOCK.WATER || getBlock(x, Math.min(LIMIT, Math.floor(body.y + height - EPS)), z) === BLOCK.WATER;
}

export function stepBody(body: Body, input: Input, dt: number, opts: { getBlock: GetBlock; mode?: Mode; speedMult?: number }): { hitCeiling?: boolean; fallDamage?: number } {
  sanitize(body);
  dt = timeStep(dt);
  if (!dt) return {};
  const getBlock = opts.getBlock, mode = opts.mode ?? 'survival';
  let state = states.get(body);
  if (!state) {
    state = { height: PLAYER.h, coyote: 0, held: false, tap: 1, flying: false, peak: body.y };
    states.set(body, state);
  }
  state.tap += dt;
  const pressed = input.jump && !state.held;
  state.held = input.jump;
  if (mode !== 'creative') state.flying = false;
  if (mode === 'creative' && pressed) {
    if (state.tap <= 0.3) {
      state.flying = !state.flying;
      body.vy = 0;
      state.tap = 1;
    } else state.tap = 0;
  }
  const flying = mode === 'spectator' || state.flying;
  if (input.crouch && !flying) state.height = 1.5;
  else if (!overlaps(body.x, body.y, body.z, PLAYER.h, getBlock) || mode === 'spectator') state.height = PLAYER.h;
  const crouched = state.height < PLAYER.h && !flying;
  const onGround = !flying && body.vy <= 0 && supported(body, state.height, getBlock);
  state.coyote = onGround ? 0.08 : Math.max(0, state.coyote - dt);
  const water = inWater(body, state.height, getBlock);
  let forward = Math.max(-1, Math.min(1, finite(input.forward)));
  let strafe = Math.max(-1, Math.min(1, finite(input.strafe)));
  const length = Math.max(1, Math.hypot(forward, strafe));
  forward /= length;
  strafe /= length;
  let speed = flying ? mode === 'spectator' ? 13 : 11 : input.sprint ? BALANCE.sprint : BALANCE.walk;
  if (!flying) speed *= water ? 0.45 : crouched ? 0.3 : 1;
  speed = Math.min(LIMIT, speed * Math.max(0, finite(opts.speedMult ?? 1)));
  const yaw = finite(input.yaw), sin = Math.sin(yaw), cos = Math.cos(yaw);
  const knocked = body as Body & { kx?: number; kz?: number };
  const kx = finite(knocked.kx ?? 0), kz = finite(knocked.kz ?? 0);
  const dx = finite((strafe * cos - forward * sin) * speed + kx) * dt;
  const dz = finite((-forward * cos - strafe * sin) * speed + kz) * dt;
  if (knocked.kx !== undefined) knocked.kx = kx * Math.exp(-8 * dt);
  if (knocked.kz !== undefined) knocked.kz = kz * Math.exp(-8 * dt);
  if (flying) body.vy = ((input.jump ? 1 : 0) - (input.crouch ? 1 : 0)) * speed;
  else if (water) body.vy = input.jump ? 3.5 : Math.max(-3, Math.min(3, body.vy + (1.5 - body.vy * 3) * dt));
  else {
    if (pressed && state.coyote > 0) {
      body.vy = BALANCE.jump;
      state.coyote = 0;
    }
    body.vy = Math.max(-55, body.vy - BALANCE.gravity * dt);
  }
  state.peak = Math.max(state.peak, body.y);
  if (mode === 'spectator') {
    body.x = finite(body.x + dx);
    body.y = finite(body.y + body.vy * dt);
    body.z = finite(body.z + dz);
    body.grounded = false;
    state.peak = body.y;
    return {};
  }
  const edge = crouched && onGround && body.vy <= 0;
  const step = onGround && body.vy <= 0 && !water;
  horizontal(body, state.height, 'x', dx, getBlock, step, edge);
  horizontal(body, state.height, 'z', dz, getBlock, step, edge);
  const result = vertical(body, dt, state.height, getBlock);
  if (flying) body.grounded = false;
  const wet = water || inWater(body, state.height, getBlock);
  const fallDamage = !wet && !flying && mode === 'survival' && body.grounded ? Math.max(0, Math.ceil(state.peak - body.y - 3 - EPS)) : 0;
  if (wet || flying || body.grounded) state.peak = body.y;
  else state.peak = Math.max(state.peak, body.y);
  return { hitCeiling: result.hitHead, fallDamage };
}

function walk(origin: Vec3, dir: Vec3, maxDist: number, getBlock: GetBlock, hitNonSolid: boolean): Hit | null {
  const ox = finite(origin.x), oy = finite(origin.y), oz = finite(origin.z);
  let dx = finite(dir.x), dy = finite(dir.y), dz = finite(dir.z);
  const length = Math.hypot(dx, dy, dz);
  if (!length) return null;
  dx /= length;
  dy /= length;
  dz /= length;
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
  const tx = dx ? Math.abs(1 / dx) : Infinity;
  const ty = dy ? Math.abs(1 / dy) : Infinity;
  const tz = dz ? Math.abs(1 / dz) : Infinity;
  let mx = dx ? (dx > 0 ? x + 1 - ox : ox - x) * tx : Infinity;
  let my = dy ? (dy > 0 ? y + 1 - oy : oy - y) * ty : Infinity;
  let mz = dz ? (dz > 0 ? z + 1 - oz : oz - z) * tz : Infinity;
  let dist = 0, fx = 0, fy = 0, fz = 0;
  while (dist <= maxDist && Math.abs(x) <= LIMIT && Math.abs(y) <= LIMIT && Math.abs(z) <= LIMIT) {
    const id = getBlock(x, y, z);
    if (id !== 0 && (hitNonSolid || blockDef(id).solid)) return { x, y, z, face: [fx, fy, fz], id, dist };
    const next = Math.min(mx, my, mz);
    if (next > maxDist) break;
    fx = 0;
    fy = 0;
    fz = 0;
    if (mx === next) { x += sx; mx += tx; fx = -sx; }
    if (my === next) { y += sy; my += ty; if (!fx) fy = -sy; }
    if (mz === next) { z += sz; mz += tz; if (!fx && !fy) fz = -sz; }
    dist = next;
  }
  return null;
}

export function raycastVoxel(origin: Vec3, dir: Vec3, maxDist: number, getBlock: GetBlock, hitNonSolid = false): Hit | null {
  return walk(origin, dir, Math.max(0, finite(maxDist)), getBlock, hitNonSolid);
}

export function LOS(getBlock: GetBlock, a: Vec3, b: Vec3): boolean {
  const origin = { x: finite(a.x), y: finite(a.y), z: finite(a.z) };
  const dx = finite(b.x) - origin.x, dy = finite(b.y) - origin.y, dz = finite(b.z) - origin.z;
  const distance = Math.hypot(dx, dy, dz);
  if (!distance) return !blockDef(getBlock(Math.floor(origin.x), Math.floor(origin.y), Math.floor(origin.z))).solid;
  return walk(origin, { x: dx / distance, y: dy / distance, z: dz / distance }, distance, getBlock, false) === null;
}
