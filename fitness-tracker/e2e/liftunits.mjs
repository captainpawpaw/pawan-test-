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
// squats a week ago: 100 kg × 8
await ctx.addInitScript(() => {
  if (localStorage.getItem('seeded')) return;
  const pad = (n) => String(n).padStart(2, '0'); const x = new Date(); x.setDate(x.getDate() - 7);
  localStorage.setItem(`fitness-tracker:month:${x.getFullYear()}-${pad(x.getMonth() + 1)}`, JSON.stringify({ [pad(x.getDate())]: { strength: [{ id: 'a', exercise: 'Back Squat', sets: '3', reps: '8', weight: '100', minWeight: '80' }], cardio: [] } }));
  localStorage.setItem('seeded', '1');
});
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
const strength = p.locator('.ft-section').first();
await p.goto('http://localhost:4190/?tab=log'); await p.getByText('STRENGTH', { exact: true }).waitFor(); await p.waitForTimeout(300);
await p.getByRole('button', { name: 'Menu' }).click();
check((await p.getByRole('menuitem', { name: /^Lifting weights/ }).innerText()).includes('kg'), 'menu: Lifting weights starts in kg');
await p.getByRole('menuitem', { name: /^Lifting weights/ }).click();
await p.screenshot({ path: 'lift-menu.png' });
await p.getByRole('menuitemradio', { name: /Pounds/ }).click();
check((await p.evaluate(() => JSON.parse(localStorage.getItem('fitness-tracker:profile')))).units.lift === 'lb', 'lb stored in the profile (syncs)');
// log in lb
await strength.getByRole('button', { name: '+ Add' }).click();
check(await p.getByLabel('Max weight (lb)').count() === 1 && await p.getByLabel('Min weight (lb), optional').count() === 1, 'the form asks for lb');
await p.getByLabel('Exercise').fill('Back Squat');
let t = (await p.getByRole('status', { name: 'Last time' }).innerText()).trim();
check(t === 'Last time: max 220.5 lb, first set 155 lb', 'last time in lb, first set rounded to 5 lb: ' + t);
await p.getByLabel('Sets').fill('3'); await p.getByLabel('Reps').fill('5'); await p.getByLabel('Set 1 weight (lb)').fill('185'); await p.getByLabel('Set 2 weight (lb)').fill('225'); // set 3 repeats set 2
await p.getByRole('button', { name: 'Log a set' }).click();
t = await p.getByRole('status', { name: 'New personal best' }).innerText();
check(t.includes('Heaviest: 225 lb (was 220.5 lb)'), 'personal best in lb: ' + t.replace(/\n/g, ' | '));
t = await strength.innerText();
check(t.includes('3×5 · 185 / 225 / 225lb') && /Volume \(reps × each set's weight\): 3,175 lb/.test(t), 'row and volume in lb: ' + t.replace(/\n/g, ' | '));
await p.screenshot({ path: 'lift-lb.png' });
const day = await p.evaluate(() => { const d = new Date(); const pad = (n) => String(n).padStart(2, '0'); return JSON.parse(localStorage.getItem(`fitness-tracker:month:${d.getFullYear()}-${pad(d.getMonth() + 1)}`))[pad(d.getDate())]; });
check(day.strength[0].weight === '102.058' && day.strength[0].minWeight === '83.915' && day.strength[0].setWeights.join(',') === '83.915,102.058,102.058', 'stored in kg, each set too: ' + day.strength[0].weight + ' / ' + day.strength[0].minWeight + ' / ' + day.strength[0].setWeights);
await p.getByRole('button', { name: 'Edit Back Squat' }).click();
check(await p.getByLabel('Set 1 weight (lb)').inputValue() === '185' && await p.getByLabel('Set 3 weight (lb)').inputValue() === '225', 'editing shows each set in lb');
await strength.getByRole('button', { name: 'Cancel' }).click();
// Progress in lb
await p.getByRole('button', { name: 'PROGRESS' }).click();
t = await p.getByRole('region', { name: 'Personal bests' }).innerText();
check(t.includes('Heaviest 225 lb × 5') && t.includes('Most reps 8 @ 220.5 lb'), 'personal bests list in lb: ' + t.replace(/\n/g, ' | '));
await p.getByRole('button', { name: 'Best weight' }).click();
t = await p.locator('body').innerText();
check(/Weekly best, lb/.test(t) && t.includes('225 lb'), 'charts in lb');
// back to kg: same log, shown in kg
await p.getByRole('button', { name: 'Menu' }).click(); await p.getByRole('menuitem', { name: /^Lifting weights/ }).click(); await p.getByRole('menuitemradio', { name: /Kilograms/ }).click();
await p.getByRole('button', { name: 'LOG', exact: true }).click();
check((await strength.innerText()).includes('3×5 · 83.92 / 102.06 / 102.06kg'), 'back in kg, nothing lost: ' + (await strength.innerText()).split('\n').find(l => l.includes('3×5')));
check(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
await b.close(); srv.close();
