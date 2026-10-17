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


let offCalls = 0, usdaCalls = 0;
async function foodRoutes(ctx) {
  await ctx.route('https://*.openfoodfacts.org/**', async (r) => {
    offCalls++;
    const u = new URL(r.request().url());
    if (u.pathname.startsWith('/api/v2/product/5000159484695')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 1, product: { product_name: 'Milk Chocolate Bar', brands: 'Cadbury', serving_quantity: 45, serving_size: '45 g', nutriments: { 'energy-kcal_100g': 534, proteins_100g: 7.3, carbohydrates_100g: 57, fat_100g: 30, sugars_100g: 56 } } }) });
    if (u.pathname.startsWith('/api/v2/product/')) return r.fulfill({ status: 404, contentType: 'application/json', body: '{"status":0}' });
    if (u.pathname === '/cgi/search.pl') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ products: [
      { code: '111', product_name: 'Greek Style Yogurt', brands: 'Fage', serving_quantity: 170, serving_size: '170 g', nutriments: { 'energy-kcal_100g': 97, proteins_100g: 9, carbohydrates_100g: 3, fat_100g: 5 } },
      { code: '222', product_name: 'No nutrition', nutriments: {} } ] }) });
    r.fulfill({ status: 404, body: '' });
  });
  await ctx.route('http://localhost:4190/api/usda*', async (r) => {
    usdaCalls++;
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ foods: [{ id: 'fdc:9', name: 'Skyr, plain (Icelandic Provisions)', group: 'Branded (USDA)', per100: { kcal: 63, protein: 11, carbs: 4, fat: 0.2, fibre: 0, sugar: 3 }, portions: [{ g: 150, label: '1 serving' }] }] }) });
  });
}
await foodRoutes(A); await foodRoutes(B);
const foodCard = (p) => p.locator('section, div').filter({ has: p.getByText('FOOD', { exact: true }) }).last();
const foodText = async (p) => (await p.locator('div', { has: p.getByText('FOOD', { exact: true }) }).last().innerText());

await pa.goto('http://localhost:4190/'); await pa.getByRole('button', { name: 'FOOD', exact: true }).click(); await pa.getByText('Set daily targets').waitFor();
await pa.screenshot({ path: 'food-tab.png' });
check(!(await pa.locator('body').innerText()).includes('STRENGTH'), 'food tab shows only food');
let t = await pa.locator('body').innerText();
check(t.includes('No food logged for this day.') && t.includes('Set daily targets'), 'food section with empty state');

// targets
await pa.getByRole('button', { name: 'Set daily targets' }).click();
await pa.getByLabel('Calories per day').fill('2200'); await pa.getByLabel('Protein per day (g)').fill('150');
await pa.getByRole('button', { name: 'Save targets' }).click();
t = await pa.locator('body').innerText();
check(t.includes('2,200 kcal left') && t.includes('150 g left'), 'targets saved, meters show remaining');
check(t.includes('0 eaten of 2,200 kcal') && t.includes('0 eaten of 150 g'), 'meters say how much is eaten');

// built-in search + grams
const addBtn = pa.getByRole('button', { name: '+ Add' }).last();
await addBtn.click();
const offIdle = pa.getByRole('button', { name: 'Search branded products (type a name above)' });
check(await offIdle.isVisible() && await offIdle.isDisabled(), 'branded search always shown, waiting for a name');
await pa.getByLabel('Search foods').fill('chicken breast roasted');
const first = pa.locator('ul li button').first();
await first.waitFor();
const firstName = await first.locator('span').first().innerText();
check(/^Chicken, broilers or fryers, breast/.test(firstName), 'built-in search ranks: ' + firstName);
await pa.screenshot({ path: 'food-search.png' });
await pa.getByRole('button', { name: /Chicken, broilers or fryers, breast, meat only, cooked, roasted/ }).first().click();
await pa.getByLabel('Amount').fill('150');
t = await pa.locator('body').innerText();
check(t.includes('248 kcal') && t.includes('Protein 46.5 g'), 'amount preview scales per 100 g (165 kcal x 1.5)');
await pa.getByRole('button', { name: 'Add to day' }).click();
check((await pa.getByRole('status').allInnerTexts()).some(x => x.includes('Added Chicken')), 'added message');

