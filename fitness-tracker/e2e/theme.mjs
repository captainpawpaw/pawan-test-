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
const waitSynced = p => p.getByText(/^Synced /).waitFor({ timeout: 8000 });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const A = await b.newContext({ viewport: { width: 420, height: 900 } }); await setup(A);
const B = await b.newContext({ viewport: { width: 420, height: 900 } }); await setup(B);
const pa = await A.newPage(), pb = await B.newPage();
const errs = []; for (const p of [pa, pb]) p.on('pageerror', e => errs.push(e.message));
await A.addInitScript(() => {
  if (localStorage.getItem('seeded')) return;
  const pad = (n) => String(n).padStart(2, '0');
  const months = {}; let i = 0;
  const start = new Date(2026, 6, 6), end = new Date();
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const mk = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, day = pad(d.getDate());
    const add = (type, e) => { months[mk] = months[mk] || {}; months[mk][day] = months[mk][day] || { strength: [], cardio: [] }; months[mk][day][type].push({ id: 's' + (i++), ...e }); };
    const wk = Math.floor((d - start) / (7 * 864e5));
    if (d.getDay() === 1 || d.getDay() === 4) add('strength', { exercise: 'Back Squat', sets: '4', reps: '6', weight: String(80 + wk * 2) });
    if (d.getDay() === 6) add('cardio', { activity: 'Run', duration: '30', distance: '5' });
  }
  for (const [k, v] of Object.entries(months)) localStorage.setItem('fitness-tracker:month:' + k, JSON.stringify(v));
  localStorage.setItem('seeded', '1');
});
const pickTheme = async (p, name) => { await p.getByRole('button', { name: 'Menu' }).click(); await p.getByRole('menuitem', { name: /^Theme/ }).click(); await p.getByRole('menuitemradio', { name }).click(); };
const bg = (p, sel) => p.locator(sel).first().evaluate(el => getComputedStyle(el).backgroundColor);
await pa.goto('http://localhost:4190/'); await pa.getByText('STRENGTH').waitFor();
check(await pa.evaluate(() => document.documentElement.dataset.theme) === 'classic', 'Classic by default');
check(await pa.locator('header svg.ft-logo').count() === 1, 'logo mark beside the name');
const icons = await pa.evaluate(() => [...document.querySelectorAll('link[rel~=icon], link[rel=apple-touch-icon], link[rel=manifest]')].map(l => l.getAttribute('href')));
check(icons.join() === '/icon.svg,/apple-touch-icon.png,/manifest.webmanifest', 'page links its icons: ' + icons.join());
const got = await pa.evaluate(async (u) => Promise.all(u.map(x => fetch(x).then(r => r.status))), [...icons, '/icon-192.png', '/icon-512.png']);
check(got.every(s => s === 200), 'icon files are served: ' + got.join());
const mf = await pa.evaluate(() => fetch('/manifest.webmanifest').then(r => r.json()));
check(mf.name === 'Training Ledger' && mf.icons.length === 3, 'manifest names the app and its icons');
// Quiet's structure in every theme: no card boxes, explanations only while you are in a section
const quietChecks = async (theme) => {
  const qc = await pa.locator('.ft-section').first().evaluate(el => { const c = getComputedStyle(el); return { bg: c.backgroundColor, bw: c.borderLeftWidth, sh: c.boxShadow }; });
  check(qc.bg === 'rgba(0, 0, 0, 0)' && qc.bw === '0px' && qc.sh === 'none', theme + ': sections have no box ' + JSON.stringify(qc));
  check(await pa.locator('.ft-section').first().locator('button', { hasText: '+ Add' }).evaluate(el => getComputedStyle(el).borderTopColor) === 'rgba(0, 0, 0, 0)', theme + ': buttons have no outline box');
  await pa.mouse.move(400, 5);
  const navLabel = (name) => pa.getByRole('button', { name, exact: true }).locator('.ft-nav-label').evaluate(el => getComputedStyle(el).opacity);
  check(await navLabel('LOG') === '1' && await navLabel('FOOD') === '0', theme + ': only the current tab shows its name');
  check(await pa.locator('.ft-brand').evaluate(el => getComputedStyle(el).visibility) === 'hidden', theme + ': the app name is dropped');
  await pa.screenshot({ path: `theme-structure-${theme}.png`, fullPage: true });
  await pa.getByRole('button', { name: 'PROGRESS' }).click(); await pa.getByText('Change since start').waitFor();
  const hint = pa.locator('.ft-hint', { hasText: 'Drag to move' });
  check(await hint.evaluate(el => getComputedStyle(el).opacity) === '0', theme + ': chart hint hidden at rest');
  await hint.locator('xpath=ancestor::*[contains(@class, "ft-card")][1]').hover(); await pa.waitForTimeout(250);
  check(await hint.evaluate(el => getComputedStyle(el).opacity) === '1', theme + ': chart hint shows while you are on the chart');
  await pa.getByRole('button', { name: 'LOG', exact: true }).click(); await pa.getByText('STRENGTH').waitFor();
};
await quietChecks('classic');
await pickTheme(pa, 'Krypton'); await pa.waitForTimeout(200);
await quietChecks('krypton');
check(await bg(pa, 'body') !== 'rgb(255, 255, 255)', 'Krypton keeps its own colours: ' + await bg(pa, 'body'));
// Quiet itself is no longer a theme here; a saved choice of it falls back to Classic
await pa.getByRole('button', { name: 'Menu' }).click(); await pa.getByRole('menuitem', { name: /^Theme/ }).click();
check(await pa.getByRole('menuitemradio', { name: 'Quiet' }).count() === 0, 'Quiet is not in the Theme menu');
await pa.keyboard.press('Escape');
await pa.evaluate(() => { localStorage.setItem('fitness-tracker:theme', 'quiet'); const pr = JSON.parse(localStorage.getItem('fitness-tracker:profile') || '{}'); pr.theme = { name: 'quiet', at: Date.now() }; localStorage.setItem('fitness-tracker:profile', JSON.stringify(pr)); });
await pa.reload(); await pa.getByText('STRENGTH').waitFor(); await pa.waitForTimeout(300);
check(await pa.evaluate(() => document.documentElement.dataset.theme) === 'classic', 'a saved Quiet choice falls back to Classic');
await pickTheme(pa, 'Classic');
await pa.locator('header').screenshot({ path: 'logo-header-classic.png' });
check(await bg(pa, 'body') === 'rgb(237, 232, 222)', 'classic paper: ' + await bg(pa, 'body'));
await pa.getByRole('button', { name: 'Menu' }).click();
check(await pa.getByRole('menuitemradio').count() === 0 && (await pa.getByRole('menuitem', { name: /^Theme/ }).innerText()).includes('Classic'), 'the menu lists Theme, showing the current one, with its options in a sub-menu');
await pa.getByRole('menuitem', { name: /^Theme/ }).click();
check(await pa.getByRole('menuitemradio', { name: 'Classic' }).getAttribute('aria-checked') === 'true', 'the Theme sub-menu shows Classic ticked');
await pa.getByRole('menuitem', { name: 'Theme' }).filter({ hasText: '‹' }).click();
check(await pa.getByRole('menuitemradio').count() === 0 && await pa.getByRole('menuitem', { name: /^Training split/ }).count() === 1, 'Back returns to the main menu');
await pa.getByRole('menuitem', { name: /^Theme/ }).click();
const mb = await pa.getByRole('menu').boundingBox(), hb = await pa.getByRole('button', { name: 'Menu' }).boundingBox();
check(mb.y > hb.y + hb.height && mb.y < hb.y + hb.height + 20, 'menu drops down under the button');
await pa.screenshot({ path: 'theme-menu-classic.png' });
await pa.keyboard.press('Escape');
check(await pa.getByRole('menu').count() === 0, 'Escape closes the menu');
check(await pa.getByText('Theme', { exact: true }).count() === 0, 'no theme section at the bottom any more');
await pickTheme(pa, 'Ledger');
check(await pa.evaluate(() => document.documentElement.dataset.theme) === 'ledger', 'switches to Ledger');
check(await bg(pa, 'body') === 'rgb(253, 253, 252)', 'ledger paper #FDFDFC: ' + await bg(pa, 'body'));
check((await pa.locator('body').evaluate(el => getComputedStyle(el).backgroundImage)).includes('repeating-linear-gradient'), 'ruled ledger lines');
check(await bg(pa, 'header') === 'rgb(29, 59, 102)', 'blueprint masthead #1D3B66: ' + await bg(pa, 'header'));
check(await pa.locator('header').evaluate(el => getComputedStyle(el.querySelector('.ft-masthead-title')).color) === 'rgb(245, 245, 245)', 'masthead text is white');
check(await pa.locator('.ft-section').first().locator('button', { hasText: '+ Add' }).evaluate(el => getComputedStyle(el).color) === 'rgb(211, 72, 54)', 'strength accent is red #D34836');
await pa.screenshot({ path: 'theme-ledger-log.png', fullPage: true });
await pa.getByRole('button', { name: 'PROGRESS' }).click();
await pa.getByText('Change since start').waitFor();
const badge = pa.getByText(/\d+\+ club/);
check(await badge.count() === 1 && await badge.evaluate(el => getComputedStyle(el).backgroundColor) === 'rgb(204, 255, 0)', 'neon milestone badge #CCFF00');
await pa.screenshot({ path: 'theme-ledger-progress.png', fullPage: true });
await pa.getByRole('button', { name: 'FOOD' }).click(); await pa.waitForTimeout(300);
await pa.screenshot({ path: 'theme-ledger-food.png', fullPage: true });
await pa.reload(); await pa.getByText('STRENGTH').waitFor();
check(await pa.evaluate(() => document.documentElement.dataset.theme) === 'ledger', 'theme kept after reload');
await pa.getByText('Connect Google Drive').click(); await waitSynced(pa);
check(book().profile?.theme?.name === 'ledger', 'theme syncs to Drive');
await pb.goto('http://localhost:4190/'); await pb.getByText('Connect Google Drive').click(); await waitSynced(pb);
await pb.waitForFunction(() => document.documentElement.dataset.theme === 'ledger', null, { timeout: 5000 }).catch(() => {});
check(await pb.evaluate(() => document.documentElement.dataset.theme) === 'ledger', 'other device picks up the theme');

