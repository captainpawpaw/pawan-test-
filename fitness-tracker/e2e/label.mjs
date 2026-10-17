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
let offCalls = [];
for (const ctx of [A, B]) {
  await ctx.route('https://*.openfoodfacts.org/**', async (r) => {
    const u = new URL(r.request().url()); offCalls.push(u.pathname);
    if (u.pathname.startsWith('/api/v2/product/5000112637922')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 1, product: { product_name: 'Crunchy Granola', brands: 'Testbrand', serving_quantity: 45, nutriments: { 'energy-kcal_100g': 999, proteins_100g: 99, carbohydrates_100g: 99, fat_100g: 99, fiber_100g: 3.3, sugars_100g: 99 } } }) });
    r.fulfill({ status: 404, contentType: 'application/json', body: '{"status":0}' });
  });
}
const pa = await A.newPage(), pb = await B.newPage();
const errs = []; for (const p of [pa, pb]) p.on('pageerror', e => errs.push(e.message));
pa.on('dialog', (d) => d.accept());

// --- make the photos: the front of a pack with its barcode, and a UK nutrition label
const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
const G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
const R = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];
const PAR = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];
function ean13svg(code, m = 3, h = 110) {
  const d = code.split('').map(Number);
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (PAR[d[0]][i - 1] === 'L' ? L : G)[d[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  bits += '101';
  const q = 12 * m;
  const rects = [...bits].map((b, i) => (b === '1' ? `<rect x="${q + i * m}" y="0" width="${m}" height="${h}" fill="#000"/>` : '')).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${q * 2 + bits.length * m}" height="${h}" style="background:#fff">${rects}</svg>`;
}
const shot = async (html, w, h) => {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.setContent(`<body style="margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif">${html}</body>`);
  const buf = await p.screenshot(); await p.close(); return buf;
};
const front = await shot(`<div style="padding:40px;display:flex;flex-direction:column;align-items:center;gap:30px"><div style="font-size:64px;font-weight:bold">CRUNCHY GRANOLA</div><div style="font-size:26px">with honey and almonds</div>${ean13svg('5000112637922')}<div style="font-size:22px;letter-spacing:6px">5000112637922</div></div>`, 900, 600);
const label = await shot(`<div style="padding:30px;font-size:30px">
<div style="font-weight:bold;font-size:34px;margin-bottom:12px">NUTRITION</div>
<table style="border-collapse:collapse;width:100%" cellpadding="8">
<tr style="border-bottom:2px solid #000"><td>Typical values</td><td>Per 100g</td><td>Per 45g serving</td></tr>
<tr><td>Energy</td><td>1849kJ<br>441kcal</td><td>832kJ<br>198kcal</td></tr>
<tr><td>Fat</td><td>17.0g</td><td>7.7g</td></tr>
<tr><td>of which saturates</td><td>2.1g</td><td>0.9g</td></tr>
<tr><td>Carbohydrate</td><td>58.0g</td><td>26.1g</td></tr>
<tr><td>of which sugars</td><td>19.5g</td><td>8.8g</td></tr>
<tr><td>Fibre</td><td>7.2g</td><td>3.2g</td></tr>
<tr><td>Protein</td><td>10.4g</td><td>4.7g</td></tr>
<tr><td>Salt</td><td>0.05g</td><td>0.02g</td></tr>
</table></div>`, 900, 760);
fs.writeFileSync('label-front.png', front); fs.writeFileSync('label-table.png', label);

// --- on the website: read on the device, barcode looked up
await pa.goto('http://localhost:4190/'); await pa.getByRole('button', { name: 'FOOD', exact: true }).click(); await pa.getByText('Set daily targets').waitFor();
await pa.getByRole('button', { name: '+ Add' }).last().click();
await pa.getByRole('button', { name: 'Photograph a label' }).click();
check(await pa.getByRole('button', { name: 'Read label' }).isDisabled(), 'Read label waits for a photo');
await pa.getByLabel('Choose photos of the pack and label').setInputFiles([{ name: 'front.png', mimeType: 'image/png', buffer: front }, { name: 'label.png', mimeType: 'image/png', buffer: label }]);
check(await pa.getByRole('img', { name: /Pack photo/ }).count() === 2, 'both photos shown');
await pa.screenshot({ path: 'label-photos.png' });
const t0 = Date.now();
await pa.getByRole('button', { name: 'Read label' }).click();
await pa.getByText('Check the details').waitFor({ timeout: 120000 });
console.log('read in ' + Math.round((Date.now() - t0) / 1000) + 's');
const val = (l) => pa.getByLabel(l, { exact: true }).inputValue();
const NUT = [['kcal', 'Calories (kcal)'], ['protein', 'Protein (g)'], ['carbs', 'Carbs (g)'], ['fat', 'Fat (g)'], ['fibre', 'Fibre (g)'], ['sugar', 'Sugar (g)']];
const column = async (per) => Object.fromEntries(await Promise.all(NUT.map(async ([k, l]) => [k, await val(`${l} per ${per}`)])));
const perServing = await column('serving'), per100 = await column('100 g');
check(JSON.stringify(perServing) === JSON.stringify({ kcal: '198', protein: '4.7', carbs: '26.1', fat: '7.7', fibre: '3.2', sugar: '8.8' }), 'serving column read as printed, shown first: ' + JSON.stringify(perServing));
check(JSON.stringify(per100) === JSON.stringify({ kcal: '441', protein: '10.4', carbs: '58', fat: '17', fibre: '7.2', sugar: '19.5' }), 'per 100 g column read too: ' + JSON.stringify(per100));
const heads = await pa.getByRole('columnheader').allTextContents();
check(heads.join('|') === 'Typical values|Per serving|Per 100 g', 'serving column comes first: ' + heads.join('|'));
check(await val('Name') === 'Crunchy Granola' && await val('Brand (optional)') === 'Testbrand', 'barcode found in the photo; name and brand from Open Food Facts: ' + await val('Name'));
check(await val('Serving weight (g)') === '45' && await val('Serving') === '1 serving' && await val('Barcode (optional)') === '5000112637922', 'serving and barcode filled');
check(offCalls.some(p => p.includes('5000112637922')), 'barcode looked up');
await pa.screenshot({ path: 'label-review.png', fullPage: true });
await pa.getByRole('button', { name: 'Save and add to today' }).click();
await pa.getByRole('button', { name: 'Add to day' }).waitFor();
const units = await pa.getByLabel('Unit').locator('option').allTextContents();
check(units.includes('1 serving (45 g)') && units.some(u => u.startsWith('1 tbsp')), 'saved food has its serving and spoons: ' + units.join(' | '));
await pa.getByLabel('Unit').selectOption({ label: '1 serving (45 g)' });
await pa.getByRole('button', { name: 'Add to day' }).click();
let t = await pa.locator('body').innerText();
check(t.includes('Crunchy Granola (Testbrand)') && t.includes('198 kcal'), 'added to today: 45 g = 198 kcal');
// next time: in My foods, also found by its barcode without asking Open Food Facts
check(await pa.getByText('My foods', { exact: true }).count() === 1, 'My foods listed when adding');
await pa.getByLabel('Search foods').fill('granola');
check(await pa.locator('li', { hasText: 'Crunchy Granola (Testbrand)' }).count() >= 1, 'search finds it under My foods');
const before = offCalls.length;
await pa.getByLabel('Search foods').fill('');
await pa.locator('#barcode-input').fill('5000112637922');
await pa.getByRole('button', { name: 'Look up' }).click();
await pa.getByRole('button', { name: 'Add to day' }).waitFor();
check(offCalls.length === before && (await pa.locator('body').innerText()).includes('My foods · 198 kcal per serving · 441 kcal per 100 g'), 'its barcode brings back My food, no lookup needed');
check(await pa.getByLabel('Unit').inputValue() === '1' && (await pa.locator('body').innerText()).includes('198 kcal'), 'the serving is the default amount');
await pa.getByRole('button', { name: 'Back', exact: true }).click();
await pa.screenshot({ path: 'label-myfoods.png', fullPage: true });
// survives a reload and syncs to another device
await pa.reload(); await pa.getByRole('button', { name: 'FOOD', exact: true }).click();
await pa.getByText('Connect Google Drive').click(); await waitSynced(pa);
check(Object.values(book().myfoods || {}).some(f => f.name === 'Crunchy Granola' && f.per100.kcal === 441 && f.thumb?.startsWith('data:image/jpeg')), 'saved to Drive with a thumbnail');
await pb.goto('http://localhost:4190/'); await pb.getByText('Connect Google Drive').click(); await waitSynced(pb);
await pb.getByRole('button', { name: 'FOOD', exact: true }).click();
await pb.getByRole('button', { name: '+ Add' }).last().click();
const mineOn = (p, n) => p.getByRole('button', { name: `Remove ${n} from My foods` });
const mineToggle = (p) => p.getByRole('button', { name: /^My foods \d/ });
check(await mineToggle(pb).getAttribute('aria-expanded') === 'false' && await mineOn(pb, 'Crunchy Granola (Testbrand)').count() === 0, 'My foods is folded until opened');
await mineToggle(pb).click();
check(await mineOn(pb, 'Crunchy Granola (Testbrand)').count() === 1, 'other device has it in My foods');
// remove
await pa.getByRole('button', { name: '+ Add' }).last().click();
await mineToggle(pa).click();
await pa.getByRole('button', { name: 'Remove Crunchy Granola (Testbrand) from My foods' }).click();
check(await mineOn(pa, 'Crunchy Granola (Testbrand)').count() === 0 && (await pa.locator('body').innerText()).includes('198 kcal'), 'removed from My foods; the logged day keeps it');
// typing it in instead
await pa.getByRole('button', { name: 'Photograph a label' }).click();
await pa.getByRole('button', { name: 'Type it in instead' }).click();
check(await pa.getByRole('button', { name: 'Save to My foods' }).isDisabled(), 'needs a name and calories');
await pa.getByLabel('Name', { exact: true }).fill('Protein Pudding'); await pa.getByLabel('Serving', { exact: true }).fill('1 pot');
await pa.getByLabel('Calories (kcal) per pot').fill('120'); await pa.getByLabel('Protein (g) per pot').fill('15');
check(await pa.getByRole('button', { name: 'Save to My foods' }).isDisabled() && (await pa.locator('body').innerText()).includes('Add the serving’s weight in grams'), 'a serving needs its weight');
await pa.getByLabel('Serving weight (g)').fill('150');
check(await pa.getByLabel('Calories (kcal) per 100 g').getAttribute('placeholder') === '80', 'per 100 g worked out from the serving');
await pa.getByRole('button', { name: 'Save to My foods' }).click();
await pa.getByText('Saved Protein Pudding to My foods.').waitFor({ timeout: 5000 }).catch(() => {});
await mineToggle(pa).click();
check((await pa.locator('body').innerText()).includes('Saved Protein Pudding to My foods.') && await mineOn(pa, 'Protein Pudding').count() === 1 && (await pa.locator('li', { hasText: 'Protein Pudding' }).innerText()).includes('120 kcal · P 15 g per pot'), 'typed food saved, listed per pot');
check(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
await b.close(); srv.close();
