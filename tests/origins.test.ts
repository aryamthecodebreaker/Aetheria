import { afterEach, describe, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/main';
import { isOriginAllowed, validateAllowedOrigins } from '../server/origins';

const servers: Awaited<ReturnType<typeof createGameServer>>[] = [];
const dirs: string[] = [];
const clients: WebSocket[] = [];
const vercelOrigin = 'https://aetheria-aryam.vercel.app';
afterEach(async () => {
  vi.restoreAllMocks();
  for (const client of clients.splice(0)) client.terminate();
  for (const server of servers.splice(0)) await server.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function start(allowedOrigins: string[] = []) {
  const saveDir = await mkdtemp(join(tmpdir(), 'aetheria-origins-'));
  dirs.push(saveDir);
  const server = await createGameServer({ port: 0, saveDir, allowedOrigins });
  servers.push(server);
  return server;
}

function connect(port: number, headers: Record<string, string> = {}, path = '/ws') {
  return new Promise<{ ws: WebSocket; status: number; body: string }>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers, handshakeTimeout: 3000 });
    clients.push(ws);
    ws.on('error', reject);
    ws.once('open', () => resolve({ ws, status: 101, body: '' }));
    ws.once('unexpected-response', (_req, res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('error', reject);
      res.once('end', () => {
        resolve({ ws, status: res.statusCode!, body });
        ws.terminate();
      });
    });
  });
}

describe('origin configuration', () => {
  it('accepts HTTP(S) origins and normalizes scheme, hostname and default ports', () => {
    expect([...validateAllowedOrigins([vercelOrigin, 'HTTPS://AETHERIA-ARYAM.VERCEL.APP:443', 'http://localhost:7777'])]).toEqual([vercelOrigin, 'http://localhost:7777']);
    expect([...validateAllowedOrigins([])]).toEqual([]);
  });
  it.each([
    'ftp://game.example.test', 'https://game.example.test/path', 'https://game.example.test/',
    'https://user:pass@game.example.test', 'https://*.example.test', '*', 'not a hostname', '', '   ',
    'https://', 'https://game.example.test?q=1', 'https://game.example.test#section',
  ])('rejects invalid configuration %s before starting the server', async origin => {
    expect(() => validateAllowedOrigins([origin])).toThrow('ALLOWED_ORIGINS');
    await expect(start([origin])).rejects.toThrow('ALLOWED_ORIGINS');
  });
  it('does not expose invalid configuration values in errors', () => {
    expect(() => validateAllowedOrigins(['https://user:private-value@game.example.test'])).toThrow(/^ALLOWED_ORIGINS must contain only HTTP\(S\) origins without paths, credentials, or wildcards$/);
  });
  it('matches configured scheme, hostname and port exactly', () => {
    const allowed = validateAllowedOrigins([vercelOrigin]);
    expect(isOriginAllowed(vercelOrigin, 'backend.example.test', allowed)).toBe(true);
    for (const origin of ['https://other.example.test', 'http://aetheria-aryam.vercel.app', `${vercelOrigin}:8443`, '', 'null']) {
      expect(isOriginAllowed(origin, 'backend.example.test', allowed)).toBe(false);
    }
  });
});

describe('isolated WebSocket connections', () => {
  it('accepts the configured Vercel frontend and exchanges a ping', async () => {
    const server = await start([vercelOrigin]);
    const client = await connect(server.port, { Origin: vercelOrigin });
    expect(client.status).toBe(101);
    const message = once(client.ws, 'message');
    client.ws.send(JSON.stringify({ type: 'ping', time: 1 }));
    expect(JSON.parse(String((await message)[0]))).toEqual({ type: 'pong', time: 1 });
  });
  it('preserves same-host and no-Origin connections without configuration', async () => {
    const server = await start();
    expect((await connect(server.port, { Origin: `http://127.0.0.1:${server.port}` })).status).toBe(101);
    expect((await connect(server.port)).status).toBe(101);
  });
  it('denies other origins with an explicit 403 and ignores forwarded hosts', async () => {
    const server = await start([vercelOrigin]);
    const client = await connect(server.port, { Origin: 'https://other.example.test', 'X-Forwarded-Host': 'other.example.test' });
    expect(client.status).toBe(403);
    expect(client.body).toBe('Origin not allowed');
    expect(server.sessions.size).toBe(0);
    expect((await connect(server.port, { Origin: vercelOrigin })).status).toBe(101);
  });
  it('returns 404 for the wrong upgrade path', async () => {
    const server = await start();
    const client = await connect(server.port, {}, '/other');
    expect(client.status).toBe(404);
    expect(client.body).toBe('WebSocket endpoint not found');
  });
  it('returns 503 at capacity without opening additional connections', async () => {
    const server = await start();
    vi.spyOn(server.sessions, 'size', 'get').mockReturnValue(64);
    const client = await connect(server.port);
    expect(client.status).toBe(503);
    expect(client.body).toBe('Server at capacity');
  });
  it('identifies the service and endpoint without exposing worlds or configuration', async () => {
    const server = await start([vercelOrigin]);
    const response = await fetch(`http://127.0.0.1:${server.port}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: 'aetheria', websocket: '/ws' });
  });
});
