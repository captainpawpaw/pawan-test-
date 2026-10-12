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
// as "9" or "¢" ("17.09" for 17.0g) and drops decimal points ("195g" for 19.5g).
export function massCandidates(token) {
  const t = String(token).toLowerCase().replace(/,/g, ".").replace(/^[<~]/, "").replace(/[oO](?=\d)|(?<=\d)[oO]/g, "0");
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

export function parseNutritionWords(words) {
  const ws = (words || []).filter((w) => w && String(w.text).trim()).map((w) => ({ ...w, t: String(w.text).trim().toLowerCase() }));
  const sameRow = (a, b, k = 0.6) => { const h = a.y1 - a.y0; return cy(b) >= a.y0 - k * h && cy(b) <= a.y1 + k * h; };

  // Columns: "per 100g" and the serving.
  const head100 = ws.find((w) => /^100\s*(g|ml)?$/.test(w.t.replace(/[^0-9a-z]/g, "")) && ws.some((p) => p !== w && sameRow(w, p, 0.3) && /^per$|100/.test(p.t))) ||
    ws.find((w) => /^100(g|ml)$/.test(w.t));
  let servingG = null, headServ = null;
  if (head100) {
    const row = ws.filter((w) => sameRow(head100, w, 0.4) && w !== head100);
    headServ = row.find((w) => /^\d+(\.\d+)?(g|ml)$/.test(w.t) && !/^100(g|ml)$/.test(w.t)) || row.find((w) => /serving|portion/.test(w.t));
    const g = headServ && headServ.t.match(/^(\d+(?:\.\d+)?)(g|ml)$/);
    if (g) servingG = Number(g[1]);
  }
  const k = servingG ? servingG / 100 : null;
  const x100 = head100 ? cx(head100) : null;
  const xServ = headServ ? cx(headServ) : null;

  // The value nearest a column (or the first one when there are no columns).
  const nearest = (tokens, x) => (x == null ? tokens[0] : tokens.reduce((a, b) => (Math.abs(cx(b) - x) < Math.abs(cx(a) - x) ? b : a), tokens[0]));

  const found = {};
  for (const [key, [match, reject]] of Object.entries(ROW_ANCHORS)) {
    const anchors = ws.filter((w) => match.test(w.t)).filter((a) => !ws.some((p) => p !== a && sameRow(a, p, 0.3) && p.x1 <= a.x0 && reject.test(p.t)));
    for (const a of anchors) {
      const vals = ws.filter((w) => w.x0 > a.x1 && sameRow(a, w) && massCandidates(w.t).length).sort((p, q) => p.x0 - q.x0);
      if (!vals.length) continue;
      const v100 = nearest(vals, x100);
      const c100 = massCandidates(v100.t);
      let pick = c100.find((v) => v <= 100) ?? null;
      // The serving column agrees with one reading: take that one.
      // Keep the likeliest reading unless the serving column disagrees with it.
      if (k && vals.length > 1) {
        const sv = massCandidates(nearest(vals.filter((w) => w !== v100), xServ).t);
        const errFor = (c) => Math.min(...sv.map((x) => Math.abs(x - c * k) / Math.max(x, c * k, 0.1)));
        if (pick == null || errFor(pick) > 0.12) {
          const agree = c100.filter((c) => c <= 100 && errFor(c) < 0.2);
          if (agree.length) pick = agree[0];
        }
      }
      if (pick != null) { found[key] = pick; break; }
    }
  }
  // Sugars can't be more than carbohydrate.
  if (found.sugar != null && found.carbs != null && found.sugar > found.carbs && found.sugar / 10 <= found.carbs) found.sugar = Math.round(found.sugar) / 10;

  // Energy: kcal (or kJ) values in the energy row, which may span two lines.
  const energy = ws.find((w) => /^energy:?$/.test(w.t));
  const eTokens = ws.filter((w) => energyFrom(w.t) && (!energy || sameRow(energy, w, 1.2)));
  const kcals = eTokens.filter((w) => energyFrom(w.t).kcal != null);
  const kjs = eTokens.filter((w) => energyFrom(w.t).kj != null);
  if (kcals.length) found.kcal = energyFrom(nearest(kcals, x100).t).kcal;
  else if (kjs.length) found.kcal = energyFrom(nearest(kjs, x100).t).kj / 4.184;

  const per100 = {};
  const missing = [];
  for (const key of ["kcal", "protein", "carbs", "fat", "fibre", "sugar"]) {
    const v = found[key];
    if (v != null && Number.isFinite(v) && v >= 0 && (key === "kcal" ? v <= 950 : v <= 100)) per100[key] = key === "kcal" ? Math.round(v) : r1(v);
    else missing.push(key);
  }
  let kcalEstimated = false;
  if (per100.kcal == null && per100.protein != null && per100.carbs != null && per100.fat != null) {
    per100.kcal = Math.round(per100.protein * 4 + per100.carbs * 4 + per100.fat * 9);
    kcalEstimated = true;
    missing.splice(missing.indexOf("kcal"), 1);
  }
  return { per100, missing, servingG, basis: x100 != null ? "100g" : "unknown", kcalEstimated, barcode: null };
}

// Best of both readings: word positions first, text lines to fill gaps.
export function combineParses(byWords, byText) {
  if (byWords.basis !== "100g" && Object.keys(byText.per100).length > Object.keys(byWords.per100).length) return byText;
  const per100 = { ...byWords.per100 };
  for (const [key, v] of Object.entries(byText.per100)) if (per100[key] == null) per100[key] = v;
  if (byWords.kcalEstimated && byText.per100.kcal != null && !byText.kcalEstimated) per100.kcal = byText.per100.kcal;
  const missing = ["kcal", "protein", "carbs", "fat", "fibre", "sugar"].filter((key) => per100[key] == null);
  return {
    per100, missing,
    servingG: byWords.servingG || byText.servingG,
    basis: byWords.basis,
    kcalEstimated: byWords.kcalEstimated && !(byText.per100.kcal != null && !byText.kcalEstimated),
    barcode: byText.barcode,
  };
}
