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

// Scrolling the selected week up to the tabs collapses the calendar to it.
await p.getByRole('button', { name: 'Show month ▾' }).click();
await p.setViewportSize({ width: 420, height: 500 });
await p.locator('[data-testid="calendar-grid"] > button', { hasText: /^\s*15\s*$/ }).click();
const tabs = p.getByRole('button', { name: 'LOG' });
const grid = p.getByTestId('calendar-grid');
const dayHeader = p.getByText(/^[A-Z]{3} \d+ [A-Z]{3}$/).first();
const cell15 = p.locator('[data-testid="calendar-grid"] > button', { hasText: /^\s*15\s*$/ });
await p.evaluate(() => window.scrollTo(0, 0));
const monthCells = await cells.count();
const monthGap = (await dayHeader.boundingBox()).y - (await cell15.boundingBox()).y;
// Scroll in small steps, like a finger, until the calendar collapses.
let lastY = null;
for (let y = 0; y < 1000 && await cells.count() > 7; y += 10) {
  lastY = (await cell15.boundingBox()).y;
  await p.mouse.wheel(0, 10); await p.waitForTimeout(30);
}
await p.waitForTimeout(100);
check(await cells.count() === 7, `scrolling down collapses the month (${monthCells} cells) to one week`);
check((await days()).includes(15), "collapsed week is the selected day's week");
const tabBox = await tabs.boundingBox(), gridBox = await grid.boundingBox();
check(tabBox.y >= 0 && tabBox.y < 10, 'tabs stay at the top');
const tabBottom = await tabs.evaluate(el => el.parentElement.getBoundingClientRect().bottom);
check(Math.abs(gridBox.y - tabBottom) < 2, 'week sits right under the tabs');
check(Math.abs((await cell15.boundingBox()).y - lastY) < 14, 'the week does not jump when the month collapses');
const weekGap = (await dayHeader.boundingBox()).y - (await cell15.boundingBox()).y;
check(weekGap < monthGap - 100, `day entries move up under the week (${Math.round(monthGap)}px -> ${Math.round(weekGap)}px)`);
await p.mouse.wheel(0, 400); await p.waitForTimeout(150);
check(await cells.count() === 7 && Math.abs((await grid.boundingBox()).y - tabBottom) < 2, 'week stays pinned while scrolling further');
await p.locator('[data-testid="calendar-grid"] > button', { hasText: /^\s*16\s*$/ }).click();
check(/ 16 [A-Z]{3}$/.test((await dayHeader.innerText()).trim()), 'tapping a day in the pinned week selects it');
for (let k = 0; k < 40 && await cells.count() === 7; k++) { await p.mouse.wheel(0, -40); await p.waitForTimeout(30); }
check(await cells.count() >= 28, 'scrolling back up brings the month back');
await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(100);
check(await cells.count() >= 28 && await p.evaluate(() => window.scrollY) === 0, 'top of the page shows the whole month');
await p.getByRole('button', { name: 'EXERCISES' }).click();
await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await p.waitForTimeout(100);
check(await p.locator('[data-testid="calendar-grid"]').count() === 0, 'no calendar on the exercises tab');

check(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
await b.close(); srv.close();
