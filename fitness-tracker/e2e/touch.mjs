import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const DIST = process.argv[2];
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(DIST, p);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.json') ? 'application/json' : 'text/html' });
  fs.createReadStream(f).pipe(res);
}).listen(4190);
const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await ctx.route('https://accounts.google.com/**', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
await ctx.route('https://*.openfoodfacts.org/**', r => r.fulfill({ status: 404, body: '{}' }));
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
// Walks the app at phone size and measures everything that can be tapped.
const seen = new Map();
const scan = async (where) => {
  const rows = await p.evaluate(() => {
    const out = [];
    for (const e of document.querySelectorAll('button, a[href], select, input, textarea, [role=button], [role=tab], [role=menuitem], [role=menuitemradio], summary, label:has(input[type=checkbox]), label:has(input[type=radio]), label:has(input[type=file])')) {
      const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
      if (!r.width || !r.height || cs.visibility === 'hidden' || cs.opacity === '0') continue;
      if (e.matches('input[type=checkbox],input[type=radio],input[type=file]') && e.closest('label')) continue;
      const name = (e.getAttribute('aria-label') || e.innerText || e.placeholder || e.id || e.tagName).trim().replace(/\s+/g, ' ').replace(/\d+/g, '#').slice(0, 40);
      out.push({ tag: e.tagName.toLowerCase(), name, w: Math.round(r.width), h: Math.round(r.height), cls: (e.className || '').toString().slice(0, 30) });
    }
    return out;
  });
  for (const r of rows) if (r.w < 44 || r.h < 44) { const k = `${r.tag}|${r.name}`; if (!seen.has(k)) seen.set(k, { ...r, where }); }
};
const tab = (n) => p.locator('.ft-bottom-nav').getByRole('button', { name: n }).click();
await p.goto('http://localhost:4190/?tab=log'); await p.getByText('STRENGTH', { exact: true }).waitFor();
await scan('log');
await p.locator('.ft-section').nth(0).getByRole('button', { name: '+ Add' }).click(); await scan('strength form');
await p.getByLabel('Exercise').first().fill('Bench press').catch(() => {});
await scan('strength form typed');
const num = async (l, v) => { const x = p.getByLabel(l).first(); if (await x.count()) await x.fill(v).catch(() => {}); };
await num('Sets', '3'); await num('Reps', '8'); await num(/Max weight/, '60');
await p.getByRole('button', { name: /^(Log|Add|Save)/ }).first().click().catch(() => {});
await p.waitForTimeout(300); await scan('strength logged');
await p.locator('.ft-section').nth(1).getByRole('button', { name: '+ Add' }).click().catch(() => {}); await scan('cardio form');
await p.getByRole('button', { name: 'Cancel' }).first().click().catch(() => {});
await p.getByRole('button', { name: 'Menu' }).click(); await scan('menu');
await p.getByRole('menuitem', { name: /Back up/ }).click(); await scan('backup'); await p.getByRole('button', { name: 'Close' }).first().click();
await p.getByRole('button', { name: 'Menu' }).click(); const wi = p.getByRole('menuitem', { name: /weigh|split|Split/i }).first(); if (await wi.count()) { await wi.click(); await scan('settings panel'); await p.getByRole('button', { name: 'Close' }).first().click().catch(() => {}); } else await p.keyboard.press('Escape');
await p.locator('.ft-cal-tab').click().catch(() => {}); await p.waitForTimeout(300); await scan('calendar'); await p.keyboard.press('Escape'); await p.locator('.ft-cal-tab').click().catch(() => {});
await p.goto('http://localhost:4190/?tab=log'); await p.getByText('STRENGTH', { exact: true }).waitFor();
await p.getByRole('button', { name: 'FOOD', exact: true }).click(); await scan('food');
await p.getByRole('button', { name: 'Set daily targets' }).click(); await scan('targets'); await p.getByRole('button', { name: /Cancel/ }).first().click().catch(() => {});
await p.getByRole('button', { name: '+ Add to Lunch' }).click(); await scan('add food');
await p.getByLabel('Search foods').fill('banana'); await p.waitForTimeout(700); await scan('food results');
await p.getByRole('button', { name: /^Bananas, flesh only/ }).first().click(); await scan('amount');
await p.getByRole('button', { name: 'Add to day' }).click(); await scan('after add');
await p.getByRole('button', { name: 'Enter manually' }).click(); await scan('manual'); await p.getByRole('button', { name: /Back|Cancel/ }).first().click().catch(() => {});
await p.getByRole('button', { name: 'Photograph a label' }).click(); await scan('label'); await p.getByRole('button', { name: /Back|Cancel/ }).first().click().catch(() => {});
await p.getByRole('button', { name: 'Done adding' }).click();
await p.locator('button[aria-controls^="food-"][aria-expanded="false"]:not([disabled])').first().click().catch(() => {}); await scan('food rows');
await p.getByRole('button', { name: /^Edit Bananas/ }).click().catch(() => {}); await scan('food edit');
await p.evaluate(() => document.activeElement?.blur()); await p.waitForTimeout(200);
await p.locator('.ft-bottom-nav button').nth(2).click(); await p.waitForTimeout(400); await scan('tab3');
await p.locator('.ft-bottom-nav button').nth(3).click(); await p.waitForTimeout(600); await scan('progress');
const small = [...seen.values()];
const allowed = (r) => (r.cls === 'ft-cal-tab' || r.cls === 'ft-cal-day') && r.w >= 24 && r.h >= 44;
const bad = small.filter(r => !allowed(r));
check(bad.length === 0, 'every control on a phone is at least 44 x 44 px' + (bad.length ? ': ' + JSON.stringify(bad.slice(0, 8)) : ''));
check(small.filter(allowed).length <= 2, 'only the calendar tab and day cells are narrower, and both are 44 px tall: ' + small.filter(allowed).map(r => `${r.name} ${r.w}x${r.h}`).join(', '));
check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'nothing pushes the page wider than the screen');
// with a mouse on a wide screen the compact sizes stay
const d = await (await b.newContext({ viewport: { width: 1100, height: 800 } })).newPage();
await d.route('https://accounts.google.com/**', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
await d.goto('http://localhost:4190/?tab=log'); await d.getByText('STRENGTH', { exact: true }).waitFor();
const menuH = (await d.getByRole('button', { name: 'Menu' }).boundingBox()).height;
check(menuH < 44, 'desktop with a mouse keeps its compact buttons: Menu is ' + menuH + ' px');
check(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
await b.close(); srv.close();
