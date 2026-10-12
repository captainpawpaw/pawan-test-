// Turns the text of a nutrition label (read off a photo) into per-100 g
// values. Handles UK/EU tables ("Per 100g | Per 30g serving", kJ and kcal,
// "of which sugars") and US "Nutrition Facts" panels (values per serving,
// converted with the serving size in grams).

const r1 = (n) => Math.round(n * 10) / 10;

// Common OCR slips inside numbers: O for 0, l/I for 1, comma decimals.
function clean(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/(\d)[oO](?=[\d.,]*\s*(g|kcal|kj|mg)\b)/gi, "$10")
    .replace(/(\d)[oO]\b/g, "$10")
    .replace(/\b[oO](?=[.,]\d)/g, "0")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[|]/g, " ")
    .replace(/[ \t]+/g, " ")
    .toLowerCase();
}

// Numbers on a line, skipping percentages (reference intakes, % daily value).
function numbers(line) {
  const out = [];
  const re = /(<\s*)?(\d+(?:\.\d+)?)\s*(kcal|kj|mg|g|ml)?(\s*%)?/g;
  let m;
  while ((m = re.exec(line))) {
    if (m[4]) continue;
    out.push({ v: m[1] ? 0 : Number(m[2]), unit: m[3] || "" });
  }
  return out;
}

const NUTRIENT_LINES = {
  // [match, reject]
  fat: [/\b(total\s+)?fat\b/, /satur|trans|mono|poly|of which|omega/],
  carbs: [/carbohydrate|\bcarbs?\b/, /of which|sugar|fibre|fiber|polyol|starch/],
  sugar: [/sugars?\b/, /added|includes|alcohol|polyol/],
  fibre: [/\bfib(re|er)\b/, /^$/],
  protein: [/\bprotein\b/, /^$/],
};

