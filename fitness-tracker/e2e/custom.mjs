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


// ---- your own exercises ----
await pa.goto('http://localhost:4190/?tab=log'); await pa.getByText('STRENGTH').waitFor();
const strength = pa.locator('.ft-section').first();
await strength.locator('button', { hasText: '+ Add' }).click();
await pa.getByLabel('Exercise').fill('Landmine Press');
await pa.getByLabel('Sets').fill('3'); await pa.getByLabel('Reps').fill('10'); await pa.getByLabel('Max weight (kg)').fill('25');
await pa.getByRole('button', { name: 'Log a set' }).click();
await pa.getByText('Added “Landmine Press” to your exercises.').waitFor();
check(true, 'logging a new name adds it to your exercises');
// logging a known exercise doesn't
await strength.locator('button', { hasText: '+ Add' }).click();
await pa.getByLabel('Exercise').fill('Back Squat'); await pa.getByLabel('Sets').fill('1'); await pa.getByLabel('Reps').fill('1'); await pa.getByLabel('Max weight (kg)').fill('1');
await pa.getByRole('button', { name: 'Log a set' }).click();
await pa.waitForTimeout(300);
check(!(await pa.locator('body').innerText()).includes('Added “Back Squat”'), 'known exercises are not re-added');
// cardio
await pa.locator('.ft-section').last().locator('button', { hasText: '+ Add' }).click();
await pa.getByLabel('Activity').fill('Padel'); await pa.getByLabel('Minutes').fill('60');
await pa.getByRole('button', { name: 'Log a session' }).click();
await pa.getByText('Added “Padel” to your exercises.').waitFor();
// it now suggests in the log
await strength.locator('button', { hasText: '+ Add' }).click();
await pa.getByLabel('Exercise').fill('landmine');
check((await pa.getByRole('option').allInnerTexts()).some((o) => o.startsWith('Landmine Press')), 'new exercise suggested when logging');
await pa.locator('button', { hasText: 'Cancel' }).first().click();

await pa.getByRole('button', { name: 'EXERCISES' }).click();
await pa.getByLabel('Search exercises').fill('landmine');
let t = await pa.locator('body').innerText();
check(/Landmine Press\nStrength · Your Exercise\n#your exercise/i.test(t), 'logged name saved as your exercise, tagged #your exercise');
await pa.getByLabel('Search exercises').fill('padel');
check(/Padel\nCardio · Your Exercise/i.test(await pa.locator('body').innerText()), 'cardio one filed as cardio');

// New exercise button
await pa.getByRole('button', { name: '+ New exercise' }).click();
await pa.locator('#new-exercise-name').fill('Banded Hip Airplane');
await pa.getByLabel('Type').selectOption('strength');
await pa.getByLabel('Equipment (optional)').selectOption('other');
await pa.getByLabel('Main muscle (optional)').selectOption('quadriceps');
await pa.getByLabel('Tags (optional, separate with commas)').fill('Legs Day, conditioning');
await pa.screenshot({ path: 'new-exercise.png' });
await pa.getByRole('button', { name: 'Save exercise' }).click();
await pa.waitForTimeout(800); await pa.getByText(/^Banded Hip Airplane$/).first().waitFor();
t = await pa.locator('body').innerText();
check(await pa.getByLabel('Search exercises').inputValue() === 'Banded Hip Airplane', 'library jumps to the new exercise');
check(/Banded Hip Airplane\nStrength · Other · Quadriceps · Your Exercise/i.test(t) && t.includes('#legs day') && t.includes('#conditioning') && t.includes('#your exercise'), 'saved with details, tags and #your exercise');
await pa.screenshot({ path: 'new-exercise-saved.png' });
// duplicate
await pa.getByRole('button', { name: '+ New exercise' }).click();
await pa.locator('#new-exercise-name').fill('back squat');
await pa.getByRole('button', { name: 'Save exercise' }).click();
check((await pa.locator('body').innerText()).includes('“back squat” is already in your exercises.'), 'duplicates refused');
await pa.getByRole('button', { name: 'Cancel' }).click();
// persists and can be removed
await pa.reload(); await pa.getByRole('button', { name: 'EXERCISES' }).click(); await pa.getByLabel('Search exercises').fill('airplane');
check((await pa.locator('body').innerText()).includes('Banded Hip Airplane'), 'persists after reload');
await pa.getByRole('button', { name: 'Tag Banded Hip Airplane', exact: true }).click();
await pa.getByRole('button', { name: 'Remove this exercise' }).click();
check(!(await pa.locator('body').innerText()).includes('Banded Hip Airplane'), 'can be removed');

// ---- automatic sync ----
await pa.getByRole('button', { name: 'LOG', exact: true }).click();
await pa.getByText('Connect Google Drive').click(); await waitSynced(pa);
check(Object.values(book().exercises || {}).some((e) => e.name === 'Landmine Press' && e.custom), 'your exercises sync to Drive');
await pb.goto('http://localhost:4190/?tab=log'); await pb.getByText('Connect Google Drive').click(); await waitSynced(pb);
await pb.reload(); await pb.getByText('STRENGTH').waitFor();
await pb.getByText('Your log may be out of date. Tap anywhere to sync with Google Drive.').waitFor();
check(true, 'after reopening, notice says the log may be out of date');
await pb.screenshot({ path: 'sync-notice.png' });
// add on A; B taps anywhere and gets it
await strength.locator('button', { hasText: '+ Add' }).click();
await pa.getByLabel('Exercise').fill('Back Squat'); await pa.getByLabel('Sets').fill('5'); await pa.getByLabel('Reps').fill('5'); await pa.getByLabel('Max weight (kg)').fill('140');
await pa.getByRole('button', { name: 'Log a set' }).click(); await pa.waitForTimeout(2500); await waitSynced(pa);
await pb.locator('[data-dayswipe] > span').first().click(); // tap the date heading
await waitSynced(pb);
check((await pb.locator('body').innerText()).includes('5×5 · max 140kg'), 'first tap anywhere syncs and shows the other device\'s entry');
check(!(await pb.locator('body').innerText()).includes('Tap anywhere to sync'), 'notice goes away');
check((await pb.evaluate(() => window.__prompts)).every((p) => p === ''), 'no permission screen on the automatic sign-in');
// returning to the tab pulls changes while signed in
await strength.locator('button', { hasText: '+ Add' }).click();
await pa.getByLabel('Exercise').fill('Back Squat'); await pa.getByLabel('Sets').fill('3'); await pa.getByLabel('Reps').fill('3'); await pa.getByLabel('Max weight (kg)').fill('150');
await pa.getByRole('button', { name: 'Log a set' }).click(); await pa.waitForTimeout(2500); await waitSynced(pa);
await pb.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); window.dispatchEvent(new Event('focus')); });
await pb.waitForTimeout(400);
await pb.evaluate(() => window.dispatchEvent(new Event('focus')));
await pb.getByText('3×3 · max 150kg').waitFor({ timeout: 5000 }).catch(() => {});
const bt = await pb.locator('body').innerText();
check(bt.includes('3×3 · max 150kg'), 'returning to the app pulls new entries');

