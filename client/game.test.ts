import { afterEach, describe, expect, it, vi } from 'vitest';
import { Game, Prediction } from './game';
import { BALANCE } from '../shared/constants';
import { motionState, stepBody } from '../shared/physics';
import { idleInput, receiveInput, tickInput, type Session } from '../server/session';
import { Vector3 } from 'three';
import { Net, socketAddress } from './net';
import type { Action, Body, ClientMessage, Player } from '../shared/types';

class Socket {
  static OPEN = 1;
  static all: Socket[] = [];
  readyState = 0;
  bufferedAmount = 0;
  onopen?: () => void;
  onclose?: (event: { code: number; reason: string }) => void;
  onerror?: () => void;
  onmessage?: (event: { data: string }) => void;
  sent: ClientMessage[] = [];
  constructor(readonly url: string) { Socket.all.push(this); }
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  open() { this.readyState = 1; this.onopen?.(); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000, reason: '' }); }
  receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); Socket.all = []; });

describe('client networking', () => {
  it('normalizes same-origin, HTTP and websocket addresses without exposing credentials', () => {
    vi.stubGlobal('location', { origin: 'https://game.test', protocol: 'https:' });
    expect(socketAddress()).toBe('wss://game.test/ws');
    expect(socketAddress('localhost:7777')).toBe('wss://localhost:7777/ws');
    expect(() => socketAddress('http://localhost:7777')).toThrow('insecure');
    vi.stubGlobal('location', { origin: 'http://game.test', protocol: 'http:' });
    expect(socketAddress('http://localhost:7777')).toBe('ws://localhost:7777/ws');
    expect(socketAddress('wss://game.test/ws#x')).toBe('wss://game.test/ws');
    expect(() => socketAddress('https://user:secret@game.test')).toThrow();
    expect(() => socketAddress('ftp://game.test')).toThrow();
  });

  it('lists on open, pings, manually reconnects without replaying actions and cancels timers on dispose', () => {
    vi.useFakeTimers();
    vi.stubGlobal('location', { origin: 'http://game.test', protocol: 'http:' });
    vi.stubGlobal('WebSocket', Socket);
    const receive = vi.fn(), status = vi.fn();
    const net = new Net(receive, status);
    net.connect('http://localhost:7777');
    const first = Socket.all[0]; first.open();
    expect(first.sent).toEqual([{ type: 'list' }]);
    vi.advanceTimersByTime(2000);
    expect(first.sent.at(-1)?.type).toBe('ping');
    first.receive({ type: 'notice', text: 'hello' });
    expect(receive).toHaveBeenCalledWith({ type: 'notice', text: 'hello' });
    first.close();
    expect(net.send({ type: 'action', action: { type: 'drop' } })).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(Socket.all).toHaveLength(1);
    net.connect('http://localhost:7777');
    expect(Socket.all).toHaveLength(2);
    const second = Socket.all[1]; second.open();
    expect(second.sent).toEqual([{ type: 'list' }]);
    expect(status).toHaveBeenLastCalledWith(true, expect.stringContaining('Connected'));
    net.disconnect();
    vi.advanceTimersByTime(60000);
    expect(Socket.all).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});

const flat = (_x: number, y: number, _z: number) => y < 0 ? 3 : 0;
const standing = (): Body => ({ x: 0.5, y: 0, z: 0.5, vy: 0, grounded: true });
const explorer = (): Player => ({ ...standing(), id: 'local', name: 'Walker', color: '#abcdef', yaw: 0, pitch: 0, realm: 'verdant', mode: 'survival', hp: 20, hunger: 20, air: 20, xp: 0, inventory: Array(36).fill(null), selected: 0, spawn: { x: 0.5, y: 0, z: 0.5, realm: 'verdant' }, achievements: [], deaths: 0, mined: 0, placed: 0, seq: 0 });

describe('fixed-tick prediction', () => {
  it('keeps walking corrections stable with delayed input, three-tick snapshots and two render frames per tick', () => {
    const server = explorer(), prediction = new Prediction(), body = standing();
    const session = { player: server, input: idleInput(), inputAt: 0 } as Session;
    const game = Object.assign(Object.create(Game.prototype) as object, {
      player: explorer(), body, prediction, correction: new Vector3(), controls: { seq: 0 }, getBlock: flat, audio: { play: vi.fn() }
    }) as unknown as { acceptPlayer: (p: Player, snapshot: boolean, motion: import('../shared/types').MotionAck) => void; correction: Vector3 };
    const inputs: { at: number; input: ReturnType<typeof idleInput> }[] = [];
    const snapshots: { at: number; player: Player; motion: import('../shared/types').MotionAck }[] = [];
    let seq = 0, maxCorrection = 0, maxError = 0;
    for (let tick = 1; tick <= 180; tick++) {
      if (tick % 2 === 1) {
        const input = { ...idleInput(), forward: 1, seq: ++seq };
        prediction.enqueue(input);
        inputs.push({ at: tick + 1, input });
      }
      for (const packet of inputs.filter(packet => packet.at === tick)) receiveInput(session, packet.input, tick * BALANCE.tick * 1000);
      const input = tickInput(session, tick * BALANCE.tick * 1000);
      stepBody(server, input, BALANCE.tick, { getBlock: flat });
      server.seq = input.seq;
      prediction.advance(body, BALANCE.tick / 2, { getBlock: flat });
      prediction.advance(body, BALANCE.tick / 2, { getBlock: flat });
      game.correction.multiplyScalar(Math.exp(-8 * BALANCE.tick));
      if (tick % 3 === 0) snapshots.push({ at: tick + 2, player: { ...server, inventory: [] }, motion: { state: motionState(server), input, ticks: session.inputTicks! } });
      for (const packet of snapshots.filter(packet => packet.at === tick)) {
        game.acceptPlayer(packet.player, true, packet.motion);
        maxCorrection = Math.max(maxCorrection, game.correction.length());
      }
      maxError = Math.max(maxError, Math.abs(body.z - server.z));
      expect(body.y).toBe(0);
    }
    expect(server.z).toBeCloseTo(0.5 - 179 * BALANCE.walk * BALANCE.tick);
    expect(body.z).toBeLessThan(-25);
    expect(maxError).toBeLessThanOrEqual(BALANCE.walk * BALANCE.tick + 1e-8);
    expect(maxCorrection).toBeLessThan(0.31);
    expect(game.correction.length()).toBeLessThan(0.16);
  });

  it('reconciles repeated acknowledgements for a held input by post-tick count, not its pre-send body', () => {
    const server = standing(), body = standing(), prediction = new Prediction();
    const input = { ...idleInput(), forward: 1, seq: 1 };
    prediction.enqueue(input);
    for (let tick = 1; tick <= 90; tick++) {
      stepBody(server, input, BALANCE.tick, { getBlock: flat });
      prediction.advance(body, BALANCE.tick, { getBlock: flat });
      if (tick % 3 === 0) prediction.reconcile(body, server, { input, ticks: tick, state: motionState(server) }, { getBlock: flat });
      expect(body).toEqual(server);
    }
    expect(body.z).toBeCloseTo(0.5 - 3 * BALANCE.walk);
  });

  it('preserves a press and release between render frames and replays a creative double tap from its acknowledged flight state', () => {
    for (const mode of ['survival', 'creative'] as const) {
      const server = standing(), body = standing(), prediction = new Prediction();
      const inputs = [true, false, true, false].map((jump, i) => ({ ...idleInput(), jump, seq: i + 1 }));
      for (const input of inputs) prediction.enqueue(input);
      let ack: import('../shared/types').MotionAck | undefined;
      let acknowledged: Body | undefined;
      for (let i = 0; i < 4; i++) {
        stepBody(server, inputs[i], BALANCE.tick, { getBlock: flat, mode });
        prediction.advance(body, BALANCE.tick, { getBlock: flat, mode });
        if (i === 2) { acknowledged = { ...server }; ack = { input: inputs[i], ticks: 1, state: motionState(server) }; }
        expect(body).toEqual(server);
      }
      expect(body.y).toBeGreaterThan(0);
      body.x += 0.5;
      prediction.reconcile(body, acknowledged!, ack!, { getBlock: flat, mode });
      expect(body).toEqual(server);
      prediction.advance(body, BALANCE.tick, { getBlock: flat, mode });
      stepBody(server, inputs[3], BALANCE.tick, { getBlock: flat, mode });
      expect(body).toEqual(server);
      if (mode === 'creative') expect(body.vy).toBe(0);
    }
  });
});

describe('sneak placement', () => {
  it.each([25, 53])('uses block %i normally but sends adjacent placement while sneaking', id => {
    const player = explorer(), action = vi.fn();
    player.inventory[0] = { id: 129, count: 2 };
    let crouch = false;
    const game = {
      player, body: standing(), ui: { isOpen: false, selected: 0 },
      controls: { locked: true, sample: () => ({ ...idleInput(), crouch }) },
      updateCamera: vi.fn(), targets: () => ({ block: { id, x: 2, y: 0, z: 0, face: [-1, 0, 0] } }),
      useAt: -Infinity, getBlock: () => 0, actors: new Map(), action
    };
    const interact = (Game.prototype as unknown as { interact(this: typeof game, button: number): void }).interact;
    interact.call(game, 2);
    expect(action).toHaveBeenLastCalledWith({ type: 'use', x: 2, y: 0, z: 0 });
    crouch = true; game.useAt = -Infinity;
    interact.call(game, 2);
    expect(action).toHaveBeenLastCalledWith({ type: 'place', x: 1, y: 0, z: 0 });
    expect(action).toHaveBeenCalledTimes(2);
  });
});

type PortalHarness = {
  player?: Pick<Player, 'hp' | 'mode'>;
  body?: Body;
  world: { chunks: Map<string, Uint16Array> };
  ui: { isOpen: boolean };
  portalReady: boolean;
  portalTime: number;
  getBlock: () => number;
  action: (action: Action) => void;
};
const updatePortal = (Game.prototype as unknown as { updatePortal(this: PortalHarness, dt: number): void }).updatePortal;
function portal() {
  const action = vi.fn();
  const game: PortalHarness = {
    player: { hp: 20, mode: 'survival' }, body: { x: 0.5, y: 35, z: 0.5, vy: 0, grounded: true },
    world: { chunks: new Map([['0,0', new Uint16Array()]]) }, ui: { isOpen: false },
    portalReady: true, portalTime: 0, getBlock: () => 43, action
  };
  const run = (frames = 22) => { for (let i = 0; i < frames; i++) updatePortal.call(game, 0.05); };
  return { game, action, run };
}

describe('client standing portals', () => {
  it('sends use once after one second, remains latched across realm loading, and rearms only off portal', () => {
    const { game, action, run } = portal();
    run(10); expect(action).not.toHaveBeenCalled();
    run(12); expect(action).toHaveBeenCalledExactlyOnceWith({ type: 'use', x: 0, y: 35, z: 0 });
    run(60); expect(action).toHaveBeenCalledTimes(1);
    game.world.chunks.clear(); game.getBlock = () => 21;
    run(); expect(game.portalReady).toBe(false);
    game.world.chunks.set('0,0', new Uint16Array()); game.getBlock = () => 42;
    run(); expect(action).toHaveBeenCalledTimes(1);
    game.getBlock = () => 0; run(1); expect(game.portalReady).toBe(true);
    game.getBlock = () => 42; run(); expect(action).toHaveBeenCalledTimes(2);
  });

  it('requires a live nonspectator player, loaded chunk, and closed UI for the full dwell', () => {
    const { game, action, run } = portal();
    game.player!.hp = 0; run(); expect(action).not.toHaveBeenCalled();
    game.player!.hp = 20; game.player!.mode = 'spectator'; run(); expect(action).not.toHaveBeenCalled();
    game.player!.mode = 'creative'; game.ui.isOpen = true; run(); expect(action).not.toHaveBeenCalled();
    game.ui.isOpen = false; game.world.chunks.clear(); run(); expect(action).not.toHaveBeenCalled();
    game.world.chunks.set('0,0', new Uint16Array()); run(10);
    game.ui.isOpen = true; run(1); game.ui.isOpen = false; run(10);
    expect(action).not.toHaveBeenCalled();
    run(12); expect(action).toHaveBeenCalledTimes(1);
  });
});
