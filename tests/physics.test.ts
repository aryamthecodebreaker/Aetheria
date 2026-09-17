import { describe, expect, it } from 'vitest';
import { BLOCK } from '../shared/blocks';
import { BALANCE } from '../shared/constants';
import { collide, LOS, PLAYER, raycastVoxel, stepBody } from '../shared/physics';
import type { Body, Input } from '../shared/types';

const idle: Input = { forward: 0, strafe: 0, jump: false, sprint: false, crouch: false, yaw: 0, pitch: 0, seq: 0 };
const ground = (_x: number, y: number, _z: number) => y < 0 ? BLOCK.STONE : BLOCK.AIR;
const bodyAt = (x = 0.5, y = 0, z = 0.5): Body => ({ x, y, z, vy: 0, grounded: y === 0 });
const tick = (body: Body, input: Partial<Input> = {}, getBlock = ground) => stepBody(body, { ...idle, ...input }, 0.05, { getBlock });

describe('body physics', () => {
  it('exports stable player dimensions and walks on flat ground without sinking', () => {
    expect(PLAYER).toEqual({ w: 0.6, h: 1.8, eye: 1.62 });
    const body = bodyAt();
    for (let i = 0; i < 20; i++) tick(body, { forward: 1 });
    expect(body.z).toBeCloseTo(0.5 - BALANCE.walk);
    expect(body.y).toBe(0);
    expect(body.vy).toBe(0);
    expect(body.grounded).toBe(true);
  });

  it('normalizes diagonals, rotates movement, and applies sprint and speed multipliers', () => {
    const a = bodyAt(), b = bodyAt(), c = bodyAt();
    tick(a, { forward: 1, strafe: 1 });
    tick(b, { forward: 1, yaw: Math.PI / 2, sprint: true });
    stepBody(c, { ...idle, strafe: 1 }, 0.05, { getBlock: ground, speedMult: 2 });
    expect(Math.hypot(a.x - 0.5, a.z - 0.5)).toBeCloseTo(BALANCE.walk * 0.05);
    expect(b.x).toBeCloseTo(0.5 - BALANCE.sprint * 0.05);
    expect(b.z).toBeCloseTo(0.5);
    expect(c.x).toBeCloseTo(0.5 + BALANCE.walk * 0.1);
  });

  it('jumps only on a rising edge and lands', () => {
    const body = bodyAt();
    tick(body, { jump: true });
    expect(body.y).toBeGreaterThan(0);
    expect(body.grounded).toBe(false);
    for (let i = 0; i < 40; i++) tick(body, { jump: true });
    expect(body.y).toBe(0);
    expect(body.grounded).toBe(true);
    tick(body);
    tick(body, { jump: true });
    expect(body.vy).toBeGreaterThan(0);
  });

  it('allows a coyote jump for 0.08 seconds but not after expiry', () => {
    const ledge = (x: number, y: number) => x < 1 && y < 0 ? BLOCK.STONE : 0;
    const a = bodyAt(1.2), b = bodyAt(1.2);
    tick(a, { strafe: 1 }, ledge);
    tick(b, { strafe: 1 }, ledge);
    tick(a, { jump: true }, ledge);
    expect(a.vy).toBeGreaterThan(0);
    tick(b, {}, ledge);
    tick(b, { jump: true }, ledge);
    expect(b.vy).toBeLessThan(0);
  });

  it('stops the whole AABB at walls and slides along the other axis', () => {
    const wall = (x: number, y: number, z: number) => x === 1 && y >= 0 && y < 4 ? BLOCK.STONE : ground(x, y, z);
    const body = bodyAt();
    for (let i = 0; i < 12; i++) tick(body, { strafe: 1, forward: 1 }, wall);
    expect(body.x).toBeCloseTo(0.7);
    expect(body.z).toBeLessThan(-1);
    expect(body.y).toBe(0);
  });

  it('does not tunnel through walls at high knockback velocity and decays knockback', () => {
    const body = { ...bodyAt(), kx: 100, kz: 0 };
    const wall = (x: number, y: number, z: number) => x === 2 && y >= 0 && y < 4 ? BLOCK.STONE : ground(x, y, z);
    tick(body, {}, wall);
    expect(body.x).toBeCloseTo(1.7);
    expect(body.kx).toBeCloseTo(100 * Math.exp(-0.4));
    expect(body.kz).toBe(0);
  });

  it('collides with ceilings at the top of the AABB', () => {
    const ceiling = (x: number, y: number, z: number) => y === 2 ? BLOCK.STONE : ground(x, y, z);
    const body = bodyAt();
    const result = tick(body, { jump: true }, ceiling);
    expect(result.hitCeiling).toBe(true);
    expect(body.y).toBeCloseTo(0.2);
    expect(body.vy).toBe(0);
    expect(body.grounded).toBe(false);
  });

  it('steps onto a half slab, but not a full cube or a slab without headroom', () => {
    const slab = (x: number, y: number, z: number) => x >= 1 && y === 0 ? BLOCK.SLAB : ground(x, y, z);
    const body = bodyAt();
    for (let i = 0; i < 10; i++) tick(body, { strafe: 1 }, slab);
    expect(body.x).toBeGreaterThan(2);
    expect(body.y).toBeCloseTo(0.5);
    expect(body.grounded).toBe(true);
    const cube = (x: number, y: number, z: number) => x >= 1 && y === 0 ? BLOCK.STONE : ground(x, y, z);
    const blocked = bodyAt();
    for (let i = 0; i < 10; i++) tick(blocked, { strafe: 1 }, cube);
    expect(blocked.x).toBeCloseTo(0.7);
    const low = bodyAt();
    const roof = (x: number, y: number, z: number) => y === 2 ? BLOCK.STONE : slab(x, y, z);
    for (let i = 0; i < 10; i++) tick(low, { strafe: 1 }, roof);
    expect(low.x).toBeCloseTo(0.7);
    expect(low.y).toBe(0);
  });

  it('keeps crouched bodies on ledges including diagonal corners', () => {
    const platform = (x: number, y: number, z: number) => x === 0 && z === 0 && y === -1 ? BLOCK.STONE : 0;
    const body = bodyAt();
    for (let i = 0; i < 100; i++) tick(body, { strafe: 1, forward: -1, crouch: true }, platform);
    expect(body.x).toBeLessThan(1.3);
    expect(body.z).toBeLessThan(1.3);
    expect(body.y).toBe(0);
    expect(body.grounded).toBe(true);
    for (let i = 0; i < 10; i++) tick(body, { strafe: 1 }, platform);
    expect(body.y).toBeLessThan(0);
  });

  it('reduces crouch height and prevents standing inside a ceiling', () => {
    const tunnel = (x: number, y: number, z: number) => x >= 1 && y === 2 ? BLOCK.STONE : ground(x, y, z);
    const body = bodyAt(0.5, 0.5);
    const world = (x: number, y: number, z: number) => y === 0 ? BLOCK.SLAB : tunnel(x, y, z);
    for (let i = 0; i < 30; i++) tick(body, { strafe: 1, crouch: true }, world);
    expect(body.x).toBeGreaterThan(2);
    expect(body.y).toBeCloseTo(0.5);
    expect(tick(body, { jump: true }, world).hitCeiling).toBe(true);
    expect(body.y).toBeCloseTo(0.5);
  });

  it('returns survival fall damage once on landing and exempts creative', () => {
    for (const mode of ['survival', 'creative'] as const) {
      const body = bodyAt(0.5, 8);
      let damage = 0;
      for (let i = 0; i < 100; i++) damage += stepBody(body, idle, 0.05, { getBlock: ground, mode }).fallDamage ?? 0;
      expect(damage).toBe(mode === 'survival' ? 5 : 0);
      expect(body.y).toBe(0);
      expect(tick(body).fallDamage).toBe(0);
    }
  });

  it('caps terminal fall velocity and sweeps vertically for simple entities', () => {
    const body = bodyAt(0.5, 100);
    for (let i = 0; i < 60; i++) tick(body, {}, () => 0);
    expect(body.vy).toBe(-55);
    body.y = 2;
    body.vy = -1000;
    expect(collide(body, 0.05, ground)).toEqual({ grounded: true, hitHead: false });
    expect(body.y).toBe(0);
    body.vy = 1000;
    expect(collide(body, 0.05, (_x, y) => y === 3 ? BLOCK.STONE : 0).hitHead).toBe(true);
    expect(body.y).toBeCloseTo(1.2);
  });

  it('swims at head or feet, moves slower, and clears fall damage', () => {
    for (const waterY of [0, 1]) {
      const body = bodyAt();
      const water = (x: number, y: number, z: number) => y === waterY ? BLOCK.WATER : ground(x, y, z);
      tick(body, { forward: 1, jump: true }, water);
      expect(body.vy).toBe(3.5);
      expect(body.z).toBeCloseTo(0.5 - BALANCE.walk * 0.45 * 0.05);
    }
    const body = bodyAt(0.5, 10);
    const pool = (x: number, y: number, z: number) => y >= 0 && y < 2 ? BLOCK.WATER : ground(x, y, z);
    let damage = 0;
    for (let i = 0; i < 100; i++) damage += tick(body, {}, pool).fallDamage ?? 0;
    expect(damage).toBe(0);
    expect(body.vy).toBeGreaterThan(-3.01);
  });

  it('toggles creative flight on double presses, hovers, descends, and still collides', () => {
    const body = bodyAt();
    const run = (input: Partial<Input> = {}, getBlock = ground) => stepBody(body, { ...idle, ...input }, 0.05, { getBlock, mode: 'creative' });
    run({ jump: true });
    run();
    const before = body.y;
    run({ jump: true });
    expect(body.y - before).toBeCloseTo(11 * 0.05);
    run();
    const hover = body.y;
    run();
    expect(body.y).toBe(hover);
    run({ crouch: true });
    expect(body.y).toBeCloseTo(hover - 11 * 0.05);
    const wall = (x: number, y: number, z: number) => x === 1 && y < 10 ? BLOCK.STONE : ground(x, y, z);
    run({ strafe: 1 }, wall);
    expect(body.x).toBeCloseTo(0.7);
    run({ jump: true });
    run();
    run({ jump: true });
    expect(body.vy).toBeLessThan(0);
  });

  it('does not interpret a held jump as a creative double press', () => {
    const body = bodyAt();
    for (let i = 0; i < 40; i++) stepBody(body, { ...idle, jump: true }, 0.05, { getBlock: ground, mode: 'creative' });
    expect(body.y).toBe(0);
  });

  it('lets spectators pass through blocks at speed 13', () => {
    const body = bodyAt();
    stepBody(body, { ...idle, strafe: 1, jump: true }, 0.05, { getBlock: () => BLOCK.STONE, mode: 'spectator' });
    expect(body.x).toBeCloseTo(1.15);
    expect(body.y).toBeCloseTo(0.65);
    expect(body.grounded).toBe(false);
  });

  it('clamps dt, coordinates and invalid numbers and only queries integer world coordinates', () => {
    const a = bodyAt(), b = bodyAt();
    stepBody(a, { ...idle, strafe: 1 }, 9, { getBlock: ground });
    stepBody(b, { ...idle, strafe: 1 }, 0.05, { getBlock: ground });
    expect(a).toEqual(b);
    const invalid = { x: Infinity, y: NaN, z: -Infinity, vy: NaN, grounded: false };
    const getBlock = (x: number, y: number, z: number) => {
      for (const n of [x, y, z]) {
        expect(Number.isInteger(n)).toBe(true);
        expect(Math.abs(n)).toBeLessThanOrEqual(1e6);
      }
      return 0;
    };
    stepBody(invalid, { ...idle, yaw: NaN, forward: Infinity }, 0.05, { getBlock });
    for (const n of [invalid.x, invalid.y, invalid.z, invalid.vy]) expect(Number.isFinite(n) && Math.abs(n) <= 1e6).toBe(true);
    const before = { ...b };
    stepBody(b, { ...idle, jump: true }, -1, { getBlock });
    expect(b).toEqual(before);
  });
});

