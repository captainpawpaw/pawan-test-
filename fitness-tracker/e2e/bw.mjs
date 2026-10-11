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


await pa.goto('http://localhost:4190/'); await pa.getByText('STRENGTH').waitFor(); await pa.waitForTimeout(500);
const strengthCard = pa.locator('.ft-section').first();
await strengthCard.locator('button', { hasText: '+ Add' }).click();
check(await pa.getByRole('button', { name: 'kg', exact: true }).getAttribute('aria-pressed') === 'true', 'kg selected by default');
// manual kg set
await pa.getByLabel('Exercise').fill('Back Squat'); await pa.getByLabel('Sets').fill('3'); await pa.getByLabel('Reps').fill('5'); await pa.getByLabel('Weight (kg)').fill('100');
await pa.getByRole('button', { name: 'Log a set' }).click();
// body-weight exercise auto-switches
await strengthCard.locator('button', { hasText: '+ Add' }).click();
await pa.getByLabel('Exercise').fill('deficit push');
await pa.getByRole('option', { name: /Deficit Push Up/ }).click();
check(await pa.getByRole('button', { name: 'Body weight', exact: true }).getAttribute('aria-pressed') === 'true', 'body-weight exercise switches to Body weight');
check(await pa.getByLabel('Added weight (kg), optional').count() === 1, 'weight box becomes optional added weight');
await pa.screenshot({ path: 'bw-form.png' });
await pa.getByLabel('Sets').fill('3'); await pa.getByLabel('Reps').fill('12');
await pa.getByRole('button', { name: 'Log a set' }).click();
// weighted body-weight set
await strengthCard.locator('button', { hasText: '+ Add' }).click();
await pa.getByLabel('Exercise').fill('Weighted Dip');
await pa.getByRole('button', { name: 'Body weight', exact: true }).click();
await pa.getByLabel('Sets').fill('3'); await pa.getByLabel('Reps').fill('8'); await pa.getByLabel('Added weight (kg), optional').fill('10');
await pa.getByRole('button', { name: 'Log a set' }).click();
let t = await strengthCard.innerText();
check(t.includes('3×5 · max 100kg'), 'kg set shown');
check(t.includes('3×12 · BW'), 'body-weight set shown as BW');
check(t.includes('3×8 · max BW + 10kg'), 'weighted body-weight set shown');
check(t.includes('Volume: 1,740 kg · 60 body-weight reps not counted'), 'footer before body weight: ' + t.split('\n').find(l => l.includes('Volume')));
check(t.includes('Add your body weight to count body-weight sets.'), 'prompt to set body weight');
await strengthCard.getByRole('button', { name: 'Set body weight' }).click();
await pa.getByLabel('Your body weight (kg)').fill('5');
await strengthCard.getByRole('button', { name: 'Save' }).click();
check((await strengthCard.innerText()).includes('Enter your body weight in kg'), 'rejects an impossible weight');
await pa.getByLabel('Your body weight (kg)').fill('80');
await pa.screenshot({ path: 'bw-set.png' });
await strengthCard.getByRole('button', { name: 'Save' }).click();
t = await strengthCard.innerText();
// 3x5x100 + 3x12x80 + 3x8x(80+10)
check(t.includes('Volume: 6,540 kg') && t.includes('Body weight 80 kg included'), 'volume counts body weight: ' + t.split('\n').find(l => l.includes('Volume')));
await strengthCard.getByRole('button', { name: 'Change' }).click();
await pa.getByLabel('Your body weight (kg)').fill('78.5');
await strengthCard.getByRole('button', { name: 'Save' }).click();
t = await strengthCard.innerText();
check(t.includes('Volume: 6,450 kg') && t.includes('Body weight 78.5 kg included'), 'changing weight updates volume: ' + t.split('\n').find(l => l.includes('Volume')));
await strengthCard.locator('button', { hasText: '+ Add' }).click();
await pa.getByRole('button', { name: 'Body weight', exact: true }).click();
await pa.getByLabel('Added weight (kg), optional').fill('5');
check((await strengthCard.innerText()).includes('Counts as 78.5 kg body weight + 5 kg.'), 'form hint shows body weight');
await pa.screenshot({ path: 'bw-hint.png' });
await pa.locator('button', { hasText: 'Cancel' }).first().click();
// switching back to kg for a body-only exercise
await strengthCard.locator('button', { hasText: '+ Add' }).click();
await pa.getByLabel('Exercise').fill('deficit push');
await pa.getByRole('option', { name: /Deficit Push Up/ }).click();
await pa.getByRole('button', { name: 'kg', exact: true }).click();
check(await pa.getByLabel('Weight (kg)').count() === 1, 'can switch back to kg');
await pa.locator('button', { hasText: 'Cancel' }).first().click();
await pa.reload(); await pa.getByText('STRENGTH').waitFor();
t = await pa.locator('.ft-section').first().innerText();
check(t.includes('3×12 · BW') && t.includes('max BW + 10kg'), 'body-weight sets persist after reload');
check(t.includes('Body weight 78.5 kg included'), 'body weight persists after reload');
await pa.getByText('Connect Google Drive').click(); await waitSynced(pa);
check(book().profile?.bodyweight?.weights?.[0]?.kg === 78.5, 'body weight syncs to Drive');
await pb.goto('http://localhost:4190/'); await pb.getByText('Connect Google Drive').click(); await waitSynced(pb);
check((await pb.locator('.ft-section').first().innerText()).includes('Volume: 6,450 kg'), 'other device uses the synced body weight');
await pa.screenshot({ path: 'bw-list.png' });
check(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
await b.close(); srv.close();