export function parseNutritionText(text) {
  const t = clean(text);
  const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
  const all = lines.join("\n");

  const us = /nutrition facts|serving size|daily value|amount per serving/.test(all) && !/per\s*100\s*g/.test(all);

  // Serving size in grams: "per 30g serving", "serving size 2/3 cup (55g)", "portion (40g)".
  let servingG = null;
  const servingMatch =
    all.match(/serving size[^\n]*?\(?\s*(\d+(?:\.\d+)?)\s*(g|ml)\b/) ||
    all.match(/per\s+(?:\d+\s*x\s*)?(\d+(?:\.\d+)?)\s*(g|ml)\s*(?:serving|portion|bar|pack|slice|biscuit|pot|bag)/) ||
    all.match(/(?:serving|portion)[^\n]{0,20}?\(?\s*(\d+(?:\.\d+)?)\s*(g|ml)\b/);
  if (servingMatch && Number(servingMatch[1]) !== 100) servingG = Number(servingMatch[1]);

  // Which column comes first: per 100 g (UK/EU) unless only a serving column exists.
  const header = lines.find((l) => /per\s*100\s*(g|ml)|100\s*(g|ml)\b/.test(l) && /(serving|portion|per\s*\d)/.test(l)) || "";
  let per100First = true;
  if (header) {
    const i100 = header.search(/100\s*(g|ml)/);
    const iServ = header.search(/serving|portion|per\s*(?!100)\d/);
    per100First = iServ < 0 || i100 < iServ;
  }
  const basis = us ? "serving" : "100g";
  const pick = (vals) => {
    if (!vals.length) return null;
    if (basis === "serving") return vals[0];
    return per100First || vals.length < 2 ? vals[0] : vals[1];
  };
  const toPer100 = (v) => (v == null ? null : basis === "serving" ? (servingG ? (v / servingG) * 100 : null) : v);

  const found = {};
  // Energy: kcal values anywhere (the line may wrap under "Energy"); else kJ.
  const kcalVals = [...all.matchAll(/(\d+(?:\.\d+)?)\s*kcal/g)].map((m) => Number(m[1]));
  const kjVals = [...all.matchAll(/(\d+(?:\.\d+)?)\s*kj/g)].map((m) => Number(m[1]));
  let kcal = pick(kcalVals);
  if (kcal == null && kjVals.length) kcal = pick(kjVals) / 4.184;
  if (kcal == null) {
    const cal = all.match(/calories\s*(\d+(?:\.\d+)?)/);
    if (cal) kcal = Number(cal[1]);
  }
  if (kcal != null) found.kcal = toPer100(kcal);

  for (const [key, [match, reject]] of Object.entries(NUTRIENT_LINES)) {
    const line = lines.find((l) => match.test(l) && !reject.test(l) && numbers(l.replace(match, "")).length);
    if (!line) continue;
    const vals = numbers(line.replace(match, "")).filter((n) => n.unit !== "mg" && n.unit !== "kcal" && n.unit !== "kj").map((n) => n.v);
    const v = pick(vals);
    if (v != null) found[key] = toPer100(v);
  }

  const per100 = {};
  const missing = [];
  for (const k of ["kcal", "protein", "carbs", "fat", "fibre", "sugar"]) {
    const v = found[k];
    const ok = v != null && Number.isFinite(v) && v >= 0 && (k === "kcal" ? v <= 950 : v <= 100);
    if (ok) per100[k] = k === "kcal" ? Math.round(v) : r1(v);
    else missing.push(k);
  }
  // No energy but the macros are there: estimate it (4/4/9 kcal per g).
  let kcalEstimated = false;
  if (per100.kcal == null && per100.protein != null && per100.carbs != null && per100.fat != null) {
    per100.kcal = Math.round(per100.protein * 4 + per100.carbs * 4 + per100.fat * 9);
    kcalEstimated = true;
    missing.splice(missing.indexOf("kcal"), 1);
  }
  const barcode = (all.match(/\b(\d{13}|\d{12}|\d{8})\b/) || [])[1] || null;
  return { per100, missing, servingG, basis, kcalEstimated, barcode };
}

// A plain-language list of what still needs checking.
export function missingLabel(missing) {
  const names = { kcal: "calories", protein: "protein", carbs: "carbs", fat: "fat", fibre: "fibre", sugar: "sugar" };
  return missing.map((k) => names[k]).join(", ");
}

/* ---------- from word positions (on-device reader) ---------- */
// Table labels read better from where each word sits than from text lines:
// stacked cells ("1849kJ" over "441kcal") and column-wise reading order break
// line-based parsing. Each nutrient's name anchors a row; the number nearest
// the "Per 100g" column is the value; the serving column checks it.
// words: [{ text, x0, y0, x1, y1 }]

const ROW_ANCHORS = {
  fat: [/^fat:?$/, /satur|trans|mono|poly|of$|which/],
  carbs: [/^carbohydrates?:?$|^carbs:?$/, /which|sugar/],
  sugar: [/^sugars?:?$/, /added|includes/],
  fibre: [/^fib(re|er):?$/, /^$/],
  protein: [/^protein:?$/, /^$/],
};

// Number readings for a mass value, most likely first. OCR often reads "g"
// as "9" or "¢" ("17.09" for 17.0g), "1" as "l", and drops decimal points
// ("195g" for 19.5g).
export function massCandidates(token) {
  const t = String(token).toLowerCase().replace(/,/g, ".").replace(/^[<~]/, "")
    .replace(/^[li|](?=[.\d])/, "1").replace(/(?<=[\d.])[li|](?=[\d.])/g, "1")
    .replace(/[o](?=\d)|(?<=\d)o/g, "0");
  const m = t.match(/^(\d+(?:\.\d+)?)([a-z¢$%]*)$/);
  if (!m || /^%/.test(m[2]) || m[2] === "mg" || /k/.test(m[2])) return [];
  const raw = m[1];
  const out = [];
  const unitG = /g/.test(m[2]);
  if (!unitG && raw.includes(".") && raw.endsWith("9") && raw.split(".")[1].length >= 2) out.push(Number(raw.slice(0, -1)));
  out.push(Number(raw));
  for (const v of [...out]) if (v >= 10) out.push(v / 10);
  return [...new Set(out.map((v) => Math.round(v * 100) / 100))];
}

function energyFrom(token) {
  const t = String(token).toLowerCase().replace(/,/g, ".");
  const kcal = t.match(/^(\d+(?:\.\d+)?)\s*k?[ce][ae]?[l1i]$/) || t.match(/^(\d+(?:\.\d+)?)kcal/);
  if (kcal) return { kcal: Number(kcal[1]) };
  const kj = t.match(/^(\d+(?:\.\d+)?)\s*k[j)]/);
  if (kj) return { kj: Number(kj[1]) };
  return null;
}

const cx = (w) => (w.x0 + w.x1) / 2;
const cy = (w) => (w.y0 + w.y1) / 2;
const KEYS = ["kcal", "protein", "carbs", "fat", "fibre", "sugar"];
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

// Serving name from a column heading: "Per average slice" → "1 average slice",
// "Per 45g serving" → "1 serving", "per bar (40g)" → "1 bar".
function servingName(words) {
  const t = words.map((w) => w.t).join(" ").replace(/[()*:]/g, " ").replace(/\b\d+(\.\d+)?\s*(g|ml)\b/g, " ").replace(/\b(per|typical|values?|%|ri|reference|intake)\b/g, " ").replace(/\s+/g, " ").trim();
  return t && /[a-z]{3}/.test(t) ? `1 ${t}` : "1 serving";
}

export function parseNutritionWords(words) {
  const ws = (words || []).filter((w) => w && String(w.text).trim()).map((w) => ({ ...w, t: String(w.text).trim().toLowerCase() }));
  const sameRow = (a, b, k = 0.6) => { const h = a.y1 - a.y0; return cy(b) >= a.y0 - k * h && cy(b) <= a.y1 + k * h; };

  // 1. Rows: each nutrient's name, and the numbers to its right.
  const rows = {};
  for (const [key, [match, reject]] of Object.entries(ROW_ANCHORS)) {
    const anchors = ws.filter((w) => match.test(w.t)).filter((a) => !ws.some((p) => p !== a && sameRow(a, p, 0.3) && p.x1 <= a.x0 && reject.test(p.t)));
    for (const a of anchors) {
      const vals = ws.filter((w) => w.x0 > a.x1 && sameRow(a, w) && massCandidates(w.t).length);
      if (vals.length) { rows[key] = { anchor: a, vals }; break; }
    }
  }
  const energy = ws.find((w) => /^energy:?$/.test(w.t));
  const eVals = ws.filter((w) => energyFrom(w.t) && (!energy || sameRow(energy, w, 1.2)));
  if (eVals.length) rows.kcal = { anchor: energy || eVals[0], vals: eVals };
  const allVals = Object.values(rows).flatMap((r) => r.vals);
  if (!allVals.length) return { per100: {}, perServing: {}, missing: [...KEYS], servingG: null, servingLabel: null, basis: "unknown", kcalEstimated: false, barcode: null };

  // 2. Columns: where the numbers line up.
  const width = median(allVals.map((w) => w.x1 - w.x0)) || 40;
  const xs = allVals.map(cx).sort((a, b) => a - b);
  const cols = [];
  for (const x of xs) { const c = cols[cols.length - 1]; if (c && x - c.last <= width) { c.xs.push(x); c.last = x; } else cols.push({ xs: [x], last: x }); }
  for (const c of cols) c.x = median(c.xs);
  const colOf = (w) => cols.reduce((a, c) => (Math.abs(cx(w) - c.x) < Math.abs(cx(w) - a.x) ? c : a), cols[0]);
  for (const c of cols) { const mine = allVals.filter((w) => colOf(w) === c); c.x0 = Math.min(...mine.map((w) => w.x0)); c.x1 = Math.max(...mine.map((w) => w.x1)); }

  // 3. Column headings: the words above the first row, in each column.
  const top = Math.min(...Object.values(rows).map((r) => r.anchor.y0));
  const rowH = median(Object.values(rows).map((r) => r.anchor.y1 - r.anchor.y0)) || 20;
  for (const c of cols) {
    // Heading words overlapping the column (a heading can be wider than its numbers).
    c.head = ws.filter((w) => w.y1 <= top && w.y0 >= top - rowH * 6 && w.x1 >= c.x0 - width * 0.5 && w.x0 <= c.x1 + width * 0.5 && colOf(w) === c).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    const txt = c.head.map((w) => w.t).join(" ");
    c.is100 = /\b100\s*(g|ml)?\b/.test(txt);
    const g = txt.replace(/\b100\s*(g|ml)\b/g, "").match(/(\d+(?:\.\d+)?)\s*(g|ml)\b/);
    c.grams = g ? Number(g[1]) : null;
  }
  const col100 = cols.find((c) => c.is100) || (cols.length > 1 ? cols[0] : null);
  const colServ = cols.find((c) => c !== col100 && !c.is100 && (c.grams || c.head.some((w) => /^(per|serving|portion|slice|bar|biscuit|pot|pack|bag|cake|bun|roll|piece)/.test(w.t)))) || (cols.length > 1 ? cols.find((c) => c !== col100) : (col100 ? null : cols[0]));
  let servingG = colServ?.grams ?? null;
  const servingLabel = colServ ? servingName(colServ.head) : null;

  // 4. Each row's reading in each column, OCR slips considered.
  const decimalsUsual = (col) => { const ts = Object.values(rows).flatMap((r) => r.vals.filter((w) => colOf(w) === col)); return ts.filter((w) => /\d[.,]\d/.test(w.t)).length > ts.length / 2; };
  const cands = (w, col) => {
    let c = massCandidates(w.t);
    // A column that's mostly "0.8g", "44.1g" but this cell reads "24g": likely 2.4g.
    if (col && decimalsUsual(col) && !/\d[.,]\d/.test(w.t) && c.length > 1 && c[0] >= 10) c = [c[1], c[0], ...c.slice(2)];
    return c;
  };
  const cell = (key, col) => (col ? rows[key]?.vals.filter((w) => colOf(w) === col).sort((a, b) => Math.abs(cx(a) - col.x) - Math.abs(cx(b) - col.x))[0] : null);
  const energyOf = (w) => { const e = w && energyFrom(w.t); return !e ? null : e.kcal != null ? e.kcal : e.kj / 4.184; };
  const energyCell = (col) => {
    if (!col || !rows.kcal) return null;
    const inCol = rows.kcal.vals.filter((w) => colOf(w) === col);
    const kc = inCol.find((w) => energyFrom(w.t).kcal != null);
    return energyOf(kc || inCol[0]);
  };

  // Serving weight not printed ("Per average slice"): the two columns' ratio gives it.
  let derived = false;
  if (!servingG && col100 && colServ) {
    const ratios = [];
    const e100 = energyCell(col100), eS = energyCell(colServ);
    if (e100 > 0 && eS > 0) ratios.push(eS / e100);
    for (const key of Object.keys(ROW_ANCHORS)) {
      const a = cell(key, col100), b = cell(key, colServ);
      const p = a && cands(a, col100)[0], q = b && cands(b, colServ)[0];
      if (p >= 1 && q > 0) ratios.push(q / p);
    }
    const r = median(ratios);
    if (r > 0.02 && r < 20) { servingG = Math.round(r * 100); derived = true; }
  }
  const k = servingG ? servingG / 100 : null;

  const per100 = {}, perServing = {};
  const e100 = energyCell(col100), eS = energyCell(colServ);
  if (e100 != null) per100.kcal = e100;
  if (eS != null) perServing.kcal = eS;
  for (const key of Object.keys(ROW_ANCHORS)) {
    const a = cell(key, col100), b = cell(key, colServ);
    const pc = a ? cands(a, col100) : [], sc = b ? cands(b, colServ) : [];
    let p = pc.find((v) => v <= 100) ?? null, q = sc[0] ?? null;
    if (k && pc.length && sc.length) {
      // The likeliest pair of readings that agree with the serving weight.
      let best = null;
      pc.forEach((pv, i) => sc.forEach((sv, j) => {
        if (pv > 100) return;
        const err = Math.abs(sv - pv * k) / Math.max(sv, pv * k, 0.1);
        const score = err + 0.04 * (i + j);
        if (err < 0.25 && (!best || score < best.score)) best = { pv, sv, score };
      }));
      if (best) { p = best.pv; q = best.sv; }
    }
    if (p != null) per100[key] = p;
    if (q != null) perServing[key] = q;
  }
  // Sugars can't be more than carbohydrate.
  for (const obj of [per100, perServing]) if (obj.sugar != null && obj.carbs != null && obj.sugar > obj.carbs && obj.sugar / 10 <= obj.carbs) obj.sugar = Math.round(obj.sugar) / 10;

  const tidy = (obj, max) => Object.fromEntries(Object.entries(obj).filter(([kk, v]) => Number.isFinite(v) && v >= 0 && v <= (kk === "kcal" ? max * 9.5 : max)).map(([kk, v]) => [kk, kk === "kcal" ? Math.round(v) : r1(v)]));
  const P = tidy(per100, 100);
  const S = tidy(perServing, servingG ? Math.max(100, servingG) : 1000);
  // Per 100 g as printed; where only the serving column was read, worked out from it.
  const final100 = { ...P };
  if (k) for (const [kk, v] of Object.entries(S)) if (final100[kk] == null) final100[kk] = kk === "kcal" ? Math.round(v / k) : r1(v / k);
  let kcalEstimated = false;
  for (const obj of [final100, S]) {
    if (obj.kcal == null && obj.protein != null && obj.carbs != null && obj.fat != null) { obj.kcal = Math.round(obj.protein * 4 + obj.carbs * 4 + obj.fat * 9); kcalEstimated = true; }
  }
  const missing = KEYS.filter((kk) => final100[kk] == null && S[kk] == null);
  return {
    per100: final100, perServing: S, missing,
    servingG, servingGDerived: derived, servingLabel: colServ ? servingLabel : null,
    basis: colServ && Object.keys(S).length ? "serving" : col100 ? "100g" : "unknown",
    kcalEstimated, barcode: null,
  };
}

// Best of both readings: word positions first, text lines to fill gaps.
export function combineParses(byWords, byText) {
  if (byWords.basis === "unknown" && Object.keys(byText.per100).length > Object.keys(byWords.per100).length) return { ...byText, perServing: {}, servingLabel: null };
  const per100 = { ...byWords.per100 };
  for (const [key, v] of Object.entries(byText.per100)) if (per100[key] == null) per100[key] = v;
  const missing = KEYS.filter((key) => per100[key] == null && byWords.perServing?.[key] == null);
  return { ...byWords, per100, missing, servingG: byWords.servingG || byText.servingG, barcode: byText.barcode };
}

/* ---------- product name from the front of the pack ---------- */
// The biggest line of words, favouring several words in mixed case (a
// product title) over a one-word logo, and skipping shop and page furniture.
const NOT_A_NAME = /\b(asda|tesco|sainsbury'?s?|morrisons|waitrose|aldi|lidl|ocado|iceland|co-?op|amazon|sign in|search|home|basket|trolley|reviews?|ask|menu|bakery|nutrition|typical|energy|ingredients|per 100)\b|www\.|\.com|\.co\.uk|>/i;

export function guessName(words) {
  // Real words (two letters or more, no stray digits) or a pack size.
  const wordLike = (t) => ((t.match(/\p{L}/gu) || []).length >= 2 && !/\d/.test(t)) || /^\d+(\.\d+)?(g|kg|ml|l|cl)$/i.test(t);
  const ws = (words || []).filter((w) => w && wordLike(String(w.text).trim())).map((w) => ({ ...w, t: String(w.text).trim(), h: w.y1 - w.y0, c: (w.y0 + w.y1) / 2 })).sort((a, b) => a.x0 - b.x0);
  const lines = [];
  for (const w of ws) {
    const line = lines.find((l) => Math.abs(l.c - w.c) < 0.4 * Math.max(l.h, w.h) && w.x0 - l.x1 < 1.2 * Math.max(l.h, w.h) && w.x0 >= l.x1 - 2);
    if (line) { line.words.push(w); line.x1 = w.x1; line.h = Math.max(line.h, w.h); }
    else lines.push({ words: [w], x1: w.x1, h: w.h, c: w.c });
  }
  const scored = lines
    .map((l) => {
      const text = l.words.map((w) => w.t).join(" ").replace(/[^\p{L}\p{N}&'’ -]/gu, " ").replace(/\s+/g, " ").trim();
      const letters = (text.match(/\p{L}/gu) || []).length;
      const mixed = /\p{Lu}\p{Ll}{2,}/u.test(text); // a Title-case word
      return { text, score: l.h * Math.sqrt(Math.min(l.words.length, 4)) * (mixed ? 1.3 : 1), letters };
    })
    .filter((l) => l.letters >= 4 && !NOT_A_NAME.test(l.text));
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]?.text || "";
  // Drop a trailing pack size ("580g"), then tidy the case of an all-caps name.
  const name = best.replace(/\s+\d+(\.\d+)?\s*(g|kg|ml|l|cl)$/i, "").trim();
  return (/\p{Ll}/u.test(name) ? name : name.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase())).slice(0, 60);
}