// UK foods (CoFID) come first and say where they're from
await pa.getByLabel('Search foods').fill('cheddar english');
const ukFirst = pa.locator('ul li button').first();
await ukFirst.waitFor();
const ukText = (await ukFirst.innerText()).replace(/\s+/g, ' ');
check(ukText.startsWith('Cheese, Cheddar, English') && ukText.includes('416 kcal') && ukText.endsWith('· UK'), 'UK CoFID food found: ' + ukText);
await pa.screenshot({ path: 'food-uk.png' });

// portion unit
await pa.getByLabel('Search foods').fill('egg whole raw fresh');
await pa.getByRole('button', { name: /^Egg, whole, raw, fresh/ }).first().click();
const unitOpts = await pa.getByLabel('Unit').locator('option').allTextContents();
check(unitOpts.some(o => /^1 tbsp \((≈ )?[\d.]+ g\)$/.test(o)) && unitOpts.some(o => /^1 tsp \((≈ )?[\d.]+ g\)$/.test(o)), 'tbsp and tsp offered: ' + unitOpts.join(' | '));
await pa.getByLabel('Unit').selectOption({ label: unitOpts.find(o => o.startsWith('1 tbsp')) });
check(!unitOpts.find(o => o.startsWith('1 tbsp')).includes('≈') || (await pa.locator('body').innerText()).includes('Spoon weight is an estimate'), 'estimated spoon weights say so');
await pa.screenshot({ path: 'food-spoons.png' });
await pa.getByLabel('Unit').selectOption({ label: '1 large (50 g)' });
await pa.getByLabel('Amount').fill('2');
await pa.getByRole('button', { name: 'Add to day' }).click();

// USDA online (Pages Function) appears on the website
await pa.getByLabel('Search foods').fill('skyr');
await pa.getByText('More from USDA online').waitFor({ timeout: 5000 });
check(usdaCalls >= 1, 'USDA online function queried');

// Open Food Facts on demand
await pa.getByLabel('Search foods').fill('greek yogurt');
check(!(await pa.locator('body').innerText()).includes('Branded products (Open Food Facts)'), 'branded search waits for a tap');
const offBtn = pa.getByRole('button', { name: /Search branded products for/ });
const offY = (await offBtn.boundingBox()).y, firstSuggestion = await pa.getByText(/^(Recent|Logged before|My foods|Foods \(UK CoFID and USDA\))$/).first().boundingBox();
check(!firstSuggestion || offY < firstSuggestion.y, 'branded search sits above the suggestions');
const searchY = (await pa.getByLabel('Search foods').boundingBox()).y, manualY = (await pa.getByRole('button', { name: 'Enter manually' }).boundingBox()).y, barcodeY = (await pa.getByLabel('Or type a barcode').boundingBox()).y;
check(searchY < manualY && manualY < barcodeY && barcodeY < offY, 'photo, barcode and manual options sit right under the search box');
await pa.getByRole('button', { name: /Search branded products for/ }).click();
await pa.getByText('Branded products (Open Food Facts)').waitFor();
check(!(await pa.locator('body').innerText()).includes('No nutrition'), 'products without nutrition data are skipped');
await pa.getByRole('button', { name: /Greek Style Yogurt \(Fage\)/ }).click();
check(await pa.getByLabel('Amount').inputValue() === '1' && (await pa.locator('body').innerText()).includes('165 kcal'), 'branded product defaults to 1 serving (170 g): 165 kcal');
await pa.getByRole('button', { name: 'Add to day' }).click();

// barcode by number
await pa.getByLabel('Or type a barcode').fill('5000159484695');
await pa.getByRole('button', { name: 'Look up' }).click();
await pa.getByText('Milk Chocolate Bar (Cadbury)').waitFor();
await pa.getByRole('button', { name: 'Add to day' }).click();
await pa.getByLabel('Or type a barcode').fill('123456789');
await pa.getByRole('button', { name: 'Look up' }).click();
await pa.getByText(/No product found for that barcode/).waitFor();
check(true, 'unknown barcode handled');

// manual
await pa.getByRole('button', { name: 'Enter manually' }).click();
await pa.getByLabel('Name').fill('Protein bar'); await pa.getByRole('spinbutton', { name: 'Calories' }).fill('200'); await pa.getByLabel('Protein (g)').fill('20');
await pa.getByRole('button', { name: 'Add to day' }).click();
check(!(await pa.locator('body').innerText()).includes('Describe a meal for Claude'), 'Claude option hidden on the website');
await pa.getByRole('button', { name: 'Done adding' }).click();
await pa.locator('.ft-card section[aria-label] button[aria-controls^="food-"][aria-expanded="false"]:not([disabled])').first().click(); // open the folded part

