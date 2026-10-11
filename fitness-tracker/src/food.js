// Food lookup: the built-in UK (CoFID) and USDA lists, and, where the app runs as a normal
// website, Open Food Facts (branded products, barcodes) and USDA FoodData
// Central online (through the /api/usda Cloudflare Pages Function). Inside a
// claude.ai artifact those online sources are blocked, and Claude can
// estimate meals instead.

import { getSample, getImageLimits } from "./claudeRead";

export const NUTRIENTS = ["kcal", "protein", "carbs", "fat", "fibre", "sugar"];
export const MACRO_LABEL = { kcal: "Calories", protein: "Protein", carbs: "Carbs", fat: "Fat", fibre: "Fibre", sugar: "Sugar" };
export const MACRO_UNIT = { kcal: "kcal", protein: "g", carbs: "g", fat: "g", fibre: "g", sugar: "g" };

const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

// Nutrients for `grams` of a food given per-100 g values.
export function scale(per100, grams) {
  const f = (Number(grams) || 0) / 100;
  const out = {};
  for (const k of NUTRIENTS) out[k] = k === "kcal" ? Math.round((per100?.[k] || 0) * f) : r1((per100?.[k] || 0) * f);
  return out;
}

export function sumFood(entries) {
  const out = Object.fromEntries(NUTRIENTS.map((k) => [k, 0]));
  for (const e of entries || []) for (const k of NUTRIENTS) out[k] += Number(e[k]) || 0;
  for (const k of NUTRIENTS) out[k] = k === "kcal" ? Math.round(out[k]) : r1(out[k]);
  return out;
}

/* ---------- built-in lists ---------- */
// Two lists ship with the app: CoFID (McCance and Widdowson, the UK national
// food composition data) and USDA SR28. UK foods come first in a search.
const LISTS = [
  { file: "foods-uk.json", source: "cofid" },
  { file: "foods.json", source: "usda" },
];
let foodsPromise = null;
export function loadFoods() {
  if (!foodsPromise) {
    foodsPromise = Promise.all(LISTS.map(({ file, source }) =>
      fetch(`${import.meta.env.BASE_URL}${file}`)
        .then((r) => { if (!r.ok) throw new Error(`${file} ${r.status}`); return r.json(); })
        .then((j) => j.foods.map(([name, group, kcal, protein, carbs, fat, fibre, sugar, portions], i) => ({
          id: `${source}:${i}`,
          name,
          group,
          source,
          per100: { kcal, protein, carbs, fat, fibre, sugar },
          portions: (portions || []).map(([g, label]) => ({ g, label })),
          lower: name.toLowerCase(),
        })))
        // One list failing to load still leaves the other.
        .catch(() => null)))
      .then((lists) => {
        const ok = lists.filter(Boolean);
        if (!ok.length) throw new Error("food lists unavailable");
        return ok.flat();
      })
      .catch((e) => { foodsPromise = null; throw e; });
  }
  return foodsPromise;
}

const PLAIN = /\b(raw|cooked|boiled|roasted|baked|grilled|plain|whole|fresh)\b/;
const DELI_GROUPS = new Set(["Sausages & deli", "Fast food", "Restaurant food"]);
const PROCESSED = /\b(babyfood|infant|canned|frozen|dehydrated|with salt|enriched)\b/;

// Ranks foods for a search: every word must start a word in the name.
export function searchFoods(list, query, limit = 25) {
  const words = query.toLowerCase().split(/[^a-z0-9%]+/).filter(Boolean);
  if (!words.length) return [];
  const res = [];
  for (const f of list) {
    const tokens = f.lower.split(/[^a-z0-9%]+/);
    let ok = true;
    for (const w of words) if (!tokens.some((t) => t.startsWith(w))) { ok = false; break; }
    if (!ok) continue;
    let score = 0;
    if (tokens[0].startsWith(words[0])) score -= 10; // "Eggs, ..." for "egg"
    if (f.lower.split(",")[0].split(/\s+/).length <= words.length) score -= 3;
    if (PLAIN.test(f.lower)) score -= 2;
    if (PROCESSED.test(f.lower)) score += 2;
    if (DELI_GROUPS.has(f.group)) score += 3; // "Chicken breast, oven-roasted, sliced" is deli meat
    score += f.lower.length / 30;
    if (f.source === "cofid") score -= 1.5; // prefer UK data
    res.push([score, f]);
  }
  return res.sort((a, b) => a[0] - b[0]).slice(0, limit).map(([, f]) => f);
}

/* ---------- where we're running ---------- */
// A normal website (not a claude.ai artifact, whose sandbox blocks the network).
export const onlineLookupsAllowed = () => typeof window !== "undefined" && !window.claude;

/* ---------- Open Food Facts ---------- */
// The UK site searches UK products; barcodes from anywhere still resolve.
const OFF = "https://uk.openfoodfacts.org";
const OFF_FIELDS = "code,product_name,product_name_en,brands,nutriments,serving_size,serving_quantity,quantity";

function fromOff(p) {
  const n = p?.nutriments || {};
  const kcal = n["energy-kcal_100g"] ?? (n.energy_100g != null ? n.energy_100g / 4.184 : null);
  if (kcal == null) return null;
  const name = (p.product_name_en || p.product_name || "").trim();
  if (!name) return null;
  const brand = (p.brands || "").split(",")[0].trim();
  const portions = [];
  if (Number(p.serving_quantity) > 0) portions.push({ g: r1(p.serving_quantity), label: `1 serving${p.serving_size ? ` (${p.serving_size})` : ""}` });
  return {
    id: `off:${p.code}`,
    name: brand ? `${name} (${brand})` : name,
    group: "Branded product",
    source: "off",
    barcode: p.code,
    per100: {
      kcal: Math.round(kcal),
      protein: r1(n.proteins_100g),
      carbs: r1(n.carbohydrates_100g),
      fat: r1(n.fat_100g),
      fibre: r1(n.fiber_100g),
      sugar: r1(n.sugars_100g),
    },
    portions,
  };
}

