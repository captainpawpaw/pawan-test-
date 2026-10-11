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


await pa.goto('http://localhost:4190/'); await pa.getByText('STRENGTH').waitFor();
const strength = pa.locator('.ft-section').first();
const cardio = pa.locator('.ft-section').last();
async function logSet(name, sets, reps, kg) {
  await strength.locator('button', { hasText: '+ Add' }).click();
  await pa.getByLabel('Exercise').fill(name); await pa.getByLabel('Sets').fill(sets); await pa.getByLabel('Reps').fill(reps); await pa.getByLabel('Max weight (kg)').fill(kg);
  await pa.getByRole('button', { name: 'Log a set' }).click();
}
await logSet('Back Squat', '3', '5', '100');
await logSet('Leg Press', '4', '10', '120');
await pa.getByText('Connect Google Drive').click(); await waitSynced(pa);

// edit the squat
await strength.getByRole('button', { name: 'Edit Back Squat' }).click();
check(await pa.getByLabel('Exercise').inputValue() === 'Back Squat' && await pa.getByLabel('Max weight (kg)').inputValue() === '100', 'edit opens the form filled in');
check((await strength.innerText()).includes('Editing an entry'), 'form says it is editing');
await pa.screenshot({ path: 'edit-set.png' });
await pa.getByLabel('Max weight (kg)').fill('105'); await pa.getByLabel('Reps').fill('6');
await pa.getByRole('button', { name: 'Save changes' }).click();
let t = await strength.innerText();
check(t.includes('3×6 · max 105kg') && !t.includes('3×5 · max 100kg'), 'set updated in place');
check(t.indexOf('Back Squat') < t.indexOf('Leg Press'), 'keeps its place in the list');
check(t.includes('Volume: 6,690 kg'), 'volume recalculated: ' + (t.match(/Volume: [\d,]+ kg/) || [''])[0]);
// cancel leaves it alone
await strength.getByRole('button', { name: 'Edit Leg Press' }).click();
await pa.getByLabel('Reps').fill('99');
await strength.locator('button', { hasText: 'Cancel' }).click();
check((await strength.innerText()).includes('4×10 · max 120kg'), 'cancel keeps the original');
// switching to body weight while editing
await strength.getByRole('button', { name: 'Edit Leg Press' }).click();
await pa.getByLabel('Exercise').fill('Weighted Dip'); await pa.getByRole('button', { name: 'Body weight', exact: true }).click();
await pa.getByLabel('Added weight (kg), optional').fill('10');
await pa.getByRole('button', { name: 'Save changes' }).click();
check((await strength.innerText()).includes('Weighted Dip') && (await strength.innerText()).includes('4×10 · max BW + 10kg'), 'can change exercise and switch to body weight');

// cardio
await cardio.locator('button', { hasText: '+ Add' }).click();
await pa.getByLabel('Activity').fill('Run'); await pa.getByLabel('Minutes').fill('30');
await pa.getByRole('button', { name: 'Log a session' }).click();
await cardio.getByRole('button', { name: 'Edit Run' }).click();
await pa.getByLabel('Minutes').fill('42');
await pa.getByRole('button', { name: 'Save changes' }).click();
check((await cardio.innerText()).includes('42 min') && !(await cardio.innerText()).includes('30 min'), 'cardio session edited');

// the edit reaches another device, without the old version coming back
await pa.waitForTimeout(2500); await waitSynced(pa);
await pb.goto('http://localhost:4190/'); await pb.getByText('Connect Google Drive').click(); await waitSynced(pb);
t = await pb.locator('body').innerText();
check(t.includes('3×6 · max 105kg') && !t.includes('max 100kg') && t.includes('42 min') && !t.includes('30 min') && !t.includes('Leg Press'), 'other device gets the edits, not the old versions');
// survives a further sync back
await pa.getByText(/^Synced /).click(); await pa.waitForTimeout(500); await waitSynced(pa);
t = await strength.innerText();
check((t.match(/Back Squat/g) || []).length === 1 && !t.includes('max 100kg'), 'no duplicates after syncing both ways');

// food
await pa.getByRole('button', { name: 'FOOD', exact: true }).click();
await pa.getByRole('button', { name: '+ Add' }).last().click();
await pa.getByLabel('Search foods').fill('banana raw');
await pa.getByRole('button', { name: /^Bananas, raw/ }).first().click();
await pa.getByLabel('Amount').fill('100');
await pa.getByRole('button', { name: 'Add to day' }).click();
await pa.getByRole('button', { name: 'Enter manually' }).click();
await pa.getByLabel('Name').fill('Protein bar'); await pa.getByRole('spinbutton', { name: 'Calories' }).fill('200'); await pa.getByLabel('Protein (g)').fill('20');
await pa.getByRole('button', { name: 'Add to day' }).click();
await pa.getByRole('button', { name: 'Done adding' }).click();
await pa.getByRole('button', { name: 'Edit Bananas, raw' }).click();
await pa.getByLabel('Amount').fill('150');
check((await pa.locator('form[aria-label="Edit Bananas, raw"]').innerText()).includes('134 kcal'), 'food edit previews rescaled nutrients');
await pa.screenshot({ path: 'edit-food.png' });
await pa.getByRole('button', { name: 'Save changes' }).click();
t = await pa.locator('body').innerText();
check(t.includes('150 g') && t.includes('134 kcal'), 'food amount edited');
await pa.getByRole('button', { name: 'Edit Protein bar' }).click();
await pa.locator('form[aria-label="Edit Protein bar"]').getByLabel('Calories').fill('230');
await pa.locator('form[aria-label="Edit Protein bar"]').getByLabel('Name').fill('Protein bar (choc)');
await pa.getByRole('button', { name: 'Save changes' }).click();
t = await pa.locator('body').innerText();
check(t.includes('Protein bar (choc)') && t.includes('230 kcal') && /364\s*kcal/.test(t), 'manual food numbers and name edited, totals updated');
await pa.reload(); await pa.getByRole('button', { name: 'FOOD', exact: true }).click();
check((await pa.locator('body').innerText()).includes('Protein bar (choc)'), 'food edits persist after reload');
check(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
await b.close(); srv.close();
