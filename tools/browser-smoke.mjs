import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { createGameServer } from '../server/main.ts';
import { inventory } from '../server/session.ts';
import { addItem, countItem } from '../shared/inventory.ts';
import { itemNameToId } from '../shared/recipes.ts';

const started = Date.now();
const result = { ok: false, failingStep: null, steps: [], screenshots: [], fixture: null, pages: [], upgrades: [], serverCloses: [], serverErrors: [], teardownProxyErrors: [], cleanup: {} };
let step = 'startup';
let temporary, game, vite, browser, expectedReloadSocket;
const observers = [];
const originalError = console.error;
console.error = (...args) => {
  const text = args.map(value => value instanceof Error ? value.stack : String(value)).join(' ');
  if (step === 'cleanup' && /ws proxy (?:socket )?error:/.test(text) && /\b(?:ECONNABORTED|ECONNRESET)\b/.test(text)) result.teardownProxyErrors.push(text);
  else result.serverErrors.push(text);
  originalError(...args);
};
const elapsed = () => Date.now() - started;
const wait = (predicate, message) => expect.poll(predicate, { message, timeout: 90000, intervals: [100, 250, 500] }).toBeTruthy();
async function stage(name, action) {
  step = name;
  const at = elapsed();
  process.stderr.write(`[browser-smoke] ${name}\n`);
  const value = await action();
  result.steps.push({ name, ms: elapsed() - at });
  return value;
}
function observe(page, name) {
  const data = { name, console: [], pageErrors: [], httpErrors: [], requestFailures: [], statuses: [], sockets: [], counts: { sent: {}, received: {} }, events: [] };
  const state = { page, data, frames: [], serial: 0 };
  observers.push(state);
  result.pages.push(data);
  page.setDefaultTimeout(90000);
  page.on('console', message => {
    const text = message.text();
    const existing = data.console.find(entry => entry.type === message.type() && entry.text === text);
    if (existing) existing.count++;
    else data.console.push({ type: message.type(), text, count: 1 });
  });
  page.on('pageerror', error => data.pageErrors.push(error.stack ?? error.message));
  page.on('response', response => {
    if (response.status() >= 400) data.httpErrors.push({ url: response.url(), status: response.status() });
  });
  page.on('requestfailed', request => data.requestFailures.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on('websocket', socket => {
    const entry = { url: socket.url(), openedAt: elapsed(), game: new URL(socket.url()).pathname === '/ws' };
    data.sockets.push(entry);
    socket.on('socketerror', error => { entry.error = String(error); });
    socket.on('close', () => { entry.closedAt = elapsed(); });
    for (const [event, direction] of [['framesent', 'sent'], ['framereceived', 'received']]) socket.on(event, ({ payload }) => {
      if (!entry.game) return;
      let message;
      try { message = JSON.parse(String(payload)); } catch { data.events.push({ direction, type: 'invalid-json', at: elapsed() }); return; }
      const type = message.type;
      data.counts[direction][type] = (data.counts[direction][type] ?? 0) + 1;
      if (direction === 'received') {
        state.frames.push({ serial: ++state.serial, message });
        if (state.frames.length > 2000) state.frames.shift();
      }
      if (!['input', 'chunks', 'chunk', 'snapshot', 'inventory', 'ping', 'pong'].includes(type)) {
        const safe = { ...message };
        delete safe.token;
        if (safe.player) safe.player = { id: safe.player.id, name: safe.player.name, inventory: safe.player.inventory };
        data.events.push({ direction, at: elapsed(), ...safe });
      }
    });
  });
  return state;
}
async function instrument(state) {
  await state.page.exposeBinding('smokeStatus', (_source, text) => {
    const statuses = state.data.statuses;
    if (statuses.at(-1)?.text !== text) statuses.push({ at: elapsed(), text });
  });
  await state.page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const root = document.getElementById('ui');
      if (!root) return;
      let last = '';
      new MutationObserver(() => {
        const text = [...root.querySelectorAll('[role="status"], .ae-world-list')].map(node => node.textContent).join('\n');
        if (text !== last) { last = text; void window.smokeStatus(text); }
      }).observe(root, { subtree: true, childList: true, characterData: true });
    });
  });
}
async function frame(state, type, after = 0, predicate = () => true) {
  let found;
  await wait(() => {
    found = state.frames.find(entry => entry.serial > after && entry.message.type === type && predicate(entry.message));
    return !!found;
  }, `${state.data.name}: waiting for actual ${type} frame after ${after}`);
  return found.message;
}
async function canvasEvidence(page) {
  await expect(page.locator('#game')).toBeVisible();
  await page.waitForFunction(() => {
    const canvas = document.getElementById('game');
    const gl = canvas?.getContext('webgl2');
    return canvas?.width > 0 && canvas?.height > 0 && gl && !gl.isContextLost();
  }, undefined, { polling: 'raf', timeout: 90000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.locator('#game').evaluate(canvas => {
    const gl = canvas.getContext('webgl2');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { width: canvas.width, height: canvas.height, renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), contextLost: gl.isContextLost() };
  });
}
async function capture(page, filename) {
  const evidence = await canvasEvidence(page);
  await page.screenshot({ path: resolve('docs/images', filename), timeout: 90000 });
  result.screenshots.push({ path: `docs/images/${filename}`, ...evidence });
}
async function readyWorld(state) {
  await frame(state, 'chunk');
  await frame(state, 'snapshot');
  await expect(state.page.locator('.ae-hud')).toBeVisible();
  await state.page.locator('#game').focus();
  await state.page.keyboard.press('F3');
  const debug = state.page.getByLabel('Performance statistics');
  await expect(debug).toBeVisible();
  await wait(async () => /Chunks [1-9]\d* \| meshes pending 0/.test(await debug.innerText()) && /triangles [1-9]\d*/.test(await debug.innerText()), 'real terrain meshes and rendered HUD statistics');
  state.data.renderStats = await debug.innerText();
  await state.page.keyboard.press('F3');
}
async function chat(sender, receiver, text) {
  const after = receiver.serial;
  await sender.page.bringToFront();
  const resume = sender.page.getByRole('button', { name: /Return to the wild/ });
  if (await resume.isVisible()) await resume.click();
  await sender.page.locator('#game').focus();
  await sender.page.keyboard.press('t');
  await sender.page.getByRole('textbox', { name: 'Message or command' }).fill(text);
  await sender.page.getByRole('button', { name: 'Send', exact: true }).click();
  await frame(receiver, 'chat', after, message => message.text === text);
  await expect(receiver.page.getByRole('log', { name: 'Chat', exact: true })).toContainText(text);
  await sender.page.keyboard.press('Escape');
}

try {
  await stage('start real game server and Vite proxy', async () => {
    const parent = process.platform === 'win32' ? join(tmpdir(), 'opencode') : tmpdir();
    temporary = await mkdtemp(join(parent, 'aetheria-browser-smoke-'));
    await mkdir(resolve('docs/images'), { recursive: true });
    game = await createGameServer({ port: 0, saveDir: join(temporary, 'saves') });
    game.http.on('upgrade', request => result.upgrades.push({ at: elapsed(), path: request.url, host: request.headers.host, origin: request.headers.origin }));
    game.wss.on('connection', socket => socket.on('close', (code, reason) => result.serverCloses.push({ at: elapsed(), code, reason: reason.toString(), expectedReload: socket === expectedReloadSocket })));
    vite = await createServer({ configFile: false, root: process.cwd(), cacheDir: join(temporary, 'vite-cache'), logLevel: 'error', server: { host: '127.0.0.1', port: 0, proxy: { '/ws': { target: `ws://127.0.0.1:${game.port}`, ws: true } } } });
    await new Promise((resolve, reject) => {
      vite.httpServer.once('error', reject);
      vite.httpServer.listen(0, '127.0.0.1', () => { vite.httpServer.off('error', reject); resolve(); });
    });
    result.frontend = `http://127.0.0.1:${vite.httpServer.address().port}`;
    result.gamePort = game.port;
    const health = await fetch(`http://127.0.0.1:${game.port}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, service: 'aetheria', websocket: '/ws' });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const first = observe(await context.newPage(), 'first');
  await instrument(first);
  await stage('frontend root, title canvas and initial world list', async () => {
    const response = await first.page.goto(result.frontend, { waitUntil: 'domcontentloaded' });
    assert.equal(response.status(), 200);
    await expect(first.page.getByRole('button', { name: /Begin your journey/ })).toBeVisible();
    await frame(first, 'worlds');
    await capture(first.page, 'title.png');
  });
  const welcome = await stage('UI create survival QA world with seed aetheria', async () => {
    await first.page.getByRole('button', { name: /Begin your journey/ }).click();
    await first.page.getByRole('textbox', { name: 'Explorer name' }).fill('QA First');
    await first.page.getByRole('button', { name: /Create a new world/ }).click();
    await first.page.getByRole('textbox', { name: 'World name' }).fill('QA world');
    await first.page.getByRole('textbox', { name: /World seed/ }).fill('aetheria');
    const mode = first.page.locator('#ae-create select[name="mode"]');
    await expect(mode).toBeVisible();
    await mode.selectOption('survival');
    await expect(mode).toHaveValue('survival');
    await first.page.getByRole('button', { name: /^Create world/ }).click();
    const message = await frame(first, 'welcome');
    assert.equal(message.world.name, 'QA world');
    assert.equal(message.world.seed, 'aetheria');
    assert.equal(message.player.mode, 'survival');
    await readyWorld(first);
    await capture(first.page, 'verdant.png');
    return message;
  });
  const secondContext = await browser.newContext({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
  const second = observe(await secondContext.newPage(), 'second');
  await instrument(second);
  await stage('second independent browser context joins via UI', async () => {
    await second.page.goto(result.frontend, { waitUntil: 'domcontentloaded' });
    await frame(second, 'worlds');
    await second.page.getByRole('button', { name: /Begin your journey/ }).click();
    await second.page.getByRole('textbox', { name: 'Explorer name' }).fill('QA Second');
    await second.page.getByRole('button', { name: /QA world.*survival/ }).click();
    const joined = await frame(second, 'welcome');
    assert.equal(joined.world.id, welcome.world.id);
    assert.notEqual(joined.player.id, welcome.player.id);
    await frame(first, 'snapshot', first.serial, message => message.players.some(player => player.id === joined.player.id));
    await readyWorld(second);
  });
  await stage('bidirectional UI chat over actual websocket', async () => {
    await chat(first, second, 'QA first to second');
    await chat(second, first, 'QA second to first');
  });
  let retainedInventory;
  await stage('real movement displaces player', async () => {
    const session = [...game.sessions].find(value => value.player?.id === welcome.player.id);
    assert.ok(session);
    const start = { x: session.player.x, z: session.player.z };
    await first.page.bringToFront();
    const resume = first.page.getByRole('button', { name: /Return to the wild/ });
    if (await resume.isVisible()) await resume.click();
    await first.page.locator('#game').focus();
    await first.page.keyboard.down('w');
    await first.page.waitForTimeout(1200);
    await first.page.keyboard.up('w');
    await wait(() => Math.hypot(session.player.x - start.x, session.player.z - start.z) > 0.5, 'server-side player displacement from held W');
    result.movement = { from: { x: +start.x.toFixed(2), z: +start.z.toFixed(2) }, to: { x: +session.player.x.toFixed(2), z: +session.player.z.toFixed(2) } };
  });
  await stage('fixture-backed UI crafting and crafting screenshot', async () => {
    const session = [...game.sessions].find(value => value.player?.id === welcome.player.id);
    assert.ok(session);
    const log = itemNameToId('log'), planks = itemNameToId('planks');
    result.fixture = { label: 'Testing fixture: server API adds 2 logs; UI sends real craft action; no mining claim', item: log, count: 2 };
    assert.equal(addItem(session.player.inventory, { id: log, count: 2 }), 0);
    const after = first.serial;
    inventory(session);
    await frame(first, 'inventory', after, message => countItem(message.player.inventory, log) === 2);
    await first.page.bringToFront();
    const resume = first.page.getByRole('button', { name: /Return to the wild/ });
    if (await resume.isVisible()) await resume.click();
    await first.page.locator('#game').focus();
    await first.page.keyboard.press('e');
    await expect(first.page.getByRole('heading', { name: 'Your field pack' })).toBeVisible();
    const before = first.serial;
    await first.page.getByRole('button', { name: 'Craft planks', exact: true }).click();
    const crafted = await frame(first, 'inventory', before, message => countItem(message.player.inventory, planks) === 4 && countItem(message.player.inventory, log) === 1);
    retainedInventory = crafted.player.inventory;
    assert.deepEqual(session.player.inventory, retainedInventory);
    await expect(first.page.locator('.ae-pack-grid')).toContainText('4');
    await capture(first.page, 'crafting.png');
  });
  await stage('reload and UI rejoin retain identity and crafted inventory', async () => {
    const profile = await first.page.evaluate(() => localStorage.getItem('aetheria.profile'));
    const before = first.serial;
    expectedReloadSocket = [...game.sessions].find(session => session.player?.id === welcome.player.id)?.socket;
    assert.ok(expectedReloadSocket);
    await first.page.reload({ waitUntil: 'domcontentloaded' });
    await frame(first, 'worlds', before);
    await first.page.getByRole('button', { name: /Begin your journey/ }).click();
    await first.page.getByRole('button', { name: /QA world.*survival/ }).click();
    const restored = await frame(first, 'welcome', before);
    assert.equal(restored.player.id, welcome.player.id);
    assert.equal(restored.player.name, 'QA First');
    assert.deepEqual(restored.player.inventory, retainedInventory);
    assert.equal(await first.page.evaluate(() => localStorage.getItem('aetheria.profile')), profile);
    await frame(first, 'snapshot', first.serial, message => message.players.length === 2);
    await frame(first, 'chunk', before);
    await expect(first.page.locator('.ae-hotbar')).toContainText('4');
    result.retention = { identity: true, inventory: true, playerId: restored.player.id };
  });
  await stage('connection and runtime error audit', async () => {
    for (const state of observers) {
      assert.deepEqual(state.data.pageErrors, [], `${state.data.name}: uncaught browser errors`);
      assert.deepEqual(state.data.events.filter(event => event.direction === 'received' && event.type === 'error'), [], `${state.data.name}: server protocol errors`);
      assert.deepEqual(state.data.sockets.filter(socket => socket.error), [], `${state.data.name}: websocket errors`);
      assert.deepEqual(state.data.console.filter(entry => entry.type === 'error'), [], `${state.data.name}: console errors`);
      assert.deepEqual(state.data.httpErrors, [], `${state.data.name}: HTTP errors`);
      assert.deepEqual(state.data.statuses.filter(status => /Disconnected|connection failed|timed out|stopped responding|Not connected|Rate limit|Input queue full/i.test(status.text)), [], `${state.data.name}: connection status failures`);
    }
    assert.deepEqual(result.serverErrors, []);
    assert.deepEqual(result.serverCloses.filter(entry => !entry.expectedReload || ![1000, 1001, 1005].includes(entry.code)), []);
  });
  result.ok = true;
} catch (error) {
  result.failingStep = step;
  result.error = error.stack ?? String(error);
  for (const state of observers) {
    if (!state.page.isClosed()) state.data.failureUI = await state.page.locator('body').innerText({ timeout: 5000 }).catch(error => error.message);
  }
} finally {
  step = 'cleanup';
  for (const [name, close] of [['browser', () => browser?.close()], ['vite', () => vite?.close()], ['game', () => game?.close()], ['temporary', () => temporary ? rm(temporary, { recursive: true, force: true }) : undefined]]) {
    try { await close(); result.cleanup[name] = true; }
    catch (error) { result.cleanup[name] = error.message; result.ok = false; result.failingStep ??= `cleanup ${name}`; }
  }
  console.error = originalError;
  if (result.serverErrors.length && result.ok) {
    result.ok = false;
    result.failingStep = 'cleanup connection error audit';
    result.error = 'Server or proxy errors occurred during teardown; see serverErrors.';
  } else if (result.teardownProxyErrors.length) {
    result.teardownProxyNote = `${result.teardownProxyErrors.length} Vite ws-proxy ECONNABORTED during teardown (expected on forced socket close)`;
  }
  result.elapsedMs = elapsed();
  result.messageCount = result.pages.reduce((total, page) => total + Object.values(page.counts.received).reduce((sum, n) => sum + n, 0), 0);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}
