import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createGameServer } from '../server/main.ts';

const directory = await mkdtemp('C:/Users/aryam/AppData/Local/Temp/opencode/aetheria-connection-');
let server, browser;
const errors = [], handshakes = [], messages = [];
try {
  server = await createGameServer({ port: 0, saveDir: join(directory, 'saves'), allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean) });
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const session = await page.context().newCDPSession(page);
  await session.send('Network.enable');
  session.on('Network.webSocketHandshakeResponseReceived', event => handshakes.push({ status: event.response.status, text: event.response.statusText }));
  page.on('websocket', socket => {
    socket.on('socketerror', error => errors.push(String(error)));
    socket.on('framereceived', ({ payload }) => { try { messages.push(JSON.parse(String(payload))); } catch { errors.push('Invalid WebSocket JSON'); } });
  });
  const address = `http://127.0.0.1:${server.port}`;
  await page.goto(address, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => messages.some(message => message.type === 'worlds'), { timeout: 20000 }).toBe(true);
  await page.getByRole('button', { name: /Begin your journey/ }).click();
  await expect(page.getByRole('button', { name: /Create a new world/ })).toBeEnabled();
  assert.ok(handshakes.some(response => response.status === 101));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, address, allowedOrigins: process.env.ALLOWED_ORIGINS, handshakes, worldListReceived: true, createWorldEnabled: true, errors }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message, handshakes, errors, messageTypes: messages.map(message => message.type) }));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server?.close();
  await rm(directory, { recursive: true, force: true });
}
