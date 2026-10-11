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

// fake Drive shared by both "devices"
const drive = { files: {}, n: 0, fail401: false, calls: [] };
const GIS = `window.google={accounts:{oauth2:{
  initTokenClient(cfg){return{requestAccessToken(o){window.__prompts=(window.__prompts||[]).concat(o&&o.prompt);setTimeout(()=>cfg.callback({access_token:'tok',expires_in:3600,scope:'${'https://www.googleapis.com/auth/drive.appdata'}'}),20)}}},
  hasGrantedAllScopes(){return true}, revoke(t,cb){window.__revoked=t;cb&&cb()}}}};`;

async function setup(ctx) {
  await ctx.route('https://accounts.google.com/gsi/client', r => r.fulfill({ contentType: 'text/javascript', body: GIS }));
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await ctx.route('https://www.googleapis.com/**', async (r) => {
    const req = r.request(); const u = new URL(req.url()); const m = req.method();
    drive.calls.push(`${m} ${u.pathname}`);
    if (req.headers()['authorization'] !== 'Bearer tok') return r.fulfill({ status: 401, body: '' });
    if (drive.fail401) return r.fulfill({ status: 401, body: '' });
    if (m === 'GET' && u.pathname === '/drive/v3/files') {
      if (u.searchParams.get('spaces') !== 'appDataFolder') return r.fulfill({ status: 400, body: 'bad space' });
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ files: Object.keys(drive.files).map(id => ({ id })) }) });
    }
    let mm;
    if (m === 'GET' && (mm = u.pathname.match(/^\/drive\/v3\/files\/(\w+)$/))) return r.fulfill({ contentType: 'application/json', body: drive.files[mm[1]] });
    if (m === 'PATCH' && (mm = u.pathname.match(/^\/upload\/drive\/v3\/files\/(\w+)$/))) { drive.files[mm[1]] = req.postData(); return r.fulfill({ contentType: 'application/json', body: '{}' }); }
    if (m === 'POST' && u.pathname === '/upload/drive/v3/files') {
      const body = req.postData(); const parts = body.split(/--tl\w+/);
      const meta = JSON.parse(parts[1].split('\r\n\r\n')[1]);
      if (meta.parents[0] !== 'appDataFolder') throw new Error('wrong parent');
      const id = 'f' + (++drive.n); drive.files[id] = parts[2].split('\r\n\r\n')[1].replace(/\r\n$/, '');
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ id }) });
    }
    r.fulfill({ status: 404, body: 'unhandled' });
  });
}
const book = () => JSON.parse(Object.values(drive.files)[0] || '{"months":{}}');
const allIds = () => Object.values(book().months).flatMap(mo => Object.values(mo).flatMap(d => [...d.strength, ...d.cardio].map(e => e.exercise || e.activity))).sort();
const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };

async function addLift(p, name) {
  await p.locator('button', { hasText: '+ Add' }).first().click();
  await p.getByLabel('Exercise').fill(name); await p.getByLabel('Sets').fill('3'); await p.getByLabel('Reps').fill('5'); await p.getByLabel('Weight (kg)').fill('60');
  await p.getByRole('button', { name: 'Log a set' }).click();
}
const status = p => p.locator('header').innerText();
const waitSynced = p => p.getByText(/^Synced /).waitFor({ timeout: 8000 });

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const A = await b.newContext({ viewport: { width: 420, height: 900 } }); await setup(A);
const B = await b.newContext({ viewport: { width: 420, height: 900 } }); await setup(B);
const pa = await A.newPage(), pb = await B.newPage();
const errs = []; for (const p of [pa, pb]) p.on('pageerror', e => errs.push(e.message));


// Seed ~14 months of training: squats Mon/Thu with rising weight, runs on Sat.
await A.addInitScript(() => {
  if (localStorage.getItem('seeded')) return;
  const pad = (n) => String(n).padStart(2, '0');
  const months = {};
  const start = new Date(2025, 7, 4), end = new Date(2026, 9, 9);
  let i = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const mk = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, day = pad(d.getDate());
    const add = (type, e) => { months[mk] = months[mk] || {}; months[mk][day] = months[mk][day] || { strength: [], cardio: [] }; months[mk][day][type].push({ id: 's' + (i++), ...e }); };
    const wk = Math.floor((d - start) / (7 * 864e5));
    if (d.getDay() === 1 || d.getDay() === 4) {
      add('strength', { exercise: 'Back Squat', sets: '4', reps: d.getDay() === 1 ? '6' : '10', weight: String(d.getDay() === 1 ? 60 + wk : 50 + wk) });
      add('strength', { exercise: 'Leg Press', sets: '3', reps: '12', weight: String(100 + wk * 2) });
    }
    if (d.getDay() === 2) add('strength', { exercise: 'Deficit Push Up', sets: '3', reps: '15', bw: true });
    if (d.getDay() === 6) add('cardio', { activity: 'Run', duration: String(25 + (wk % 10)), distance: '3' });
  }
  for (const [k, v] of Object.entries(months)) localStorage.setItem('fitness-tracker:month:' + k, JSON.stringify(v));
  localStorage.setItem('fitness-tracker:tags', JSON.stringify({ 'Back Squat': { tags: ['legs'], at: 1 }, 'Leg Press': { tags: ['legs'], at: 1 } }));
  localStorage.setItem('fitness-tracker:profile', JSON.stringify({ bodyweight: { weights: [{ date: '2025-08-01', kg: 80 }], at: 1 } }));
  localStorage.setItem('seeded', '1');
});
const ticks = async () => (await pa.locator('svg text').allTextContents());
const scaleOn = async () => pa.locator('[aria-label="Time scale"] button[aria-pressed="true"]').innerText();

