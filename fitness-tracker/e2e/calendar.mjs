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


const drawer = (p) => p.locator('#month-calendar');
const tab = (p) => p.getByRole('button', { name: 'Calendar', exact: true });
const shut = async (p) => { await drawer(p).waitFor({ state: 'hidden', timeout: 2000 }).catch(() => {}); return !(await drawer(p).isVisible()); };
const settled = (p) => p.waitForTimeout(350); // slide animation
const focusedLabel = (p) => p.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent || '');

await pa.goto('http://localhost:4190/?tab=log'); await pa.getByText('STRENGTH').waitFor();
check(!(await drawer(pa).isVisible()) && await tab(pa).isVisible(), 'calendar starts tucked away, with a tab on the left');
const tb = await tab(pa).boundingBox();
check(tb.x <= 1 && tb.width <= 30 && tb.height >= 44, 'tab sits on the left edge: ' + JSON.stringify(tb));
await pa.screenshot({ path: 'cal-folded.png' });
// hover peeks it open
await tab(pa).hover();
await drawer(pa).waitFor(); await settled(pa);
let db = await drawer(pa).boundingBox();
check(db.x <= 1 && db.height >= 899 && db.width <= 340, 'hovering slides out a full-height sidebar from the left: ' + JSON.stringify(db));
check(await pa.locator('.ft-cal-backdrop').count() === 0, 'hover peek does not dim the page');
await pa.mouse.move(415, 890);
check(await shut(pa), 'moving away tucks it back');
// hover, then click a day: picks it and tucks away
await tab(pa).hover(); await drawer(pa).waitFor(); await settled(pa);
await drawer(pa).getByRole('button', { name: /^3/ }).first().click();
check((await pa.locator('body').innerText()).includes('SAT 3 OCT'), 'clicking a day selects it');
check(await shut(pa), 'and the sidebar tucks away');
// same on the food tab, with the calorie key
await pa.getByRole('button', { name: 'FOOD', exact: true }).click();
check(!(await drawer(pa).isVisible()) && await tab(pa).isVisible(), 'food tab has the calendar tab too');
// click to pin: dialog with backdrop, focus inside, month arrows, Escape
await tab(pa).click(); await settled(pa);
check(await drawer(pa).isVisible() && await pa.locator('.ft-cal-backdrop').isVisible(), 'clicking the tab pins it open over a dimmed page');
check((await drawer(pa).innerText()).includes('calories'), 'food calendar explains its bars');
check(await pa.evaluate(() => document.getElementById('month-calendar').contains(document.activeElement)) && (await drawer(pa).getAttribute('aria-modal')) === 'true', 'focus moves into the open sidebar');
await pa.screenshot({ path: 'cal-pinned-food.png' });
await drawer(pa).getByRole('button', { name: 'Show next month' }).click();
check((await drawer(pa).innerText()).includes('NOVEMBER') && (await pa.locator('header').innerText()).includes('NOVEMBER'), 'sidebar arrows change the month');
await drawer(pa).getByRole('button', { name: 'Show previous month' }).click();
await pa.keyboard.press('Escape');
check(await shut(pa) && (await focusedLabel(pa)) === 'Calendar', 'Escape closes it and returns focus to the tab');
// keyboard: open with Enter, pick a day with Enter
await pa.keyboard.press('Enter'); await settled(pa);
check(await drawer(pa).isVisible(), 'Enter on the tab opens it');
await pa.keyboard.press('Tab'); await pa.keyboard.press('Shift+Tab');
check(await pa.evaluate(() => document.getElementById('month-calendar').contains(document.activeElement)), 'Tab stays inside the open sidebar');
await drawer(pa).getByRole('button', { name: /^7/ }).first().focus();
await pa.keyboard.press('Enter');
check(await shut(pa) && (await pa.locator('body').innerText()).includes('WED 7 OCT') && (await focusedLabel(pa)) === 'Calendar', 'Enter on a day picks it, closes, focus back on the tab');
check(await pa.evaluate(() => document.body.style.overflow) === '', 'page scrolls again once closed');
// not on the exercises or progress tabs
await pa.getByRole('button', { name: 'EXERCISES' }).click();
check(await tab(pa).count() === 0, 'no calendar tab on the exercises tab');
await pa.getByRole('button', { name: 'LOG', exact: true }).click();

// phone: tap to open, tap a day to close, tap outside to close
const M = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); await setup(M);
const pm = await M.newPage(); pm.on('pageerror', (e) => errs.push(e.message));
await pm.goto('http://localhost:4190/?tab=log'); await pm.getByText('STRENGTH').waitFor();
check(!(await drawer(pm).isVisible()), 'phone: tucked away at first');
await tab(pm).tap(); await settled(pm);
const dows = await drawer(pm).evaluate(el => [...el.querySelectorAll('div')].find(d => d.children.length === 7 && d.textContent.length === 7)?.textContent);
const firstDay = await drawer(pm).getByRole('button', { name: /^1$/ }).first().boundingBox();
const colW = (await drawer(pm).boundingBox()).width;
check(dows === 'MTWTFSS', 'week starts on Monday: ' + dows);
// 1 Oct 2026 is a Thursday: fourth column
check(firstDay.x > colW * 0.4 && firstDay.x < colW * 0.6, '1 Oct sits under Thursday ' + JSON.stringify(firstDay));
await pm.touchscreen.tap(385, 600); await shut(pm);
await tab(pm).tap(); await settled(pm);
db = await drawer(pm).boundingBox();
const tb2 = await tab(pm).boundingBox();
check(await drawer(pm).isVisible() && db.x <= 1 && db.width < 390 - 40 && Math.abs(tb2.x - (db.x + db.width)) <= 2, 'phone: tap slides it out, tab rides on its edge ' + JSON.stringify({ db, tb2 }));
await pm.screenshot({ path: 'cal-open.png' });
await drawer(pm).getByRole('button', { name: /^5/ }).first().tap();
check(await shut(pm) && (await pm.locator('body').innerText()).includes('MON 5 OCT'), 'phone: tapping a day selects it and closes');
await tab(pm).tap(); await settled(pm);
await pm.touchscreen.tap(385, 600);
check(await shut(pm), 'phone: tapping the dimmed page closes it');
await tab(pm).tap(); await settled(pm); await tab(pm).tap();
check(await shut(pm), 'phone: tapping the tab again closes it');
await pm.getByRole('button', { name: 'Menu' }).tap();
await pm.getByRole('menuitem', { name: /^Theme/ }).tap();
await pm.getByRole('menuitemradio', { name: 'Alpine Sunset' }).tap();
await tab(pm).tap(); await settled(pm);
await pm.screenshot({ path: 'cal-open-alpine.png' });
check(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
await b.close(); srv.close();
