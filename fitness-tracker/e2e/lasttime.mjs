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
// a squat session a week ago
await ctx.addInitScript(() => {
  if (localStorage.getItem('seeded')) return;
  const pad = (n) => String(n).padStart(2, '0'); const x = new Date(); x.setDate(x.getDate() - 7);
  localStorage.setItem(`fitness-tracker:month:${x.getFullYear()}-${pad(x.getMonth() + 1)}`, JSON.stringify({ [pad(x.getDate())]: { strength: [
    { id: 'a', exercise: 'Back Squat', sets: '2', reps: '8', weight: '80' },
    { id: 'b', exercise: 'Back Squat', sets: '4', reps: '5', weight: '100' },
  ], cardio: [] } }));
  localStorage.setItem('seeded', '1');
});
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
const strength = p.locator('.ft-section').first();
const hint = () => p.getByRole('status', { name: 'Last time' });
await p.goto('http://localhost:4190/'); await p.getByText('STRENGTH', { exact: true }).waitFor();
await strength.getByRole('button', { name: '+ Add' }).click();
check(await hint().count() === 0, 'no message before an exercise is chosen');
await p.getByLabel('Exercise').fill('back squat');
await hint().waitFor();
let t = await hint().innerText();
check(t.trim() === 'Last time: max 100 kg, first set 70 kg', 'shows last time\'s max and a first set at 70%: ' + t);
check(await p.getByRole('button', { name: /warm-up/i }).count() === 0, 'no warm-up button');
await p.screenshot({ path: 'last-time.png' });
await p.getByLabel('Sets').fill('1'); await p.getByLabel('Reps').fill('5'); await p.getByLabel('Max weight (kg)').fill('70');
await p.getByRole('button', { name: 'Log a set' }).click();
// tomorrow: last time is today's session
await p.getByRole('button', { name: 'Next day' }).click();
await strength.getByRole('button', { name: '+ Add' }).click();
await p.getByLabel('Exercise').fill('Back Squat');
t = await hint().innerText();
check(t.trim() === 'Last time: max 70 kg, first set 50 kg', 'the latest earlier session counts: ' + t);
await p.getByLabel('Exercise').fill('Deadlift');
check(await hint().count() === 0, 'nothing for an exercise never logged');
await strength.getByRole('button', { name: 'Cancel' }).click();
// editing an entry: no message
await p.getByRole('button', { name: 'Previous day' }).click();
await p.getByRole('button', { name: 'Edit Back Squat' }).click();
check(await hint().count() === 0, 'not shown while editing an entry');
check(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
await b.close(); srv.close();
