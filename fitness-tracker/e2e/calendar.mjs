import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const DIST = process.argv[2];
// static server
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(DIST, p);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.json') ? 'application/json' : 'text/html' });
  fs.createReadStream(f).pipe(res);
}).listen(4190);

const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
await ctx.route('https://accounts.google.com/gsi/client', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:4190/');
await p.getByText('STRENGTH').first().waitFor();

const cells = p.locator('[data-testid="calendar-grid"] > *');
const days = async () => (await p.locator('[data-testid="calendar-grid"] > button').allInnerTexts()).map(t => Number(t.trim()));
const today = new Date().getDate();
const height = async () => (await p.getByTestId('calendar-grid').boundingBox()).height;

const fullCount = await cells.count();
const fullHeight = await height();
check(fullCount >= 28 && fullCount % 7 === 0, `month view shows every week (${fullCount} cells)`);

await p.getByRole('button', { name: 'Show week ▴' }).click();
check(await cells.count() === 7, 'collapsed view shows one row of 7');
check((await days()).includes(today), "collapsed week holds today's date");
check(await height() < fullHeight / 3, 'collapsed calendar is shorter');
check(await p.getByRole('button', { name: 'Show month ▾' }).getAttribute('aria-pressed') === 'true', 'toggle reports pressed');

await p.reload(); await p.getByText('STRENGTH').first().waitFor();
check(await cells.count() === 7, 'stays collapsed after reload');

await p.getByRole('button', { name: 'FOOD' }).click();
check(await cells.count() === 7, 'stays collapsed on the food tab');
await p.getByRole('button', { name: 'LOG' }).click();

await p.getByRole('button', { name: 'Next month' }).click();
check((await days()).includes(1), 'next month collapses to the week of the 1st');

await p.getByRole('button', { name: 'Show month ▾' }).click();
check(await cells.count() >= 28, 'expands back to the whole month');
await p.locator('[data-testid="calendar-grid"] > button', { hasText: /^\s*20\s*$/ }).click();
await p.getByRole('button', { name: 'Show week ▴' }).click();
check((await days()).includes(20), 'collapses to the week of the picked day');

check(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
await b.close(); srv.close();
