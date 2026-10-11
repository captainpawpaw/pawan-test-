// Merging logbooks from two places (this browser and Google Drive).
//
// Entries are only ever added or deleted, never edited, and every entry has a
// unique id. So two copies merge by taking every entry either side has, minus
// any entry either side has deleted. Deletions are remembered as
// "tombstones" ({ [entryId]: deletedAtMs }) so a deleted entry doesn't come
// back from the other copy.

const TYPES = ["strength", "cardio", "food"];

export function mergeTombstones(a = {}, b = {}) {
  const out = { ...a };
  for (const [id, ts] of Object.entries(b)) {
    out[id] = Math.max(out[id] || 0, ts);
  }
  return out;
}

// month: { "01": { strength: [...], cardio: [...] }, ... }
export function mergeMonth(a = {}, b = {}, tombstones = {}) {
  const out = {};
  const days = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const day of days) {
    const da = a[day] || {};
    const db = b[day] || {};
    const merged = {};
    let any = false;
    for (const type of TYPES) {
      const seen = new Set();
      const list = [];
      for (const e of [...(da[type] || []), ...(db[type] || [])]) {
        if (!e || !e.id || seen.has(e.id) || tombstones[e.id]) continue;
        seen.add(e.id);
        list.push(e);
      }
      merged[type] = list;
      if (list.length) any = true;
    }
    if (any) out[day] = merged;
  }
  return out;
}

// Exercise tags: { [exerciseName]: { tags: [...], at: changedAtMs } }.
// Each exercise keeps whichever side changed its tags most recently.
export function mergeTags(a = {}, b = {}) {
  const out = { ...a };
  for (const [name, v] of Object.entries(b)) {
    if (!out[name] || (v?.at || 0) > (out[name].at || 0)) out[name] = v;
  }
  return out;
}

// Imported exercises: { [exerciseName]: { ...details, at, removed? } }, same rule.
export const mergeExercises = mergeTags;

// Settings: { bodyweight: { weights: [{ date, kg }], at } }, same rule per setting.
export const mergeProfile = mergeTags;

// book: { months: { "2026-09": month, ... }, deleted: tombstones, tags, exercises, profile }
export function mergeBooks(a = {}, b = {}) {
  const deleted = mergeTombstones(a.deleted, b.deleted);
  const tags = mergeTags(a.tags, b.tags);
  const exercises = mergeExercises(a.exercises, b.exercises);
  const profile = mergeProfile(a.profile, b.profile);
  const months = {};
  const keys = new Set([...Object.keys(a.months || {}), ...Object.keys(b.months || {})]);
  for (const k of keys) {
    const m = mergeMonth((a.months || {})[k], (b.months || {})[k], deleted);
    if (Object.keys(m).length) months[k] = m;
  }
  return { months, deleted, tags, exercises, profile };
}

// True when two months hold the same entries (order within a day ignored).
export function sameMonth(a = {}, b = {}) {
  const norm = (m) => {
    const out = {};
    for (const [day, v] of Object.entries(m || {})) {
      const ids = TYPES.flatMap((t) => (v?.[t] || []).map((e) => `${t}:${e.id}`)).sort();
      if (ids.length) out[day] = ids.join(",");
    }
    return JSON.stringify(Object.keys(out).sort().map((d) => [d, out[d]]));
  };
  return norm(a) === norm(b);
}
