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


const grid = (p) => p.locator('#month-calendar');
await pa.goto('http://localhost:4190/'); await pa.getByText('STRENGTH').waitFor();
check(!(await grid(pa).isVisible()), 'calendar folded into a button at first');
await pa.screenshot({ path: 'cal-folded.png' });
const toggle = pa.getByRole('button', { name: /Calendar/ });
await toggle.hover();
check(await grid(pa).isVisible(), 'hovering opens it');
await pa.mouse.move(5, 5);
check(!(await grid(pa).isVisible()), 'moving away folds it');
// hover, then click a day: picks it and folds
await toggle.hover();
await grid(pa).getByRole('button', { name: /^3/ }).first().click();
check((await pa.locator('body').innerText()).includes('SAT 3 OCT'), 'clicking a day selects it');
await pa.mouse.move(5, 5);
check(!(await grid(pa).isVisible()), 'and the calendar folds');
// same on the food tab
await pa.getByRole('button', { name: 'FOOD', exact: true }).click();
check(!(await grid(pa).isVisible()) && (await pa.getByRole('button', { name: /Calendar/ }).count()) === 1, 'food tab has the folded calendar too');

// phone: tap to open, tap a day to close
const M = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); await setup(M);
const pm = await M.newPage(); pm.on('pageerror', (e) => errs.push(e.message));
await pm.goto('http://localhost:4190/'); await pm.getByText('STRENGTH').waitFor();
check(!(await grid(pm).isVisible()), 'phone: folded at first');
await pm.getByRole('button', { name: /Calendar/ }).tap();
check(await grid(pm).isVisible(), 'phone: tap opens it');
await pm.screenshot({ path: 'cal-open.png' });
await grid(pm).getByRole('button', { name: /^5/ }).first().tap();
check(!(await grid(pm).isVisible()) && (await pm.locator('body').innerText()).includes('MON 5 OCT'), 'phone: tapping a day selects it and folds');
await pm.getByRole('button', { name: /Calendar/ }).tap(); await pm.getByRole('button', { name: /Calendar/ }).tap();
check(!(await grid(pm).isVisible()), 'phone: tapping the button again folds it');
check(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
await b.close(); srv.close();
