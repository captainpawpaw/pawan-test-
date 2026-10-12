// Training splits: which muscles each day of the week trains, and the sets,
// reps and first-set weight to use. Default is no schedule, just the scheme.
// Setting (in the profile, so it syncs): { id, sets, reps, firstPct, at }

const UPPER = ["chest", "lats", "middle back", "shoulders", "biceps", "triceps", "traps", "forearms"];
const LOWER = ["quadriceps", "hamstrings", "glutes", "calves", "adductors", "abductors", "lower back"];
export const SESSIONS = {
  "Upper A": { muscles: UPPER, about: "chest, back, shoulders, arms" },
  "Upper B": { muscles: UPPER, about: "chest, back, shoulders, arms" },
  "Lower A": { muscles: LOWER, about: "quads, hamstrings, glutes, calves" },
  "Lower B": { muscles: LOWER, about: "quads, hamstrings, glutes, calves" },
  Push: { muscles: ["chest", "shoulders", "triceps"], about: "chest, shoulders, triceps" },
  Pull: { muscles: ["lats", "middle back", "traps", "biceps", "forearms"], about: "back, biceps" },
  Legs: { muscles: LOWER, about: "quads, hamstrings, calves" },
  "Full body": { muscles: null, about: "compound lifts: squats, deadlifts, presses, rows" },
};

// week: Monday first. null = rest.
export const SPLITS = [
  { id: "default", name: "Default", sets: 3, reps: 10, firstPct: 70, week: null,
    about: "No schedule. First set at 70% of last time's max, then 3 × 10." },
  { id: "upper-lower", name: "Upper/Lower · 4 days", sets: 4, reps: 8, firstPct: 70,
    week: ["Upper A", "Lower A", null, "Upper B", "Lower B", null, null],
    about: "Each muscle twice a week with plenty of recovery. Best for balance; leaves room for cardio." },
  { id: "ppl-3", name: "Push-Pull-Legs · 3 days", sets: 3, reps: 10, firstPct: 70,
    week: ["Push", null, "Pull", null, "Legs", null, null],
    about: "Muscles grouped by movement, each trained once a week." },
  { id: "ppl-6", name: "Push-Pull-Legs · 6 days", sets: 3, reps: 10, firstPct: 70,
    week: ["Push", "Pull", "Legs", "Push", "Pull", "Legs", null],
    about: "Each group twice a week: the most weekly volume." },
  { id: "full-body", name: "Full body · 3 days", sets: 3, reps: 8, firstPct: 70,
    week: ["Full body", null, "Full body", null, "Full body", null, null],
    about: "The whole body every session with compound lifts. Best for time and calorie burn." },
];

const clampNum = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : dflt; };

// The chosen split, with your own sets, reps and first-set % applied.
export function activeSplit(setting) {
  const base = SPLITS.find((s) => s.id === setting?.id) || SPLITS[0];
  return {
    ...base,
    sets: clampNum(setting?.sets, 1, 20, base.sets),
    reps: clampNum(setting?.reps, 1, 100, base.reps),
    firstPct: clampNum(setting?.firstPct, 10, 100, base.firstPct),
  };
}

// The session on a date (local time), or undefined for a split with no
// schedule, or null for a rest day.
export function sessionOn(split, date) {
  if (!split.week) return undefined;
  const name = split.week[(date.getDay() + 6) % 7];
  return name ? { name, ...SESSIONS[name] } : null;
}

// Exercises you've logged that suit a session, most logged first.
// logged: [[name, count]]; library: [{ name, primaryMuscles }]
export function suggestFor(session, logged, library, max = 6) {
  const muscles = new Map(library.map((e) => [e.name.toLowerCase(), e.primaryMuscles || []]));
  const fits = (name) => {
    if (!session.muscles) return true;
    return (muscles.get(name.toLowerCase()) || []).some((m) => session.muscles.includes(m));
  };
  return logged.filter(([name]) => fits(name)).sort((a, b) => b[1] - a[1]).slice(0, max).map(([name]) => name);
}
