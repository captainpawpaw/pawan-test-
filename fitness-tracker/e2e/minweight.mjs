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
  await p.getByLabel('Exercise').fill(name); await p.getByLabel('Sets').fill('3'); await p.getByLabel('Reps').fill('5'); await p.getByLabel('Max weight (kg)').fill('60');
  await p.getByRole('button', { name: 'Log a set' }).click();
}
const status = p => p.locator('header').innerText();
const waitSynced = p => p.getByText(/^Synced /).waitFor({ timeout: 8000 });

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const A = await b.newContext({ viewport: { width: 420, height: 900 } }); await setup(A);
const B = await b.newContext({ viewport: { width: 420, height: 900 } }); await setup(B);
const pa = await A.newPage(), pb = await B.newPage();
const errs = []; for (const p of [pa, pb]) p.on('pageerror', e => errs.push(e.message));


await pa.goto('http://localhost:4190/'); await pa.getByText('STRENGTH').waitFor();
const strength = pa.locator('.ft-section').first();
const foot = async () => ((await strength.innerText()).match(/Volume \(sets × reps × max weight\): [\d,.]+ kg/) || [''])[0];
async function logSet(name, sets, reps, max, min) {
  await strength.locator('button', { hasText: '+ Add' }).click();
  await pa.getByLabel('Exercise').fill(name); await pa.getByLabel('Sets').fill(sets); await pa.getByLabel('Reps').fill(reps);
  await pa.getByLabel('Max weight (kg)').fill(max);
  if (min != null) await pa.getByLabel('Min weight (kg), optional').fill(min);
  await pa.getByRole('button', { name: 'Log a set' }).click();
}
await strength.locator('button', { hasText: '+ Add' }).click();
check(await pa.getByLabel('Min weight (kg), optional').count() === 1, 'form has a min weight box');
await pa.screenshot({ path: 'min-weight-form.png' });
await strength.locator('button', { hasText: 'Cancel' }).click();

await logSet('Bench Press', '4', '10', '60', '40');
let t = await strength.innerText();
check(t.includes('4×10 · 40–60kg'), 'row shows the weight range');
check((await foot()).endsWith(' 2,400 kg'), 'volume uses max weight (4×10×60): ' + await foot());
await logSet('Back Squat', '2', '5', '100');
check((await strength.innerText()).includes('2×5 · max 100kg') && (await foot()).endsWith(' 3,400 kg'), 'no min: counts at max weight (2,400 + 2×5×100): ' + await foot());
await logSet('Leg Press', '1', '10', '50', '90');
check((await strength.innerText()).includes('1×10 · 50–90kg'), 'min above max gets swapped');
// edit keeps and changes the min
await strength.getByRole('button', { name: 'Edit Bench Press' }).click();
check(await pa.getByLabel('Min weight (kg), optional').inputValue() === '40', 'edit form shows the min weight');
await pa.getByLabel('Min weight (kg), optional').fill('50');
await pa.getByRole('button', { name: 'Save changes' }).click();
check((await strength.innerText()).includes('4×10 · 50–60kg'), 'min weight edited');
// clearing the min falls back to max
await strength.getByRole('button', { name: 'Edit Bench Press' }).click();
await pa.getByLabel('Min weight (kg), optional').fill('');
await pa.getByRole('button', { name: 'Save changes' }).click();
check((await strength.innerText()).includes('4×10 · max 60kg'), 'clearing min shows max only');
// body weight with added range
await strength.locator('button', { hasText: '+ Add' }).click();
await pa.getByLabel('Exercise').fill('Weighted Dip'); await pa.getByRole('button', { name: 'Body weight', exact: true }).click();
check(await pa.getByLabel('Min added weight (kg), optional').count() === 1, 'body weight: min box is for added weight');
await pa.getByLabel('Sets').fill('3'); await pa.getByLabel('Reps').fill('8');
await pa.getByLabel('Max added weight (kg), optional').fill('10'); await pa.getByLabel('Min added weight (kg), optional').fill('5');
await pa.getByRole('button', { name: 'Log a set' }).click();
check((await strength.innerText()).includes('3×8 · BW + 5–10kg'), 'body weight range shown');
// progress: min line uses the min weight
await logSet('Bench Press', '3', '8', '70', '45');
await pa.getByRole('button', { name: 'PROGRESS' }).click();
await pa.locator('#progress-pick').selectOption('exercise:Bench Press');
await pa.getByRole('button', { name: 'Weight & reps' }).click();
await pa.getByRole('button', { name: 'Daily' }).click();
await pa.getByText(/^Table of values in view/).click();
const row = (await pa.locator('table tbody tr').first().innerText()).replace(/\s+/g, ' ');
check(/70 45 10 8/.test(row), 'weight & reps min weight comes from the logged min: ' + row);
await pa.getByRole('button', { name: 'Volume' }).click();
check((await pa.locator('body').innerText()).includes('sets × reps × max weight'), 'progress volume says max weight');
await pa.screenshot({ path: 'min-weight-progress.png' });
check(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
await b.close(); srv.close();
