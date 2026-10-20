// "Last time": the previous session of an exercise, shown when you log it
// again, with a first-set weight: a share (70% by default) of that session's top weight.

import { nameKey } from "./importParser.js";

export const FIRST_SET_PCT = 70;
// The choices offered in the menu.
export const FIRST_SET_OPTIONS = [70, 80, 90];
// The chosen first-set %: the menu's setting, else an older per-split one
// rounded to the nearest choice, else 70%.
export function firstSetPct(profile) {
  const n = Number(profile?.firstSet?.pct ?? profile?.split?.firstPct);
  if (!Number.isFinite(n) || n <= 0) return FIRST_SET_PCT;
  return FIRST_SET_OPTIONS.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));
}

// months: { "2026-10": { "05": { strength: [...] } } } -> Map(nameKey -> [{ date, entries }]) oldest first
export function strengthHistory(months) {
  const byName = new Map();
  for (const [mk, month] of Object.entries(months || {})) {
    for (const [day, v] of Object.entries(month || {})) {
      for (const e of v?.strength || []) {
        const k = nameKey(e?.exercise || "");
        if (!k) continue;
        const date = `${mk}-${day}`;
        if (!byName.has(k)) byName.set(k, new Map());
        const days = byName.get(k);
        if (!days.has(date)) days.set(date, []);
        days.get(date).push(e);
      }
    }
  }
  const out = new Map();
  for (const [k, days] of byName) out.set(k, [...days].map(([date, entries]) => ({ date, entries })).sort((a, b) => a.date.localeCompare(b.date)));
  return out;
}

// Rounded to the nearest 2.5 kg (what plates allow), never below 0.
export const roundPlate = (kg) => Math.max(0, Math.round(kg / 2.5) * 2.5);

// The latest session of `name` before `beforeDate` (YYYY-MM-DD): its top set
// (heaviest, then most reps) and the first-set weight. null if there isn't one.
export function lastSession(history, name, beforeDate, firstPct = FIRST_SET_PCT) {
  const sessions = history?.get(nameKey(name || ""));
  if (!sessions) return null;
  let s = null;
  for (let i = sessions.length - 1; i >= 0; i--) if (sessions[i].date < beforeDate) { s = sessions[i]; break; }
  if (!s) return null;
  const num = (v) => Number(v) || 0;
  const top = s.entries.reduce((a, e) => (!a || num(e.weight) > num(a.weight) || (num(e.weight) === num(a.weight) && num(e.reps) > num(a.reps)) ? e : a), null);
  const weight = num(top.weight);
  const bw = Boolean(top.bw);
  return {
    date: s.date,
    weight,
    reps: num(top.reps),
    sets: num(top.sets),
    bw,
    warmUp: weight > 0 ? roundPlate((weight * firstPct) / 100) : null,
  };
}
