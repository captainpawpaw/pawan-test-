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
// two weeks ago: an upper and a lower session
await ctx.addInitScript(() => {
  if (localStorage.getItem('seeded')) return;
  const pad = (n) => String(n).padStart(2, '0'); const x = new Date(); x.setDate(x.getDate() - 14);
  localStorage.setItem(`fitness-tracker:month:${x.getFullYear()}-${pad(x.getMonth() + 1)}`, JSON.stringify({ [pad(x.getDate())]: { strength: [
    { id: 'a', exercise: 'Barbell Bench Press - Medium Grip', sets: '3', reps: '10', weight: '100' },
    { id: 'b', exercise: 'Back Squat', sets: '3', reps: '10', weight: '120' },
    { id: 'c', exercise: 'Bent Over Barbell Row', sets: '3', reps: '10', weight: '80' },
    { id: 'd', exercise: 'Dumbbell Bicep Curl', sets: '3', reps: '10', weight: '15' },
  ], cardio: [] } }));
  localStorage.setItem('seeded', '1');
});
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
const plan = () => p.getByRole('note', { name: "Today's plan" });
const label = async () => (await p.locator('[data-dayswipe] > span').first().innerText()).trim();
const goTo = async (dow) => { for (let i = 0; i < 8 && !(await label()).startsWith(dow); i++) await p.getByRole('button', { name: 'Next day' }).click(); };
await p.goto('http://localhost:4190/'); await p.getByText('STRENGTH', { exact: true }).waitFor();
await p.waitForTimeout(500);
check(await plan().count() === 0, 'Default: no day plan');
// the Default split: picking an exercise fills 3 x 10
await p.locator('.ft-section').first().getByRole('button', { name: '+ Add' }).click();
await p.getByLabel('Exercise').fill('Back Squ');
await p.getByRole('option', { name: /Back Squat/ }).first().click();
check(await p.getByLabel('Sets').inputValue() === '3' && await p.getByLabel('Reps').inputValue() === '10', 'Default fills 3 × 10');
check((await p.getByRole('status', { name: 'Last time' }).innerText()).trim() === 'Last time: max 120 kg, first set 85 kg', 'and the first set at 70%');
await p.locator('.ft-section').first().getByRole('button', { name: 'Cancel' }).click();
// choose Upper/Lower in the menu, beside the themes
await p.getByRole('button', { name: 'Menu' }).click();
check((await p.getByRole('menuitem', { name: /^Training split/ }).innerText()).includes('Default'), 'the menu shows the split, beside Theme');
await p.getByRole('menuitem', { name: /^Training split/ }).click();
const splitGroup = p.getByRole('group', { name: 'Training split' });
check(await splitGroup.getByRole('menuitemradio', { name: 'Default' }).getAttribute('aria-checked') === 'true', 'its sub-menu has Default ticked to start with');
await p.screenshot({ path: 'split-menu.png', fullPage: true });
await splitGroup.getByRole('menuitemradio', { name: /^Upper\/Lower/ }).click();
check(await p.getByRole('menu').count() === 0, 'one tap picks it and closes the menu');
const pr = await p.evaluate(() => JSON.parse(localStorage.getItem('fitness-tracker:profile')));
check(pr.split.id === 'upper-lower' && pr.split.sets === 4 && pr.split.reps === 8, 'stored in the profile (syncs), with Upper/Lower\'s 4 × 8');
await p.getByRole('button', { name: 'Menu' }).click();
check((await p.getByRole('menuitem', { name: /^Training split/ }).innerText()).includes('Upper/Lower'), 'the menu shows it');
await p.getByRole('menuitem', { name: /^Training split/ }).click();
check(await splitGroup.getByRole('menuitemradio', { name: /^Upper\/Lower/ }).getAttribute('aria-checked') === 'true', 'and ticks it in the sub-menu');
await p.keyboard.press('Escape');
const settings = p.getByRole('region', { name: 'Training split settings' });
// Monday: Upper A, with upper-body exercises you've logged
await goTo('MON');
let t = await plan().innerText();
check(t.includes('Upper A: chest, back, shoulders, arms · 4 × 8, first set 70%'), 'Monday is Upper A: ' + t.split('\n')[0]);
check(t.includes('Barbell Bench Press') && t.includes('Bent Over Barbell Row') && t.includes('Dumbbell Bicep Curl') && !t.includes('Back Squat'), 'suggests the upper-body exercises you\'ve logged');
await p.screenshot({ path: 'split-day.png' });
await p.getByRole('button', { name: '+ Barbell Bench Press - Medium Grip' }).click();
check(await p.getByLabel('Exercise').inputValue() === 'Barbell Bench Press - Medium Grip' && await p.getByLabel('Sets').inputValue() === '4' && await p.getByLabel('Reps').inputValue() === '8', 'tapping one starts logging it at 4 × 8');
check((await p.getByRole('status', { name: 'Last time' }).innerText()).trim() === 'Last time: max 100 kg, first set 70 kg', 'with last time and the first set');
await p.getByLabel('Max weight (kg)').fill('70'); await p.getByRole('button', { name: 'Log a set' }).click();
check(!(await plan().innerText()).includes('Barbell Bench Press'), 'a logged exercise leaves the suggestions');
// Tuesday: Lower A; Wednesday: rest
await goTo('TUE');
t = await plan().innerText();
check(t.includes('Lower A') && t.includes('Back Squat') && !t.includes('Bench'), 'Tuesday is Lower A, with squats');
await goTo('WED');
check((await plan().innerText()).includes('Rest day'), 'Wednesday is a rest day');
// adjust sets and reps: no first-set % there any more
await p.getByRole('button', { name: 'Menu' }).click();
await p.getByRole('menuitem', { name: /^Training split/ }).click();
await p.getByRole('menuitem', { name: 'Adjust sets & reps…' }).click();
check((await settings.innerText()).includes('Upper/Lower') && await settings.getByLabel('Sets').inputValue() === '4' && await settings.getByLabel('First set %').count() === 0, 'Adjust shows the chosen split\'s sets and reps only');
await p.screenshot({ path: 'split-settings.png' });
await settings.getByRole('button', { name: 'Close' }).click();
// First set weight in the menu: 70% to start, choose 90%
await p.getByRole('button', { name: 'Menu' }).click();
check((await p.getByRole('menuitem', { name: /^First set weight/ }).innerText()).includes('70%'), 'the menu shows First set weight at 70%');
await p.getByRole('menuitem', { name: /^First set weight/ }).click();
const fsGroup = p.getByRole('group', { name: 'First set weight' });
check((await fsGroup.getByRole('menuitemradio').allInnerTexts()).map(x => x.replace(/\s*✓/, '').trim()).join(',') === '70% of last max,80% of last max,90% of last max', 'choices: 70%, 80%, 90%');
await p.screenshot({ path: 'first-set-menu.png' });
await fsGroup.getByRole('menuitemradio', { name: /^90%/ }).click();
check((await p.evaluate(() => JSON.parse(localStorage.getItem('fitness-tracker:profile')))).firstSet.pct === 90, 'stored in the profile (syncs)');
await goTo('TUE');
check((await plan().innerText()).includes('first set 90%'), 'the day plan uses it');
await p.getByRole('button', { name: '+ Back Squat' }).click();
check((await p.getByRole('status', { name: 'Last time' }).innerText()).trim() === 'Last time: max 120 kg, first set 107.5 kg', 'the suggestion follows your choice: ' + await p.getByRole('status', { name: 'Last time' }).innerText());
await p.locator('.ft-section').first().getByRole('button', { name: 'Cancel' }).click();
await p.getByRole('button', { name: 'Menu' }).click(); await p.getByRole('menuitem', { name: /^First set weight/ }).click();
await fsGroup.getByRole('menuitemradio', { name: /^80%/ }).click();
await p.getByRole('button', { name: '+ Back Squat' }).click();
check((await p.getByRole('status', { name: 'Last time' }).innerText()).trim() === 'Last time: max 120 kg, first set 95 kg', '80%: ' + await p.getByRole('status', { name: 'Last time' }).innerText());
check(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
await b.close(); srv.close();