// ---- names logged before this feature are added on open ----
const C = await b.newContext({ viewport: { width: 420, height: 900 } }); await setup(C);
await C.addInitScript(() => {
  if (localStorage.getItem('seeded')) return;
  localStorage.setItem('fitness-tracker:month:2026-10', JSON.stringify({ '11': { strength: [
    { id: 'a1', exercise: 'Front Pull Down Machine', sets: '3', reps: '10', weight: '60' },
    { id: 'a2', exercise: 'front pull down machine', sets: '3', reps: '10', weight: '60' },
    { id: 'a3', exercise: 'Single cable pull down', sets: '3', reps: '10', weight: '12.5' },
    { id: 'a4', exercise: 'Back Squat', sets: '3', reps: '5', weight: '100' },
    { id: 'a5', exercise: 'Ring Dip Hold', sets: '3', reps: '1', bw: true } ], cardio: [ { id: 'c1', activity: 'Padel', duration: '60' } ] } }));
  localStorage.setItem('seeded', '1');
});
const pc = await C.newPage(); pc.on('pageerror', (e) => errs.push(e.message));
await pc.goto('http://localhost:4190/?tab=log');
await pc.getByText("Added 4 exercises you've logged to your exercises.").waitFor({ timeout: 8000 });
check(true, 'earlier logged names added once each (case ignored, built-in Back Squat skipped)');
await pc.getByRole('button', { name: 'EXERCISES' }).click();
await pc.getByRole('button', { name: /#your exercise 4/ }).click();
t = await pc.locator('body').innerText();
check(t.includes('Front Pull Down Machine') && t.includes('Single cable pull down') && t.includes('Ring Dip Hold') && t.includes('Padel') && !t.includes('Back Squat'), 'tap #your exercise to see them all');
check(/Ring Dip Hold\nStrength · Body Only · Your Exercise/i.test(t) && /Padel\nCardio · Your Exercise/i.test(t), 'type and body weight carried over');
await pc.screenshot({ path: 'your-exercises.png' });
await pc.reload(); await pc.waitForTimeout(1500);
check(!(await pc.locator('body').innerText()).includes("you've logged to your exercises"), 'not added again on the next visit');
check(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
await b.close(); srv.close();
