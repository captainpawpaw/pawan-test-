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
await A.route('https://*.openfoodfacts.org/**', r => r.fulfill({ status: 404, body: '{}' }));
const p = await A.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
const offline = () => p.getByRole('status').filter({ hasText: "You're offline" });

// first visit online: the offline worker installs and stores the app
await p.goto('http://localhost:4190/?tab=log'); await p.getByText('STRENGTH', { exact: true }).waitFor();
await p.evaluate(async () => { await navigator.serviceWorker.ready; for (let i = 0; i < 50 && !navigator.serviceWorker.controller; i++) await new Promise(r => setTimeout(r, 100)); });
check(await p.evaluate(() => Boolean(navigator.serviceWorker.controller)), 'the offline worker is running');
const cached = await p.evaluate(async () => { const ks = await caches.keys(); const c = await caches.open(ks.find(k => k.startsWith('ledger-') && k !== 'ledger-runtime')); return (await c.keys()).map(r => new URL(r.url).pathname); });
check(['/', '/foods.json', '/foods-uk.json', '/exercises.json'].every(x => cached.includes(x)) && cached.some(x => x.startsWith('/assets/')), 'the app, exercises and food lists are stored: ' + cached.length + ' files');
check(await offline().count() === 0, 'no offline note while online');
await p.getByText('Connect Google Drive').click(); await waitSynced(p);

// no signal: the app still opens and works
await A.setOffline(true);
await p.reload(); await p.getByText('STRENGTH', { exact: true }).waitFor();
check(await offline().count() === 1 && (await offline().innerText()).includes('saved on this phone and syncs when you\'re back online'), 'opens offline, with a note');
check(await p.getByText('Your log may be out of date').count() === 0 && await p.getByText(/^Offline · changes will sync/).count() === 1, 'no "tap to sync" prompt while offline; the cloud says it will sync later');
await p.screenshot({ path: 'offline-log.png' });
await addLift(p, 'Offline squat');
check((await p.locator('body').innerText()).includes('Offline squat'), 'logging works offline');
await p.waitForTimeout(2500);
check(await p.getByText(/^Offline · changes will sync/).count() === 1, 'the sync cloud says it will sync when back online');
check(!allIds().includes('Offline squat'), 'nothing sent while offline');
await p.reload(); await p.getByText('STRENGTH', { exact: true }).waitFor();
check((await p.locator('body').innerText()).includes('Offline squat'), 'still there after reopening offline');
// food offline: built-in lists work, online extras say so
await p.getByRole('button', { name: 'FOOD', exact: true }).click();
await p.getByRole('button', { name: '+ Add to Lunch' }).click();
await p.getByLabel('Search foods').fill('banana');
await p.getByText(/Foods \(UK CoFID and USDA\)/i).waitFor({ timeout: 8000 });
check(await p.getByRole('button', { name: /^Bananas?/ }).count() > 0, 'food search works offline');
check(await p.getByRole('button', { name: 'Branded search needs a connection' }).isDisabled(), 'branded search says it needs a connection');
await p.getByLabel('Or type a barcode').fill('5000159484695'); await p.getByRole('button', { name: 'Look up' }).click();
check((await p.locator('body').innerText()).includes("isn't in My foods. Looking up new ones needs a connection"), 'barcode look-up explains it needs a connection');
await p.screenshot({ path: 'offline-food.png' });
// back online: the note goes and the log syncs
await A.setOffline(false);
await p.waitForTimeout(300);
check(await offline().count() === 0, 'the note goes when back online');
await p.getByText('Tap to sync with Drive').click(); // reopened offline, so Google asks again once back online
await waitSynced(p);
check(allIds().includes('Offline squat'), 'the offline set syncs to Drive once back online');
check(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
await b.close(); srv.close();
