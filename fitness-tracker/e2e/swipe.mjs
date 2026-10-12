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
await ctx.addInitScript(() => {
  if (localStorage.getItem('seeded')) return;
  const pad = (n) => String(n).padStart(2, '0'); const d = new Date(); const months = {};
  for (let i = 0; i < 20; i++) { const x = new Date(d); x.setDate(d.getDate() - i * 3); const mk = `${x.getFullYear()}-${pad(x.getMonth() + 1)}`; months[mk] = months[mk] || {}; months[mk][pad(x.getDate())] = { strength: [{ id: 's' + i, exercise: 'Back Squat', sets: '4', reps: '6', weight: String(80 + i) }], cardio: [] }; }
  for (const [k, v] of Object.entries(months)) localStorage.setItem('fitness-tracker:month:' + k, JSON.stringify(v));
  localStorage.setItem('seeded', '1');
});
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
const swipe = async (x0, y0, x1, y1, steps = 8) => {
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(300);
};
const tab = () => p.locator('.ft-tabs button[aria-current="page"]').innerText();
await p.goto('http://localhost:4190/'); await p.getByText('STRENGTH', { exact: true }).waitFor();
check(await tab() === 'LOG', 'starts on Log');
await swipe(320, 600, 80, 610);
check(await tab() === 'FOOD', 'swipe left: Food');
await swipe(320, 600, 80, 610);
check(await tab() === 'EXERCISES', 'swipe left again: Exercises');
await swipe(80, 600, 320, 610);
check(await tab() === 'FOOD', 'swipe right: back to Food');
await swipe(320, 400, 300, 700);
check(await tab() === 'FOOD', 'scrolling up and down does not change tab');
await swipe(300, 600, 260, 600);
check(await tab() === 'FOOD', 'a short drag does not change tab');
await swipe(80, 600, 320, 600); await swipe(80, 600, 320, 600);
check(await tab() === 'LOG', 'nothing before Log');
// Progress: dragging the chart pans it, it doesn't change tab
await p.getByRole('button', { name: 'PROGRESS' }).click();
await p.locator('[data-noswipe]').waitFor();
const box = await p.locator('[data-noswipe]').boundingBox();
await swipe(box.x + box.width - 40, box.y + box.height / 2, box.x + 40, box.y + box.height / 2);
check(await tab() === 'PROGRESS', 'dragging the chart stays on Progress');
const lb = await p.getByText('Show progress for').boundingBox();
const ly = lb.y + lb.height / 2;
await swipe(320, ly, 80, ly);
check(await tab() === 'PROGRESS', 'nothing after Progress');
await swipe(80, ly, 320, ly);
check(await tab() === 'EXERCISES', 'swipe right from Progress: Exercises');
// typing boxes and the calendar's edge tab are left alone
await p.getByRole('button', { name: 'LOG', exact: true }).click();
await p.getByRole('button', { name: '+ Add' }).first().click();
const ib = await p.getByLabel('Exercise').boundingBox();
await swipe(ib.x + ib.width - 10, ib.y + ib.height / 2, ib.x + 10, ib.y + ib.height / 2);
check(await tab() === 'LOG', 'a swipe on a text box stays put');
await swipe(5, 300, 250, 300);
check(await tab() === 'LOG', 'a swipe from the screen edge stays put');
// the date heading: swipe or tap ‹ › for the previous or next day
await p.keyboard.press('Escape');
const label = async () => (await p.locator('[data-dayswipe] > span').first().innerText()).trim();
const fmtDay = (d) => `${d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()} ${d.getDate()} ${d.toLocaleDateString('en-US', { month: 'long' }).toUpperCase().slice(0, 3)}`;
const today = new Date(); const plus = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };
check(await label() === fmtDay(today), 'the heading shows today: ' + await label());
const hb = await p.locator('[data-dayswipe]').boundingBox();
const hy = hb.y + hb.height / 2;
await swipe(260, hy, 80, hy);
check(await label() === fmtDay(plus(1)) && await tab() === 'LOG', 'swipe left on the date: next day, same tab');
await swipe(80, hy, 260, hy); await swipe(80, hy, 260, hy);
check(await label() === fmtDay(plus(-1)), 'swipe right on the date: previous day');
await p.screenshot({ path: 'day-swipe.png' });
await p.getByRole('button', { name: 'Next day' }).click();
check(await label() === fmtDay(today), 'the › button: next day');
// across a month boundary
for (let i = 0; i < 32 && (await label()) !== fmtDay(plus(-today.getDate())); i++) await p.getByRole('button', { name: 'Previous day' }).click();
check(await label() === fmtDay(plus(-today.getDate())), 'the ‹ button steps back into last month: ' + await label());
const mt = await p.locator('.ft-masthead-title').innerText();
check(mt.toUpperCase().startsWith(plus(-today.getDate()).toLocaleDateString('en-US', { month: 'long' }).toUpperCase()), 'and the month changes with it: ' + mt);
await p.getByRole('button', { name: 'Next day' }).click();
check(await label() === fmtDay(plus(1 - today.getDate())), 'and forward again into this month');
await swipe(320, 600, 80, 610);
check(await tab() === 'FOOD', 'swiping below the heading still changes tab');
check(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
await b.close(); srv.close();
