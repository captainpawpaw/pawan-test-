// Phone layout: no sideways scrolling at common widths, and text boxes at
// 16px so iPhone Safari doesn't zoom in when one is tapped.
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const D = process.argv[2];
const srv = http.createServer((q, r) => { let p = q.url.split('?')[0]; if (p === '/') p = '/index.html'; const f = path.join(D, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.json') ? 'application/json' : 'text/html' }); fs.createReadStream(f).pipe(r); }).listen(4196);
const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
for (const w of [320, 375, 390, 430]) {
  const c = await b.newContext({ viewport: { width: w, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  await c.route('https://**', (r) => r.fulfill({ body: '' }));
  await c.addInitScript(() => {
    const names = ['Cable Face Pull', 'Incline Dumbbell Hammer Curl', 'Seated Barbell Military Press', 'Cable bar pull down isometric hold'];
    const d = new Date(); const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; const day = String(d.getDate()).padStart(2, '0');
    localStorage.setItem('fitness-tracker:month:' + mk, JSON.stringify({ [day]: { strength: names.map((n, i) => ({ id: 'x' + i, exercise: n, sets: '4', reps: '12', weight: '23.75' })), cardio: [] } }));
  });
  const p = await c.newPage(); await p.goto('http://localhost:4196/'); await p.getByText('STRENGTH').waitFor();
  const bad = [];
  for (const tab of ['LOG', 'FOOD', 'EXERCISES', 'PROGRESS']) {
    await p.getByRole('button', { name: tab, exact: true }).click(); await p.waitForTimeout(400);
    const r = await p.evaluate(() => ({ vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth }));
    if (r.sw > r.vw) bad.push(`${tab} ${r.sw}>${r.vw}`);
  }
  check(!bad.length, `${w}px wide: no sideways scrolling ${bad.join(', ')}`);
  await p.getByRole('button', { name: 'LOG', exact: true }).click();
  await p.locator('.ft-section').first().locator('button', { hasText: '+ Add' }).click();
  const sizes = await p.locator('input, select, textarea').evaluateAll((els) => [...new Set(els.map((e) => getComputedStyle(e).fontSize))]);
  check(sizes.every((s) => parseFloat(s) >= 16), `${w}px wide: text boxes are 16px or more (${sizes.join(', ')})`);
  await c.close();
}
await b.close(); srv.close();
