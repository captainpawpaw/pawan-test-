// Cloudflare Pages Function: GET /api/usda?q=chicken breast
// Searches USDA FoodData Central with the key kept on the server
// (set USDA_API_KEY in the Pages project's settings; a free key comes from
// https://fdc.nal.usda.gov/api-key-signup). Answers are cached for a day.

const FDC = "https://api.nal.usda.gov/fdc/v1/foods/search";
// FoodData Central nutrient numbers.
const NUM = { kcal: "208", protein: "203", carbs: "205", fat: "204", fibre: "291", sugar: "269" };
const ENERGY_KJ = "268";

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...extra } });

const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

export function mapFood(f) {
  const by = {};
  for (const n of f.foodNutrients || []) by[String(n.nutrientNumber)] = n.value;
  let kcal = by[NUM.kcal];
  if (kcal == null && by[ENERGY_KJ] != null) kcal = by[ENERGY_KJ] / 4.184;
  if (kcal == null) return null;
  const brand = (f.brandName || f.brandOwner || "").trim();
  const title = String(f.description || "").trim();
  const name = brand ? `${title.charAt(0) + title.slice(1).toLowerCase()} (${brand})` : title;
  const portions = [];
  // Branded foods' nutrients are per 100 g; servingSize says how big a serving is.
  if (Number(f.servingSize) > 0 && /^(g|grm|ml|mlt)$/i.test(f.servingSizeUnit || "")) {
    portions.push({ g: r1(f.servingSize), label: `1 serving${f.householdServingFullText ? ` (${f.householdServingFullText})` : ""}` });
  }
  return {
    id: `fdc:${f.fdcId}`,
    name,
    group: f.dataType === "Branded" ? "Branded (USDA)" : f.foodCategory || "USDA",
    per100: {
      kcal: Math.round(kcal),
      protein: r1(by[NUM.protein]),
      carbs: r1(by[NUM.carbs]),
      fat: r1(by[NUM.fat]),
      fibre: r1(by[NUM.fibre]),
      sugar: r1(by[NUM.sugar]),
    },
    portions,
  };
}

export async function onRequestGet({ request, env, waitUntil }) {
  const q = (new URL(request.url).searchParams.get("q") || "").trim().slice(0, 100);
  // Pasted keys sometimes carry spaces or quote marks.
  const key = String(env.USDA_API_KEY || "").trim().replace(/^["']+|["']+$/g, "").trim();
  if (!key) return json({ error: "USDA_API_KEY is not set" }, 503);
  if (q.length < 2) return json({ foods: [] });

  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(`https://usda-cache.local/?q=${encodeURIComponent(q.toLowerCase())}`);
  const hit = cache && (await cache.match(cacheKey));
  if (hit) return hit;

  const url = `${FDC}?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(q)}&pageSize=25&dataType=Foundation,SR%20Legacy,Branded`;
  let res;
  try {
    res = await fetch(url, { headers: { accept: "application/json", "user-agent": "TrainingLedger/1.0 (+https://training-ledger.pages.dev)" } });
  } catch {
    return json({ error: "Couldn't reach USDA" }, 502);
  }
  if (!res.ok) {
    // USDA's reason, for diagnosing (the key is blanked out).
    const why = (await res.text().catch(() => "")).split(key).join("…").replace(/\s+/g, " ").slice(0, 300);
    return json({ error: `USDA answered ${res.status}`, detail: why }, 502);
  }
  const data = await res.json();
  const foods = (data.foods || []).map(mapFood).filter(Boolean);
  const out = json({ foods }, 200, { "cache-control": "public, max-age=86400" });
  if (cache) {
    const put = cache.put(cacheKey, out.clone());
    if (waitUntil) waitUntil(put); else await put;
  }
  return out;
}
