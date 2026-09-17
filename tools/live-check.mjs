import { chromium } from 'playwright';

const URL = 'https://aetheria-aryam.vercel.app/';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

const wsEvents = [];
page.on('websocket', ws => {
  wsEvents.push({ type: 'open', url: ws.url() });
  ws.on('close', () => wsEvents.push({ type: 'close', url: ws.url() }));
  ws.on('socketerror', err => wsEvents.push({ type: 'error', url: ws.url(), err }));
});

const responses = [];
page.on('response', r => { if (r.status() >= 400) responses.push(`${r.status()} ${r.url()}`); });

await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.screenshot({ path: 'docs/images/live-status.png', fullPage: true });

// Click "Begin" if present
const begin = page.locator('button:has-text("Begin"), a:has-text("Begin")').first();
if (await begin.count()) {
  await begin.click().catch(e => consoleErrors.push('begin click fail: ' + e.message));
  await page.waitForTimeout(6000);
  await page.screenshot({ path: 'docs/images/live-status.png', fullPage: true });
  console.log('--- post-click UI ---');
  console.log((await page.locator('body').innerText()).slice(0, 2000));
} else {
  console.log('--- begin button not found ---');
}

console.log('--- console errors ---');
console.log(consoleErrors.join('\n') || '(none)');
console.log('--- ws events ---');
console.log(JSON.stringify(wsEvents) || '(none)');
console.log('--- http >=400 ---');
console.log(responses.join('\n') || '(none)');
console.log('--- body text sample ---');
console.log((await page.locator('body').innerText()).slice(0, 1500));

await browser.close();