await pa.goto('http://localhost:4190/');
await pa.getByRole('button', { name: 'PROGRESS' }).click();
await pa.locator('#progress-pick').waitFor();
check(await pa.locator('#progress-pick').inputValue() === 'exercise:Back Squat', 'defaults to the most-logged exercise');
const opts = await pa.locator('#progress-pick option').allTextContents();
check(opts.includes('#legs (248)') && opts.some(o => o.startsWith('Run (')), 'tags and exercises offered: ' + opts.slice(0, 4).join(' | '));
const metrics = await pa.locator('[aria-label="Measure"] button').allTextContents();
check(metrics.join(',') === 'Weight & reps,Best weight,Est. 1-rep max,Volume,Reps,Sets', 'exercise metrics: ' + metrics.join(','));
// weight & reps (default): two axes, four lines, legend, readout, table
let wt = await pa.locator('body').innerText();
check(wt.includes('Max weight (kg, left)') && wt.includes('Min weight') && wt.includes('Max reps (right)') && wt.includes('Min reps'), 'legend names all four lines');
const svgText = await pa.locator('svg text').allTextContents();
check(svgText.includes('kg') && svgText.includes('reps'), 'left kg axis and right reps axis');
check((await pa.locator('svg g[opacity="0.38"]').count()) === 2 && (await pa.locator('svg g[opacity="1"] path').count()) === 2, 'two solid max lines and two faint min lines');
check(/Heaviest in view\n\d+ kg/.test(wt) && /Most reps in a set\n\d+/.test(wt), 'weight & reps tiles');
const bx = await pa.locator('[role="img"]').boundingBox();
await pa.mouse.click(bx.x + bx.width - 60, bx.y + 120);
const tipDual = (await pa.locator('[role="status"]').allInnerTexts()).join(' ');
check(/kg max weight/.test(tipDual) && /kg min weight/.test(tipDual) && /reps max reps/.test(tipDual) && /reps min reps/.test(tipDual), 'tap shows all four values: ' + tipDual.replace(/\n/g, ' ').slice(0, 120));
await pa.screenshot({ path: 'prog-weightreps.png' });
await pa.getByText(/^Table of values in view/).click();
check((await pa.locator('table thead').innerText()).replace(/\s+/g, ' ').includes('Max kg Min kg Max reps Min reps'), 'table has the four columns');
await pa.getByText(/^Table of values in view/).click();
await pa.getByRole('button', { name: 'Best weight' }).click();
check(await scaleOn() === 'Weekly', 'starts weekly');
let t = await pa.locator('body').innerText();
check(/Best week in view\n\d+ kg/.test(t), 'stat tiles shown');
await pa.screenshot({ path: 'prog-weekly.png' });

// scale buttons
await pa.getByRole('button', { name: 'Daily' }).click();
check(await scaleOn() === 'Daily', 'Daily button');
const dayTicks = await ticks();
await pa.getByRole('button', { name: 'Monthly' }).click();
check(await scaleOn() === 'Monthly', 'Monthly button');
check((await ticks()).some(x => /^(Jan 2026|Sep|Oct)$/.test(x)), 'monthly labels: ' + (await ticks()).filter(x => /[A-Z]/.test(x)).join(','));
await pa.screenshot({ path: 'prog-monthly.png' });
await pa.getByRole('button', { name: 'Yearly' }).click();
await pa.screenshot({ path: 'prog-yearly.png' });
check(await scaleOn() === 'Yearly' && (await ticks()).includes('2025') && (await ticks()).includes('2026'), 'Yearly button: ' + (await ticks()).join(','));

// zoom in with buttons from yearly crosses into finer scales
for (let k = 0; k < 6; k++) await pa.getByRole('button', { name: 'Zoom in' }).click();
check(['Monthly', 'Weekly'].includes(await scaleOn()), 'zooming in switches to finer scale: ' + await scaleOn());

