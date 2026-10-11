// Progress data: turns logged months into per-period values for one exercise
// or one tag, at a daily, weekly, monthly or yearly scale.

export const DAY = 86_400_000;
export const SCALES = ["day", "week", "month", "year"];
export const SCALE_LABEL = { day: "Daily", week: "Weekly", month: "Monthly", year: "Yearly" };
// Visible span (days) each scale button jumps to. Yearly fits the whole log.
export const SCALE_SPAN_DAYS = { day: 30, week: 26 * 7, month: 730, year: 4 * 365 };
const PERIOD_DAYS = { day: 1, week: 7, month: 30.44, year: 365.25 };
// Fewest periods a scale shows before zooming in switches to a finer one.
const MIN_PERIODS = { day: 0, week: 4, month: 4, year: 2.5 };
const MIN_PERIOD_PX = 5;

// Keeps the scale while it reads well; zooming out until periods get thinner
// than a few pixels moves to a bigger period, zooming in until only a few
// periods show moves to a smaller one.
export function adjustScale(scale, spanMs, plotW) {
  let i = SCALES.indexOf(scale);
  if (i < 0) i = 1;
  const periods = (sc) => spanMs / (PERIOD_DAYS[sc] * DAY);
  while (i < SCALES.length - 1 && plotW / periods(SCALES[i]) < MIN_PERIOD_PX) i += 1;
  while (i > 0 && periods(SCALES[i]) < MIN_PERIODS[SCALES[i]]) i -= 1;
  return SCALES[i];
}

const pad2 = (n) => String(n).padStart(2, "0");
export const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const parseIso = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

// Start of the period containing date d (local time).
export function periodStart(d, scale) {
  if (scale === "day") return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (scale === "week") {
    const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); // Monday
    return s;
  }
  if (scale === "month") return new Date(d.getFullYear(), d.getMonth(), 1);
  return new Date(d.getFullYear(), 0, 1);
}