t = await pa.locator('body').innerText();
// 248 + 2 eggs 143 + yogurt 165 + chocolate 240 + bar 200 = 996
check(t.includes('996') && t.includes('1,204 kcal left'), 'day total calories: ' + (t.match(/[\d,]+ \/ 2,200 kcal|[\d,]+ kcal left/g) || []).join(' '));
check(t.includes('2 × 1 large'), 'portion shown on the entry');
await pa.screenshot({ path: 'food-day.png', fullPage: true });

// delete one: the row has no buttons of its own; Delete is in the edit form
check(await pa.getByRole('button', { name: 'Delete Protein bar' }).count() === 0, 'no delete button on the row itself');
await pa.getByRole('button', { name: 'Edit Protein bar' }).click();
await pa.screenshot({ path: 'food-edit-delete.png' });
await pa.getByRole('button', { name: 'Delete Protein bar' }).click();
check((await pa.locator('body').innerText()).includes('1,404 kcal left'), 'delete updates totals');

// recent foods
await pa.getByRole('button', { name: '+ Add' }).last().click();
check((await pa.locator('body').innerText()).includes('RECENT'), 'recent list shown');
await pa.getByRole('button', { name: /Done adding/ }).click();

// progress
await pa.getByRole('button', { name: 'PROGRESS' }).click();
await pa.locator('#progress-pick').waitFor();
await pa.locator('#progress-pick').selectOption('food:all');
check((await pa.locator('[aria-label="Measure"] button').allTextContents()).join(',') === 'Calories,Protein,Carbs,Fat', 'food measures');
await pa.getByRole('button', { name: 'Daily' }).click();
t = await pa.locator('body').innerText();
check(t.includes('Target 2.2K') || (await pa.locator('svg text').allTextContents()).some(x => x.startsWith('Target')), 'target line drawn');
check(t.includes('Days within 10% of target'), 'target tile');
await pa.screenshot({ path: 'food-progress.png' });
await pa.getByRole('button', { name: 'Protein' }).click();
check((await pa.locator('body').innerText()).includes('Days at or over target'), 'protein target tile');

// drive sync of food, and export/import between devices
await pa.getByRole('button', { name: 'LOG', exact: true }).click();
await pa.getByText('Connect Google Drive').click(); await waitSynced(pa);
const synced = Object.values(book().months).flatMap(m => Object.values(m).flatMap(d => d.food || []));
check(synced.length === 4 && book().profile.targets.kcal === 2200, 'food and targets sync to Drive');

const openBackup = async (p) => { await p.getByRole('button', { name: 'Menu' }).click(); await p.getByRole('menuitem', { name: 'Back up or move your data…' }).click(); };
const backupPanel = (p) => p.getByRole('region', { name: 'Back up or move your data' });
check(await backupPanel(pa).count() === 0 && await pa.getByText('Back up or move your data').count() === 0, 'backup is no longer at the bottom of the page');
await openBackup(pa);
check(await backupPanel(pa).count() === 1 && await pa.getByRole('menu').count() === 0, 'the menu opens it as a panel');
await pa.screenshot({ path: 'backup-panel.png' });
const [dl] = await Promise.all([pa.waitForEvent('download'), pa.getByRole('button', { name: 'Export backup' }).click()]);
const file = await dl.path();
const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
check(exported.app === 'training-ledger' && exported.profile.targets.protein === 150, 'export file contains data');
await pb.goto('http://localhost:4190/'); await pb.getByText('STRENGTH', { exact: true }).waitFor(); await openBackup(pb);
await pb.getByLabel('Import a backup file').setInputFiles(file);
await pb.getByText(/logged day.*Add them to this log\?/).waitFor();
await pb.getByRole('button', { name: 'Import', exact: true }).click();
await pb.getByText(/^Imported\./).waitFor();
await pb.getByRole('button', { name: 'FOOD', exact: true }).click();
t = await pb.locator('body').innerText();
check(t.includes('1,404 kcal left'), 'import shows food on the other device without reload');
await pb.getByLabel('Import a backup file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
check(await pb.getByText("That file isn't a Training Ledger backup.").waitFor({ timeout: 5000 }).then(() => true, () => false), 'bad file rejected');
await backupPanel(pb).getByRole('button', { name: 'Close' }).click();
check(await backupPanel(pb).count() === 0, 'Close puts it away');
check(offCalls <= 3, 'Open Food Facts only called when asked: ' + offCalls);
check(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
await b.close(); srv.close();
