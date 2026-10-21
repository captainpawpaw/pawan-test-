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

// an entry from before the split (no meal set), two days ago
await A.addInitScript(() => {
  if (localStorage.getItem('seeded')) return;
  const pad = (n) => String(n).padStart(2, '0'); const d = new Date(); d.setDate(d.getDate() - 2);
  const mk = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const cur = JSON.parse(localStorage.getItem('fitness-tracker:month:' + mk) || '{}');
  cur[pad(d.getDate())] = { strength: [], cardio: [], food: [{ id: 'old1', name: 'Old toast', grams: 40, kcal: 100, protein: 3, carbs: 18, fat: 1, fibre: 1, sugar: 2 }] };
  localStorage.setItem('fitness-tracker:month:' + mk, JSON.stringify(cur));
  localStorage.setItem('seeded', '1');
});
const part = (p, name) => p.getByRole('region', { name, exact: true });

await pa.goto('http://localhost:4190/?tab=log'); await pa.getByRole('button', { name: 'FOOD', exact: true }).click(); await pa.getByText('Set daily targets').waitFor();
const heads = await pa.locator('.ft-card section[aria-label]').evaluateAll(ss => ss.map(s => s.getAttribute('aria-label')));
check(heads.join(',') === 'Breakfast,Lunch,Dinner,Snacks', 'the day is split into four parts: ' + heads.join(','));
check(await pa.getByRole('button', { name: /Save .* as a meal/ }).count() === 0, 'no Save as meal on an empty day');
await pa.getByRole('button', { name: '+ Add to Breakfast' }).click();
await manual(pa, 'Porridge oats', 150, 5, 40);
await manual(pa, 'Skyr', 95, 16, 150);
await manual(pa, 'Banana', 105, 1.3, 120);
await manual(pa, 'Coffee', 5, 0, 250);
check((await part(pa, 'Breakfast').innerText()).includes('Porridge oats'), 'the part is open while adding to it');
await pa.getByRole('button', { name: 'Done adding' }).click();
const bToggle = part(pa, 'Breakfast').getByRole('button', { name: /^.?Breakfast \d items/ });
let bt = await part(pa, 'Breakfast').innerText();
check(bt.includes('4 items · 355 kcal · P 22.3 g') && !bt.includes('Porridge oats') && await bToggle.getAttribute('aria-expanded') === 'false', 'done adding folds the part to one line, with its subtotal');
await bToggle.click();
bt = await part(pa, 'Breakfast').innerText();
check(bt.includes('Porridge oats') && bt.includes('Coffee'), 'tapping opens it: the foods landed in Breakfast');
check(!(await part(pa, 'Lunch').innerText()).includes('Skyr'), 'other parts stay empty');
// move one to another part
await pa.getByRole('button', { name: 'Edit Coffee' }).click();
await pa.getByLabel('Meal', { exact: true }).selectOption('snacks');
await pa.getByRole('button', { name: 'Save changes' }).click();
check((await part(pa, 'Snacks').innerText()).includes('Coffee') && !(await part(pa, 'Breakfast').innerText()).includes('Coffee'), 'editing moves a food to another part');
// one part open at a time; tap to open or close
check(!(await part(pa, 'Breakfast').innerText()).includes('Porridge oats') && (await part(pa, 'Snacks').innerText()).includes('Coffee'), 'the moved-to part opens and the other folds');
await part(pa, 'Snacks').getByRole('button', { name: /^.?Snacks 1 item/ }).click();
let bc = await part(pa, 'Snacks').innerText();
check(bc.includes('1 item · 5 kcal') && !bc.includes('Coffee'), 'tapping folds it to one line');
await pa.screenshot({ path: 'food-folded.png', fullPage: true });
await bToggle.click(); await part(pa, 'Snacks').getByRole('button', { name: /^.?Snacks 1 item/ }).click();
check(!(await part(pa, 'Breakfast').innerText()).includes('Porridge oats') && (await part(pa, 'Snacks').innerText()).includes('Coffee'), 'opening one part folds the others');
await pa.reload(); await pa.getByRole('button', { name: 'FOOD', exact: true }).click(); await pa.getByText('Set daily targets').waitFor();
check(!(await part(pa, 'Breakfast').innerText()).includes('Porridge oats') && !(await part(pa, 'Snacks').innerText()).includes('Coffee'), 'every part starts folded');
await bToggle.click();
check((await part(pa, 'Breakfast').innerText()).includes('Porridge oats'), 'tapping opens it again');
check(await part(pa, 'Lunch').getByRole('button', { name: 'Lunch', exact: true }).isDisabled(), 'an empty part has nothing to open');
// save breakfast as a meal: name filled in
await pa.getByRole('button', { name: 'Save breakfast as a meal' }).click();
check(await pa.getByLabel('Meal name').inputValue() === 'Breakfast', 'meal name starts as the part');
const boxes = pa.getByRole('group', { name: 'Foods in the meal' }).getByRole('checkbox');
check(await boxes.count() === 3 && (await boxes.evaluateAll(bs => bs.every(x => x.checked))), 'the part\'s foods, all ticked');
check((await body(pa)).includes('3 foods · 350 kcal · P 22.3 g'), 'meal totals');
await pa.screenshot({ path: 'meal-save.png', fullPage: true });
await pa.getByRole('button', { name: 'Save meal' }).click();
check((await body(pa)).includes('Saved Breakfast (3 foods).'), 'meal saved');
await pa.screenshot({ path: 'food-parts.png', fullPage: true });
// another day: add the meal to Lunch in one tap
await pa.getByRole('button', { name: 'Calendar', exact: true }).click();
await pa.locator('#month-calendar').getByRole('button', { name: /^1$/ }).first().click();
await pa.getByRole('button', { name: '+ Add to Lunch' }).click();
const mealsY = (await pa.getByText(/^Meals · one tap adds them all$/i).boundingBox())?.y, recentY = (await pa.getByText(/^Recent$/i).boundingBox())?.y;
check(mealsY != null && recentY != null && mealsY < recentY && (await body(pa)).includes('Porridge oats + Skyr + Banana'), 'Meals listed first when adding');
const recentBtn = pa.getByRole('button', { name: /^Recent \d/ });
check(await recentBtn.getAttribute('aria-expanded') === 'false' && await pa.getByRole('button', { name: /^Porridge oats/ }).count() === 0, 'Recent is folded until opened');
await recentBtn.click();
check(await recentBtn.getAttribute('aria-expanded') === 'true' && await pa.getByRole('button', { name: /^Porridge oats/ }).count() === 1, 'tapping Recent opens it');
await recentBtn.click();
await pa.getByLabel('Search foods').fill('porridge');
const hits = await pa.getByRole('button', { name: /^Porridge oats/ }).count(), lb = await pa.getByText(/^Logged before$/i).count();
check(hits >= 1 && lb === 1, `searching shows matches without opening it (${hits} hits, ${lb} label)`);
await pa.getByLabel('Search foods').fill('');
await pa.screenshot({ path: 'meal-pick.png', fullPage: true });
await pa.getByRole('button', { name: 'Add meal Breakfast' }).click();
check((await body(pa)).includes('Added Breakfast: 3 foods.'), 'one tap adds the meal');
await pa.getByRole('button', { name: 'Done adding' }).click();
check(!(await part(pa, 'Lunch').innerText()).includes('Skyr'), 'and folds when done');
await part(pa, 'Lunch').getByRole('button', { name: /^.?Lunch 3 items/ }).click();
const lt = await part(pa, 'Lunch').innerText();
check(lt.includes('Porridge oats') && lt.includes('Skyr') && lt.includes('Banana') && lt.includes('350 kcal') && !(await part(pa, 'Breakfast').innerText()).includes('Skyr'), 'the meal lands in the part it was added to');
check(lt.includes('· Breakfast'), 'foods show which meal they came from');
let t = await body(pa);
check(/350\s*kcal/.test(t), 'day total counts it');
// search finds meals by name or by a food in them
await pa.getByRole('button', { name: '+ Add to Dinner' }).click();
await pa.getByLabel('Search foods').fill('skyr');
check(await pa.getByRole('button', { name: 'Add meal Breakfast' }).count() === 1, 'search finds the meal by a food in it');
await pa.getByLabel('Search foods').fill('lunch');
check(await pa.getByRole('button', { name: 'Add meal Breakfast' }).count() === 0, 'and leaves it out otherwise');
await pa.getByLabel('Search foods').fill('');
// a day from before the split: Not sorted, until moved
const d2 = new Date(); d2.setDate(d2.getDate() - 2);
const p2 = await A.newPage();
await p2.goto('http://localhost:4190/?tab=log'); await p2.getByRole('button', { name: 'FOOD', exact: true }).click();
if (d2.getMonth() !== new Date().getMonth()) await p2.getByRole('button', { name: 'Previous month' }).click();
await p2.getByRole('button', { name: 'Calendar', exact: true }).click();
await p2.locator('#month-calendar').getByRole('button', { name: new RegExp('^' + d2.getDate() + '$') }).first().click();
check((await part(p2, 'Not sorted').innerText()).includes('Old toast'), 'older food shows under Not sorted');
await p2.getByRole('button', { name: 'Edit Old toast' }).click();
await p2.getByLabel('Meal', { exact: true }).selectOption('breakfast');
await p2.getByRole('button', { name: 'Save changes' }).click();
check(await part(p2, 'Not sorted').count() === 0 && (await part(p2, 'Breakfast').innerText()).includes('Old toast'), 'and moves into a part when edited');
await p2.close();
await pa.getByRole('button', { name: 'Close adding to Dinner' }).click();
await pa.getByRole('button', { name: '+ Add to Dinner' }).click();
// syncs to another device and survives reload
await pa.getByText('Connect Google Drive').click(); await waitSynced(pa);
check(Object.values(book().meals || {}).some(m => m.name === 'Breakfast' && m.items.length === 3 && !m.items[0].id), 'meal saved to Drive');
await pb.goto('http://localhost:4190/?tab=log'); await pb.getByText('Connect Google Drive').click(); await waitSynced(pb);
await pb.getByRole('button', { name: 'FOOD', exact: true }).click();
await pb.getByRole('button', { name: '+ Add' }).last().click();
check(await pb.getByRole('button', { name: 'Add meal Breakfast' }).count() === 1, 'other device has the meal');
// remove
await pa.getByRole('button', { name: 'Remove meal Breakfast' }).click();
await pa.getByRole('button', { name: /^Recent \d/ }).click();
check(await pa.getByRole('button', { name: 'Add meal Breakfast' }).count() === 0 && (await body(pa)).includes('Porridge oats'), 'meal removed; logged days keep their foods');
check(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
await b.close(); srv.close();
