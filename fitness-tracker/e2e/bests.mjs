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
// squats ten days ago: 100 kg × 8 and 80 kg × 12
await ctx.addInitScript(() => {
  if (localStorage.getItem('seeded')) return;
  const pad = (n) => String(n).padStart(2, '0'); const x = new Date(); x.setDate(x.getDate() - 10);
  localStorage.setItem(`fitness-tracker:month:${x.getFullYear()}-${pad(x.getMonth() + 1)}`, JSON.stringify({ [pad(x.getDate())]: { strength: [
    { id: 'a', exercise: 'Back Squat', sets: '3', reps: '8', weight: '100' },
    { id: 'b', exercise: 'Back Squat', sets: '2', reps: '12', weight: '80' },
  ], cardio: [] } }));
  localStorage.setItem('seeded', '1');
});
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
const strength = p.locator('.ft-section').first();
const banner = () => p.getByRole('status', { name: 'New personal best' });
const logSet = async (name, sets, reps, kg) => {
  await strength.getByRole('button', { name: '+ Add' }).click();
  await p.getByLabel('Exercise').fill(name); await p.getByLabel('Sets').fill(sets); await p.getByLabel('Reps').fill(reps); await p.getByLabel('Max weight (kg)').fill(kg);
  await p.getByRole('button', { name: 'Log a set' }).click();
};
await p.goto('http://localhost:4190/?tab=log'); await p.getByText('STRENGTH', { exact: true }).waitFor(); await p.waitForTimeout(400);
await logSet('Back Squat', '3', '5', '105');
await banner().waitFor();
let t = await banner().innerText();
check(t.includes('New personal best on Back Squat') && t.includes('Heaviest: 105 kg (was 100 kg)') && !t.includes('Most reps'), 'heavier set: banner ' + t.replace(/\n/g, ' | '));
await p.screenshot({ path: 'pb-banner.png' });
check(await strength.getByRole('button', { name: 'Edit Back Squat' }).getByText('PB').count() === 1, 'the record-setting row gets a PB badge');
await banner().getByRole('button', { name: 'Dismiss' }).click();
check(await banner().count() === 0, 'dismissed');
await logSet('Back Squat', '1', '15', '60');
t = await banner().innerText();
check(t.includes('Most reps: 15 (was 12)') && !t.includes('Heaviest'), 'more reps: ' + t.replace(/\n/g, ' | '));
await banner().getByRole('button', { name: 'Dismiss' }).click();
await logSet('Back Squat', '3', '5', '100');
check(await banner().count() === 0, 'matching or below a record: no banner');
await logSet('Deadlift', '1', '5', '140');
check(await banner().count() === 0, 'an exercise\'s first set: no banner');
// Progress: the list
await p.getByRole('button', { name: 'PROGRESS' }).click();
const list = p.getByRole('region', { name: 'Personal bests' });
await list.waitFor();
t = await list.innerText();
const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
check(t.includes('Back Squat') && t.includes(`Heaviest 105 kg × 5 · ${today}`) && t.includes(`Most reps 15 @ 60 kg · ${today}`), 'Progress lists the bests: ' + t.replace(/\n/g, ' | '));
check(t.includes('Deadlift') && t.includes('Heaviest 140 kg × 5'), 'every exercise, including a first set');
await list.scrollIntoViewIfNeeded(); await p.screenshot({ path: 'pb-list.png' });
await list.getByRole('button', { name: /^Deadlift/ }).click();
check(await p.getByLabel('Show progress for').inputValue() === 'exercise:Deadlift', 'tapping one charts it');
check(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
await b.close(); srv.close();