export function nextPeriod(d, scale) {
  if (scale === "day") return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  if (scale === "week") return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
  if (scale === "month") return new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return new Date(d.getFullYear() + 1, 0, 1);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function periodLabel(d, scale, long = false) {
  if (scale === "day") return long ? `${d.toLocaleDateString("en-GB", { weekday: "short" })} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  if (scale === "week") return long ? `Week of ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  if (scale === "month") return long ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : d.getMonth() === 0 ? `${MONTHS[0]} ${d.getFullYear()}` : MONTHS[d.getMonth()];
  return String(d.getFullYear());
}

/* ---------- entries ---------- */
// months: { "2026-09": { "01": { strength: [...], cardio: [...] } } }
// Returns a flat, date-sorted list of logged sets and sessions.
export function flattenMonths(months) {
  const out = [];
  for (const [mk, month] of Object.entries(months || {})) {
    for (const [day, v] of Object.entries(month || {})) {
      const date = `${mk}-${day}`;
      for (const e of v?.strength || []) if (e?.exercise) out.push({ date, type: "strength", name: e.exercise, e });
      for (const e of v?.cardio || []) if (e?.activity) out.push({ date, type: "cardio", name: e.activity, e });
      for (const e of v?.food || []) if (e?.name) out.push({ date, type: "food", name: e.name, e });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/* ---------- metrics ---------- */
// agg "sum": add up within a period; "max": the best within a period;
// "avg": the average day (food is totalled per day, then averaged over the
// days with food logged).
export const METRICS = {
  weightreps: { label: "Weight & reps", unit: "kg", agg: "dual", type: "strength", form: "dual", note: "max weight on the left, reps per set on the right" },
  best: { label: "Best weight", unit: "kg", agg: "max", type: "strength", form: "line" },
  e1rm: { label: "Est. 1-rep max", unit: "kg", agg: "max", type: "strength", form: "line", note: "Epley: weight × (1 + reps ÷ 30)" },
  volume: { label: "Volume", unit: "kg", agg: "sum", type: "strength", form: "column", note: "based on max weight: sets × reps × max weight" },
  reps: { label: "Reps", unit: "reps", agg: "sum", type: "strength", form: "column" },
  sets: { label: "Sets", unit: "sets", agg: "sum", type: "strength", form: "column" },
  minutes: { label: "Minutes", unit: "min", agg: "sum", type: "cardio", form: "column" },
  distance: { label: "Distance", unit: "mi", agg: "sum", type: "cardio", form: "column" },
  kcal: { label: "Calories", unit: "kcal", agg: "avg", type: "food", form: "column", target: "kcal" },
  protein: { label: "Protein", unit: "g", agg: "avg", type: "food", form: "column", target: "protein" },
  carbs: { label: "Carbs", unit: "g", agg: "avg", type: "food", form: "column" },
  fat: { label: "Fat", unit: "g", agg: "avg", type: "food", form: "column" },
};
export const FOOD_METRICS = ["kcal", "protein", "carbs", "fat"];

// bwOn(date) -> body weight in kg on that date, or null.
function loadOf(e, date, bwOn) {
  const added = Number(e.weight) || 0;
  return e.bw ? added + (Number(bwOn?.(date)) || 0) : added;
}

// The value one logged entry contributes to a metric (null = none).
export function entryValue(metric, row, bwOn) {
  const { e, date } = row;
  const sets = Number(e.sets) || 0;
  const reps = Number(e.reps) || 0;
  switch (metric) {
    case "best": { const l = loadOf(e, date, bwOn); return l > 0 ? l : null; }
    case "e1rm": {
      const l = loadOf(e, date, bwOn);
      if (!(l > 0) || !(reps > 0)) return null;
      return reps === 1 ? l : l * (1 + reps / 30);
    }
    case "volume": { const v = sets * reps * loadOf(e, date, bwOn); return v > 0 ? v : null; }
    case "reps": { const v = sets * reps; return v > 0 ? v : null; }
    case "sets": return sets > 0 ? sets : null;
    case "minutes": { const v = Number(e.duration) || 0; return v > 0 ? v : null; }
    case "distance": { const v = Number(e.distance) || 0; return v > 0 ? v : null; }
    case "kcal": case "protein": case "carbs": case "fat": { const v = Number(e[metric]); return v >= 0 ? v : null; }
    default: return null;
  }
}

// Which metrics make sense for a selection, in display order.
export function metricsFor(rows) {
  if (rows.length && rows.every((r) => r.type === "food")) return FOOD_METRICS;
  const hasStrength = rows.some((r) => r.type === "strength");
  const hasCardio = rows.some((r) => r.type === "cardio");
  const names = new Set(rows.map((r) => r.name));
  const out = [];
  if (hasStrength) {
    // Best weight and 1RM only compare like with like: one exercise.
    if (names.size === 1 && rows.some((r) => Number(r.e.weight) > 0 || r.e.bw)) out.push("weightreps", "best", "e1rm");
    out.push("volume", "reps", "sets");
  }
  if (hasCardio) {
    out.push("minutes");
    if (rows.some((r) => Number(r.e.distance) > 0)) out.push("distance");
  }
  return out;
}

// One exercise's weight and reps per period: the heaviest and lightest
// weight logged (body-weight sets count body weight plus added weight), and
// the most and fewest reps per set. `value` is the max weight.
export function bucketizeWeightReps(rows, scale, bwOn) {
  const map = new Map();
  for (const r of rows) {
    if (r.type !== "strength") continue;
    const w = loadOf(r.e, r.date, bwOn);
    const reps = Number(r.e.reps) || 0;
    if (!(w > 0) && !(reps > 0)) continue;
    const start = periodStart(parseIso(r.date), scale);
    const key = start.getTime();
    let b = map.get(key);
    if (!b) { b = { start, end: nextPeriod(start, scale), wMax: null, wMin: null, rMax: null, rMin: null, days: new Set() }; map.set(key, b); }
    if (w > 0) { b.wMax = Math.max(b.wMax ?? -Infinity, w); b.wMin = Math.min(b.wMin ?? Infinity, w); }
    if (reps > 0) { b.rMax = Math.max(b.rMax ?? -Infinity, reps); b.rMin = Math.min(b.rMin ?? Infinity, reps); }
    b.days.add(r.date);
  }
  const round = (v) => (v == null ? null : Math.round(v * 10) / 10);
  return [...map.values()]
    .map((b) => ({ start: b.start, end: b.end, wMax: round(b.wMax), wMin: round(b.wMin), rMax: round(b.rMax), rMin: round(b.rMin), value: round(b.wMax) ?? 0, days: b.days.size }))
    .sort((a, b) => a.start - b.start);
}

// Rows -> [{ start: Date, end: Date, value, count, days }] for one scale,
// only periods that have data.
export function bucketize(rows, metric, scale, bwOn) {
  const m = METRICS[metric];
  const map = new Map();
  for (const r of rows) {
    if (r.type !== m.type) continue;
    const v = entryValue(metric, r, bwOn);
    if (v == null) continue;
    const start = periodStart(parseIso(r.date), scale);
    const key = start.getTime();
    let b = map.get(key);
    if (!b) { b = { start, end: nextPeriod(start, scale), value: m.agg === "max" ? -Infinity : 0, count: 0, days: new Set() }; map.set(key, b); }
    b.value = m.agg === "max" ? Math.max(b.value, v) : b.value + v;
    b.count += 1;
    b.days.add(r.date);
  }
  return [...map.values()]
    .map((b) => ({ ...b, value: Math.round((m.agg === "avg" ? b.value / b.days.size : b.value) * 10) / 10, days: b.days.size }))
    .sort((a, b) => a.start - b.start);
}

/* ---------- axis helpers ---------- */
// Round tick values: 0 to a clean max in 3-5 even steps.
// Days with food logged in [start, end), and how many of them met a target:
// protein at or above it, calories within 10% of it.
export function daysOnTarget(rows, metric, target, start, end) {
  const byDay = new Map();
  for (const r of rows) {
    if (r.type !== "food") continue;
    const t = parseIso(r.date).getTime();
    if (t < start || t >= end) continue;
    byDay.set(r.date, (byDay.get(r.date) || 0) + (Number(r.e[metric]) || 0));
  }
  let hit = 0;
  for (const v of byDay.values()) if (metric === "kcal" ? Math.abs(v - target) <= target * 0.1 : v >= target) hit += 1;
  return { hit, days: byDay.size };
}

export function niceTicks(v) {
  if (!(v > 0)) return [0, 1];
  const raw = v / 4;
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * exp).find((st) => st >= raw);
  const n = Math.max(1, Math.ceil(v / step - 1e-9));
  return Array.from({ length: n + 1 }, (_, i) => Math.round(i * step * 1000) / 1000);
}

// For lines (levels like best weight), start the axis a little under the
// lowest value instead of at zero, so changes are visible.
export function niceRange(min, max) {
  if (!(max > 0)) return [0, 1];
  if (!(min > 0) || min / max < 0.4) return niceTicks(max);
  const raw = (max - min * 0.9) / 4 || max / 4;
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * exp).find((st) => st >= raw);
  const lo = Math.floor((min * 0.95) / step) * step;
  const n = Math.max(1, Math.ceil((max - lo) / step - 1e-9));
  return Array.from({ length: n + 1 }, (_, i) => Math.round((lo + i * step) * 1000) / 1000);
}

export function compact(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, "")}K`;
  return String(Math.round(n * 10) / 10);
}
