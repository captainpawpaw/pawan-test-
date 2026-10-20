// Personal bests for each strength exercise: the heaviest weight lifted and
// the most reps in a set. A record is set by the first set that beats it;
// matching it later isn't a new best.

import { nameKey } from "./importParser.js";

const num = (v) => Number(v) || 0;

// history: Map(nameKey -> [{ date, entries }]) oldest first (from strengthHistory)
// -> Map(nameKey -> { name, weight: { value, reps, bw, date, id } | null, reps: { value, weight, bw, date, id } | null })
export function personalBests(history) {
  const out = new Map();
  for (const [k, sessions] of history || []) {
    let weight = null, reps = null;
    for (const { date, entries } of sessions) {
      for (const e of entries) {
        const w = num(e.weight), r = num(e.reps);
        if (w > 0 && (!weight || w > weight.value)) weight = { value: w, reps: r, bw: Boolean(e.bw), date, id: e.id };
        if (r > 0 && (!reps || r > reps.value)) reps = { value: r, weight: w, bw: Boolean(e.bw), date, id: e.id };
      }
    }
    const last = sessions[sessions.length - 1];
    if (weight || reps) out.set(k, { name: last.entries[last.entries.length - 1].exercise, weight, reps });
  }
  return out;
}

// What a new set would beat, against the bests before it. Nothing for an
// exercise's first ever set: there's no record to beat yet.
// -> { weight: { value, was } | null, reps: { value, was } | null } or null
export function newBests(bests, entry) {
  const prev = bests?.get(nameKey(entry?.exercise || ""));
  if (!prev) return null;
  const w = num(entry.weight), r = num(entry.reps);
  const weight = prev.weight && w > prev.weight.value ? { value: w, was: prev.weight.value } : null;
  const reps = prev.reps && r > prev.reps.value ? { value: r, was: prev.reps.value } : null;
  return weight || reps ? { weight, reps } : null;
}

// The ids of the sets that hold a record, for a PB badge.
export function recordIds(bests) {
  const ids = new Set();
  for (const b of bests?.values() || []) {
    if (b.weight?.id) ids.add(b.weight.id);
    if (b.reps?.id) ids.add(b.reps.id);
  }
  return ids;
}

// Bests as a list, most recently set first.
export function bestsList(bests) {
  const latest = (b) => [b.weight?.date || "", b.reps?.date || ""].sort().pop();
  return [...(bests?.values() || [])].sort((a, b) => latest(b).localeCompare(latest(a)) || a.name.localeCompare(b.name));
}
