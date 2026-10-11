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

// Device A: log, then connect
await pa.goto('http://localhost:4190/'); await pa.getByText('Connect Google Drive').waitFor();
await addLift(pa, 'Device A squat');
await pa.getByText('Connect Google Drive').click(); await waitSynced(pa);
check(JSON.stringify(allIds()) === '["Device A squat"]', 'A connect uploads existing entry to appDataFolder: ' + JSON.stringify(allIds()));
check((await pa.evaluate(() => window.__prompts)).join() === 'consent', 'first connect asks for consent');
await pa.screenshot({ path: 'e2e-a-synced.png' });

// A logs another -> auto sync
await addLift(pa, 'Device A bench'); await pa.waitForTimeout(2500); await waitSynced(pa);
check(allIds().includes('Device A bench'), 'new entry auto-syncs after logging');

// Device B has its own local entry, then connects -> merge
await pb.goto('http://localhost:4190/'); await pb.getByText('Connect Google Drive').waitFor();
await addLift(pb, 'Device B deadlift');
await pb.getByText('Connect Google Drive').click(); await waitSynced(pb);
const bText = await pb.locator('body').innerText();
check(bText.includes('Device A squat') && bText.includes('Device B deadlift'), 'B shows merged entries on screen');
check(JSON.stringify(allIds()) === '["Device A bench","Device A squat","Device B deadlift"]', 'Drive holds union: ' + JSON.stringify(allIds()));
check(Object.keys(drive.files).length === 1, 'still a single Drive file');

// B deletes A's squat -> sync; A taps sync -> squat gone, B's entry appears
const row = pb.locator('div', { hasText: /^Device A squat/ }).last();
await pb.locator('div:has(> span:text-is("Device A squat"))').getByRole('button', { name: 'Delete entry' }).click();
check(!(await pb.locator('body').innerText()).includes('Device A squat') && (await pb.locator('body').innerText()).includes('Device A bench'), 'B deleted exactly the squat');
await pb.waitForTimeout(2500); await waitSynced(pb);
check(!allIds().includes('Device A squat'), 'deletion syncs to Drive');
await pa.getByText(/^Synced /).click(); await pa.waitForTimeout(300); await waitSynced(pa);
const aText = await pa.locator('body').innerText();
check(!aText.includes('Device A squat') && aText.includes('Device B deadlift'), 'A picks up B\'s delete and addition without reload');

// reload A: deleted entry must not come back, state needs re-auth
await pa.reload(); await pa.getByText('Tap to sync with Drive').waitFor();
check(!(await pa.locator('body').innerText()).includes('Device A squat'), 'deleted entry stays deleted after reload');
check(true, 'after reload shows "Tap to sync with Drive"');
await pa.getByText('Tap to sync with Drive').click(); await waitSynced(pa);
check((await pa.evaluate(() => window.__prompts)).join() === '', 'reconnect skips consent screen');

// expired token -> needs-auth
drive.fail401 = true; await addLift(pa, 'Offline curl'); await pa.getByText('Tap to sync with Drive').waitFor({ timeout: 8000 });
check(true, '401 from Drive -> "Tap to sync with Drive"');
check((await pa.locator('body').innerText()).includes('Offline curl'), 'entry kept locally while Drive unreachable');
drive.fail401 = false; await pa.getByText('Tap to sync with Drive').click(); await waitSynced(pa);
check(allIds().includes('Offline curl'), 'pending entry uploads after re-sign-in');

// disconnect
await pa.getByText('Disconnect').click(); await pa.getByText('Connect Google Drive').waitFor();
check((await pa.locator('body').innerText()).includes('Offline curl'), 'disconnect keeps local data');
await pa.reload(); await pa.getByText('Connect Google Drive').waitFor();
check(true, 'disconnect persists across reload');
await pb.screenshot({ path: 'e2e-b.png' });
check(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
await b.close(); srv.close();