describe('voxel rays and visibility', () => {
  const cube = (x: number, y: number, z: number) => x === 3 && y === 1 && z === 0 ? BLOCK.STONE : 0;

  it('hits a known face at world distance with an unnormalized direction', () => {
    expect(raycastVoxel({ x: 0.5, y: 1.5, z: 0.5 }, { x: 2, y: 0, z: 0 }, 5, cube)).toEqual({ x: 3, y: 1, z: 0, face: [-1, 0, 0], id: BLOCK.STONE, dist: 2.5 });
    expect(raycastVoxel({ x: 5, y: 1.5, z: 0.5 }, { x: -1, y: 0, z: 0 }, 5, cube)?.face).toEqual([1, 0, 0]);
  });

  it('misses empty space, short rays and zero directions', () => {
    const origin = { x: 0.5, y: 1.5, z: 0.5 };
    expect(raycastVoxel(origin, { x: 1, y: 0, z: 0 }, 2.49, cube)).toBeNull();
    expect(raycastVoxel(origin, { x: 0, y: 1, z: 0 }, 10, cube)).toBeNull();
    expect(raycastVoxel(origin, { x: 0, y: 0, z: 0 }, 10, cube)).toBeNull();
  });

  it('handles vertical rays, negative coordinates, boundaries and starting inside a cube', () => {
    expect(raycastVoxel({ x: 3.5, y: 4, z: 0.5 }, { x: 0, y: -1, z: 0 }, 10, cube)).toMatchObject({ dist: 2, face: [0, 1, 0] });
    expect(raycastVoxel({ x: 3.5, y: 1.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, 10, cube)).toMatchObject({ dist: 0, face: [0, 0, 0] });
    const negative = (x: number, y: number, z: number) => x === -2 && y === -1 && z === -1 ? BLOCK.STONE : 0;
    expect(raycastVoxel({ x: -1, y: -0.5, z: -0.5 }, { x: -1, y: 0, z: 0 }, 2, negative)).toMatchObject({ x: -2, dist: 0, face: [1, 0, 0] });
  });

  it('advances all tied axes without selecting cubes touched only at a corner', () => {
    const diagonal = (x: number, y: number, z: number) => y === 0 && ((x === 1 && z === 0) || (x === 2 && z === 2)) ? BLOCK.STONE : 0;
    const hit = raycastVoxel({ x: 0.5, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 1 }, 5, diagonal);
    expect(hit).toMatchObject({ x: 2, z: 2 });
    expect(hit?.dist).toBeCloseTo(Math.sqrt(4.5));
  });

  it('skips water and plants unless non-solid selection is enabled', () => {
    const water = (x: number, y: number, z: number) => x === 1 ? BLOCK.WATER : x === 2 ? BLOCK.FLOWER : cube(x, y, z);
    const origin = { x: 0.5, y: 1.5, z: 0.5 }, dir = { x: 1, y: 0, z: 0 };
    expect(raycastVoxel(origin, dir, 5, water)?.x).toBe(3);
    expect(raycastVoxel(origin, dir, 5, water, true)?.id).toBe(BLOCK.WATER);
  });

  it('blocks LOS on solid blocks but not water or plants, including endpoints', () => {
    const a = { x: 0.5, y: 1.5, z: 0.5 }, b = { x: 5.5, y: 1.5, z: 0.5 };
    expect(LOS(cube, a, b)).toBe(false);
    expect(LOS(cube, b, a)).toBe(false);
    expect(LOS(() => BLOCK.WATER, a, b)).toBe(true);
    expect(LOS(() => BLOCK.FLOWER, a, b)).toBe(true);
    expect(LOS(cube, a, { x: 2.5, y: 1.5, z: 0.5 })).toBe(true);
    expect(LOS(cube, a, { x: 3.5, y: 1.5, z: 0.5 })).toBe(false);
    expect(LOS(cube, a, a)).toBe(true);
    expect(LOS(() => BLOCK.STONE, a, a)).toBe(false);
  });
});
