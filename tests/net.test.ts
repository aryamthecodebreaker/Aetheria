import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultServerAddress, Net, socketAddress } from '../client/net';
import { WebSocket, WebSocketServer } from 'ws';
import { once } from 'node:events';

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => { this.readyState = 3; });
  constructor(readonly url: string) { Socket.instances.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('location', { origin: 'http://192.168.1.20:5173', protocol: 'http:' });
  vi.stubGlobal('WebSocket', Socket);
  vi.stubEnv('VITE_SERVER_URL', '');
  Socket.instances = [];
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function fixture() {
  const receive = vi.fn(), status = vi.fn(), observer = vi.fn();
  const net = new Net(receive, status);
  net.observeStatus(observer);
  net.connect();
  return { net, receive, status, observer, socket: Socket.instances.at(-1)! };
}

describe('server addresses', () => {
  it('defaults to the page origin with the dev proxy path', () => {
    expect(defaultServerAddress()).toBe(location.origin);
    expect(socketAddress()).toBe('ws://192.168.1.20:5173/ws');
  });
  it('supports a trimmed build-time endpoint in both UI defaults and Net', () => {
    vi.stubEnv('VITE_SERVER_URL', '  https://game.example.test/socket  ');
    expect(defaultServerAddress()).toBe('https://game.example.test/socket');
    expect(fixture().socket.url).toBe('wss://game.example.test/socket');
  });
  it.each([
    ['https://game.example.test', 'wss://game.example.test/ws'],
    ['wss://game.example.test/custom?region=one#ignored', 'wss://game.example.test/custom?region=one'],
    ['http://192.168.1.20:7777', 'ws://192.168.1.20:7777/ws'],
    ['localhost:7777', 'ws://localhost:7777/ws'],
    ['[::1]:7777', 'ws://[::1]:7777/ws'],
  ])('normalizes %s', (input, expected) => { expect(socketAddress(input)).toBe(expected); });
  it('infers WSS for a bare address on HTTPS pages', () => {
    vi.stubGlobal('location', { origin: 'https://client.example.test', protocol: 'https:' });
    expect(socketAddress('game.example.test:443')).toBe('wss://game.example.test/ws');
  });
  it.each(['ws://localhost:7777', 'http://192.168.1.20:7777'])('rejects mixed content %s without opening a socket', address => {
    vi.stubGlobal('location', { origin: 'https://client.example.test', protocol: 'https:' });
    expect(() => socketAddress(address)).toThrow('HTTPS page cannot connect to insecure ws:');
    const status = vi.fn();
    new Net(vi.fn(), status).connect(address);
    expect(Socket.instances).toHaveLength(0);
    expect(status).toHaveBeenCalledWith(false, expect.stringContaining('HTTPS page'));
  });
  it.each(['ftp://game.example.test', 'file:///tmp/server', 'javascript:alert(1)', 'data:text/plain,server', 'https:game.example.test', 'not a hostname', '', 'http://', 'https://user:pass@game.example.test'])('rejects invalid or credential-bearing address %s', address => {
    expect(() => socketAddress(address)).toThrow();
  });
});

describe('Net connection lifecycle', () => {
  it('connects to a real local WebSocket server and receives the requested world list', async () => {
    vi.useRealTimers();
    vi.stubGlobal('WebSocket', WebSocket);
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0, path: '/ws' });
    await once(server, 'listening');
    const address = server.address();
    if (typeof address === 'string' || !address) throw new Error('No server address');
    server.on('connection', socket => socket.on('message', raw => {
      if (JSON.parse(String(raw)).type === 'list') socket.send(JSON.stringify({ type: 'worlds', worlds: [] }));
    }));
    const receive = vi.fn(), net = new Net(receive, vi.fn());
    try {
      net.connect(`http://127.0.0.1:${address.port}`);
      await vi.waitFor(() => expect(receive).toHaveBeenCalledWith({ type: 'worlds', worlds: [] }));
      expect(net.connected).toBe(true);
    } finally {
      net.disconnect();
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
  it('reports browser errors honestly, stops retry loops and allows explicit retry', () => {
    const { net, socket, status, observer } = fixture();
    socket.onerror?.();
    expect(status).toHaveBeenLastCalledWith(false, expect.stringContaining('browser does not expose the cause'));
    expect(observer).toHaveBeenLastCalledWith(...status.mock.calls.at(-1)!);
    expect(socket.close).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(120000);
    expect(Socket.instances).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    net.connect();
    expect(Socket.instances).toHaveLength(2);
    net.disconnect();
  });
  it('replays a synchronous initial failure to the UI observer attached by main', () => {
    vi.stubEnv('VITE_SERVER_URL', 'ftp://game.example.test');
    const status = vi.fn(), observer = vi.fn(), net = new Net(vi.fn(), status);
    net.connect();
    net.observeStatus(observer);
    expect(observer).toHaveBeenCalledWith(false, expect.stringContaining('server address'));
  });
  it('preserves constructor errors rather than silently retrying', () => {
    vi.stubGlobal('WebSocket', class { constructor() { throw new Error('Blocked by policy'); } });
    const status = vi.fn();
    new Net(vi.fn(), status).connect();
    expect(status).toHaveBeenCalledWith(false, expect.stringContaining('Blocked by policy'));
    expect(vi.getTimerCount()).toBe(0);
  });
  it('times out sockets that never open', () => {
    const { status } = fixture();
    vi.advanceTimersByTime(12000);
    expect(status).toHaveBeenLastCalledWith(false, expect.stringContaining('connection timed out'));
    expect(vi.getTimerCount()).toBe(0);
  });
  it('times out a missing world list even if pongs keep arriving', () => {
    const { socket, status } = fixture();
    socket.open();
    for (let i = 0; i < 6; i++) {
      socket.message({ type: 'pong', time: performance.now() });
      vi.advanceTimersByTime(2000);
    }
    expect(status).toHaveBeenLastCalledWith(false, expect.stringContaining('did not send a world list'));
    expect(vi.getTimerCount()).toBe(0);
  });
  it('receives worlds, refreshes an existing socket and clears all timers on disconnect', () => {
    const { net, socket, receive, status } = fixture();
    socket.open();
    socket.message({ type: 'worlds', worlds: [] });
    expect(net.connected).toBe(true);
    expect(receive).toHaveBeenCalledWith({ type: 'worlds', worlds: [] });
    expect(status).toHaveBeenLastCalledWith(true, expect.stringContaining('Connected'));
    net.connect();
    expect(Socket.instances).toHaveLength(1);
    expect(socket.send.mock.calls.filter(([raw]) => JSON.parse(raw).type === 'list')).toHaveLength(2);
    socket.message({ type: 'worlds', worlds: [] });
    net.disconnect();
    expect(vi.getTimerCount()).toBe(0);
    expect(net.connected).toBe(false);
  });
  it('ignores stale socket events after switching endpoints', () => {
    const { net, socket, status } = fixture();
    const staleError = socket.onerror, staleClose = socket.onclose;
    net.connect('ws://other.example.test');
    staleError?.();
    staleClose?.({ code: 1006, reason: '' });
    expect(status).not.toHaveBeenCalled();
    net.disconnect();
  });
  it('surfaces the actual disconnect code and reason', () => {
    const { socket, status } = fixture();
    socket.onclose?.({ code: 1008, reason: 'Origin not allowed' });
    expect(status).toHaveBeenCalledWith(false, expect.stringContaining('1008): Origin not allowed'));
  });
  it('rejects malformed JSON and missing world-list arrays', () => {
    for (const data of ['{', '{"type":"worlds"}']) {
      const { socket, status } = fixture();
      socket.onmessage?.({ data });
      expect(status).toHaveBeenLastCalledWith(false, expect.stringContaining('invalid data'));
    }
  });
  it('does not mislabel application callback errors as invalid server data', () => {
    const net = new Net(() => { throw new Error('UI rendering failed'); }, vi.fn());
    net.connect();
    const socket = Socket.instances[0];
    expect(() => socket.message({ type: 'worlds', worlds: [] })).toThrow('UI rendering failed');
    net.disconnect();
  });
});
