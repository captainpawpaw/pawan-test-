/* ---------- tablespoons and teaspoons ---------- */
// A UK/metric tablespoon is 15 ml and a teaspoon 5 ml. Turning those into
// grams needs the food's density (g per ml), taken in this order:
//   1. measured: the food's own spoon, cup or fl oz weight (USDA portions);
//   2. similar: a UK food borrows it from the closest USDA food that has one;
//   3. typical: a density for the kind of food, from its name.
// 2 and 3 are shown as estimates (≈).
export const TBSP_ML = 15;
export const TSP_ML = 5;
const US_ML = { tbsp: 14.787, tsp: 4.929, cup: 236.59, "fl oz": 29.574 };

function frac(q) {
  const m = q.trim().match(/^(\d+)\s+(\d+)\/(\d+)$|^(\d+)\/(\d+)$|^(\d*\.?\d+)$/);
  if (!m) return null;
  if (m[1]) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  if (m[4]) return Number(m[4]) / Number(m[5]);
  return Number(m[6]);
}

// g per ml from a portion such as "1 tbsp", "1/2 cup, chopped", "8 fl oz".
export function measuredDensity(portions) {
  let best = null;
  for (const { g, label } of portions || []) {
    const m = String(label).toLowerCase().match(/^([\d./ ]+?)\s*(tbsp|tsp|cup|fl oz)\b/);
    if (!m || !(g > 0)) continue;
    const q = frac(m[1]);
    if (!(q > 0)) continue;
    const d = g / (q * US_ML[m[2]]);
    // Prefer a spoon over a cup: closer to how it'll be used.
    const rank = m[2] === "tbsp" || m[2] === "tsp" ? 0 : 1;
    if (d > 0.02 && d < 3 && (!best || rank < best.rank)) best = { d, rank };
  }
  return best ? best.d : null;
}

// Typical densities, first match wins (name is lower case).
const TYPICAL = [
  [/\b(oil|ghee|dripping|lard)\b/, 0.92],
  [/\beggs?\b.*\b(raw|beaten|white|yolk)\b/, 1.03],
  [/\b(honey|syrup|treacle|molasses)\b/, 1.4],
  [/\b(jam|marmalade|preserve|curd|chutney|pickle)\b/, 1.3],
  [/\b(icing sugar|powdered sugar)\b/, 0.56],
  [/\bsugar\b/, 0.85],
  [/\b(flour|cornflour|starch|cocoa|powder|protein powder|whey)\b/, 0.53],
  [/\b(salt)\b/, 1.2],
  [/\b(spice|pepper|cinnamon|cumin|paprika|turmeric|curry powder|herbs?|oregano|basil|thyme|ginger, ground)\b/, 0.5],
  [/\b(butter|margarine|spread|mayonnaise|peanut butter|nut butter|tahini|hummus|houmous)\b/, 0.95],
  [/\b(cream|milk|yogh?urt|kefir|custard|juice|water|drink|coffee|tea|smoothie|soup|stock|broth|gravy|sauce|ketchup|dressing|vinegar|beer|wine|spirits?|cider|lager|squash)\b/, 1.03],
  [/\b(oats|porridge oats|muesli|granola|cereal|flakes|crisp)\b/, 0.35],
  [/\b(rice|lentils|couscous|quinoa|pasta|beans, dried)\b/, 0.85],
  [/\b(nuts?|almonds?|peanuts?|walnuts?|cashews?|seeds?|chia|linseed|flaxseed)\b/, 0.6],
  [/\b(cheese, (parmesan|grated))\b/, 0.4],
  [/\bcheese\b/, 0.45],
  [/\b(raisins|sultanas|currants|dried fruit|dates)\b/, 0.65],
  [/\b(chopped|diced|grated|mashed|puree|purée)\b/, 0.7],
];
export function typicalDensity(name) {
  const n = String(name).toLowerCase();
  for (const [re, d] of TYPICAL) if (re.test(n)) return d;
  return 0.75; // solid foods, chopped into a spoon
}

const STOP = new Set(["raw", "and", "with", "in", "of", "the", "or", "a", "fresh", "average", "only", "without", "excluding", "including"]);
const tokens = (name) => String(name).toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 1 && !STOP.has(t)).map((t) => t.replace(/(ies)$/, "y").replace(/(?<!s)s$/, ""));

// Index of USDA foods with a measured density, by first word.
export function densityIndex(list) {
  const idx = new Map();
  for (const f of list) {
    if (f.density?.how !== "measured") continue;
    const t = tokens(f.name);
    if (!t.length) continue;
    if (!idx.has(t[0])) idx.set(t[0], []);
    idx.get(t[0]).push({ set: new Set(t), d: f.density.d });
  }
  return idx;
}
export function similarDensity(idx, name) {
  const t = tokens(name);
  if (!t.length) return null;
  const set = new Set(t);
  let best = null;
  for (const c of idx.get(t[0]) || []) {
    let both = 0;
    for (const w of set) if (c.set.has(w)) both++;
    const score = both / (set.size + c.set.size - both);
    if (score >= 0.34 && (!best || score > best.score)) best = { score, d: c.d };
  }
  return best ? best.d : null;
}

const SPOON_RE = /\b(tbsp|tsp|tablespoon|teaspoon)/i;
// Adds "1 tbsp" and "1 tsp" portions, unless the food already has them.
export function withSpoons(food, density = null) {
  if ((food.portions || []).some((p) => SPOON_RE.test(p.label))) return food;
  let dens = density;
  if (!dens) {
    const d = measuredDensity(food.portions);
    dens = d ? { d, how: "measured" } : { d: typicalDensity(food.name), how: "typical" };
  }
  const approx = dens.how !== "measured";
  const r = (n) => Math.round(n * 10) / 10;
  return {
    ...food,
    density: dens,
    portions: [
      ...(food.portions || []),
      { g: r(dens.d * TBSP_ML), label: "1 tbsp", approx, how: dens.how },
      { g: r(dens.d * TSP_ML), label: "1 tsp", approx, how: dens.how },
    ],
  };
}
