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
// past weigh-ins, and a weekly weigh-in at midnight today (so it's due now)
await ctx.addInitScript(() => {
  if (localStorage.getItem('seeded')) return;
  const pad = (n) => String(n).padStart(2, '0'); const iso = (x) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  const d = new Date(); const weights = [];
  for (let i = 6; i >= 1; i--) { const x = new Date(d); x.setDate(d.getDate() - i * 7); weights.push({ date: iso(x), kg: 82 - (6 - i) * 0.5 }); }
  localStorage.setItem('fitness-tracker:profile', JSON.stringify({ bodyweight: { weights, at: 1 }, weighin: { on: true, day: d.getDay(), time: '00:00', since: Date.now() - 8 * 86400000, at: 1 } }));
  localStorage.setItem('seeded', '1');
});
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
const prompt = () => p.getByRole('region', { name: 'Weekly weigh-in', exact: true });
const profile = () => p.evaluate(() => JSON.parse(localStorage.getItem('fitness-tracker:profile')));
await p.goto('http://localhost:4190/'); await p.getByText('STRENGTH', { exact: true }).waitFor();
await prompt().waitFor();
check((await prompt().innerText()).includes('Time for your weekly weigh-in') && (await prompt().innerText()).includes('Last time: 79.5 kg'), 'asks for the weight when the weigh-in time has passed');
await p.screenshot({ path: 'weighin-prompt.png' });
await p.getByRole('button', { name: 'Save', exact: true }).click();
check((await prompt().innerText()).includes('Enter your weight, e.g. 78.5 kg'), 'needs a weight');
// skip this week: gone, and stays gone after reload
await p.getByRole('button', { name: 'Skip this week' }).click();
check(await prompt().count() === 0, 'skip hides it');
await p.reload(); await p.getByText('STRENGTH', { exact: true }).waitFor(); await p.waitForTimeout(300);
check(await prompt().count() === 0, 'a skipped week stays skipped');
// undo the skip by hand, then log a weight
await p.evaluate(() => { const pr = JSON.parse(localStorage.getItem('fitness-tracker:profile')); delete pr.weighin.skipped; localStorage.setItem('fitness-tracker:profile', JSON.stringify(pr)); });
await p.reload(); await prompt().waitFor();
check(await prompt().getByRole('group', { name: 'Weight unit' }).getByRole('button').allInnerTexts().then(t => t.join(',')) === 'kg,lb,st & lb', 'choice of kg, lb, or st & lb');
await prompt().getByRole('button', { name: 'lb', exact: true }).click();
check((await prompt().innerText()).includes('Last time: 175.3 lb'), 'in lb: ' + (await prompt().innerText()).split('\n').find(l => l.startsWith('Last')));
await prompt().getByRole('button', { name: 'st & lb' }).click();
check((await prompt().innerText()).includes('Last time: 12 st 7.3 lb'), 'in st & lb: ' + (await prompt().innerText()).split('\n').find(l => l.startsWith('Last')));
await p.getByLabel('Stones').fill('12'); await p.getByLabel('Pounds').fill('7');
await p.screenshot({ path: 'weighin-stones.png' });
await p.getByRole('button', { name: 'Save', exact: true }).click();
check(await prompt().count() === 0, 'saving the weight closes it');
const pr = await profile();
check(pr.bodyweight.weights.at(-1).kg === 79.4 && pr.bodyweight.weights.length === 7 && pr.units.weight === 'st', 'weight saved for today in kg (12 st 7 lb = 79.4 kg), and the unit remembered');
// settings from the menu
await p.getByRole('button', { name: 'Menu' }).click();
await p.getByRole('menuitem', { name: 'Weekly weigh-in…' }).click();
const settings = p.getByRole('region', { name: 'Weekly weigh-in settings' });
check(await settings.getByLabel('Day').inputValue() === String(new Date().getDay()) && await settings.getByLabel('Time').inputValue() === '00:00', 'settings show the current day and time');
await settings.getByLabel('Day').selectOption('1');
await settings.getByLabel('Time').fill('07:30');
await settings.getByRole('button', { name: 'Save' }).click();
check((await settings.innerText()).includes('The app will ask Mondays at 7:30'), 'saved: ' + (await settings.innerText()).split('\n').find(l => l.startsWith('Saved')));
const w = (await profile()).weighin;
check(w.day === 1 && w.time === '07:30' && w.on === true, 'day and time stored');
const href = await settings.getByRole('link', { name: 'add it to your calendar' }).getAttribute('href');
const ics = decodeURIComponent(href.split(',')[1]);
check(/RRULE:FREQ=WEEKLY;BYDAY=MO/.test(ics) && /DTSTART:\d{8}T073000/.test(ics), 'calendar event repeats weekly on Monday at 7:30');
await p.screenshot({ path: 'weighin-settings.png' });
await settings.getByRole('button', { name: 'Close' }).click();
// Progress: body weight chart
await p.getByRole('button', { name: 'PROGRESS' }).click();
await p.getByLabel('Show progress for').selectOption('body:weight');
let t = await p.locator('body').innerText();
check(t.includes('Body weight (7 weigh-ins)') && t.includes('Latest weigh-in') && t.includes('12 st 7 lb') && t.includes('Body weight') && /\bst\b/.test(t), 'Progress charts body weight in st & lb');
check(t.includes('Weekly weigh-in: Mondays at 7:30'), 'and shows the weigh-in time');
await p.screenshot({ path: 'weighin-progress.png' });
// turn it off
await p.getByRole('button', { name: 'Change' }).click();
await settings.getByLabel('Ask me for my weight each week').uncheck();
await settings.getByRole('button', { name: 'Save' }).click();
check((await profile()).weighin.on === false && (await p.locator('body').innerText()).includes('No weekly weigh-in set'), 'can be turned off');
check(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
await b.close(); srv.close();
