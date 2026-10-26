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


let external = 0;
await A.route('https://*.openfoodfacts.org/**', (r) => { external++; r.abort(); });
await A.addInitScript(() => {
  window.__saved = []; window.__prompts = [];
  const sample = async () => ({ text: '' });
  sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 4, maxInputBytes: 20e6, mediaTypes: ['image/png', 'image/jpeg'] } });
  sample.json = async (prompt, opts) => {
    window.__prompts.push({ prompt, images: [].concat(opts.images || []).length });
    if (prompt.includes('nutrition information label')) return { name: 'Protein Granola', brand: 'Testbrand', perServing: { kcal: 165, protein: 9, carbs: 19.2, fat: 5.2, fibre: 2.6, sugar: 3.9 }, servingLabel: '1 bowl', per100: { kcal: 412, protein: 22.5, carbs: 48, fat: 13.1, fibre: 6.4, sugar: 9.8 }, servingGrams: 40, barcode: '5012345678900', note: '' };
    return { items: [ { name: 'Chicken tikka masala', grams: 350, kcal: 520, protein: 38, carbs: 18, fat: 32, fibre: 3, sugar: 9 }, { name: 'Pilau rice', grams: 200, kcal: 300, protein: 6, carbs: 60, fat: 5 } ], note: 'Assumed a restaurant portion.' };
  };
  const downloads = { save: async (req) => { window.__saved.push({ filename: req.filename, size: String(req.data).length }); } };
  window.claude = { use: async (n) => (n === 'sample' ? sample : n === 'downloads' ? downloads : null) };
});
await pa.goto('http://localhost:4190/?tab=log'); await pa.getByRole('button', { name: 'FOOD', exact: true }).click(); await pa.getByText('Set daily targets').waitFor();
await pa.screenshot({ path: 'food-tab.png' });
check(!(await pa.locator('body').innerText()).includes('STRENGTH'), 'food tab shows only food');
await pa.getByRole('button', { name: '+ Add' }).last().click();
await pa.getByLabel('Search foods').fill('banana');
await pa.waitForTimeout(900);
let t = await pa.locator('body').innerText();
check(t.includes('Bananas, flesh only'), 'built-in foods work on the claude.ai link');
check(!t.includes('Search branded products') && !t.includes('Or type a barcode') && !t.includes('Scan barcode'), 'online-only options hidden');
check(external === 0, 'no calls to outside services');
await pa.getByRole('button', { name: 'Describe a meal for Claude' }).click();
await pa.getByLabel('Describe what you ate').fill('chicken tikka masala with pilau rice');
const png = await pa.evaluate(async () => { const c = document.createElement('canvas'); c.width = 40; c.height = 40; const b = await new Promise(r => c.toBlob(r, 'image/png')); return Array.from(new Uint8Array(await b.arrayBuffer())); });
await pa.getByLabel('Add a photo of your meal').setInputFiles({ name: 'meal.png', mimeType: 'image/png', buffer: Buffer.from(png) });
check(await pa.getByRole('img', { name: 'Meal photo 1' }).count() === 1, 'photo attached');
await pa.getByRole('button', { name: 'Estimate with Claude' }).click();
await pa.getByText("Claude's estimate").waitFor();
const pr = await pa.evaluate(() => window.__prompts);
check(pr.length === 1 && pr[0].images === 1 && pr[0].prompt.includes('chicken tikka masala with pilau rice'), 'Claude gets the description and photo');
await pa.screenshot({ path: 'food-claude.png' });
await pa.getByRole('spinbutton').nth(1).fill('100'); // rice 200g -> 100g
t = await pa.locator('body').innerText();
check(t.includes('150 kcal'), 'changing grams rescales the estimate');
await pa.getByRole('button', { name: 'Add 2 items' }).click();
await pa.getByRole('button', { name: 'Done adding' }).click();
await pa.locator('.ft-card section[aria-label] button[aria-controls^="food-"][aria-expanded="false"]:not([disabled])').first().click(); // open the folded part
t = await pa.locator('body').innerText();
check(t.includes('Chicken tikka masala') && t.includes('≈ estimate') && t.includes('670'), 'estimate added and marked: ' + (t.match(/\d[\d,]* kcal/g) || []).slice(0, 4).join(' '));
// label photos: Claude reads them; saved to My foods
await pa.getByRole('button', { name: '+ Add' }).last().click();
await pa.getByRole('button', { name: 'Photograph a label' }).click();
check((await pa.locator('body').innerText()).includes('Claude reads the photos'), 'claude.ai: Claude reads the label');
await pa.getByLabel('Choose photos of the pack and label').setInputFiles([{ name: 'front.png', mimeType: 'image/png', buffer: Buffer.from(png) }, { name: 'label.png', mimeType: 'image/png', buffer: Buffer.from(png) }]);
await pa.getByRole('button', { name: 'Read label' }).click();
await pa.getByText('Check the details').waitFor();
const lp = (await pa.evaluate(() => window.__prompts)).at(-1);
check(lp.images === 2 && lp.prompt.includes('per 100 g'), 'Claude gets both photos');
check(await pa.getByLabel('Name', { exact: true }).inputValue() === 'Protein Granola' && await pa.getByLabel('Calories (kcal) per bowl').inputValue() === '165' && await pa.getByLabel('Calories (kcal) per 100 g').inputValue() === '412' && await pa.getByLabel('Serving weight (g)').inputValue() === '40', 'Claude\'s reading fills the form, serving first');
check(lp.prompt.includes('single serving matters most'), 'Claude is told the serving comes first');
await pa.getByRole('button', { name: 'Save to My foods' }).click();
await pa.getByRole('button', { name: /^My foods \d/ }).click(); // open the folded group
await pa.getByRole('button', { name: 'Remove Protein Granola (Testbrand) from My foods' }).waitFor({ timeout: 5000 }).catch(() => {});
check(await pa.getByRole('button', { name: 'Remove Protein Granola (Testbrand) from My foods' }).count() === 1 && external === 0, 'saved to My foods, nothing sent outside');
await pa.getByRole('button', { name: 'Done adding' }).click();
await pa.getByRole('button', { name: 'Menu' }).click(); await pa.getByRole('menuitem', { name: 'Back up or move your data…' }).click();
await pa.getByRole('button', { name: 'Export backup' }).click();
await pa.getByText(/^Saved a backup of/).waitFor();
const saved = await pa.evaluate(() => window.__saved);
check(saved.length === 1 && /^training-ledger-\d{4}-\d\d-\d\d\.json$/.test(saved[0].filename) && saved[0].size > 100, 'export uses the claude.ai download prompt: ' + JSON.stringify(saved));
check(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
await b.close(); srv.close();
