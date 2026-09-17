import { afterEach, describe, expect, it, vi } from 'vitest';
import { Game } from './game';
import { Net, socketAddress } from './net';
import type { Action, Body, ClientMessage, Player } from '../shared/types';

class Socket {
  static OPEN = 1;
  static all: Socket[] = [];
  readyState = 0;
  bufferedAmount = 0;
  onopen?: () => void;
  onclose?: () => void;
  onerror?: () => void;
  onmessage?: (event: { data: string }) => void;
  sent: ClientMessage[] = [];
  constructor(readonly url: string) { Socket.all.push(this); }
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  open() { this.readyState = 1; this.onopen?.(); }
  close() { this.readyState = 3; this.onclose?.(); }
  receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); Socket.all = []; });

describe('client networking', () => {
  it('normalizes same-origin, HTTP and websocket addresses without exposing credentials', () => {
    vi.stubGlobal('location', { origin: 'https://game.test', protocol: 'https:' });
    expect(socketAddress()).toBe('wss://game.test/ws');
    expect(socketAddress('localhost:7777')).toBe('wss://localhost:7777/ws');
    expect(socketAddress('http://localhost:7777')).toBe('ws://localhost:7777/ws');
    expect(socketAddress('wss://game.test/ws#x')).toBe('wss://game.test/ws');
    expect(() => socketAddress('https://user:secret@game.test')).toThrow();
    expect(() => socketAddress('ftp://game.test')).toThrow();
  });

  it('lists on open, pings, reconnects without replaying actions and cancels timers on dispose', () => {
    vi.useFakeTimers();
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
    expect(Socket.all).toHaveLength(2);
    const second = Socket.all[1]; second.open();
    expect(second.sent).toEqual([{ type: 'list' }]);
    expect(status).toHaveBeenLastCalledWith(true, expect.stringContaining('restored'));
    net.disconnect();
    vi.advanceTimersByTime(60000);
    expect(Socket.all).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
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