const offCache = new Map();
// Open Food Facts asks for no more than ~10 searches a minute, so this runs
// only when the person asks for it, and repeats come from the cache.
export async function searchOpenFoodFacts(query, { signal } = {}) {
  const q = query.trim().toLowerCase();
  if (offCache.has(q)) return offCache.get(q);
  const url = `${OFF}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=24&fields=${OFF_FIELDS}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Open Food Facts answered ${res.status}`);
  const j = await res.json();
  const list = (j.products || []).map(fromOff).filter(Boolean);
  offCache.set(q, list);
  return list;
}

export async function lookupBarcode(code, { signal } = {}) {
  const clean = String(code).replace(/\D/g, "");
  if (clean.length < 6) return null;
  const res = await fetch(`${OFF}/api/v2/product/${clean}.json?fields=${OFF_FIELDS}`, { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Open Food Facts answered ${res.status}`);
  const j = await res.json();
  return j.status === 1 || j.product ? fromOff({ ...j.product, code: clean }) : null;
}

/* ---------- USDA online (Cloudflare Pages Function) ---------- */
let usdaState = "unknown"; // "unknown" | "on" | "off"
export const usdaOnlineKnownOff = () => usdaState === "off";

export async function searchUsdaOnline(query, { signal } = {}) {
  if (usdaState === "off") return null;
  try {
    const res = await fetch(`/api/usda?q=${encodeURIComponent(query.trim())}`, { signal });
    const type = res.headers.get("content-type") || "";
    if (!res.ok || !type.includes("json")) { if (res.status === 404 || res.status === 503 || !type.includes("json")) usdaState = "off"; return null; }
    usdaState = "on";
    const j = await res.json();
    return (j.foods || []).map((f) => ({ ...f, source: "usda-online", group: f.group || "USDA" }));
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    return null;
  }
}

/* ---------- barcode camera ---------- */
export const cameraAllowed = () => onlineLookupsAllowed() && Boolean(navigator.mediaDevices?.getUserMedia);

// Starts scanning `video`; calls onCode(code) once. Returns stop().
export async function startBarcodeScan(video, onCode) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  video.srcObject = stream;
  video.setAttribute("playsinline", "");
  await video.play();
  let stopped = false;
  let controls = null;
  const stop = () => {
    stopped = true;
    controls?.stop?.();
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
  const found = (code) => { if (!stopped) { stop(); onCode(code); } };

  if ("BarcodeDetector" in window) {
    const detector = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
    const tick = async () => {
      if (stopped) return;
      try {
        const codes = await detector.detect(video);
        if (codes[0]?.rawValue) return found(codes[0].rawValue);
      } catch { /* frame not ready */ }
      setTimeout(tick, 200);
    };
    tick();
  } else {
    // iPhone Safari and others without BarcodeDetector.
    const { BrowserMultiFormatReader } = await import("@zxing/browser");
    const reader = new BrowserMultiFormatReader();
    controls = await reader.decodeFromVideoElement(video, (result) => { if (result) found(result.getText()); });
  }
  return stop;
}

/* ---------- Claude estimates (claude.ai link) ---------- */
export async function claudeEstimateAvailable() {
  return Boolean(await getSample());
}
export async function claudePhotoLimits() {
  return getImageLimits();
}

const ESTIMATE_RULES = `Estimate the nutrition of what the person ate. Split it into its separate foods. For each give a realistic weight in grams for the portion described (use typical portion sizes when none is given) and the calories and macronutrients for that weight.

Reply with only JSON in this shape:
{"items":[{"name":"Chicken tikka masala","grams":350,"kcal":520,"protein":38,"carbs":18,"fat":32,"fibre":3,"sugar":9}],"note":"one short sentence on any big assumption, or empty"}`;

export async function estimateWithClaude({ text = "", photos = [] }, { signal } = {}) {
  const sample = await getSample();
  if (!sample) throw { code: "not_granted", message: "Claude isn't available here." };
  const prompt = photos.length
    ? `The image${photos.length > 1 ? "s show" : " shows"} a meal${text ? `, described as: "${text}"` : ""}. ${ESTIMATE_RULES}`
    : `The person ate: "${text}". ${ESTIMATE_RULES}`;
  const data = await sample.json(prompt, { signal, ...(photos.length ? { images: photos } : {}), modelTier: "default" });
  const items = (Array.isArray(data?.items) ? data.items : [])
    .map((it) => {
      const grams = Math.max(0, Number(it?.grams) || 0);
      const name = String(it?.name || "").trim().slice(0, 80);
      if (!name || !(Number(it?.kcal) >= 0)) return null;
      const vals = Object.fromEntries(NUTRIENTS.map((k) => [k, k === "kcal" ? Math.round(Number(it[k]) || 0) : r1(it[k])]));
      const per100 = grams > 0 ? Object.fromEntries(NUTRIENTS.map((k) => [k, k === "kcal" ? Math.round((vals[k] / grams) * 100) : r1((vals[k] / grams) * 100)])) : null;
      return { name, grams, ...vals, per100, source: "claude", estimate: true };
    })
    .filter(Boolean);
  return { items, note: typeof data?.note === "string" ? data.note.trim() : "" };
}
