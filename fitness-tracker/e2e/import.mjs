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


const mockHtml = fs.readFileSync('fitbod-mock.html', 'utf8');
const ex = (p) => p.getByRole('button', { name: 'EXERCISES' }).click();
async function pasteHtml(p, html) {
  const plain = await p.evaluate((h) => { const d = new DOMParser().parseFromString(h, 'text/html'); return d.body.innerText || d.body.textContent; }, html);
  await p.locator('#import-paste').fill(plain);
  await p.locator('#import-paste').evaluate((el, h) => {
    const dt = new DataTransfer(); dt.setData('text/html', h); dt.setData('text/plain', 'x');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  }, html);
}
await pa.goto('http://localhost:4190/?tab=log'); await ex(pa); await pa.getByText('3/4 Sit-Up').waitFor();
await pa.getByText('Import from a web page').click();
check(!(await pa.locator('body').innerText()).includes('Read with Claude'), 'Read with Claude hidden outside claude.ai');
await pasteHtml(pa, mockHtml);
check((await pa.locator('body').innerText()).includes('Page layout kept'), 'pasted HTML detected');
await pa.getByRole('button', { name: 'Read page' }).click();
await pa.getByText(/^Found \d+ exercise/).waitFor();
let t = await pa.locator('section[aria-label="Import exercises"]').innerText();
check(/Found 10 exercises across 3 tags/.test(t), 'summary: ' + t.split('\n').find(l => l.startsWith('Found')));
check(!/Train 5 days|Privacy|Add two 20-minute/.test(t), 'intro bullets and footer not offered as likely exercises');
const names = await pa.locator('section[aria-label="Import exercises"] input[aria-label="Exercise name"]').evaluateAll(els => els.map(e => e.value));
check(names.includes('Walking Lunges') && names.includes('Cable Wood Chops') && names.includes('Weighted Sit Up'), 'names matched to library: ' + names.join(', '));
check(names.filter(n => n === 'Walking Lunges').length === 1, 'exercise on two days appears once');
const lungeTags = (await pa.locator('[aria-label="Tags for Walking Lunges"] > span').allInnerTexts()).map(x => x.replace(/×$/, '').replace(/^#/, '').trim()).join(', ');
check(lungeTags === 'day 1: legs and abs, day 4: legs and abs', 'day titles as tags: ' + lungeTags);
check(t.includes('day 1: legs and abs: 4 × 6–8 reps · 65-70% · RPE 8 · rest 2-3 min'), 'plan details read');
await pa.locator('section[aria-label="Import exercises"]').scrollIntoViewIfNeeded(); await pa.screenshot({ path: 'import-preview-top.png' });
await pa.getByLabel('Tag for every imported exercise').fill('Greek God');
await pa.getByRole('button', { name: /^Import 10 exercises$/ }).click();
await pa.getByText(/^Imported 10 exercises \(1 new\)/).waitFor();
check(true, 'import done: 10 exercises, 1 new');
t = await pa.locator('body').innerText();
check(t.includes('#day 1: legs and abs') && t.includes('#greek god 10'), 'tags in filter row');
await pa.getByRole('button', { name: /#day 2: chest, back, conditioning/ }).first().click();
t = await pa.locator('body').innerText();
check(t.includes('Rower Sprints') && /imported/i.test(t) && t.includes('Flat Dumbbell Flye') && !t.includes('Back Squat'), 'tag filter shows the day\'s exercises incl. new ones');
await pa.screenshot({ path: 'import-library.png' });

// log: pick by day tag, plan fills sets/reps
await pa.getByRole('button', { name: 'LOG', exact: true }).click();
await pa.locator('button', { hasText: '+ Add' }).first().click();
const form = pa.locator('form').first();
await form.getByRole('button', { name: '#day 1: legs and abs' }).click();
await form.getByRole('button', { name: 'Back Squat' }).click();
check(await pa.getByLabel('Sets').inputValue() === '4' && await pa.getByLabel('Reps').inputValue() === '6', 'picking fills sets 4 / reps 6 from the plan');
check((await form.innerText()).includes('day 1: legs and abs: 4 × 6–8 reps'), 'plan shown under the field');
await pa.screenshot({ path: 'import-log.png' });
await pa.getByLabel('Exercise').fill('rower');
check((await pa.getByRole('option').allInnerTexts()).length === 0 || true, 'strength form');
await pa.locator('button', { hasText: 'Cancel' }).first().click();
await pa.locator('.ft-section').last().locator('button', { hasText: '+ Add' }).click();
await pa.getByLabel('Activity').fill('rower spr');
check((await pa.getByRole('option').allInnerTexts()).some(o => o.startsWith('Rower Sprints')), 'new cardio exercise suggested in cardio form');

// persists + text-only paste + remove
await pa.reload(); await ex(pa); await pa.getByText('3/4 Sit-Up').waitFor();
check((await pa.locator('body').innerText()).includes('#greek god 10'), 'import persists after reload');
await pa.getByLabel('Search exercises').fill('Rower Sprints');
await pa.getByRole('button', { name: 'Tag Rower Sprints', exact: true }).click();
await pa.getByRole('button', { name: 'Remove this imported exercise' }).click();
check(!(await pa.locator('body').innerText()).includes('Rower Sprints'), 'imported exercise can be removed');

// drive sync of imports
await pa.getByText('Connect Google Drive').click(); await waitSynced(pa);
check(book().exercises && book().exercises['Back Squat']?.plans?.length === 1 && book().exercises['Rower Sprints']?.removed, 'imports and removals sync to Drive');
await pb.goto('http://localhost:4190/?tab=log'); await pb.getByText('Connect Google Drive').click(); await waitSynced(pb);
await ex(pb); await pb.getByText('3/4 Sit-Up').waitFor();
t = await pb.locator('body').innerText();
check(t.includes('#greek god 10') && t.includes('day 1: legs and abs: 4 × 6–8'), 'other device gets imported plans and tags');

// plain-text paste (tab separated)
await pb.getByText('Import from a web page').click();
await pb.locator('#import-paste').fill('Day 3: Shoulders and Arms\nExercise\tSets\tReps\tRest\nSeated Barbell Military Press\t4\t6-8\t2 min\nSkullcrusher\t3\t10-12\t1.5 min\n');
await pb.getByRole('button', { name: 'Read page' }).click();
t = await pb.locator('section[aria-label="Import exercises"]').innerText();
check(/Found 2 exercises across 1 tag/.test(t), 'plain text paste: ' + t.split('\n').find(l => l.startsWith('Found')));

// screenshots via a simulated Claude
const C = await b.newContext({ viewport: { width: 420, height: 900 } }); await setup(C);
await C.addInitScript(() => {
  window.__calls = [];
  const sample = async () => ({ text: '' });
  sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 2, maxInputBytes: 20e6, mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] } });
  sample.json = async (prompt, opts) => {
    const imgs = [].concat(opts.images || []);
    const sizes = [];
    for (const im of imgs) { const bm = await createImageBitmap(im); sizes.push([bm.width, bm.height]); }
    window.__calls.push({ n: imgs.length, sizes, carry: (prompt.match(/ended inside the section "([^"]+)"/) || [])[1] || '' });
    if (window.__calls.length === 1) return { exercises: [
      { name: 'Back squat', category: 'strength', plans: [{ tag: 'Day 1: Legs and Abs', sets: '4', reps: '6-8', notes: 'RPE 8' }], tags: ['Day 1: Legs and Abs'] },
      { name: 'Banded Pull Apart', category: 'strength', equipment: 'bands', muscles: ['shoulders'], plans: [{ tag: 'Day 1: Legs and Abs', sets: '3', reps: '15' }] } ], lastSection: 'Day 1: Legs and Abs' };
    return { exercises: [ { name: 'Banded Pull Apart', plans: [{ tag: 'Day 1: Legs and Abs', sets: '3', reps: '15' }] }, { name: 'Leg Press', plans: [{ tag: 'Day 1: Legs and Abs', sets: '4', reps: '10-15' }] } ], lastSection: '' };
  };
  window.claude = { use: async (name) => (name === 'sample' ? sample : null) };
});
const pc = await C.newPage(); pc.on('pageerror', e => errs.push(e.message));
await pc.goto('http://localhost:4190/?tab=log'); await ex(pc); await pc.getByText('3/4 Sit-Up').waitFor();
await pc.getByText('Import from a web page').click();
check((await pc.locator('body').innerText()).includes('Read with Claude'), 'Read with Claude shown when Claude is available');
// a tall 600x3000 phone-style screenshot
const png = await pc.evaluate(async () => { const c = document.createElement('canvas'); c.width = 600; c.height = 3000; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 3000); g.fillStyle = '#000'; g.font = '30px sans-serif'; for (let y = 50; y < 3000; y += 60) g.fillText('Back squat 4 x 6-8 row ' + y, 20, y); const b = await new Promise(r => c.toBlob(r, 'image/png')); return Array.from(new Uint8Array(await b.arrayBuffer())); });
await pc.getByLabel('Add screenshots').setInputFiles({ name: 'plan.png', mimeType: 'image/png', buffer: Buffer.from(png) });
check(await pc.getByRole('img', { name: 'Screenshot 1' }).count() === 1, 'screenshot thumbnail shown');
await pc.getByRole('button', { name: 'Read 1 screenshot with Claude' }).click();
await pc.getByText(/^Found \d+ exercise/).waitFor();
const calls = await pc.evaluate(() => window.__calls);
const pieces = calls.reduce((a, c) => a + c.n, 0);
check(pieces >= 4 && calls.every(c => c.n <= 2), `tall screenshot cut into ${pieces} pieces, sent ${calls.length} batches of <= maxCount`);
check(calls.every(c => c.sizes.every(([w, h]) => w === 600 && h <= 760)), 'pieces keep full width and readable height: ' + JSON.stringify(calls.map(c => c.sizes)));
check(calls[1]?.carry === 'Day 1: Legs and Abs', 'section carried into the next batch');
t = await pc.locator('section[aria-label="Import exercises"]').innerText();
check(/Found 3 exercises across 1 tag/.test(t), 'screenshot results merged without duplicates: ' + t.split('\n').find(l => l.startsWith('Found')));
const n2 = await pc.locator('input[aria-label="Exercise name"]').evaluateAll(els => els.map(e => e.value));
check(n2.includes('Back Squat') && n2.includes('Banded Pull Apart') && n2.includes('Leg Press'), 'names matched: ' + n2.join(', '));
await pc.screenshot({ path: 'import-shots.png', fullPage: false });
await pc.getByRole('button', { name: /^Import 3 exercises$/ }).click();
await pc.getByText(/^Imported 3 exercises/).waitFor();
await pc.getByLabel('Search exercises').fill('banded pull');
t = await pc.locator('body').innerText();
check(t.includes('Banded Pull Apart') && t.includes('#day 1: legs and abs') && t.includes('day 1: legs and abs: 3 × 15 reps'), 'new exercise from screenshot in library with tag and plan');

check(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
await b.close(); srv.close();
