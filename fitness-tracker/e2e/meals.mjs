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
for (const ctx of [A, B]) await ctx.route('https://*.openfoodfacts.org/**', r => r.fulfill({ status: 404, body: '{}' }));
const pa = await A.newPage(), pb = await B.newPage();
const errs = []; for (const p of [pa, pb]) p.on('pageerror', e => errs.push(e.message));
pa.on('dialog', (d) => d.accept());
const body = (p) => p.locator('body').innerText();

async function manual(p, name, kcal, protein, grams) {
  await p.getByRole('button', { name: 'Enter manually' }).click();
  await p.getByLabel('Name', { exact: true }).fill(name);
  await p.getByRole('spinbutton', { name: 'Calories' }).fill(String(kcal));
  await p.getByLabel('Protein (g)').fill(String(protein));
  await p.getByLabel('Weight (g), optional').fill(String(grams));
  await p.getByRole('button', { name: 'Add to day' }).click();
}

await pa.goto('http://localhost:4190/'); await pa.getByRole('button', { name: 'FOOD', exact: true }).click(); await pa.getByText('Set daily targets').waitFor();
check(await pa.getByRole('button', { name: 'Save as meal' }).count() === 0, 'no Save as meal on an empty day');
await pa.getByRole('button', { name: '+ Add' }).last().click();
await manual(pa, 'Porridge oats', 150, 5, 40);
await manual(pa, 'Skyr', 95, 16, 150);
await manual(pa, 'Banana', 105, 1.3, 120);
await manual(pa, 'Coffee', 5, 0, 250);
await pa.getByRole('button', { name: 'Done adding' }).click();
// save three of the four as a meal
await pa.getByRole('button', { name: 'Save as meal' }).click();
check(await pa.getByRole('button', { name: 'Save meal' }).isDisabled(), 'needs a name');
await pa.getByLabel('Meal name').fill('Breakfast');
const boxes = pa.getByRole('group', { name: 'Foods in the meal' }).getByRole('checkbox');
check(await boxes.count() === 4 && (await boxes.evaluateAll(bs => bs.every(x => x.checked))), 'every food ticked to start');
await pa.getByRole('group', { name: 'Foods in the meal' }).locator('label', { hasText: 'Coffee' }).getByRole('checkbox').uncheck();
check((await body(pa)).includes('3 foods · 350 kcal · P 22.3 g'), 'totals follow the ticks');
await pa.screenshot({ path: 'meal-save.png', fullPage: true });
await pa.getByRole('button', { name: 'Save meal' }).click();
check((await body(pa)).includes('Saved Breakfast (3 foods).'), 'meal saved');
// another day: one tap adds it all
await pa.getByRole('button', { name: 'Calendar', exact: true }).click();
await pa.locator('#month-calendar').getByRole('button', { name: /^1$/ }).first().click();
await pa.getByRole('button', { name: '+ Add' }).last().click();
const mealsY = (await pa.getByText(/^Meals · one tap adds them all$/i).boundingBox())?.y, recentY = (await pa.getByText(/^Recent$/i).boundingBox())?.y;
check(mealsY != null && recentY != null && mealsY < recentY && (await body(pa)).includes('Porridge oats + Skyr + Banana'), 'Meals listed first when adding');
await pa.screenshot({ path: 'meal-pick.png', fullPage: true });
await pa.getByRole('button', { name: 'Add meal Breakfast' }).click();
let t = await body(pa);
check(t.includes('Added Breakfast: 3 foods.'), 'one tap adds the meal');
await pa.getByRole('button', { name: 'Done adding' }).click();
t = await body(pa);
check(t.includes('Porridge oats') && t.includes('Skyr') && t.includes('Banana') && !t.includes('Coffee') && /350\s*kcal/.test(t), 'the day has the three foods: ' + (t.match(/\d[\d,]* kcal/g) || []).slice(0, 2).join(' '));
check(t.includes('· Breakfast'), 'foods show which meal they came from');
// search finds meals by name or by a food in them
await pa.getByRole('button', { name: '+ Add' }).last().click();
await pa.getByLabel('Search foods').fill('skyr');
check(await pa.getByRole('button', { name: 'Add meal Breakfast' }).count() === 1, 'search finds the meal by a food in it');
await pa.getByLabel('Search foods').fill('lunch');
check(await pa.getByRole('button', { name: 'Add meal Breakfast' }).count() === 0, 'and leaves it out otherwise');
await pa.getByLabel('Search foods').fill('');
// syncs to another device and survives reload
await pa.getByText('Connect Google Drive').click(); await waitSynced(pa);
check(Object.values(book().meals || {}).some(m => m.name === 'Breakfast' && m.items.length === 3 && !m.items[0].id), 'meal saved to Drive');
await pb.goto('http://localhost:4190/'); await pb.getByText('Connect Google Drive').click(); await waitSynced(pb);
await pb.getByRole('button', { name: 'FOOD', exact: true }).click();
await pb.getByRole('button', { name: '+ Add' }).last().click();
check(await pb.getByRole('button', { name: 'Add meal Breakfast' }).count() === 1, 'other device has the meal');
// remove
await pa.getByRole('button', { name: 'Remove meal Breakfast' }).click();
check(await pa.getByRole('button', { name: 'Add meal Breakfast' }).count() === 0 && (await body(pa)).includes('Porridge oats'), 'meal removed; logged days keep their foods');
check(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
await b.close(); srv.close();
