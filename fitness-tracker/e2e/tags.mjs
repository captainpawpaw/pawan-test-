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


const ex = (p) => p.getByRole('button', { name: 'EXERCISES' }).click();
const search = (p) => p.getByLabel('Search exercises');
async function tag(p, name, tags) {
  await search(p).fill(name);
  await p.getByRole('button', { name: `Tag ${name}`, exact: true }).click();
  for (const t of tags) { await p.getByLabel(`New tag for ${name}`).fill(t); await p.getByLabel(`New tag for ${name}`).press('Enter'); }
  await p.getByRole('button', { name: 'Done' }).click();
}
const listNames = (p) => p.locator('[style*="flex-direction: column"] > div span').evaluateAll(() => 0);
const visible = async (p) => (await p.locator('body').innerText());

await pa.goto('http://localhost:4190/'); await ex(pa);
await pa.getByText('3/4 Sit-Up').waitFor();
await tag(pa, 'Back Squat', ['Legs Day', '#monday']);
await tag(pa, 'Romanian Deadlift', ['legs day']);
await search(pa).fill('');
let t = await visible(pa);
check(t.includes('#legs day 2') && t.includes('#monday 1'), 'tag filter row shows tags with counts (normalised)');
await pa.getByRole('button', { name: /#legs day/ }).first().click();
t = await visible(pa);
check(t.includes('Back Squat') && t.includes('Romanian Deadlift') && !t.includes('3/4 Sit-Up'), 'tapping a tag filters the list to tagged exercises');
await pa.screenshot({ path: 'tags-filter.png' });
await pa.getByRole('button', { name: /#legs day/ }).first().click();
await search(pa).fill('#monday');
t = await visible(pa);
check(t.includes('Back Squat') && !t.includes('Romanian Deadlift'), 'search matches tags');
await search(pa).fill('Back Squat');
await pa.getByRole('button', { name: 'Tag Back Squat', exact: true }).click();
await pa.screenshot({ path: 'tags-edit.png' });
await pa.getByRole('button', { name: 'Remove tag monday' }).click();
await pa.getByRole('button', { name: 'Done' }).click();
await search(pa).fill('');
t = await visible(pa);
check(!t.includes('#monday'), 'removing the last use of a tag drops it from the filter row');
await pa.reload(); await ex(pa); await pa.getByText('3/4 Sit-Up').waitFor();
check((await visible(pa)).includes('#legs day 2'), 'tags persist after reload');

// sync tags via Drive to B
await pa.getByText('Connect Google Drive').click(); await waitSynced(pa);
check(JSON.stringify(book().tags['Back Squat'].tags) === '["legs day"]', 'tags uploaded to Drive');
await pb.goto('http://localhost:4190/'); await pb.getByText('Connect Google Drive').click(); await waitSynced(pb);
await ex(pb); await pb.getByText('3/4 Sit-Up').waitFor();
check((await visible(pb)).includes('#legs day 2'), 'B receives tags from Drive');
await tag(pb, 'Rower', ['cardio warmup']); await pb.waitForTimeout(2500); await waitSynced(pb);
await pa.getByText(/^Synced /).click(); await pa.waitForTimeout(300); await waitSynced(pa);
check((await visible(pa)).includes('#cardio warmup'), 'A picks up B\'s new tag without reload');
check(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
await b.close(); srv.close();