// ctrl+wheel (trackpad pinch) zooms
await pa.getByRole('button', { name: 'Weekly' }).click();
const box = await pa.locator('[role="img"]').boundingBox();
await pa.mouse.move(box.x + box.width / 2, box.y + 100);
await pa.keyboard.down('Control');
for (let k = 0; k < 8; k++) await pa.mouse.wheel(0, -40);
await pa.keyboard.up('Control');
check(await scaleOn() === 'Daily', 'ctrl+wheel pinch zooms to daily: ' + await scaleOn());

// drag pans back in time
const before = (await ticks()).filter(x => /[A-Z]/.test(x)).join(',');
await pa.mouse.move(box.x + 300, box.y + 100); await pa.mouse.down(); await pa.mouse.move(box.x + 80, box.y + 100, { steps: 8 }); await pa.mouse.up();
let after = (await ticks()).filter(x => /[A-Z]/.test(x)).join(',');
if (after === before) { await pa.mouse.move(box.x + 80, box.y + 100); await pa.mouse.down(); await pa.mouse.move(box.x + 300, box.y + 100, { steps: 8 }); await pa.mouse.up(); after = (await ticks()).filter(x => /[A-Z]/.test(x)).join(','); }
check(before !== after, `drag moves the time axis (${before.slice(0, 20)} -> ${after.slice(0, 20)})`);

// two-finger pinch out (zoom out) with touch pointers
await pa.getByRole('button', { name: 'Daily' }).click();
await pa.locator('[role="img"]').evaluate((el) => {
  const r = el.getBoundingClientRect(), y = r.top + 100, cx = r.left + r.width / 2;
  const ev = (type, id, x) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: id === 1 }));
  ev('pointerdown', 1, cx - 100); ev('pointerdown', 2, cx + 100);
  for (let k = 1; k <= 10; k++) { ev('pointermove', 1, cx - 100 + k * 8); ev('pointermove', 2, cx + 100 - k * 8); }
  ev('pointerup', 1, cx - 20); ev('pointerup', 2, cx + 20);
});
check(['Weekly', 'Monthly'].includes(await scaleOn()), 'pinch in with two fingers zooms out: ' + await scaleOn());

// tap shows a value
await pa.getByRole('button', { name: 'Weekly' }).click();
await pa.mouse.click(box.x + box.width - 30, box.y + 120);
const tip = await pa.locator('[role="status"]').allInnerTexts();
check(tip.some(x => /kg/.test(x) && /Week of/.test(x)), 'tap shows tooltip: ' + tip.join(' / ').replace(/\n/g, ' '));

// table view
await pa.getByRole('button', { name: 'Yearly' }).click(); await pa.getByRole('button', { name: 'Weekly' }).click();
await pa.getByText(/^Table of values in view/).click();
check(await pa.locator('table tbody tr').count() > 10, 'table lists values in view');

// volume uses body weight; tag selection; cardio
await pa.locator('#progress-pick').selectOption('exercise:Deficit Push Up');
await pa.getByRole('button', { name: 'Volume' }).click();
await pa.getByText(/^Table of values in view/).click();
t = await pa.locator('table tbody').innerText();
check(/3,600/.test(t), 'body-weight volume: 3x15x80 = 3,600 per week');
const vt = await pa.locator('body').innerText();
check(vt.includes('based on max weight: sets × reps × max weight') && vt.includes('(max-weight volume)'), 'volume says it is based on max weight');
await pa.screenshot({ path: 'prog-volume.png' });
await pa.locator('#progress-pick').selectOption('tag:legs');
const tm = await pa.locator('[aria-label="Measure"] button').allTextContents();
check(tm.join(',') === 'Volume,Reps,Sets', 'tag metrics (no best weight across exercises): ' + tm.join(','));
await pa.screenshot({ path: 'prog-tag.png' });
await pa.locator('#progress-pick').selectOption('exercise:Run');
check((await pa.locator('[aria-label="Measure"] button').allTextContents()).join(',') === 'Minutes,Distance', 'cardio metrics');
// selection remembered
await pa.reload(); await pa.getByRole('button', { name: 'PROGRESS' }).click(); await pa.locator('#progress-pick').waitFor();
check(await pa.locator('#progress-pick').inputValue() === 'exercise:Run', 'selection remembered after reload');
// new log shows up
await pa.getByRole('button', { name: 'LOG', exact: true }).click();
await pa.locator('.ft-section').last().locator('button', { hasText: '+ Add' }).click();
await pa.getByLabel('Activity').fill('Run'); await pa.getByLabel('Minutes').fill('90');
await pa.getByRole('button', { name: 'Log a session' }).click();
await pa.getByRole('button', { name: 'PROGRESS' }).click(); await pa.getByRole('button', { name: 'Daily' }).click();
await pa.getByText(/^Table of values in view/).click();
check((await pa.locator('table tbody tr').first().innerText()).includes('90'), 'newly logged session appears');
check(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
await b.close(); srv.close();