// the other three themes
const card = (p) => p.locator('.ft-card').first().evaluate(el => { const c = getComputedStyle(el); return { bg: c.backgroundColor, r: c.borderTopLeftRadius, sh: c.boxShadow, tt: c.textTransform, bf: c.backdropFilter }; });
await pickTheme(pa, 'Krypton');
let k = await card(pa);
check(await pa.evaluate(() => getComputedStyle(document.body).backgroundImage).then(x => x.includes('radial-gradient')) && k.bg === 'rgba(0, 0, 0, 0)' && k.sh === 'none', 'Krypton: black radial page, cards without boxes ' + JSON.stringify(k));
check((await pa.locator('header').evaluate(el => getComputedStyle(el).borderBottomColor)) === 'rgb(211, 26, 26)', 'Krypton: crimson masthead edge');
check(await pa.locator('.ft-section').first().locator('.ft-masthead-title, h2, div').first().evaluate(el => getComputedStyle(el).color) !== 'rgb(0, 0, 0)', 'Krypton: light text');
await pa.screenshot({ path: 'theme-krypton.png', fullPage: true });
await pa.locator('header').screenshot({ path: 'logo-header-krypton.png' });
await pickTheme(pa, 'Gotham Swarm');
k = await card(pa);
check(k.bg === 'rgba(0, 0, 0, 0)' && k.sh === 'none' && k.tt === 'uppercase', 'Gotham: its uppercase type, cards without boxes ' + JSON.stringify(k));
check((await pa.locator('header').evaluate(el => getComputedStyle(el).clipPath)).includes('polygon'), 'Gotham: cut masthead');
await pa.screenshot({ path: 'theme-gotham.png', fullPage: true });
await pa.getByRole('button', { name: 'Menu' }).click(); await pa.screenshot({ path: 'theme-menu-gotham.png' }); await pa.keyboard.press('Escape');
await pickTheme(pa, 'Alpine Sunset');
k = await card(pa);
check(await pa.evaluate(() => getComputedStyle(document.body).backgroundImage).then(x => x.includes('linear-gradient')) && k.bf === 'none' && k.bg === 'rgba(0, 0, 0, 0)', 'Alpine: sunset gradient, cards without boxes ' + JSON.stringify(k));
await pa.screenshot({ path: 'theme-alpine.png', fullPage: true });
await pa.getByRole('button', { name: 'Menu' }).click(); await pa.screenshot({ path: 'theme-menu-alpine.png' }); await pa.keyboard.press('Escape');
await pa.getByRole('button', { name: 'PROGRESS' }).click(); await pa.getByText('Change since start').waitFor();
await pa.screenshot({ path: 'theme-alpine-progress.png', fullPage: true });
await pickTheme(pa, 'Krypton');
await pa.screenshot({ path: 'theme-krypton-progress.png', fullPage: true });
await pickTheme(pa, 'Gotham Swarm');
await pa.screenshot({ path: 'theme-gotham-progress.png', fullPage: true });
await pa.getByRole('button', { name: 'LOG', exact: true }).click();
await pickTheme(pa, 'Classic');
check(await bg(pa, 'header') === 'rgba(0, 0, 0, 0)' && await bg(pa, 'body') === 'rgb(237, 232, 222)', 'back to Classic');
await pa.screenshot({ path: 'theme-classic-log.png', fullPage: true });
check(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
await b.close(); srv.close();
