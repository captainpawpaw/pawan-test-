import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { storage } from "./storage";
import * as drive from "./driveSync";
import { parsePage, nameKey, planText } from "./importParser";
import { getSample, getImageLimits, readWithClaude, readScreenshotsWithClaude } from "./claudeRead";
import Progress from "./Progress";
import FoodLog from "./FoodLog";
import { sumFood } from "./food";
import { flattenMonths, ledgerHeadline } from "./progress";
import Backup from "./Backup";
import { WeighInPrompt, WeighInSettings } from "./WeighIn";
import { weighInDue, describeWeighIn } from "./weighin";
import { strengthHistory, lastSession, firstSetPct, FIRST_SET_OPTIONS } from "./lastTime";
import { personalBests, newBests, recordIds, bestsList } from "./bests";
import { BodyWeightField } from "./BodyWeight";
import { validUnit, toKg, fromKg, bwText, validLiftUnit, liftValue, liftText, liftToKg, liftField } from "./units";
import { SplitSettings, DayPlan } from "./Split";
import { SPLITS, activeSplit, sessionOn, suggestFor } from "./splits";
import { C, THEMES, THEME_NAMES, THEME_CSS, applyTheme, savedTheme } from "./theme";

/* ---------- date helpers ---------- */
const pad2 = (n) => String(n).padStart(2, "0");
const monthKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
const todayDayNum = () => pad2(new Date().getDate());
const isSameMonth = (d) => monthKey(d) === monthKey(new Date());
const MONTH_NAMES = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
// Weeks start on Monday.
const DOW = ["M","T","W","T","F","S","S"];

const TABS = [["log", "LOG"], ["food", "FOOD"], ["exercises", "EXERCISES"], ["progress", "PROGRESS"]];
// Icons for the bottom navigation bar (24 × 24, drawn with the current colour).
const TAB_ICONS = {
  log: <path d="M3 9.5v5M6 7.5v9M18 7.5v9M21 9.5v5M6 12h12" />,
  food: <><path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5" /><path d="M17 21V3c-2.2 1.2-3 3.6-3 6.5V14h3" /></>,
  exercises: <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>,
  progress: <path d="M3 20h18M5 16l5-5 4 3 6-7" />,
};

// A synced map in storage ({ [id]: entry }): loads it, and writes one entry at
// a time, re-reading first so anything that arrived by sync isn't lost.
function useSyncedMap(key) {
  const [map, setMap] = useState({});
  const load = useCallback(async () => {
    try {
      const res = await storage.get(key, false);
      setMap(res ? JSON.parse(res.value) : {});
    } catch (e) {
      /* keep what's on screen */
    }
  }, [key]);
  useEffect(() => { load(); }, [load]);
  const write = useCallback(async (id, entry) => {
    let cur = {};
    try { const res = await storage.get(key, false); cur = res ? JSON.parse(res.value) : {}; } catch { cur = {}; }
    const next = { ...cur, [id]: entry };
    const ok = await storage.set(key, JSON.stringify(next), false).catch(() => null);
    if (!ok) return false;
    setMap(next);
    drive.scheduleSync();
    return true;
  }, [key]);
  return [map, setMap, write, load];
}

// Things that use a sideways drag themselves: typing, sliders, the chart,
// anything scrolling sideways, and the calendar sidebar.
function swipeBlocked(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.matches?.("input, textarea, select, [data-noswipe], .ft-cal-drawer, .ft-cal-tab, [contenteditable='true']")) return true;
    const ox = getComputedStyle(n).overflowX;
    if ((ox === "auto" || ox === "scroll") && n.scrollWidth > n.clientWidth + 2) return true;
  }
  return false;
}

function buildGrid(d) {
  const year = d.getFullYear(), month = d.getMonth();
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(pad2(day));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

// Volume counts each logged exercise at its max weight. Body-weight sets add
// body weight (when known) to that.
function strengthVolume(entries, bodyweightKg = null) {
  return (entries || []).reduce((sum, e) => {
    const load = (Number(e.weight) || 0) + (e.bw ? Number(bodyweightKg) || 0 : 0);
    return sum + (Number(e.sets) || 0) * (Number(e.reps) || 0) * load;
  }, 0);
}
function bodyweightReps(entries) {
  return (entries || []).filter((e) => e.bw).reduce((sum, e) => sum + (Number(e.sets) || 0) * (Number(e.reps) || 0), 0);
}
const todayIso = () => { const d = new Date(); return `${monthKey(d)}-${pad2(d.getDate())}`; };

// weights: [{ date: "YYYY-MM-DD", kg }]. The weight in force on a date: the
// latest entry on or before it, else the earliest one.
function bodyweightOn(weights, date) {
  if (!weights?.length) return null;
  const sorted = [...weights].sort((a, b) => a.date.localeCompare(b.date));
  let found = null;
  for (const w of sorted) if (w.date <= date) found = w;
  return (found || sorted[0]).kg;
}

// Weights are stored in kg; u is the unit to show them in ("kg" or "lb").
const weightLabel = (e, u = "kg") => (e.bw ? (Number(e.weight) ? `BW + ${liftValue(e.weight, u)}${u}` : "BW") : `${liftValue(e.weight || 0, u)}${u}`);
const hasMin = (e) => e.minWeight !== "" && e.minWeight != null && Number(e.weight) > 0;
// "4×10 · 20–23.75kg", "4×10 · max 23.75kg", "3×8 · BW + 5–10kg"
const weightRange = (e, u = "kg") => {
  if (e.bw && !Number(e.weight)) return "BW";
  if (!hasMin(e)) return `max ${weightLabel(e, u)}`;
  const lo = liftValue(Math.min(Number(e.minWeight), Number(e.weight)), u), hi = liftValue(e.weight, u);
  return e.bw ? `BW + ${lo}–${hi}${u}` : `${lo}–${hi}${u}`;
};
function cardioDuration(entries) {
  return (entries || []).reduce((sum, e) => sum + (Number(e.duration) || 0), 0);
}

const uid = () => Math.random().toString(36).slice(2, 10);

// Always included in the exercise library, regardless of what the external dataset returns
const CUSTOM_EXERCISES = [
  { name: "Back Squat", category: "strength", equipment: "barbell", primaryMuscles: ["quadriceps"] },
  { name: "Leg Press", category: "strength", equipment: "machine", primaryMuscles: ["quadriceps"] },
  { name: "Romanian Deadlift", category: "strength", equipment: "barbell", primaryMuscles: ["hamstrings"] },
  { name: "Walking Lunges", category: "strength", equipment: "dumbbell", primaryMuscles: ["quadriceps"] },
  { name: "Weighted Sit Up", category: "strength", equipment: "plate", primaryMuscles: ["abdominals"] },
  { name: "Cable Wood Chops", category: "strength", equipment: "cable", primaryMuscles: ["abdominals"] },
  { name: "Incline Barbell Bench Press", category: "strength", equipment: "barbell", primaryMuscles: ["chest"] },
  { name: "Flat Dumbbell Flye", category: "strength", equipment: "dumbbell", primaryMuscles: ["chest"] },
  { name: "Weighted Dip", category: "strength", equipment: "dip bar", primaryMuscles: ["triceps", "chest"] },
  { name: "Dumbbell Row", category: "strength", equipment: "dumbbell", primaryMuscles: ["lats"] },
  { name: "Wide Grip Lat Pulldown", category: "strength", equipment: "cable", primaryMuscles: ["lats"] },
  { name: "Rower", category: "cardio", equipment: "machine", primaryMuscles: ["cardiovascular system"] },
  { name: "Seated Barbell Military Press", category: "strength", equipment: "barbell", primaryMuscles: ["shoulders"] },
  { name: "Dumbbell Lateral Raise", category: "strength", equipment: "dumbbell", primaryMuscles: ["shoulders"] },
  { name: "Cable Face Pull", category: "strength", equipment: "cable", primaryMuscles: ["shoulders"] },
  { name: "Skullcrusher", category: "strength", equipment: "barbell", primaryMuscles: ["triceps"] },
  { name: "Cable Pushdown", category: "strength", equipment: "cable", primaryMuscles: ["triceps"] },
  { name: "Preacher Curl", category: "strength", equipment: "barbell", primaryMuscles: ["biceps"] },
  { name: "Incline Dumbbell Hammer Curl", category: "strength", equipment: "dumbbell", primaryMuscles: ["biceps"] },
  { name: "Deadlift (Sumo, Trap Bar, or Conventional)", category: "strength", equipment: "barbell", primaryMuscles: ["hamstrings", "glutes"] },
  { name: "Machine Hamstring Curl", category: "strength", equipment: "machine", primaryMuscles: ["hamstrings"] },
  { name: "Machine Leg Extension", category: "strength", equipment: "machine", primaryMuscles: ["quadriceps"] },
  { name: "Decline Sit Up", category: "strength", equipment: "bench", primaryMuscles: ["abdominals"] },
  { name: "Russian Twist", category: "strength", equipment: "body only", primaryMuscles: ["abdominals"] },
  { name: "Dumbbell Shoulder Press", category: "strength", equipment: "dumbbell", primaryMuscles: ["shoulders"] },
  { name: "Deficit Push Up", category: "strength", equipment: "body only", primaryMuscles: ["chest"] },
  { name: "Neutral Grip Pulldown", category: "strength", equipment: "cable", primaryMuscles: ["lats"] },
  { name: "Cable Triceps Pushdown", category: "strength", equipment: "cable", primaryMuscles: ["triceps"] },
  { name: "Incline Dumbbell Curl", category: "strength", equipment: "dumbbell", primaryMuscles: ["biceps"] },
  { name: "Incline Treadmill Run/Walk", category: "cardio", equipment: "machine", primaryMuscles: ["cardiovascular system"] },
];

export default function App() {
  const [cursor, setCursor] = useState(new Date());
  const [monthData, setMonthData] = useState({});
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(false);
  const [selected, setSelected] = useState(isSameMonth(new Date()) ? todayDayNum() : "01");
  const [baseExercises, setFullExercises] = useState([...CUSTOM_EXERCISES].sort((a, b) => a.name.localeCompare(b.name)));
  const [exercisesLoading, setExercisesLoading] = useState(true);
  // Opens on Progress; a link can ask for another tab with ?tab=log (or food, exercises).
  const [activeTab, setActiveTab] = useState(() => {
    const asked = new URLSearchParams(window.location.search).get("tab");
    return TABS.some(([id]) => id === asked) ? asked : "progress";
  });
  // Swipe left or right to move between tabs (touch only). Swipes that start
  // on something that drags or scrolls sideways itself are left alone.
  const [slideDir, setSlideDir] = useState(null);
  const swipe = useRef(null);
  const goTab = (id) => {
    const from = TABS.findIndex(([t]) => t === activeTab), to = TABS.findIndex(([t]) => t === id);
    if (to < 0 || to === from) return;
    setSlideDir(to > from ? "left" : "right");
    setActiveTab(id);
  };
  const onSwipeStart = (e) => {
    const t = e.touches[0];
    if (e.touches.length !== 1 || t.clientX < 30 || t.clientX > window.innerWidth - 20 || swipeBlocked(e.target)) { swipe.current = null; return; }
    swipe.current = { x: t.clientX, y: t.clientY, at: Date.now(), day: Boolean(e.target.closest?.("[data-dayswipe]")) };
  };
  const onSwipeEnd = (e) => {
    const s0 = swipe.current;
    swipe.current = null;
    const t = e.changedTouches[0];
    if (!s0 || !t) return;
    const dx = t.clientX - s0.x, dy = t.clientY - s0.y;
    if (Math.abs(dx) < (s0.day ? 40 : 70) || Math.abs(dx) < Math.abs(dy) * 1.8 || Date.now() - s0.at > 700) return;
    // On the date heading: the previous or next day instead of another tab.
    if (s0.day) { goDayRef.current?.(dx < 0 ? 1 : -1); return; }
    const i = TABS.findIndex(([id]) => id === activeTab);
    const next = TABS[i + (dx < 0 ? 1 : -1)];
    if (next) goTab(next[0]);
  };
  const [prefill, setPrefill] = useState(null);
  // The month calendar is a sidebar that slides out from the left: open while
  // its tab is hovered (mouse), or tapped/clicked open; picking a day tucks it
  // away again.
  const [calHover, setCalHover] = useState(false);
  const [calPinned, setCalPinned] = useState(false);
  const calOpen = calHover || calPinned;
  const calRef = useRef(null);
  const calTabRef = useRef(null);
  const calPickedAt = useRef(0);
  // restoreFocus: after closing from the keyboard, put focus back on the tab.
  const closeCal = useCallback((restoreFocus = false) => {
    setCalPinned(false);
    setCalHover(false);
    if (restoreFocus) calTabRef.current?.focus();
  }, []);
  // Opened by a tap or click: it acts as a dialog, so focus moves into it and
  // the page behind stops scrolling.
  useEffect(() => {
    if (!calPinned) return undefined;
    const raf = requestAnimationFrame(() => {
      if (!calRef.current?.contains(document.activeElement)) calRef.current?.querySelector('[aria-pressed="true"]')?.focus();
    });
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { cancelAnimationFrame(raf); document.body.style.overflow = prev; };
  }, [calPinned]);
  const onCalKeyDown = (e) => {
    if (e.key === "Escape") { e.preventDefault(); closeCal(true); return; }
    if (e.key !== "Tab" || !calPinned) return;
    // Keep Tab inside the open sidebar.
    const items = [...calRef.current.querySelectorAll("button")];
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const [tagMap, setTagMap] = useState({});
  const [tagSaveError, setTagSaveError] = useState(false);
  const [imported, setImported] = useState({});
  const [loaded, setLoaded] = useState({ tags: false, imported: false });
  const [profile, setProfile] = useState({});

  const key = monthKey(cursor);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}exercises.json`)
      .then((r) => r.json())
      .then((data) => {
        const customLower = new Set(CUSTOM_EXERCISES.map((e) => e.name.toLowerCase()));
        const merged = [...CUSTOM_EXERCISES];
        data
          .filter((e) => e.name && !customLower.has(e.name.toLowerCase()))
          .forEach((e) =>
            merged.push({
              name: e.name,
              category: e.category || "strength",
              equipment: e.equipment || null,
              primaryMuscles: e.primaryMuscles || [],
            })
          );
        merged.sort((a, b) => a.name.localeCompare(b.name));
        setFullExercises(merged);
      })
      .catch(() => {
        /* autosuggest / library are optional — the rest of the app still works */
      })
      .finally(() => setExercisesLoading(false));
  }, []);

  const loadMonth = useCallback(async (d, quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await storage.get(`month:${monthKey(d)}`, false);
      setMonthData(res ? JSON.parse(res.value) : {});
    } catch (e) {
      if (!quiet) setMonthData({});
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadMonth(cursor); }, [cursor, loadMonth]);

  const loadTags = useCallback(async () => {
    try {
      const res = await storage.get("tags", false);
      setTagMap(res ? JSON.parse(res.value) : {});
      setLoaded((l) => ({ ...l, tags: true }));
    } catch (e) {
      /* keep what's on screen */
    }
  }, []);

  useEffect(() => { loadTags(); }, [loadTags]);

  const loadImported = useCallback(async () => {
    try {
      const res = await storage.get("exercises", false);
      setImported(res ? JSON.parse(res.value) : {});
      setLoaded((l) => ({ ...l, imported: true }));
    } catch (e) {
      /* keep what's on screen */
    }
  }, []);

  useEffect(() => { loadImported(); }, [loadImported]);

  const loadProfile = useCallback(async () => {
    try {
      const res = await storage.get("profile", false);
      setProfile(res ? JSON.parse(res.value) : {});
    } catch (e) {
      /* keep what's on screen */
    }
  }, []);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  // My foods (packaged foods saved from photos of their labels) and meals
  // (several foods added in one tap): synced lists keyed by id.
  const [myFoods, , writeMyFood, loadMyFoods] = useSyncedMap("myfoods");
  const [meals, , writeMeal, loadMeals] = useSyncedMap("meals");
  const newId = (prefix) => `${prefix}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const saveMyFood = async (food) => {
    const id = food.id || newId("my");
    const entry = { ...food, id, at: Date.now() };
    return (await writeMyFood(id, entry)) ? entry : null;
  };
  const removeMyFood = async (id) => {
    const f = myFoods[id];
    if (f) await writeMyFood(id, { id, name: f.name, removed: true, at: Date.now() });
  };
  // A meal keeps its foods as logged (amounts and nutrients), without day-entry ids.
  const saveMeal = async (name, entries) => {
    const id = newId("meal");
    const items = entries.map(({ id: _id, meal: _m, ...e }) => e);
    const entry = { id, name: name.trim().slice(0, 60), items, at: Date.now() };
    return (await writeMeal(id, entry)) ? entry : null;
  };
  const removeMeal = async (id) => {
    const m = meals[id];
    if (m) await writeMeal(id, { id, name: m.name, removed: true, at: Date.now() });
  };
  const mealList = useMemo(() => Object.values(meals).filter((m) => m && !m.removed && m.items?.length).sort((a, b) => (b.at || 0) - (a.at || 0)), [meals]);
  const myFoodList = useMemo(() => Object.values(myFoods).filter((f) => f && !f.removed && f.per100).sort((a, b) => (b.at || 0) - (a.at || 0)), [myFoods]);

  // Theme: remembered in this browser for a quick start, and in the profile
  // so it follows you to other devices.
  const [theme, setTheme] = useState(savedTheme);
  useEffect(() => {
    const t = profile.theme?.name;
    if (t && THEMES[t] && t !== theme) setTheme(applyTheme(t));
  }, [profile.theme?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef(null);
  const closeMenu = useCallback(() => { setMenuOpen(false); menuBtnRef.current?.focus(); }, []);
  const chooseTheme = async (name) => {
    setTheme(applyTheme(name));
    const next = { ...profile, theme: { name, at: Date.now() } };
    setProfile(next);
    const res = await storage.set("profile", JSON.stringify(next), false).catch(() => null);
    if (res) drive.scheduleSync();
  };

  const weights = useMemo(() => profile.bodyweight?.weights || [], [profile]);
  const bwOnDate = useCallback((date) => bodyweightOn(weights, date), [weights]);
  const bwOnDay = useCallback((d, day) => bodyweightOn(weights, `${monthKey(d)}-${day}`), [weights]);

  const saveBodyweight = async (kg) => {
    const date = todayIso();
    const nextWeights = [...weights.filter((w) => w.date !== date), { date, kg }].sort((a, b) => a.date.localeCompare(b.date));
    const next = { ...profile, bodyweight: { weights: nextWeights, at: Date.now() } };
    setProfile(next);
    const res = await storage.set("profile", JSON.stringify(next), false).catch(() => null);
    if (res) drive.scheduleSync();
    return Boolean(res);
  };

  // Lifting weights unit (kg or lb), chosen in the menu; weights stay stored in kg.
  const liftUnit = validLiftUnit(profile.units?.lift);
  const saveLiftUnit = async (unit) => {
    const next = { ...profile, units: { ...(profile.units || {}), lift: unit, at: Date.now() } };
    setProfile(next);
    const res = await storage.set("profile", JSON.stringify(next), false).catch(() => null);
    if (res) drive.scheduleSync();
  };

  // Body weight unit (kg, lb, or st & lb), chosen wherever you enter it.
  const bwUnit = validUnit(profile.units?.weight);
  const saveBwUnit = async (unit) => {
    const next = { ...profile, units: { ...(profile.units || {}), weight: unit, at: Date.now() } };
    setProfile(next);
    const res = await storage.set("profile", JSON.stringify(next), false).catch(() => null);
    if (res) drive.scheduleSync();
  };

  // The panel opened from the menu, shown above the tabs: "weighin" (its
  // settings), "split" (sets and reps) or "backup". One at a time.
  const [panel, setPanel] = useState(null);
  const openPanel = (name) => { setPanel(name); window.scrollTo?.({ top: 0, behavior: "smooth" }); };
  const closePanel = () => setPanel(null);

  // Weekly weigh-in: asks for your weight at the day and time you set.
  const weighIn = profile.weighin || null;
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setClock(Date.now());
    const id = setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, []);
  const weighInDueAt = useMemo(() => weighInDue(weighIn, weights, new Date(clock)), [weighIn, weights, clock]);
  // Training split: the day's session, and the sets, reps and first-set % to use.
  const split = useMemo(() => activeSplit(profile.split), [profile.split]);
  // First set: the share of last time's max the app suggests starting at.
  const firstPct = firstSetPct(profile);
  const saveFirstSet = async (pct) => {
    const next = { ...profile, firstSet: { pct, at: Date.now() } };
    setProfile(next);
    const res = await storage.set("profile", JSON.stringify(next), false).catch(() => null);
    if (res) drive.scheduleSync();
  };
  const saveSplit = async (value) => {
    const next = { ...profile, split: { ...value, at: Date.now() } };
    setProfile(next);
    const res = await storage.set("profile", JSON.stringify(next), false).catch(() => null);
    if (res) drive.scheduleSync();
    return Boolean(res);
  };

  const saveWeighIn = async (patch) => {
    const cur = profile.weighin || {};
    const changed = ["on", "day", "time"].some((k) => k in patch && patch[k] !== cur[k]);
    const next = { ...profile, weighin: { ...cur, ...patch, ...(changed ? { since: Date.now() } : {}), at: Date.now() } };
    setProfile(next);
    const res = await storage.set("profile", JSON.stringify(next), false).catch(() => null);
    if (res) drive.scheduleSync();
    return Boolean(res);
  };

  // The built-in library plus anything imported from web pages. An imported
  // exercise that's already in the library adds its plan (sets, reps, notes).
  const fullExercises = useMemo(() => {
    const byKey = new Map(baseExercises.map((e) => [nameKey(e.name), e]));
    const extra = [];
    const withPlans = new Map();
    for (const imp of Object.values(imported)) {
      if (!imp || imp.removed || !imp.name) continue;
      const base = byKey.get(nameKey(imp.name));
      if (base) withPlans.set(base.name, imp.plans || []);
      else extra.push({ name: imp.name, category: imp.category || "strength", equipment: imp.equipment || null, primaryMuscles: imp.primaryMuscles || [], plans: imp.plans || [], imported: true, custom: Boolean(imp.custom) });
    }
    const list = baseExercises.map((e) => (withPlans.has(e.name) ? { ...e, plans: withPlans.get(e.name) } : e));
    return [...list, ...extra].sort((a, b) => a.name.localeCompare(b.name));
  }, [baseExercises, imported]);

  const strengthNames = useMemo(() => fullExercises.filter((e) => e.category !== "cardio").map((e) => e.name), [fullExercises]);
  const cardioNames = useMemo(() => fullExercises.filter((e) => e.category === "cardio").map((e) => e.name), [fullExercises]);
  const bodyweightNames = useMemo(
    () => new Set(fullExercises.filter((e) => /body ?only|bodyweight/i.test(e.equipment || "")).map((e) => e.name)),
    [fullExercises],
  );
  const isBodyweight = useCallback((name) => bodyweightNames.has(name), [bodyweightNames]);
  const plansByName = useMemo(() => {
    const out = {};
    fullExercises.forEach((e) => { if (e.plans?.length) out[e.name] = e.plans; });
    return out;
  }, [fullExercises]);

  // Re-read what's on screen when a Drive sync brings in changes to it.
  // Bumped whenever logged data changes, so the Progress tab reloads it.
  const [dataVersion, setDataVersion] = useState(0);
  const loadAllMonths = useCallback(async () => {
    const listed = await storage.list("month:");
    const out = {};
    for (const k of listed?.keys || []) {
      const res = await storage.get(k).catch(() => null);
      if (res) {
        try { out[k.slice("month:".length)] = JSON.parse(res.value); } catch { /* skip a damaged month */ }
      }
    }
    return out;
  }, []);

  // Every logged strength session, for "last time" when you log an exercise
  // again. This month comes from what's on screen, so it's always current.
  const [allMonths, setAllMonths] = useState({});
  useEffect(() => {
    let live = true;
    loadAllMonths().then((m) => { if (live) setAllMonths(m); }).catch(() => {});
    return () => { live = false; };
  }, [loadAllMonths, dataVersion, key]); // and again on changing month, to pick up edits made in the last one
  const history = useMemo(() => strengthHistory({ ...allMonths, [monthKey(cursor)]: monthData }), [allMonths, monthData, cursor]);
  // The headline Ledger score at the top of every tab.
  const ledger = useMemo(() => ledgerHeadline(flattenMonths({ ...allMonths, [monthKey(cursor)]: monthData }), bwOnDate), [allMonths, monthData, cursor, bwOnDate]);

  // Personal bests: heaviest weight and most reps for each exercise.
  const bests = useMemo(() => personalBests(history), [history]);
  const pbIds = useMemo(() => recordIds(bests), [bests]);
  const [pbNote, setPbNote] = useState(null); // { name, bw, weight, reps } for a set that just beat a record
  const pbTimer = useRef(null);

  // Exercises you've logged that suit the day's session in your split,
  // leaving out what's already logged that day.
  const todaySuggestions = useMemo(() => {
    const session = sessionOn(split, new Date(cursor.getFullYear(), cursor.getMonth(), Number(selected)));
    if (!session) return [];
    const done = new Set((monthData[selected]?.strength || []).map((e) => nameKey(e.exercise || "")));
    const logged = [...history].filter(([k]) => !done.has(k)).map(([, sessions]) => [sessions[sessions.length - 1].entries[0].exercise, sessions.length]);
    return suggestFor(session, logged, fullExercises);
  }, [split, cursor, selected, monthData, history, fullExercises]);

  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  useEffect(() => {
    drive.initDriveSync();
    return drive.onMonthsChanged((keys) => {
      setDataVersion((v) => v + 1);
      if (keys.includes(monthKey(cursorRef.current))) loadMonth(cursorRef.current, true);
      if (keys.includes("tags")) loadTags();
      if (keys.includes("exercises")) loadImported();
      if (keys.includes("profile")) loadProfile();
      if (keys.includes("myfoods")) loadMyFoods();
      if (keys.includes("meals")) loadMeals();
    });
  }, [loadMonth, loadTags, loadImported, loadProfile, loadMyFoods, loadMeals]);

  const saveImported = async (next) => {
    setImported(next);
    const result = await storage.set("exercises", JSON.stringify(next), false).catch(() => null);
    if (result) drive.scheduleSync();
    return Boolean(result);
  };

  // rows: exercises from the import preview. Saves them and their tags.
  const importExercises = async (rows, extraTag) => {
    const now = Date.now();
    const nextImported = { ...imported };
    const nextTags = { ...tagMap };
    for (const r of rows) {
      const prev = nextImported[r.name];
      const plans = [...(prev && !prev.removed ? prev.plans || [] : [])];
      for (const pl of r.plans || []) {
        if (!plans.some((x) => x.tag === pl.tag && x.sets === pl.sets && x.reps === pl.reps && x.notes === pl.notes)) plans.push(pl);
      }
      nextImported[r.name] = {
        name: r.name,
        category: r.category,
        equipment: r.equipment || null,
        primaryMuscles: r.primaryMuscles || [],
        plans,
        at: now,
      };
      const tags = [...tagsOf(nextTags, r.name)];
      for (const t of [...(r.tags || []), extraTag].map((t) => t && cleanTag(t)).filter(Boolean)) if (!tags.includes(t)) tags.push(t);
      if (tags.length !== tagsOf(nextTags, r.name).length) nextTags[r.name] = { tags, at: now };
    }
    const ok = await saveImported(nextImported);
    setTagMap(nextTags);
    const tagRes = await storage.set("tags", JSON.stringify(nextTags), false).catch(() => null);
    setTagSaveError(!tagRes);
    if (tagRes) drive.scheduleSync();
    return ok && Boolean(tagRes);
  };

  const removeImported = async (name) => {
    const prev = imported[name];
    if (!prev) return;
    await saveImported({ ...imported, [name]: { name, at: Date.now(), removed: true } });
  };

  const setExerciseTags = async (name, tags) => {
    const next = { ...tagMap, [name]: { tags, at: Date.now() } };
    setTagMap(next);
    try {
      const result = await storage.set("tags", JSON.stringify(next), false);
      setTagSaveError(!result);
      if (result) drive.scheduleSync();
    } catch (e) {
      setTagSaveError(true);
    }
  };

  const persist = async (next) => {
    setMonthData(next);
    try {
      const result = await storage.set(`month:${monthKey(cursor)}`, JSON.stringify(next), false);
      setSaveError(!result);
      if (result) { drive.scheduleSync(); setDataVersion((v) => v + 1); }
    } catch (e) {
      setSaveError(true);
    }
  };

  const dayEntries = monthData[selected] || { strength: [], cardio: [] };

  // Your own exercises live with the imported ones, marked custom.
  const libraryKeys = useMemo(() => new Set(fullExercises.map((e) => nameKey(e.name))), [fullExercises]);
  const [newExerciseNote, setNewExerciseNote] = useState("");

  const createExercise = async ({ name, category, equipment, muscle, tags = [] }) => {
    const clean = name.trim().replace(/\s+/g, " ");
    if (!clean) return { ok: false, error: "Give the exercise a name." };
    if (libraryKeys.has(nameKey(clean))) return { ok: false, error: `“${clean}” is already in your exercises.` };
    const now = Date.now();
    const ok = await saveImported({
      ...imported,
      [clean]: { name: clean, category: category || "strength", equipment: equipment || null, primaryMuscles: muscle ? [muscle] : [], plans: [], custom: true, at: now },
    });
    const cleanTags = [...new Set([...tags.map(cleanTag), YOUR_TAG].filter(Boolean))];
    await setExerciseTags(clean, cleanTags);
    return { ok, name: clean, error: ok ? "" : "Couldn't save. Try again." };
  };

  // Once per visit, after the library and your data have loaded: add any
  // exercise you've logged that isn't in the library yet (e.g. logged before
  // this feature), and give all your own exercises the "your exercise" tag.
  const backfilled = useRef(false);
  useEffect(() => {
    if (backfilled.current || exercisesLoading || baseExercises.length < 100 || !loaded.tags || !loaded.imported) return;
    backfilled.current = true;
    (async () => {
      const months = await loadAllMonths().catch(() => null);
      if (!months) return;
      const known = new Set(fullExercises.map((e) => nameKey(e.name)));
      const found = new Map(); // key -> { name, category, bw }
      for (const month of Object.values(months)) {
        for (const day of Object.values(month || {})) {
          for (const [type, field] of [["strength", "exercise"], ["cardio", "activity"]]) {
            for (const e of day?.[type] || []) {
              const name = String(e?.[field] || "").trim().replace(/\s+/g, " ");
              const k = nameKey(name);
              if (!name || known.has(k)) continue;
              const prev = found.get(k);
              found.set(k, { name: prev?.name || name, category: type === "cardio" ? "cardio" : "strength", bw: (prev?.bw ?? true) && Boolean(e.bw) });
            }
          }
        }
      }
      const now = Date.now();
      let nextImported = null;
      if (found.size) {
        nextImported = { ...imported };
        for (const f of found.values()) {
          nextImported[f.name] = { name: f.name, category: f.category, equipment: f.bw ? "body only" : null, primaryMuscles: [], plans: [], custom: true, at: now };
        }
      }
      const mine = [
        ...Object.values(imported).filter((x) => x?.custom && !x.removed).map((x) => x.name),
        ...[...found.values()].map((f) => f.name),
      ];
      const nextTags = { ...tagMap };
      let tagsChanged = false;
      for (const n of mine) {
        const cur = tagsOf(nextTags, n);
        if (!cur.includes(YOUR_TAG)) { nextTags[n] = { tags: [...cur, YOUR_TAG], at: now }; tagsChanged = true; }
      }
      if (nextImported) await saveImported(nextImported);
      if (tagsChanged) {
        setTagMap(nextTags);
        const res = await storage.set("tags", JSON.stringify(nextTags), false).catch(() => null);
        if (res) drive.scheduleSync();
      }
      if (found.size) {
        setNewExerciseNote(`Added ${found.size} exercise${found.size === 1 ? "" : "s"} you've logged to your exercises.`);
        setTimeout(() => setNewExerciseNote(""), 6000);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercisesLoading, baseExercises, loaded]);

  const addEntry = (type, entry) => {
    if (type === "strength") {
      const beat = newBests(bests, entry);
      if (beat) {
        setPbNote({ name: entry.exercise, bw: Boolean(entry.bw), ...beat });
        clearTimeout(pbTimer.current);
        pbTimer.current = setTimeout(() => setPbNote(null), 10000);
      }
    }
    const current = monthData[selected] || { strength: [], cardio: [] };
    const updated = { ...current, [type]: [...(current[type] || []), { id: uid(), ...entry }] };
    persist({ ...monthData, [selected]: updated });
    noteNewExercise(type, entry);
  };

  // Editing keeps the entry's place in the list but gives it a new id, and
  // records the old id as deleted: entries sync by id, so this is how an
  // edit reaches other devices instead of being merged away.
  const editEntry = async (type, id, entry) => {
    await drive.recordDeletion(id).catch(() => {});
    const current = monthData[selected] || { strength: [], cardio: [] };
    const updated = { ...current, [type]: (current[type] || []).map((e) => (e.id === id ? { ...entry, id: uid() } : e)) };
    persist({ ...monthData, [selected]: updated });
    if (type !== "food") noteNewExercise(type, entry);
  };

  function noteNewExercise(type, entry) {
    // A name that isn't in the library yet becomes one of your exercises.
    const name = (type === "cardio" ? entry.activity : entry.exercise || "").trim();
    if (name && !libraryKeys.has(nameKey(name))) {
      createExercise({ name, category: type === "cardio" ? "cardio" : "strength", equipment: entry.bw ? "body only" : null }).then((r) => {
        if (r.ok) {
          setNewExerciseNote(`Added “${r.name}” to your exercises.`);
          setTimeout(() => setNewExerciseNote(""), 5000);
        }
      });
    }
  };

  const addFoods = (list) => {
    const current = monthData[selected] || { strength: [], cardio: [] };
    const updated = { ...current, food: [...(current.food || []), ...list.map((e) => ({ id: uid(), ...e }))] };
    persist({ ...monthData, [selected]: updated });
  };

  // Foods logged this month, newest first, for one-tap re-adding.
  const recentFoods = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const day of Object.keys(monthData).sort().reverse()) {
      for (const e of [...(monthData[day]?.food || [])].reverse()) {
        const k = e.name.toLowerCase();
        if (seen.has(k) || !e.per100) continue;
        seen.add(k);
        out.push({ id: `recent:${k}`, name: e.name, source: e.source, per100: e.per100, portions: e.portion && e.qty ? [{ g: Math.round((e.grams / e.qty) * 10) / 10, label: e.portion }] : [], lastGrams: e.grams, group: "", estimate: e.estimate });
      }
    }
    return out;
  }, [monthData]);

  const saveTargets = async (t) => {
    const next = { ...profile, targets: { kcal: t.kcal, protein: t.protein, at: Date.now() } };
    setProfile(next);
    const res = await storage.set("profile", JSON.stringify(next), false).catch(() => null);
    if (res) drive.scheduleSync();
    return Boolean(res);
  };

  const deleteEntry = async (type, id) => {
    await drive.recordDeletion(id).catch(() => {});
    const current = monthData[selected] || { strength: [], cardio: [] };
    const updated = { ...current, [type]: (current[type] || []).filter((e) => e.id !== id) };
    persist({ ...monthData, [selected]: updated });
  };

  const grid = useMemo(() => buildGrid(cursor), [cursor]);

  const maxVol = useMemo(() => {
    let m = 1;
    Object.entries(monthData).forEach(([day, v]) => { m = Math.max(m, strengthVolume(v.strength, bwOnDay(cursor, day))); });
    return m;
  }, [monthData, bwOnDay, cursor]);
  // Food tab calendar: bars scale to the calorie target, or the month's biggest day.
  const maxKcal = useMemo(() => {
    let m = Number(profile.targets?.kcal) || 1;
    Object.values(monthData).forEach((v) => { m = Math.max(m, sumFood(v.food).kcal); });
    return m;
  }, [monthData, profile.targets]);
  const maxDur = useMemo(() => {
    let m = 1;
    Object.values(monthData).forEach((v) => { m = Math.max(m, cardioDuration(v.cardio)); });
    return m;
  }, [monthData]);

  const changeMonth = (delta) => {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1);
    setCursor(next);
    setSelected(isSameMonth(next) ? todayDayNum() : "01");
  };

  // Previous or next day, crossing into the next month when needed. The day
  // slides in from the side it came from.
  const dayRef = useRef(null);
  const goDayRef = useRef(null);
  const goDay = (delta) => {
    const d = new Date(cursor.getFullYear(), cursor.getMonth(), Number(selected) + delta);
    if (d.getMonth() !== cursor.getMonth() || d.getFullYear() !== cursor.getFullYear()) setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
    setSelected(pad2(d.getDate()));
    const el = dayRef.current;
    if (el?.animate && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      el.animate([{ opacity: 0, transform: `translateX(${delta > 0 ? 28 : -28}px)` }, { opacity: 1, transform: "none" }], { duration: 220, easing: "ease" });
    }
  };
  goDayRef.current = goDay;

  const selectedLabel = () => {
    const dow = new Date(cursor.getFullYear(), cursor.getMonth(), Number(selected)).toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
    return `${dow} ${Number(selected)} ${MONTH_NAMES[cursor.getMonth()].slice(0, 3)}`;
  };

  const pickFromLibrary = (exercise) => {
    const type = exercise.category === "cardio" ? "cardio" : "strength";
    setPrefill({ type, value: exercise.name, plan: exercise.plans?.[0] || (type === "strength" ? { sets: split.sets, reps: split.reps } : null), token: Date.now() });
    setActiveTab("log");
  };

  return (
    <div className="ft-page" style={styles.page} onTouchStart={onSwipeStart} onTouchEnd={onSwipeEnd} onTouchCancel={() => { swipe.current = null; }}>
      <style>{`${THEME_CSS}
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        input:focus, button:focus { outline: 2px solid var(--ft-ink); outline-offset: 1px; }
        button { cursor: pointer; }
        @media (min-width: 720px) {
          .ft-sections { flex-direction: row !important; }
          .ft-section { flex: 1 1 0; }
        }
        :root { --ft-cal-w: min(340px, calc(100vw - 52px)); }
        .ft-cal-backdrop { animation: ft-fade 0.2s ease; }
        /* Sideways swipes change tabs, not browser history. */
        html, body { overscroll-behavior-x: none; }
        .ft-slide-left { animation: ft-slide-left 0.22s ease; }
        .ft-slide-right { animation: ft-slide-right 0.22s ease; }
        @keyframes ft-slide-left { from { opacity: 0; transform: translateX(28px); } }
        @keyframes ft-slide-right { from { opacity: 0; transform: translateX(-28px); } }
        @keyframes ft-fade { from { opacity: 0; } }
        @media (prefers-reduced-motion: reduce) {
          .ft-bar, .ft-cal-tab, .ft-cal-drawer, .ft-hint, .ft-reveal, .ft-nav-label { transition: none !important; }
          .ft-cal-backdrop, .ft-slide-left, .ft-slide-right { animation: none; }
        }
        /* iPhone Safari zooms in on any text box under 16px when it's tapped,
           which leaves the page zoomed and shifted sideways. */
        @media (max-width: 720px) {
          input, select, textarea { font-size: 16px !important; }
        }
        /* Example text in empty boxes: clearly fainter than anything typed. */
        ::placeholder { color: var(--ft-ink-faint); opacity: 0.45; }
        /* Room for the bottom navigation bar and the phone's home indicator. */
        .ft-page { padding-bottom: calc(96px + env(safe-area-inset-bottom, 0px)) !important; }
        .ft-bottom-nav { padding-bottom: env(safe-area-inset-bottom, 0px); }
      `}</style>

      <header className="ft-masthead" style={styles.header}>
        <div style={styles.eyebrowRow}>
          <div className="ft-brand" style={styles.brand}>
            <LogoMark size={22} />
            <span style={styles.eyebrow}>TRAINING LEDGER</span>
          </div>
          <div style={styles.headerRight}>
            <DriveStatus />
            <button
              ref={menuBtnRef}
              type="button"
              aria-label="Menu"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls="app-menu"
              onClick={() => setMenuOpen((o) => !o)}
              style={styles.menuBtn}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
              </svg>
            </button>
          </div>
        </div>
        {/* The Ledger score leads on every tab; tapping it opens Progress. */}
        <button
          type="button"
          onClick={() => goTab("progress")}
          aria-label={ledger ? `Ledger score ${ledger.value}, ${ledger.sinceStart >= 0 ? "up" : "down"} ${Math.abs(ledger.sinceStart)}% since you started` : "Ledger score: not started yet"}
          style={styles.scoreBlock}
        >
          <span style={styles.scoreLabel}>Ledger score</span>
          {ledger ? (
            <>
              <span className="ft-masthead-title" style={styles.scoreValue}>{ledger.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
              <span style={styles.scoreSub}>
                <span>{ledger.sinceStart >= 0 ? "▲" : "▼"} {Math.abs(ledger.sinceStart)}% since you started</span>
                {ledger.sinceLastWeek != null && ledger.sinceLastWeek !== 0 && <span style={styles.scoreWeek}>{ledger.sinceLastWeek > 0 ? "+" : "−"}{Math.abs(ledger.sinceLastWeek)} this week</span>}
                {ledger.badge && <span style={styles.scoreBadge}>{ledger.badge}</span>}
              </span>
            </>
          ) : (
            <span className="ft-masthead-title" style={styles.scoreEmpty}>Log a workout to start your score</span>
          )}
        </button>
        {(activeTab === "log" || activeTab === "food") && (
          <div style={styles.headerDayWrap}>
            <div data-dayswipe style={styles.headerDay}>
              <span aria-live="polite">{selectedLabel()}</span>
              <span style={styles.dayNav}>
                <button type="button" aria-label="Previous day" onClick={() => goDay(-1)} style={styles.dayNavBtn}>‹</button>
                <button type="button" aria-label="Next day" onClick={() => goDay(1)} style={styles.dayNavBtn}>›</button>
              </span>
            </div>
            {activeTab === "food" && (() => {
              const eaten = Math.round(sumFood(dayEntries.food || []).kcal), target = Number(profile.targets?.kcal) || 0;
              return <span style={styles.headerSub}>{target ? `${(target - eaten).toLocaleString()} kcal ${target - eaten >= 0 ? "left" : "over"} · ${eaten.toLocaleString()} eaten` : `${eaten.toLocaleString()} kcal eaten`}</span>;
            })()}
            {saveError && <span style={styles.errorTag}>Not saved — try again</span>}
            {newExerciseNote && <span role="status" style={styles.newExerciseNote}>{newExerciseNote}</span>}
          </div>
        )}
      </header>
      {menuOpen && <AppMenu theme={theme} onTheme={(t) => { chooseTheme(t); closeMenu(); }} onWeighIn={() => { openPanel("weighin"); closeMenu(); }} split={split.id} onSplit={(id) => { const sp = SPLITS.find((x) => x.id === id); saveSplit({ id, sets: sp.sets, reps: sp.reps }); closeMenu(); }} firstPct={firstPct} onFirstSet={(pct) => { saveFirstSet(pct); closeMenu(); }} liftUnit={liftUnit} onLiftUnit={(u) => { saveLiftUnit(u); closeMenu(); }} onAdjustSplit={() => { openPanel("split"); closeMenu(); }} onBackup={() => { openPanel("backup"); closeMenu(); }} onClose={closeMenu} buttonRef={menuBtnRef} />}
      <SyncNotice />
      {panel === "backup" ? (
        <Backup onClose={closePanel} />
      ) : panel === "split" ? (
        <SplitSettings setting={profile.split} onSave={saveSplit} onClose={closePanel} />
      ) : panel === "weighin" ? (
        <WeighInSettings setting={weighIn} onSave={saveWeighIn} onClose={closePanel} />
      ) : weighInDueAt && (
        <WeighInPrompt
          key={weighInDueAt.getTime()}
          setting={weighIn}
          lastKg={weights.length ? weights[weights.length - 1].kg : null}
          unit={bwUnit}
          onUnit={saveBwUnit}
          onSave={saveBodyweight}
          onSkip={() => saveWeighIn({ skipped: weighInDueAt.getTime() })}
          onSettings={() => openPanel("weighin")}
        />
      )}

      <div
        key={activeTab}
        className={slideDir ? `ft-slide-${slideDir}` : undefined}
      >
      {activeTab === "progress" ? (
        <Progress bests={bestsList(bests)} liftUnit={liftUnit} bwUnit={bwUnit} loadAll={loadAllMonths} version={dataVersion} tagMap={tagMap} bwOn={bwOnDate} targets={profile.targets} weights={weights} weighInText={weighIn?.on ? describeWeighIn(weighIn) : null} onWeighInSettings={() => openPanel("weighin")} />
      ) : activeTab === "exercises" ? (
        <ExerciseLibrary
          exercises={fullExercises}
          loading={exercisesLoading}
          onPick={pickFromLibrary}
          tagMap={tagMap}
          onSetTags={setExerciseTags}
          saveError={tagSaveError}
          onImport={importExercises}
          onRemoveImported={removeImported}
          onCreate={createExercise}
        />
      ) : (
      <>
      {calPinned && <div className="ft-cal-backdrop" aria-hidden="true" onClick={() => closeCal()} style={styles.calBackdrop} />}
      <div
        onPointerEnter={(e) => { if (e.pointerType === "mouse" && Date.now() - calPickedAt.current > 600) setCalHover(true); }}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") setCalHover(false); }}
      >
      <button
        ref={calTabRef}
        type="button"
        aria-label="Calendar"
        aria-expanded={calOpen}
        aria-controls="month-calendar"
        onClick={() => setCalPinned((p) => !p)}
        className="ft-cal-tab"
        style={{ ...styles.calTab, transform: calOpen ? "translateX(var(--ft-cal-w))" : "none" }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2" y="3" width="12" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
        </svg>
        <span className="ft-cal-label" style={styles.calTabLabel}>Calendar</span>
      </button>
      <aside
        id="month-calendar"
        ref={calRef}
        role="dialog"
        aria-modal={calPinned ? "true" : undefined}
        aria-labelledby="cal-title"
        onKeyDown={onCalKeyDown}
        className="ft-cal-drawer"
        style={{
          ...styles.calDrawer,
          transform: calOpen ? "none" : "translateX(-100%)",
          visibility: calOpen ? "visible" : "hidden",
          // Hide only once it has slid away.
          transition: calOpen ? "transform 0.22s ease" : "transform 0.22s ease, visibility 0s linear 0.22s",
        }}
      >
        <div style={styles.calHead}>
          <span style={styles.calEyebrow}>Calendar</span>
          <button type="button" aria-label="Close calendar" onClick={(e) => closeCal(e.detail === 0)} style={styles.calClose}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
            </svg>
          </button>
        </div>
        <div style={styles.calMonthRow}>
          <button type="button" aria-label="Show previous month" onClick={() => changeMonth(-1)} style={styles.navBtn}>‹</button>
          <h2 id="cal-title" style={styles.calMonth}>{MONTH_NAMES[cursor.getMonth()]} <span style={styles.year}>{cursor.getFullYear()}</span></h2>
          <button type="button" aria-label="Show next month" onClick={() => changeMonth(1)} style={styles.navBtn}>›</button>
        </div>
        <div style={styles.dowRow}>
          {DOW.map((d, i) => <div key={i} style={styles.dowCell}>{d}</div>)}
        </div>

        <div style={styles.grid}>
          {grid.map((day, i) => {
            if (!day) return <div key={i} style={styles.emptyCell} />;
            const data = monthData[day] || { strength: [], cardio: [] };
            const vol = strengthVolume(data.strength, bwOnDay(cursor, day));
            const dur = cardioDuration(data.cardio);
            const isSelected = day === selected;
            const isToday = isSameMonth(cursor) && day === todayDayNum();
            return (
              <button
                key={i}
                type="button"
                aria-pressed={isSelected}
                aria-current={isToday ? "date" : undefined}
                onClick={(e) => { setSelected(day); calPickedAt.current = Date.now(); closeCal(e.detail === 0); }}
                style={{
                  ...styles.dayCell,
                  ...(isSelected ? styles.dayCellSelected : {}),
                  ...(isToday && !isSelected ? styles.dayCellToday : {}),
                }}
              >
                <span style={styles.dayNum}>{String(Number(day))}</span>
                <span style={styles.barTrack}>
                  {activeTab === "food" ? (
                    <span className="ft-bar" style={{ ...styles.bar, width: 10, background: C.plum, height: `${Math.round((sumFood(data.food).kcal / maxKcal) * 100)}%` }} />
                  ) : (
                    <>
                      <span className="ft-bar" style={{ ...styles.bar, background: rust, height: `${Math.round((vol / maxVol) * 100)}%` }} />
                      <span className="ft-bar" style={{ ...styles.bar, background: teal, height: `${Math.round((dur / maxDur) * 100)}%` }} />
                    </>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <div style={styles.calLegend}>
          {activeTab === "food" ? (
            <span><span aria-hidden="true" style={{ ...styles.calKey, background: C.plum }} />calories</span>
          ) : (
            <>
              <span><span aria-hidden="true" style={{ ...styles.calKey, background: rust }} />volume lifted</span>
              <span><span aria-hidden="true" style={{ ...styles.calKey, background: teal }} />cardio minutes</span>
            </>
          )}
        </div>
      </aside>
      </div>

      {loading ? (
        <div style={styles.loading}>Loading ledger…</div>
      ) : (
        <div ref={dayRef} style={styles.dayBody}>

          {activeTab === "food" ? (
            <FoodLog
              key={`${key}-${selected}`}
              entries={dayEntries.food || []}
              recent={recentFoods}
              onAdd={addFoods}
              onDelete={(id) => deleteEntry("food", id)}
              onEdit={(id, e) => editEntry("food", id, e)}
              targets={profile.targets}
              onSaveTargets={saveTargets}
              myFoods={myFoodList}
              onSaveMyFood={saveMyFood}
              onRemoveMyFood={removeMyFood}
              meals={mealList}
              onSaveMeal={saveMeal}
              onRemoveMeal={removeMeal}
              saveError={saveError}
            />
          ) : (
          <>
          {pbNote && (
            <div role="status" aria-label="New personal best" style={styles.pbNote}>
              <span aria-hidden="true" style={{ fontSize: 22 }}>🏆</span>
              <span style={{ flex: 1 }}>
                <strong>New personal best</strong> on {pbNote.name}
                {pbNote.weight && <span style={styles.pbLine}>Heaviest: {pbNote.bw ? "body weight + " : ""}{liftText(pbNote.weight.value, liftUnit)} (was {liftText(pbNote.weight.was, liftUnit)})</span>}
                {pbNote.reps && <span style={styles.pbLine}>Most reps: {pbNote.reps.value} (was {pbNote.reps.was})</span>}
              </span>
              <button type="button" aria-label="Dismiss" onClick={() => setPbNote(null)} style={styles.pbClose}>×</button>
            </div>
          )}
          <DayPlan
            split={split}
            firstPct={firstPct}
            session={sessionOn(split, new Date(cursor.getFullYear(), cursor.getMonth(), Number(selected)))}
            suggestions={todaySuggestions}
            onPick={(name) => setPrefill({ type: "strength", value: name, plan: { sets: split.sets, reps: split.reps }, token: Date.now() })}
          />
          <div className="ft-sections" style={styles.sections}>
            <Section
              className="ft-section"
              sectionType="strength"
              prefill={prefill}
              tagMap={tagMap}
              plansByName={plansByName}
              accent={rust}
              accentSoft={C.rustSoft}
              title="STRENGTH"
              emptyText="No lifts logged for this day."
              addLabel="Log a set"
              fields={[
                { key: "exercise", label: "Exercise", type: "text", placeholder: "Back squat", options: strengthNames, listId: "strength-exercise-list" },
                { key: "sets", label: "Sets", type: "number", inputMode: "numeric", placeholder: "3" },
                { key: "reps", label: "Reps", type: "number", inputMode: "numeric", placeholder: "5" },
                { key: "weight", label: `Max weight (${liftUnit})`, type: "number", placeholder: liftUnit === "lb" ? "175" : "80", bodyweightToggle: true },
                { key: "minWeight", label: `Min weight (${liftUnit}), optional`, bwLabel: `Min added weight (${liftUnit}), optional`, type: "number", inputMode: "decimal", placeholder: liftUnit === "lb" ? "135" : "60" },
              ]}
              onAdd={(vals) => addEntry("strength", vals)}
              renderRow={(e) => (
                <>
                  <span style={styles.rowMain}>
                    {e.exercise || "Exercise"}
                    {pbIds.has(e.id) && <span title="Personal best" style={styles.pbBadge}>PB</span>}
                  </span>
                  <span style={styles.rowMono}>{e.sets || 0}×{e.reps || 0} · {weightRange(e, liftUnit)}</span>
                </>
              )}
              entries={dayEntries.strength}
              onDelete={(id) => deleteEntry("strength", id)}
              onEdit={(id, e) => editEntry("strength", id, e)}
              isBodyweight={isBodyweight}
              bodyweightKg={bwOnDay(cursor, selected)}
              bwUnit={bwUnit}
              lastFor={(name) => lastSession(history, name, `${key}-${selected}`, firstPct, liftUnit)}
              liftUnit={liftUnit}
              defaults={{ sets: String(split.sets), reps: String(split.reps) }}
              footer={dayEntries.strength && dayEntries.strength.length > 0 ? (
                <StrengthFooter
                  entries={dayEntries.strength}
                  bodyweightKg={bwOnDay(cursor, selected)}
                  onSaveBodyweight={saveBodyweight}
                  liftUnit={liftUnit}
                  unit={bwUnit}
                  onUnit={saveBwUnit}
                />
              ) : null}
            />
            <Section
              className="ft-section"
              sectionType="cardio"
              prefill={prefill}
              tagMap={tagMap}
              plansByName={plansByName}
              accent={teal}
              accentSoft={C.tealSoft}
              title="CARDIO"
              emptyText="No sessions logged for this day."
              addLabel="Log a session"
              fields={[
                { key: "activity", label: "Activity", type: "text", placeholder: "Run", options: cardioNames, listId: "cardio-activity-list" },
                { key: "duration", label: "Minutes", type: "number", inputMode: "numeric", placeholder: "30" },
                { key: "distance", label: "Distance (mi)", type: "number", inputMode: "decimal", placeholder: "3.1" },
              ]}
              onAdd={(vals) => addEntry("cardio", vals)}
              renderRow={(e) => (
                <>
                  <span style={styles.rowMain}>{e.activity || "Activity"}</span>
                  <span style={styles.rowMono}>{e.duration || 0} min{e.distance ? ` · ${e.distance} mi` : ""}</span>
                </>
              )}
              entries={dayEntries.cardio}
              onDelete={(id) => deleteEntry("cardio", id)}
              onEdit={(id, e) => editEntry("cardio", id, e)}
              footer={dayEntries.cardio && dayEntries.cardio.length > 0 ? `Total time: ${cardioDuration(dayEntries.cardio)} min` : null}
            />
          </div>
          </>
          )}
        </div>
      )}
      </>
      )}
      </div>

      {/* Bottom navigation: the four sections within thumb reach. */}
      <nav className="ft-tabs ft-bottom-nav" aria-label="Sections" style={styles.bottomNav}>
        {TABS.map(([id, label]) => {
          const on = activeTab === id;
          return (
            <button key={id} type="button" onClick={() => goTab(id)} aria-current={on ? "page" : undefined} style={{ ...styles.navTab, color: on ? ink : inkFaint }}>
              <span aria-hidden="true" style={{ ...styles.navPill, background: on ? `color-mix(in srgb, ${ink} 12%, transparent)` : "transparent" }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={on ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">{TAB_ICONS[id]}</svg>
              </span>
              <span className="ft-nav-label" style={{ ...styles.navLabel, fontWeight: on ? 700 : 500 }}>{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// The logo: Train, Progress and Fuel loops inside the hexagon. Colours are
// CSS variables so dark headers can brighten them.
function LogoMark({ size = 22 }) {
  const loop = (d, v) => <path d={d} fill="none" style={{ stroke: `var(${v})` }} strokeWidth="11" strokeLinejoin="round" />;
  return (
    <svg className="ft-logo" width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" style={{ flex: "none" }}>
      <polyline points="12,100 56,23.8 144,23.8 188,100" fill="none" style={{ stroke: "var(--ft-logo-blue)" }} strokeWidth="13" strokeLinejoin="round" strokeLinecap="round" />
      <polyline points="188,100 144,176.2 56,176.2 12,100" fill="none" style={{ stroke: "var(--ft-logo-orange)" }} strokeWidth="13" strokeLinejoin="round" strokeLinecap="round" />
      {loop("M100,110 L84.5,134.0 A22,22 0 1 1 72.9,101.1 Z", "--ft-logo-red")}
      {loop("M100,110 L127.1,101.1 A22,22 0 1 1 115.5,134.0 Z", "--ft-logo-yellow")}
      {loop("M100,110 L82.1,84.7 A22,22 0 1 1 117.9,84.7 Z", "--ft-logo-cyan")}
    </svg>
  );
}

// The ☰ menu under the header. It sits outside the header so the header's
// theme styling (dark text overrides, Gotham's cut corner) doesn't reach it.
function AppMenu({ theme, onTheme, onWeighIn, split, onSplit, onAdjustSplit, firstPct, onFirstSet, liftUnit, onLiftUnit, onBackup, onClose, buttonRef }) {
  const ref = useRef(null);
  // "main", or a sub-menu: "theme", "split" or "firstset".
  const [view, setView] = useState("main");
  const cameFrom = useRef(null);
  // Drop down from just under the ☰ button, right-aligned with it.
  const [pos, setPos] = useState(null);
  React.useLayoutEffect(() => {
    const place = () => {
      const host = ref.current?.offsetParent, btn = buttonRef.current;
      if (!host || !btn) return;
      const h = host.getBoundingClientRect(), r = btn.getBoundingClientRect();
      setPos({ top: r.bottom - h.top + 6, right: Math.max(8, h.right - r.right) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [buttonRef]);
  // Focus: the ticked choice in a sub-menu; back on the main menu, the item it was opened from.
  useEffect(() => {
    if (!pos) return;
    const el = view === "main"
      ? (cameFrom.current && ref.current?.querySelector(`[data-sub="${cameFrom.current}"]`)) || ref.current?.querySelector('[role^="menuitem"]')
      : ref.current?.querySelector('[aria-checked="true"]') || ref.current?.querySelector('[role^="menuitem"]');
    el?.focus();
  }, [Boolean(pos), view]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const away = (e) => {
      if (!ref.current?.contains(e.target) && !buttonRef.current?.contains(e.target)) onClose();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [onClose, buttonRef]);
  const open = (sub) => { cameFrom.current = sub; setView(sub); };
  const back = () => setView("main");
  const onKeyDown = (e) => {
    const items = [...ref.current.querySelectorAll('[role^="menuitem"]')];
    const i = items.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === "ArrowLeft" && view !== "main") { e.preventDefault(); back(); }
    else if (e.key === "ArrowRight" && document.activeElement?.dataset.sub) { e.preventDefault(); open(document.activeElement.dataset.sub); }
    else if (e.key === "Tab") onClose();
  };
  const chev = <span aria-hidden="true" style={styles.menuChev}>›</span>;
  const subItem = (sub, label, value) => (
    <button type="button" role="menuitem" aria-haspopup="menu" data-sub={sub} onClick={() => open(sub)} style={styles.menuItem}>
      <span style={{ flex: 1 }}>{label}</span>
      <span style={styles.menuValue}>{value}</span>
      {chev}
    </button>
  );
  const backItem = (label) => (
    <button type="button" role="menuitem" onClick={back} style={{ ...styles.menuItem, ...styles.menuBack }}>
      <span aria-hidden="true">‹</span>
      <span style={{ flex: 1 }}>{label}</span>
    </button>
  );
  const splitName = (SPLITS.find((sp) => sp.id === split) || SPLITS[0]).name.split(" ·")[0];
  return (
    <div id="app-menu" ref={ref} role="menu" aria-label={view === "theme" ? "Theme" : view === "split" ? "Training split" : view === "firstset" ? "First set weight" : view === "lift" ? "Lifting weights" : "Menu"} onKeyDown={onKeyDown} style={{ ...styles.menu, ...(pos || { visibility: "hidden" }) }}>
      {view === "main" && (
        <>
          {subItem("theme", "Theme", THEMES[theme]?.label)}
          {subItem("split", "Training split", splitName)}
          {subItem("firstset", "First set weight", `${firstPct}%`)}
          {subItem("lift", "Lifting weights", liftUnit)}
          <button type="button" role="menuitem" onClick={onWeighIn} style={styles.menuItem}>
            <span style={{ flex: 1 }}>Weekly weigh-in…</span>
          </button>
          <div role="separator" style={styles.menuRule} />
          <button type="button" role="menuitem" onClick={onBackup} style={styles.menuItem}>
            <span style={{ flex: 1 }}>Back up or move your data…</span>
          </button>
        </>
      )}
      {view === "theme" && (
        <>
          {backItem("Theme")}
          <div role="group" aria-label="Theme">
            {THEME_NAMES.map((t) => (
              <button
                key={t}
                type="button"
                role="menuitemradio"
                aria-checked={theme === t}
                onClick={() => onTheme(t)}
                style={{ ...styles.menuItem, ...(theme === t ? styles.menuItemOn : {}) }}
              >
                <span aria-hidden="true" style={{ ...styles.themeSwatch, background: THEMES[t].swatch, borderColor: THEMES[t].vars.ink }}>
                  <span style={{ ...styles.themeSwatchDot, background: THEMES[t].vars.rust }} />
                  <span style={{ ...styles.themeSwatchDot, background: THEMES[t].vars.teal }} />
                </span>
                <span style={{ flex: 1 }}>{THEMES[t].label}</span>
                {theme === t && <span aria-hidden="true">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
      {view === "lift" && (
        <>
          {backItem("Lifting weights")}
          <p style={styles.menuNote}>The unit for the weights you lift: in the log, last time, personal bests and Progress. Your log is kept the same either way.</p>
          <div role="group" aria-label="Lifting weights">
            {[["kg", "Kilograms (kg)"], ["lb", "Pounds (lb)"]].map(([u, label]) => (
              <button
                key={u}
                type="button"
                role="menuitemradio"
                aria-checked={liftUnit === u}
                onClick={() => onLiftUnit(u)}
                style={{ ...styles.menuItem, ...(liftUnit === u ? styles.menuItemOn : {}) }}
              >
                <span style={{ flex: 1 }}>{label}</span>
                {liftUnit === u && <span aria-hidden="true">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
      {view === "firstset" && (
        <>
          {backItem("First set weight")}
          <p style={styles.menuNote}>When you log an exercise, the app suggests starting at this share of last time's max.</p>
          <div role="group" aria-label="First set weight">
            {FIRST_SET_OPTIONS.map((pct) => (
              <button
                key={pct}
                type="button"
                role="menuitemradio"
                aria-checked={firstPct === pct}
                onClick={() => onFirstSet(pct)}
                style={{ ...styles.menuItem, ...(firstPct === pct ? styles.menuItemOn : {}) }}
              >
                <span style={{ flex: 1 }}>{pct}% of last max</span>
                {firstPct === pct && <span aria-hidden="true">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
      {view === "split" && (
        <>
          {backItem("Training split")}
          <div role="group" aria-label="Training split">
            {SPLITS.map((sp) => (
              <button
                key={sp.id}
                type="button"
                role="menuitemradio"
                aria-checked={split === sp.id}
                onClick={() => onSplit(sp.id)}
                style={{ ...styles.menuItem, ...(split === sp.id ? styles.menuItemOn : {}) }}
              >
                <span style={{ flex: 1 }}>{sp.name}</span>
                {split === sp.id && <span aria-hidden="true">✓</span>}
              </button>
            ))}
            <button type="button" role="menuitem" onClick={onAdjustSplit} style={{ ...styles.menuItem, color: inkFaint }}>
              <span style={{ flex: 1 }}>Adjust sets &amp; reps…</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Shown while Drive is connected but this visit hasn't synced yet.
function SyncNotice() {
  const [st, setSt] = useState({ state: "off" });
  useEffect(() => drive.subscribe(setSt), []);
  if (!drive.driveSupported() || (st.state !== "needs-auth" && st.state !== "connecting")) return null;
  return (
    <div role="status" style={styles.syncNotice}>
      {st.state === "connecting"
        ? "Syncing with Google Drive…"
        : "Your log may be out of date. Tap anywhere to sync with Google Drive."}
    </div>
  );
}

// Google Drive sync as a small cloud: tap it to connect or sync; once synced,
// tap it for the last sync time, Sync now and Disconnect. Its words are kept
// for screen readers.
function DriveStatus() {
  const [st, setSt] = useState({ state: "off" });
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => drive.subscribe(setSt), []);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  if (!drive.driveSupported()) return null;

  const time = st.lastSynced ? st.lastSynced.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  const view = {
    off: { label: "Connect Google Drive", action: drive.connect, hint: "Back up and sync your log", mark: "plus" },
    connecting: { label: "Connecting…", mark: "dots" },
    syncing: { label: "Syncing…", mark: "dots" },
    synced: { label: `Synced ${time}`, action: () => setOpen((o) => !o), hint: `Synced ${time}`, done: true, mark: "check" },
    "needs-auth": { label: "Tap to sync with Drive", action: drive.connect, hint: "Google needs you to sign in again", warn: true, mark: "alert" },
    error: { label: "Sync failed · retry", action: drive.connect, hint: "Sync failed: tap to retry", warn: true, mark: "alert" },
  }[st.state] || { label: "", mark: "plus" };

  const color = view.warn ? rust : view.done ? teal : inkFaint;
  const icon = (
    <svg width="26" height="20" viewBox="0 0 26 20" aria-hidden="true" style={{ color }}>
      <path d="M7.5 17.5h11a5 5 0 0 0 .6-9.96A6.5 6.5 0 0 0 6.6 9.1 4.2 4.2 0 0 0 7.5 17.5z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      {view.mark === "check" && <path d="M9.8 12.4l2.3 2.2 4.4-4.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
      {view.mark === "plus" && <path d="M13 9.6v5.4M10.3 12.3h5.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />}
      {view.mark === "alert" && <path d="M13 9.4v3.4M13 15.1v.1" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />}
      {view.mark === "dots" && <path d="M10.2 13h.01M13 13h.01M15.8 13h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />}
    </svg>
  );

  return (
    <div ref={ref} style={styles.driveWrap}>
      {view.action ? (
        <button type="button" onClick={view.action} title={view.hint} aria-expanded={view.done ? open : undefined} style={styles.driveIconBtn}>
          {icon}
          <span style={styles.srOnly}>{view.label}</span>
        </button>
      ) : (
        <span role="status" title={view.label} style={styles.driveIconBtn}>
          {icon}
          <span style={styles.srOnly}>{view.label}</span>
        </span>
      )}
      {open && st.state === "synced" && (
        <div role="dialog" aria-label="Google Drive sync" style={styles.drivePop}>
          <span style={styles.drivePopText}>Last synced with Google Drive at {time}</span>
          <button type="button" onClick={() => { setOpen(false); drive.connect(); }} style={styles.drivePopBtn}>Sync now</button>
          <button type="button" onClick={() => { setOpen(false); drive.disconnect(); }} title="Stop syncing. Your log stays in this browser and in Drive." style={styles.drivePopBtn}>Disconnect</button>
        </div>
      )}
      {st.message && <span style={styles.driveMsg} role="alert">{st.message}</span>}
    </div>
  );
}

// Form values a plan fills in: sets and reps for lifts, minutes for cardio.
function planValues(sectionType, plan) {
  if (!plan) return {};
  const first = (v) => (String(v || "").match(/\d+(?:\.\d+)?/) || [""])[0];
  if (sectionType === "strength") {
    const out = {};
    if (first(plan.sets)) out.sets = first(plan.sets);
    if (first(plan.reps) && !/sec|min|step|round/i.test(`${plan.reps} ${plan.unit}`)) out.reps = first(plan.reps);
    return out;
  }
  const mins = `${plan.reps} ${plan.unit}`.match(/(\d+(?:\.\d+)?)\s*(?:min|minutes)\b/i);
  return mins ? { duration: mins[1] } : {};
}

function StrengthFooter({ entries, bodyweightKg, onSaveBodyweight, unit, onUnit, liftUnit = "kg" }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState({ main: "", extra: "" });
  const [error, setError] = useState("");
  const hasBw = entries.some((e) => e.bw);
  const known = bodyweightKg != null;

  const open = () => { setValue(known ? fromKg(bodyweightKg, unit) : { main: "", extra: "" }); setError(""); setEditing(true); };
  const save = async (ev) => {
    ev.preventDefault();
    const kg = toKg(unit, value.main, value.extra);
    if (!(kg > 20 && kg < 400)) { setError(`Enter your body weight, e.g. ${unit === "lb" ? "175 lb" : unit === "st" ? "12 st 7 lb" : "78.5 kg"}`); return; }
    const ok = await onSaveBodyweight(kg);
    if (!ok) { setError("Couldn't save. Try again."); return; }
    setEditing(false);
  };

  return (
    <div style={styles.footerStack}>
      <span>
        Volume<span className="ft-hint ft-hint-inline"> (sets × reps × max weight)</span>: {liftValue(strengthVolume(entries, bodyweightKg), liftUnit).toLocaleString(undefined, { maximumFractionDigits: 1 })} {liftUnit}
        {hasBw && !known && ` · ${bodyweightReps(entries).toLocaleString()} body-weight reps not counted`}
      </span>
      {hasBw && !editing && (
        <span style={styles.bwLine}>
          {known ? `Body weight ${bwText(bodyweightKg, unit)} included` : "Add your body weight to count body-weight sets."}
          <button type="button" onClick={open} style={styles.bwEditBtn}>{known ? "Change" : "Set body weight"}</button>
        </span>
      )}
      {editing && (
        <form onSubmit={save} noValidate style={styles.bwForm}>
          <span style={styles.bwLabel}>Your body weight</span>
          <BodyWeightField
            id="bodyweight-input"
            unit={unit}
            onUnit={(u) => { onUnit(u); setValue((v) => { const kg = toKg(unit, v.main, v.extra); return kg ? fromKg(kg, u) : { main: "", extra: "" }; }); setError(""); }}
            value={value}
            onChange={(v) => { setValue(v); setError(""); }}
            autoFocus
          />
          <button type="submit" style={styles.tagAddBtn}>Save</button>
          <button type="button" onClick={() => setEditing(false)} style={styles.tagDoneBtn}>Cancel</button>
          {error && <span role="alert" style={styles.bwError}>{error}</span>}
          <span style={styles.bwNote}>Saved from today. Earlier workouts keep the weight you had then.</span>
        </form>
      )}
    </div>
  );
}

function Section({ accent, accentSoft, title, emptyText, addLabel, fields, onAdd, onEdit, renderRow, entries, onDelete, footer, className, sectionType, prefill, tagMap, plansByName, isBodyweight, bodyweightKg, bwUnit, lastFor, defaults, liftUnit = "kg" }) {
  // Strength weights are typed in liftUnit and stored in kg.
  const WEIGHT_KEYS = sectionType === "strength" ? ["weight", "minWeight"] : [];
  const hasBwToggle = fields.some((f) => f.bodyweightToggle);
  const bwFor = (name) => (hasBwToggle && isBodyweight ? { bw: isBodyweight(name) } : {});
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState({});
  const [editingId, setEditingId] = useState(null); // entry being edited in the form

  const startEdit = (e) => {
    const v = {};
    for (const f of fields) if (e[f.key] != null) v[f.key] = WEIGHT_KEYS.includes(f.key) ? liftField(e[f.key], liftUnit) : String(e[f.key]);
    if (e.bw) v.bw = true;
    setVals(v);
    setEditingId(e.id);
    setOpen(true);
  };
  const closeForm = () => { setOpen(false); setEditingId(null); setVals({}); };
  const formRef = useRef(null);
  useEffect(() => {
    if (editingId) formRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [editingId]);

  useEffect(() => {
    if (prefill && prefill.type === sectionType) {
      setOpen(true);
      setVals({ [fields[0].key]: prefill.value, ...planValues(sectionType, prefill.plan), ...bwFor(prefill.value) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  const submit = (e) => {
    e.preventDefault();
    const primary = fields[0].key;
    if (!vals[primary]) return;
    const { bw, ...rest } = vals;
    const entry = bw ? { ...rest, bw: true } : rest;
    // A min weight above the max is a slip: keep the two the right way round.
    if (entry.minWeight !== undefined && entry.minWeight !== "" && entry.weight !== undefined && Number(entry.minWeight) > Number(entry.weight)) {
      [entry.minWeight, entry.weight] = [entry.weight, entry.minWeight];
    }
    if (entry.minWeight === "") delete entry.minWeight;
    for (const k of WEIGHT_KEYS) if (entry[k] !== undefined) entry[k] = liftToKg(entry[k], liftUnit);
    if (editingId) onEdit(editingId, entry);
    else onAdd(entry);
    closeForm();
  };

  return (
    <div className={`${className || ""} ft-card`} style={{ ...styles.section, borderLeftColor: accent }}>
      <div style={styles.sectionHead}>
        <span style={{ ...styles.sectionTitle, color: accent }}>{title}</span>
        <button
          onClick={() => (open ? closeForm() : setOpen(true))}
          style={{ ...styles.addBtn, borderColor: accent, color: open ? C.onFill : accent, background: open ? accent : "transparent" }}
        >
          {open ? "Cancel" : "+ Add"}
        </button>
      </div>

      {open && (
        <form ref={formRef} onSubmit={submit} style={styles.form}>
          {fields.map((f) => f.options ? (
            <React.Fragment key={f.key}>
            <ExercisePicker
              field={f}
              value={vals[f.key] || ""}
              onChange={(v) => setVals((cur) => ({ ...cur, [f.key]: v }))}
              onPicked={(name, tag) => {
                const plans = (plansByName || {})[name] || [];
                const plan = plans.find((pl) => tag && pl.tag === tag) || plans[0];
                const fill = { ...(defaults || {}), ...planValues(sectionType, plan) };
                setVals((cur) => {
                  const next = { ...cur, [f.key]: name, ...bwFor(name) };
                  for (const [k, v] of Object.entries(fill)) if (!cur[k]) next[k] = v;
                  return next;
                });
              }}
              plans={(plansByName || {})[vals[f.key]] || null}
              tagMap={tagMap || {}}
              accent={accent}
            />
            {lastFor && !editingId && vals[f.key] && (
              <LastTime last={lastFor(vals[f.key])} accent={accent} unit={liftUnit} />
            )}
            </React.Fragment>
          ) : f.bodyweightToggle ? (
            <div key={f.key} style={styles.fieldLabel}>
              <div style={styles.weightHead}>
                <label htmlFor={`${sectionType}-${f.key}`}>{vals.bw ? `Max added weight (${liftUnit}), optional` : f.label}</label>
                <div role="group" aria-label="Weight type" style={styles.unitToggle}>
                  {[[false, liftUnit], [true, "Body weight"]].map(([on, label], i) => {
                    const active = Boolean(vals.bw) === on;
                    return (
                      <button
                        key={label}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setVals((v) => ({ ...v, bw: on }))}
                        style={{ ...styles.unitBtn, borderRadius: i === 0 ? "3px 0 0 3px" : "0 3px 3px 0", ...(active ? { background: accent, borderColor: accent, color: C.onFill } : { borderColor: accent, color: accent }) }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <input
                id={`${sectionType}-${f.key}`}
                type="number"
                inputMode="decimal"
                placeholder={vals.bw ? "0" : f.placeholder}
                value={vals[f.key] || ""}
                onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
                style={styles.input}
                step="any"
                min="0"
                autoComplete="off"
              />
              {vals.bw && (
                <span style={styles.bwHint}>
                  {bodyweightKg != null
                    ? `Counts as ${bwText(bodyweightKg, bwUnit)} body weight${Number(vals[f.key]) ? ` + ${vals[f.key]} ${liftUnit}` : ""}.`
                    : "Set your body weight under the day's sets to count it in volume."}
                </span>
              )}
            </div>
          ) : (
            <label key={f.key} style={styles.fieldLabel}>
              {vals.bw && f.bwLabel ? f.bwLabel : f.label}
              <input
                type={f.type}
                // Number boxes bring up the phone's number pad, not the full keyboard.
                inputMode={f.inputMode}
                placeholder={f.placeholder}
                value={vals[f.key] || ""}
                onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
                style={styles.input}
                step={f.type === "number" ? "any" : undefined}
                autoComplete="off"
              />
            </label>
          ))}
          {editingId && <span style={styles.editingNote}>Editing an entry. Change anything, then save.</span>}
          <button type="submit" className="ft-submit" style={{ ...styles.submitBtn, background: accent }}>{editingId ? "Save changes" : addLabel}</button>
          {editingId && (
            <button type="button" aria-label="Delete entry" onClick={() => { const id = editingId; closeForm(); onDelete(id); }} style={{ ...styles.formDeleteBtn, color: accent }}>
              Delete this entry
            </button>
          )}
        </form>
      )}

      <div style={styles.rows}>
        {(!entries || entries.length === 0) ? (
          <div style={styles.emptyText}>{emptyText}</div>
        ) : (
          entries.map((e) => (
            // Tap a row to edit it; Delete is in the form that opens, away from + Add.
            <button
              key={e.id}
              type="button"
              aria-label={`Edit ${e[fields[0].key] || "entry"}`}
              onClick={() => (editingId === e.id ? closeForm() : startEdit(e))}
              style={{ ...styles.row, ...styles.rowBtn, background: `color-mix(in srgb, ${accentSoft} 25%, transparent)`, ...(editingId === e.id ? { outline: `2px solid ${accent}`, outlineOffset: -2 } : {}) }}
            >
              {renderRow(e)}
              <span aria-hidden="true" style={styles.rowChev}>›</span>
            </button>
          ))
        )}
      </div>
      {footer && <div style={{ ...styles.footer, color: accent }}>{footer}</div>}
    </div>
  );
}

// "Last time" for the exercise being logged: the previous session's top
// weight, and a first set 30% lighter (70% of it).
function LastTime({ last, accent, unit = "kg" }) {
  if (!last) return null;
  const load = (kg) => (last.bw ? (kg > 0 ? `body weight + ${liftText(kg, unit)}` : "body weight") : liftText(kg, unit));
  return (
    <div role="status" aria-label="Last time" style={{ ...styles.lastTime, borderColor: accent }}>
      <span>
        <strong>Last time:</strong> max {load(last.weight)}
        {last.warmUp != null ? <>, first set <strong>{load(last.warmUp)}</strong></> : last.reps ? `, ${last.reps} reps` : ""}
      </span>
    </div>
  );
}

// Exercise name field for the log form: pick by tag, or type to get
// suggestions that match the name or any of its tags.
const SUGGEST_CAP = 8;

function ExercisePicker({ field, value, onChange, onPicked, plans, tagMap, accent }) {
  const [focused, setFocused] = useState(false);
  const [tag, setTag] = useState(null);
  const id = `pick-${field.listId}`;

  // Tags used on exercises that belong in this section, most-used first.
  const tags = useMemo(() => {
    const names = new Set(field.options);
    const counts = {};
    for (const [name, v] of Object.entries(tagMap)) {
      if (!names.has(name)) continue;
      (v?.tags || []).forEach((t) => { counts[t] = (counts[t] || 0) + 1; });
    }
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  }, [field.options, tagMap]);

  useEffect(() => { if (tag && !tags.includes(tag)) setTag(null); }, [tags, tag]);

  const tagged = useMemo(
    () => (tag ? field.options.filter((n) => tagsOf(tagMap, n).includes(tag)) : []),
    [tag, field.options, tagMap],
  );

  const suggestions = useMemo(() => {
    const raw = value.trim().toLowerCase();
    if (!raw) return [];
    const tagOnly = raw.startsWith("#");
    const q = raw.replace(/^#+/, "");
    if (!q) return [];
    const scored = [];
    for (const n of field.options) {
      const lower = n.toLowerCase();
      if (lower === raw) return []; // already a full match
      const nameHit = !tagOnly && lower.includes(q);
      const tagHit = tagsOf(tagMap, n).some((t) => t.includes(q));
      if (!nameHit && !tagHit) continue;
      // tagged and name-prefix matches first
      const score = (tagsOf(tagMap, n).length ? 0 : 2) + (lower.startsWith(q) || tagHit ? 0 : 1);
      scored.push([score, n]);
    }
    return scored.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1])).slice(0, SUGGEST_CAP).map(([, n]) => n);
  }, [value, field.options, tagMap]);

  const choose = (n) => { (onPicked || onChange)(n, tag); setTag(null); };

  return (
    <div style={styles.fieldLabel}>
      <label htmlFor={id}>{field.label}</label>
      {tags.length > 0 && (
        <div style={styles.rowTags} aria-label="Pick by tag">
          {tags.map((t) => {
            const on = tag === t;
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                onClick={() => setTag(on ? null : t)}
                style={{ ...styles.rowTag, ...(on ? { background: accent, borderColor: accent, color: C.onFill } : {}) }}
              >
                #{t}
              </button>
            );
          })}
        </div>
      )}
      {tag && (
        <div style={styles.pickList}>
          {tagged.map((n) => (
            <button key={n} type="button" onClick={() => choose(n)} style={{ ...styles.pickItem, borderColor: accent, color: accent }}>
              {n}
            </button>
          ))}
        </div>
      )}
      <div style={{ position: "relative" }}>
        <input
          id={id}
          type="text"
          placeholder={field.placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && focused && suggestions.length && !field.options.includes(value)) {
              e.preventDefault();
              choose(suggestions[0]);
            }
          }}
          autoComplete="off"
          role="combobox"
          aria-expanded={focused && suggestions.length > 0}
          aria-controls={`${id}-list`}
          style={{ ...styles.input, width: "100%" }}
        />
        {focused && suggestions.length > 0 && (
          <ul id={`${id}-list`} role="listbox" style={styles.suggestList}>
            {suggestions.map((n) => {
              const ts = tagsOf(tagMap, n);
              return (
                <li
                  key={n}
                  role="option"
                  aria-selected="false"
                  onMouseDown={(e) => { e.preventDefault(); choose(n); }}
                  style={styles.suggestItem}
                >
                  <span>{n}</span>
                  {ts.length > 0 && <span style={styles.suggestTags}>{ts.map((t) => `#${t}`).join(" ")}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {plans && plans.length > 0 && (
        <div style={styles.planHint} aria-label="Plan from imported page">
          {plans.slice(0, 3).map((pl, i) => (
            <span key={i}>
              {pl.tag ? <strong style={{ fontWeight: 500 }}>{pl.tag}: </strong> : "Plan: "}
              {planText(pl)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const RESULT_CAP = 120;

const tagsOf = (tagMap, name) => tagMap[name]?.tags || [];
const YOUR_TAG = "your exercise";
const cleanTag = (t) => t.trim().replace(/^#+/, "").replace(/\s+/g, " ").toLowerCase().slice(0, 48);

function ExerciseLibrary({ exercises, loading, onPick, tagMap, onSetTags, saveError, onImport, onRemoveImported, onCreate }) {
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState(null);
  const [editing, setEditing] = useState(null);

  // Every tag in use, most-used first.
  const allTags = useMemo(() => {
    const counts = {};
    Object.values(tagMap).forEach((v) => (v?.tags || []).forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b)).map((t) => [t, counts[t]]);
  }, [tagMap]);

  useEffect(() => {
    if (tagFilter && !allTags.some(([t]) => t === tagFilter)) setTagFilter(null);
  }, [allTags, tagFilter]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, "");
    return exercises.filter((e) => {
      const isCardio = e.category === "cardio";
      if (filter === "strength" && isCardio) return false;
      if (filter === "cardio" && !isCardio) return false;
      const tags = tagsOf(tagMap, e.name);
      if (tagFilter && !tags.includes(tagFilter)) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        (e.equipment && e.equipment.toLowerCase().includes(q)) ||
        e.primaryMuscles.some((m) => m.toLowerCase().includes(q)) ||
        tags.some((t) => t.includes(q))
      );
    });
  }, [exercises, query, filter, tagFilter, tagMap]);

  const shown = filtered.slice(0, RESULT_CAP);

  return (
    <div style={styles.library}>
      {creating ? (
        <NewExerciseForm
          suggestions={[...new Set(Object.values(tagMap).flatMap((v) => v?.tags || []))].sort()}
          onCreate={async (v) => {
            const r = await onCreate(v);
            if (r.ok) { setCreating(false); setQuery(r.name); setFilter("all"); setTagFilter(null); }
            return r;
          }}
          onClose={() => setCreating(false)}
        />
      ) : importing ? (
        <ImportPanel library={exercises} onImport={onImport} onClose={() => setImporting(false)} />
      ) : (
        <div style={styles.libraryActions}>
          <button onClick={() => setCreating(true)} style={{ ...styles.importOpenBtn, marginBottom: 0 }}>+ New exercise</button>
          <button onClick={() => setImporting(true)} style={{ ...styles.importOpenBtn, marginBottom: 0 }}>↓ Import from a web page</button>
        </div>
      )}
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search exercises, muscles, or your tags…"
        aria-label="Search exercises"
        style={{ ...styles.input, width: "100%", marginBottom: 10 }}
        autoComplete="off"
      />
      <div style={styles.filterRow}>
        {[["all", "All", ink], ["strength", "Strength", rust], ["cardio", "Cardio", teal]].map(([id, label, color]) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            style={{
              ...styles.filterChip,
              borderColor: color,
              color: filter === id ? C.onFill : color,
              background: filter === id ? color : "transparent",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {allTags.length > 0 && (
        <div style={styles.tagFilterRow} aria-label="Filter by tag">
          <span style={styles.tagFilterLabel}>TAGS</span>
          {allTags.map(([t, n]) => {
            const on = tagFilter === t;
            return (
              <button
                key={t}
                onClick={() => setTagFilter(on ? null : t)}
                aria-pressed={on}
                style={{ ...styles.tagChip, ...(on ? styles.tagChipOn : {}) }}
              >
                #{t} <span style={{ opacity: 0.6 }}>{n}</span>
              </button>
            );
          })}
        </div>
      )}
      {saveError && <div style={{ ...styles.errorTag, marginBottom: 8 }}>Tags not saved — try again</div>}

      {loading ? (
        <div style={styles.loading}>Loading exercise library…</div>
      ) : filtered.length === 0 ? (
        <div style={styles.emptyText}>{tagFilter ? `No exercises tagged #${tagFilter} match.` : "No exercises match that search."}</div>
      ) : (
        <>
          <div style={styles.libraryList}>
            {shown.map((e) => {
              const isCardio = e.category === "cardio";
              const accent = isCardio ? teal : rust;
              const meta = [e.category, e.equipment, e.primaryMuscles[0]].filter(Boolean).join(" · ");
              const tags = tagsOf(tagMap, e.name);
              const isEditing = editing === e.name;
              return (
                <div key={e.name} className="ft-card" style={styles.libraryItem}>
                  <div style={styles.libraryRow}>
                    <div style={styles.libraryRowText}>
                      <span style={styles.rowMain}>{e.name}</span>
                      {meta && <span style={styles.libraryMeta}>{meta}{e.custom ? " · your exercise" : e.imported ? " · imported" : ""}</span>}
                      {e.plans?.length > 0 && (
                        <span style={styles.libraryPlans}>
                          {e.plans.map((pl, i) => (
                            <span key={i}>{pl.tag ? `${pl.tag}: ` : ""}{planText(pl)}</span>
                          ))}
                        </span>
                      )}
                      {tags.length > 0 && !isEditing && (
                        <span style={styles.rowTags}>
                          {tags.map((t) => (
                            <button key={t} onClick={() => setTagFilter(t)} style={styles.rowTag} title={`Show #${t}`}>#{t}</button>
                          ))}
                        </span>
                      )}
                    </div>
                    <div style={styles.libraryBtns}>
                      <button
                        onClick={() => setEditing(isEditing ? null : e.name)}
                        aria-label={`Tag ${e.name}`}
                        aria-expanded={isEditing}
                        title="Add or remove tags"
                        className={isEditing || tags.length ? undefined : "ft-reveal"}
                        style={{ ...styles.tagBtn, ...(isEditing || tags.length ? styles.tagBtnOn : {}) }}
                      >
                        #
                      </button>
                      <button
                        onClick={() => onPick(e)}
                        aria-label={`Log ${e.name}`}
                        style={{ ...styles.libraryAddBtn, borderColor: accent, color: accent }}
                      >
                        +
                      </button>
                    </div>
                  </div>
                  {isEditing && (
                    <TagEditor
                      name={e.name}
                      tags={tags}
                      suggestions={allTags.map(([t]) => t)}
                      onChange={(next) => onSetTags(e.name, next)}
                      onDone={() => setEditing(null)}
                      onRemove={e.imported ? () => { onRemoveImported(e.name); setEditing(null); } : null}
                      removeLabel={e.custom ? "Remove this exercise" : "Remove this imported exercise"}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {filtered.length > RESULT_CAP && (
            <div style={styles.libraryTruncated}>Showing first {RESULT_CAP} of {filtered.length} — refine your search for more.</div>
          )}
        </>
      )}
    </div>
  );
}

function TagEditor({ name, tags, suggestions, onChange, onDone, onRemove, removeLabel }) {
  const [text, setText] = useState("");
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const add = (raw) => {
    const t = cleanTag(raw);
    setText("");
    if (!t || tags.includes(t)) return;
    onChange([...tags, t]);
  };
  const remove = (t) => onChange(tags.filter((x) => x !== t));
  const unused = suggestions.filter((t) => !tags.includes(t));
  const listId = `tag-list-${name.replace(/[^A-Za-z0-9]/g, "-")}`;

  return (
    <form
      style={styles.tagEditor}
      onSubmit={(ev) => { ev.preventDefault(); add(text); }}
    >
      <div style={styles.rowTags}>
        {tags.length === 0 && <span style={styles.libraryMeta}>No tags yet.</span>}
        {tags.map((t) => (
          <span key={t} style={styles.editTag}>
            #{t}
            <button type="button" onClick={() => remove(t)} aria-label={`Remove tag ${t}`} style={styles.editTagX}>×</button>
          </span>
        ))}
      </div>
      <div style={styles.tagInputRow}>
        <input
          ref={inputRef}
          id={`tag-input-${listId}`}
          value={text}
          onChange={(ev) => {
            const v = ev.target.value;
            if (v.endsWith(",")) add(v.slice(0, -1));
            else setText(v);
          }}
          onKeyDown={(ev) => {
            if (ev.key === "Escape") onDone();
            if (ev.key === "Backspace" && !text && tags.length) remove(tags[tags.length - 1]);
          }}
          placeholder="Add a tag, e.g. legs day"
          aria-label={`New tag for ${name}`}
          list={listId}
          autoComplete="off"
          style={{ ...styles.input, flex: 1, minWidth: 0 }}
        />
        <datalist id={listId}>
          {unused.map((t) => <option key={t} value={t} />)}
        </datalist>
        <button type="submit" style={styles.tagAddBtn}>Add</button>
        <button type="button" onClick={onDone} style={styles.tagDoneBtn}>Done</button>
      </div>
      {unused.length > 0 && (
        <div style={styles.rowTags}>
          {unused.slice(0, 8).map((t) => (
            <button key={t} type="button" onClick={() => add(t)} style={styles.rowTag}>+ #{t}</button>
          ))}
        </div>
      )}
      {onRemove && (
        <button type="button" onClick={onRemove} style={styles.removeImportedBtn}>
          {removeLabel || "Remove this exercise"}
        </button>
      )}
    </form>
  );
}

const EQUIPMENT_CHOICES = ["body only", "barbell", "dumbbell", "kettlebells", "cable", "machine", "bands", "e-z curl bar", "medicine ball", "exercise ball", "foam roll", "other"];
const MUSCLE_CHOICES = ["abdominals", "biceps", "calves", "chest", "forearms", "glutes", "hamstrings", "lats", "lower back", "middle back", "neck", "quadriceps", "shoulders", "traps", "triceps", "abductors", "adductors"];
const CATEGORY_CHOICES = [["strength", "Strength"], ["cardio", "Cardio"], ["stretching", "Stretching"], ["plyometrics", "Plyometrics"], ["powerlifting", "Powerlifting"], ["strongman", "Strongman"], ["olympic weightlifting", "Olympic weightlifting"]];

function NewExerciseForm({ suggestions, onCreate, onClose }) {
  const [v, setV] = useState({ name: "", category: "strength", equipment: "", muscle: "", tags: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setV((cur) => ({ ...cur, [k]: e.target.value })); setError(""); };
  const submit = async (ev) => {
    ev.preventDefault();
    setBusy(true);
    const r = await onCreate({ ...v, tags: v.tags.split(",") });
    setBusy(false);
    if (!r.ok) setError(r.error);
  };
  return (
    <form onSubmit={submit} className="ft-card" style={styles.importPanel} aria-label="New exercise">
      <div style={styles.sectionHead}>
        <span style={styles.importTitle}>NEW EXERCISE</span>
        <button type="button" onClick={onClose} style={styles.tagDoneBtn}>Close</button>
      </div>
      <label style={styles.fieldLabel}>
        Name
        <input id="new-exercise-name" value={v.name} onChange={set("name")} placeholder="e.g. Landmine press" autoFocus autoComplete="off" style={styles.input} />
      </label>
      <div style={styles.newExerciseGrid}>
        <label style={styles.fieldLabel}>
          Type
          <select value={v.category} onChange={set("category")} style={styles.input}>
            {CATEGORY_CHOICES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label style={styles.fieldLabel}>
          Equipment (optional)
          <select value={v.equipment} onChange={set("equipment")} style={styles.input}>
            <option value="">—</option>
            {EQUIPMENT_CHOICES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label style={styles.fieldLabel}>
          Main muscle (optional)
          <select value={v.muscle} onChange={set("muscle")} style={styles.input}>
            <option value="">—</option>
            {MUSCLE_CHOICES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
      </div>
      <label style={styles.fieldLabel}>
        Tags (optional, separate with commas)
        <input value={v.tags} onChange={set("tags")} placeholder={suggestions.length ? suggestions.slice(0, 3).join(", ") : "legs day, monday"} list="new-exercise-tags" autoComplete="off" style={styles.input} />
        <datalist id="new-exercise-tags">{suggestions.map((t) => <option key={t} value={t} />)}</datalist>
      </label>
      {error && <span role="alert" style={styles.importError}>{error}</span>}
      <div style={styles.importBtnRow}>
        <button type="submit" disabled={busy || !v.name.trim()} style={styles.tagAddBtn}>Save exercise</button>
        <button type="button" onClick={onClose} style={styles.tagDoneBtn}>Cancel</button>
      </div>
    </form>
  );
}

function ImportPanel({ library, onImport, onClose }) {
  const [text, setText] = useState("");
  const [html, setHtml] = useState("");
  const [rows, setRows] = useState(null);
  const [checked, setChecked] = useState({});
  const [extraTag, setExtraTag] = useState("");
  const [status, setStatus] = useState(null); // { kind: "error"|"done"|"busy", text }
  const [canAskClaude, setCanAskClaude] = useState(false);
  const [imageLimits, setImageLimits] = useState(null);
  const [shots, setShots] = useState([]); // [{ id, file, url }]
  const abortRef = useRef(null);
  const shotsRef = useRef(shots);
  shotsRef.current = shots;

  useEffect(() => {
    let live = true;
    getSample().then((s) => { if (live) setCanAskClaude(Boolean(s)); });
    getImageLimits().then((l) => { if (live) setImageLimits(l); });
    return () => {
      live = false;
      abortRef.current?.abort();
      shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url));
    };
  }, []);

  const addShots = (files) => {
    if (!imageLimits) return;
    const ok = [...files].filter((f) => imageLimits.mediaTypes.includes(f.type));
    const tooBig = ok.filter((f) => f.size > imageLimits.maxInputBytes);
    const keep = ok.filter((f) => f.size <= imageLimits.maxInputBytes);
    setShots((cur) => [...cur, ...keep.map((file) => ({ id: Math.random().toString(36).slice(2), file, url: URL.createObjectURL(file) }))]);
    if (ok.length < files.length || tooBig.length) {
      setStatus({ kind: "error", text: tooBig.length ? "Some images are too large. Try a smaller screenshot." : "Only JPEG, PNG, WebP or GIF images can be read." });
    } else {
      setStatus(null);
    }
  };
  const removeShot = (id) => setShots((cur) => {
    const s = cur.find((x) => x.id === id);
    if (s) URL.revokeObjectURL(s.url);
    return cur.filter((x) => x.id !== id);
  });

  const askClaudeShots = async () => {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setStatus({ kind: "busy", text: "Claude is reading your screenshots…" });
    try {
      const list = await readScreenshotsWithClaude(shots.map((s) => s.file), library, {
        signal: ctl.signal,
        onProgress: (done, total) => total > 1 && done < total && setStatus({ kind: "busy", text: `Claude is reading your screenshots… (${done} of ${total})` }),
      });
      show(list, "claude");
    } catch (e) {
      if (e?.code === "cancelled") return;
      setStatus({ kind: "error", text: e?.code === "not_granted"
        ? "Claude wasn't allowed to read the screenshots."
        : e?.code === "rate_limited" ? "Claude is busy right now. Try again in a minute."
        : e?.code === "image_rejected" ? "One of the images couldn't be read. Try a PNG or JPEG screenshot."
        : "Claude couldn't read those screenshots. Try clearer or fewer screenshots." });
    }
  };

  const show = (list, how) => {
    if (!list.length) {
      setRows(null);
      setStatus({ kind: "error", text: how === "claude"
        ? "Claude didn't find any exercises in that page."
        : "No exercises found. Try copying just the workout part of the page" + (canAskClaude ? ", or use Read with Claude." : ".") });
      return;
    }
    setRows(list.map((r) => ({ ...r, tags: [...r.tags], newTag: "" })));
    setChecked(Object.fromEntries(list.map((r) => [r.key, r.confident])));
    setStatus(null);
  };

  const readPage = () => show(parsePage({ html, text, library }), "rules");

  const askClaude = async () => {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setStatus({ kind: "busy", text: "Claude is reading the page…" });
    try {
      show(await readWithClaude(text, library, { signal: ctl.signal }), "claude");
    } catch (e) {
      if (e?.code === "cancelled") return;
      setStatus({ kind: "error", text: e?.code === "not_granted"
        ? "Claude wasn't allowed to read the page. You can still use Read page."
        : e?.code === "rate_limited" ? "Claude is busy right now. Try again in a minute."
        : "Claude couldn't read that page. Try Read page, or copy just the workout part." });
    }
  };

  const update = (key, patch) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const selected = (rows || []).filter((r) => checked[r.key] && r.name.trim());
  const likely = (rows || []).filter((r) => r.confident);
  const maybe = (rows || []).filter((r) => !r.confident);

  const doImport = async () => {
    const list = selected.map((r) => ({
      ...r,
      name: r.name.trim(),
      tags: [...r.tags, r.newTag.trim()].filter(Boolean),
    }));
    const ok = await onImport(list, extraTag.trim());
    if (!ok) { setStatus({ kind: "error", text: "Couldn't save the import. Try again." }); return; }
    const added = list.filter((r) => !r.inLibrary).length;
    setStatus({ kind: "done", text: `Imported ${list.length} exercise${list.length === 1 ? "" : "s"}${added ? ` (${added} new)` : ""}. Tap a tag below to find them.` });
    setRows(null);
    setText("");
    setHtml("");
    shots.forEach((s) => URL.revokeObjectURL(s.url));
    setShots([]);
  };

  const renderRow = (r) => (
    <div key={r.key} style={{ ...styles.importRow, opacity: checked[r.key] ? 1 : 0.6 }}>
      <input
        type="checkbox"
        id={`imp-${r.key}`}
        checked={Boolean(checked[r.key])}
        onChange={(e) => setChecked((c) => ({ ...c, [r.key]: e.target.checked }))}
        aria-label={`Import ${r.name}`}
        style={{ marginTop: 9 }}
      />
      <div style={styles.importRowBody}>
        <div style={styles.importRowTop}>
          <input
            value={r.name}
            onChange={(e) => update(r.key, { name: e.target.value })}
            aria-label="Exercise name"
            style={{ ...styles.input, flex: "1 1 160px", minWidth: 0, fontSize: 13, padding: "5px 7px" }}
          />
          {r.inLibrary ? (
            <span style={styles.importBadge}>In library</span>
          ) : (
            <select
              value={r.category}
              onChange={(e) => update(r.key, { category: e.target.value })}
              aria-label={`Category for ${r.name}`}
              style={styles.importSelect}
            >
              {["strength", "cardio", "stretching", "plyometrics", "powerlifting", "strongman", "olympic weightlifting"].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
        </div>
        {r.plans.length > 0 && (
          <div style={styles.libraryPlans}>
            {r.plans.map((pl, i) => <span key={i}>{pl.tag ? `${pl.tag}: ` : ""}{planText(pl)}</span>)}
          </div>
        )}
        <div style={styles.rowTags} aria-label={`Tags for ${r.name}`}>
          {r.tags.map((t) => (
            <span key={t} style={styles.editTag}>
              #{t}
              <button type="button" onClick={() => update(r.key, { tags: r.tags.filter((x) => x !== t) })} aria-label={`Remove tag ${t} from ${r.name}`} style={styles.editTagX}>×</button>
            </span>
          ))}
          <input
            value={r.newTag}
            onChange={(e) => update(r.key, { newTag: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && r.newTag.trim()) {
                e.preventDefault();
                const t = cleanTag(r.newTag);
                update(r.key, { tags: r.tags.includes(t) ? r.tags : [...r.tags, t], newTag: "" });
              }
            }}
            placeholder="+ tag"
            aria-label={`Add a tag to ${r.name}`}
            style={{ ...styles.input, width: 90, fontSize: 12, padding: "2px 7px", fontFamily: "'IBM Plex Mono', monospace" }}
          />
        </div>
      </div>
    </div>
  );

  return (
    <section className="ft-card" style={styles.importPanel} aria-label="Import exercises">
      <div style={styles.sectionHead}>
        <span style={styles.importTitle}>IMPORT FROM A WEB PAGE</span>
        <button onClick={onClose} style={styles.tagDoneBtn}>Close</button>
      </div>

      {!rows && (
        <>
          <ol style={styles.importSteps}>
            <li>Open the workout page, select the plan (or press Ctrl/⌘ + A for the whole page) and copy.</li>
            <li>Paste it below, then tap <strong>Read page</strong>.</li>
          </ol>
          <textarea
            id="import-paste"
            value={text}
            onPaste={(e) => {
              const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
              if (files.length && imageLimits) {
                e.preventDefault();
                addShots(files);
                return;
              }
              const h = e.clipboardData?.getData("text/html") || "";
              setHtml(h);
              setStatus(null);
            }}
            onChange={(e) => {
              setText(e.target.value);
              if (!e.target.value) setHtml("");
            }}
            placeholder="Paste the page here"
            aria-label="Pasted web page"
            rows={6}
            style={{ ...styles.input, width: "100%", resize: "vertical", fontSize: 13 }}
          />
          {html && <div style={styles.importNote}>Page layout kept: tables, lists and headings will be read.</div>}
          <div style={styles.importBtnRow}>
            <button onClick={readPage} disabled={!text.trim() && !html} style={styles.tagAddBtn}>Read page</button>
            {canAskClaude && (
              <button onClick={askClaude} disabled={!text.trim() || status?.kind === "busy"} style={styles.tagDoneBtn} title="For pages the built-in reader can't follow. Asks Claude to read it.">
                Read with Claude
              </button>
            )}
          </div>

          {imageLimits && (
            <div style={styles.shotBox}>
              <div style={styles.importSteps}>
                <strong>Or use screenshots.</strong> Add screenshots of the plan in order, top to bottom. Long screenshots are fine. Claude reads them.
              </div>
              <label style={styles.shotPick}>
                + Add screenshots
                <input
                  type="file"
                  accept={imageLimits.mediaTypes.join(",")}
                  multiple
                  onChange={(e) => { addShots(e.target.files || []); e.target.value = ""; }}
                  style={styles.visuallyHidden}
                  aria-label="Add screenshots"
                />
              </label>
              {shots.length > 0 && (
                <>
                  <div style={styles.shotList}>
                    {shots.map((s, i) => (
                      <div key={s.id} style={styles.shotThumb}>
                        <img src={s.url} alt={`Screenshot ${i + 1}`} style={styles.shotImg} />
                        <span style={styles.shotNum}>{i + 1}</span>
                        <button onClick={() => removeShot(s.id)} aria-label={`Remove screenshot ${i + 1}`} style={styles.shotX}>×</button>
                      </div>
                    ))}
                  </div>
                  <div style={styles.importBtnRow}>
                    <button onClick={askClaudeShots} disabled={status?.kind === "busy"} style={styles.tagAddBtn}>
                      Read {shots.length} screenshot{shots.length === 1 ? "" : "s"} with Claude
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      {status && (
        <div role={status.kind === "error" ? "alert" : "status"} style={status.kind === "error" ? styles.importError : styles.importStatus}>
          {status.text}
        </div>
      )}

      {rows && (
        <>
          <div style={styles.importSummary}>
            {(() => {
              const n = new Set(likely.flatMap((r) => r.tags)).size;
              return `Found ${likely.length} exercise${likely.length === 1 ? "" : "s"}${n ? ` across ${n} tag${n === 1 ? "" : "s"}` : ""}.`;
            })()}
            {" "}Check the names and tags, then import.
          </div>
          <label style={{ ...styles.importTagLabel, marginTop: 2 }}>
            Also tag all with
            <input
              value={extraTag}
              onChange={(e) => setExtraTag(e.target.value)}
              placeholder="e.g. greek god"
              aria-label="Tag for every imported exercise"
              style={{ ...styles.input, flex: 1, minWidth: 0, fontSize: 12, padding: "5px 7px" }}
            />
          </label>
          <div style={styles.importBtnRow}>
            <button onClick={doImport} disabled={!selected.length} style={styles.tagAddBtn}>
              Import {selected.length} exercise{selected.length === 1 ? "" : "s"}
            </button>
            <button onClick={() => { setRows(null); setStatus(null); }} style={styles.tagDoneBtn}>Back</button>
          </div>
          <div style={styles.importList}>{likely.map(renderRow)}</div>
          {maybe.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={styles.libraryMeta}>Maybe exercises ({maybe.length}) — not selected</summary>
              <div style={{ ...styles.importList, marginTop: 6 }}>{maybe.map(renderRow)}</div>
            </details>
          )}
        </>
      )}
    </section>
  );
}

/* ---------- styles ---------- */
const ink = C.ink;
const inkFaint = C.inkFaint;
const paper = C.paper;
const raised = C.raised;
const line = C.line;
const rust = C.rust;
const teal = C.teal;

const boteh = "M40 6 C16 4 2 26 8 46 C13 62 30 72 46 64 C58 58 58 44 46 40 C38 37 36 28 44 24 C52 20 60 26 60 36 C60 46 52 54 42 56";

// dotted-trim points hand-placed near the boteh outline, in the same local coordinate space
const trimDots = [[40,6],[22,10],[8,46],[16,60],[46,64],[52,52],[46,40],[38,32],[44,24],[54,28],[60,36],[54,46]];
const trimDotMarkup = (r, opacity) =>
  trimDots.map(([x, y]) => `<circle cx='${x}' cy='${y}' r='${r}' fill='${paper}' fill-opacity='${opacity}'/>`).join("");

const sunMarkup = (x, y, scale, color) => `
  <g transform='translate(${x},${y}) scale(${scale})' stroke='${color}' stroke-width='1.3' fill='none'>
    <circle r='4.5'/>
    <line x1='0' y1='-8' x2='0' y2='-6'/><line x1='0' y1='8' x2='0' y2='6'/>
    <line x1='-8' y1='0' x2='-6' y2='0'/><line x1='8' y1='0' x2='6' y2='0'/>
    <line x1='-5.6' y1='-5.6' x2='-4.2' y2='-4.2'/><line x1='5.6' y1='5.6' x2='4.2' y2='4.2'/>
    <line x1='-5.6' y1='5.6' x2='-4.2' y2='4.2'/><line x1='5.6' y1='-5.6' x2='4.2' y2='-4.2'/>
  </g>`;

const heartMarkup = (x, y, scale, color) => `
  <path transform='translate(${x},${y}) scale(${scale})' d='M0,3 C-4,-2 -9,1 -9,5 C-9,9 -4,12 0,16 C4,12 9,9 9,5 C9,1 4,-2 0,3 Z' fill='none' stroke='${color}' stroke-width='1.3'/>`;

const botehMotif = (fill) => `
  <path d='${boteh}' fill='${fill}' stroke='${paper}' stroke-width='2.2'/>
  <path d='${boteh}' transform='scale(0.62) translate(24,20)' fill='none' stroke='${paper}' stroke-width='1.4' opacity='0.8'/>
  ${trimDotMarkup(1.5, 0.85)}
  <circle cx='47' cy='38' r='2' fill='${paper}' fill-opacity='0.9'/>
  <circle cx='51' cy='45' r='1.2' fill='${paper}' fill-opacity='0.8'/>`;

const paisleySvg = `
<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240' viewBox='0 0 240 240'>
  <rect width='240' height='240' fill='${paper}'/>

  <g transform='translate(6,4) rotate(-10) scale(1.5)'>${botehMotif(teal)}</g>
  <g transform='translate(150,120) rotate(160) scale(1.35)'>${botehMotif(teal)}</g>
  <g transform='translate(150,-8) rotate(70) scale(1.05)'>${botehMotif(rust)}</g>
  <g transform='translate(-6,150) rotate(-160) scale(1.05)'>${botehMotif(rust)}</g>

  ${sunMarkup(120, 40, 1, ink)}
  ${sunMarkup(200, 170, 1.1, ink)}
  ${sunMarkup(30, 210, 0.9, ink)}
  ${heartMarkup(190, 60, 0.55, ink)}
  ${heartMarkup(60, 190, 0.5, teal)}

  <circle cx='105' cy='95' r='2.4' fill='${ink}' fill-opacity='0.35'/>
  <circle cx='170' cy='30' r='1.8' fill='${ink}' fill-opacity='0.3'/>
  <circle cx='210' cy='100' r='2' fill='${rust}' fill-opacity='0.4'/>
  <circle cx='25' cy='100' r='1.8' fill='${teal}' fill-opacity='0.4'/>
  <circle cx='95' cy='215' r='2.2' fill='${ink}' fill-opacity='0.3'/>
  <circle cx='215' cy='215' r='1.6' fill='${ink}' fill-opacity='0.3'/>
</svg>`;

const paisleyBg = `url("data:image/svg+xml,${encodeURIComponent(paisleySvg)}")`;

const styles = {
  page: {
    fontFamily: C.sans,
    backgroundColor: paper,
    color: ink,
    minHeight: "100vh",
    padding: "20px 16px 40px",
    position: "relative",
    maxWidth: 640,
    margin: "0 auto",
  },
  header: { marginBottom: 4 },
  headerRight: { display: "flex", alignItems: "flex-start", gap: 8, marginLeft: "auto" },
  menuBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, flex: "none", color: ink, background: "transparent", border: `1px solid ${line}`, borderRadius: 4, padding: 0 },
  menu: { position: "absolute", top: 58, right: 16, zIndex: 20, width: 250, maxHeight: "calc(100dvh - 90px)", overflowY: "auto", display: "flex", flexDirection: "column", gap: 2, padding: 8, background: C.field, color: ink, border: `1px solid ${line}`, borderRadius: 6, boxShadow: "0 10px 28px rgba(0,0,0,0.25)" },
  menuHeading: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: inkFaint, padding: "4px 8px 6px" },
  menuItem: { display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 44, padding: "4px 8px", fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: ink, background: "transparent", border: "none", borderRadius: 4, textAlign: "left" },
  menuItemOn: { fontWeight: 600, background: paper },
  menuValue: { fontSize: 12, color: inkFaint, whiteSpace: "nowrap" },
  menuChev: { fontSize: 16, color: inkFaint, marginLeft: 2 },
  menuNote: { margin: "2px 8px 6px", fontSize: 12, lineHeight: 1.4, color: inkFaint },
  menuRule: { height: 1, background: line, margin: "4px 8px" },
  menuBack: { color: inkFaint, borderBottom: `1px solid ${line}`, borderRadius: 0, marginBottom: 4 },
  themeSwatch: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 2, width: 26, height: 26, borderRadius: "50%", border: "1px solid" },
  themeSwatchDot: { width: 7, height: 7, borderRadius: "50%" },
  brand: { display: "flex", alignItems: "center", gap: 8, paddingTop: 2 },
  eyebrowRow: { display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "4px 12px", marginBottom: 6 },
  syncNotice: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: ink,
    background: raised,
    border: `1px solid ${rust}`,
    borderRadius: 4,
    padding: "7px 10px",
    marginTop: 10,
  },
  driveIconBtn: { position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 40, height: 34, padding: 0, background: "none", border: "none", color: ink },
  srOnly: { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 },
  drivePop: { position: "absolute", top: 40, right: 0, zIndex: 25, display: "flex", flexDirection: "column", gap: 2, width: 220, padding: 8, background: C.field, color: ink, border: `1px solid ${line}`, borderRadius: 6, boxShadow: "0 10px 28px rgba(0,0,0,0.25)" },
  drivePopText: { fontSize: 12.5, color: inkFaint, padding: "4px 8px 6px" },
  drivePopBtn: { minHeight: 40, padding: "4px 8px", fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: ink, background: "transparent", border: "none", borderRadius: 4, textAlign: "left" },
  driveWrap: { position: "relative", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: "4px 10px", marginLeft: "auto" },
  driveBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    letterSpacing: "0.04em",
    color: ink,
    background: "transparent",
    border: `1px solid ${line}`,
    borderRadius: 999,
    padding: "3px 10px",
    lineHeight: 1.4,
  },
  driveBtnWarn: { borderColor: rust, color: rust },
  driveBtnDone: { borderColor: line, color: inkFaint },
  driveDot: { width: 6, height: 6, borderRadius: "50%", flex: "none" },
  driveLink: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: inkFaint,
    background: "none",
    border: "none",
    padding: 0,
    textDecoration: "underline",
  },
  driveMsg: { flexBasis: "100%", textAlign: "right", fontSize: 12, color: rust },
  eyebrow: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    letterSpacing: "0.18em",
    color: inkFaint,
  },
  scoreBlock: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, width: "100%", margin: "2px 0 0", padding: "4px 0", background: "none", border: "none", color: "inherit", textAlign: "left", font: "inherit" },
  scoreLabel: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: inkFaint },
  scoreValue: { fontFamily: C.display, fontWeight: 700, fontSize: 56, lineHeight: 1, letterSpacing: "0.01em" },
  scoreEmpty: { fontFamily: C.display, fontWeight: 600, fontSize: 22, lineHeight: 1.2 },
  scoreSub: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 10px", fontSize: 13, color: inkFaint },
  scoreWeek: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 },
  scoreBadge: { display: "inline-block", padding: "1px 8px", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 600, color: C.highlightInk, background: C.highlight, borderRadius: 999 },
  headerDayWrap: { display: "flex", flexDirection: "column", gap: 2, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${line}` },
  headerDay: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontFamily: C.display, fontWeight: 600, fontSize: 22, letterSpacing: "0.03em" },
  headerSub: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: inkFaint },
  dayBody: { marginTop: 14 },
  monthRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  monthTitle: {
    fontFamily: C.display,
    fontWeight: 700,
    fontSize: 26,
    letterSpacing: "0.02em",
    lineHeight: 1,
  },
  year: { color: inkFaint, fontWeight: 500 },
  navBtn: {
    background: "none",
    border: `1px solid ${line}`,
    borderRadius: 4,
    width: 34,
    height: 34,
    fontSize: 18,
    color: ink,
    lineHeight: 1,
  },
  bottomNav: { position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 30, display: "flex", justifyContent: "center", background: raised, borderTop: `1px solid ${line}`, boxShadow: "0 -4px 16px rgba(0,0,0,0.08)" },
  navTab: { flex: "1 1 0", maxWidth: 160, minHeight: 60, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, padding: "6px 2px 8px", background: "none", border: "none" },
  navPill: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 56, height: 30, borderRadius: 999 },
  navLabel: { fontFamily: C.display, fontSize: 12, letterSpacing: "0.08em" },
  library: { marginTop: 16 },
  filterRow: { display: "flex", gap: 8, marginBottom: 12 },
  filterChip: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    border: "1px solid",
    borderRadius: 999,
    padding: "5px 12px",
  },
  libraryList: { display: "flex", flexDirection: "column", gap: 6 },
  libraryItem: {
    background: raised,
    border: `1px solid ${line}`,
    borderRadius: 4,
    padding: "9px 10px",
  },
  libraryRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  libraryBtns: { display: "flex", gap: 6, flexShrink: 0 },
  tagBtn: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    border: `1.5px solid ${line}`,
    background: "transparent",
    color: inkFaint,
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 13,
    lineHeight: 1,
  },
  tagBtnOn: { borderColor: ink, color: ink },
  rowTags: { display: "flex", flexWrap: "wrap", gap: 4, marginTop: 3 },
  rowTag: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: ink,
    background: paper,
    border: `1px solid ${line}`,
    borderRadius: 999,
    padding: "1px 8px",
  },
  pickList: { display: "flex", flexWrap: "wrap", gap: 6 },
  weightHead: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 6 },
  unitToggle: { display: "inline-flex" },
  unitBtn: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    background: "transparent",
    border: "1px solid",
    padding: "3px 9px",
    marginLeft: -1,
  },
  planHint: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: inkFaint,
    marginTop: 2,
  },
  libraryPlans: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: ink,
    marginTop: 2,
    overflowWrap: "anywhere",
  },
  libraryActions: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 },
  newExerciseGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 },
  pbNote: { display: "flex", alignItems: "center", gap: 10, margin: "0 0 12px", padding: "10px 12px", fontSize: 14, lineHeight: 1.4, color: C.highlightInk, background: C.highlight, borderRadius: 4 },
  pbLine: { display: "block", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5 },
  pbClose: { background: "none", border: "none", color: "inherit", fontSize: 20, lineHeight: 1, padding: "4px 6px", minWidth: 36, minHeight: 36 },
  pbBadge: { display: "inline-block", marginLeft: 8, padding: "1px 6px", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.06em", color: C.highlightInk, background: C.highlight, borderRadius: 999, verticalAlign: "middle" },
  newExerciseNote: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: teal, fontWeight: 400, letterSpacing: 0 },
  importOpenBtn: {
    width: "100%",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: ink,
    background: "transparent",
    border: `1px dashed ${inkFaint}`,
    borderRadius: 4,
    padding: "9px 10px",
    marginBottom: 12,
    textAlign: "left",
  },
  importPanel: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    background: raised,
    border: `1px solid ${line}`,
    borderLeft: `3px solid ${ink}`,
    borderRadius: 4,
    padding: "12px 12px 14px",
    marginBottom: 14,
  },
  importTitle: {
    fontFamily: C.display,
    fontWeight: 700,
    fontSize: 17,
    letterSpacing: "0.04em",
  },
  importSteps: { margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.45, display: "flex", flexDirection: "column", gap: 2 },
  importBtnRow: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 2 },
  importSummary: { fontSize: 13, lineHeight: 1.4 },
  importList: { display: "flex", flexDirection: "column", gap: 6 },
  importRow: {
    display: "flex",
    gap: 8,
    alignItems: "flex-start",
    background: paper,
    border: `1px solid ${line}`,
    borderRadius: 4,
    padding: "7px 8px",
  },
  importRowBody: { display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 },
  importRowTop: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" },
  importBadge: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    letterSpacing: "0.06em",
    color: teal,
    border: `1px solid ${teal}`,
    borderRadius: 999,
    padding: "2px 8px",
    flexShrink: 0,
  },
  importSelect: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: ink,
    background: C.field,
    border: `1px solid ${line}`,
    borderRadius: 3,
    padding: "4px 6px",
    flexShrink: 0,
  },
  importTagLabel: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: inkFaint,
  },
  importStatus: { fontSize: 13, color: teal },
  importNote: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: inkFaint },
  shotBox: { display: "flex", flexDirection: "column", gap: 8, borderTop: `1px dashed ${line}`, paddingTop: 10, marginTop: 4 },
  shotPick: {
    alignSelf: "flex-start",
    position: "relative",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: ink,
    border: `1px solid ${ink}`,
    borderRadius: 4,
    padding: "7px 10px",
    cursor: "pointer",
  },
  visuallyHidden: { position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden", pointerEvents: "none" },
  shotList: { display: "flex", flexWrap: "wrap", gap: 8 },
  shotThumb: { position: "relative", width: 64, height: 88, borderRadius: 3, overflow: "hidden", border: `1px solid ${line}`, background: paper },
  shotImg: { width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", display: "block" },
  shotNum: { position: "absolute", left: 3, bottom: 3, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: C.onFill, background: ink, borderRadius: 2, padding: "0 4px" },
  shotX: { position: "absolute", right: 2, top: 2, width: 20, height: 20, borderRadius: "50%", border: "none", background: ink, color: C.onFill, fontSize: 13, lineHeight: 1, padding: 0 },
  importError: { fontSize: 13, color: rust },
  removeImportedBtn: {
    alignSelf: "flex-start",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: rust,
    background: "none",
    border: "none",
    padding: 0,
    textDecoration: "underline",
  },
  pickItem: {
    fontFamily: C.sans,
    fontSize: 13,
    background: raised,
    border: "1px solid",
    borderRadius: 4,
    padding: "5px 9px",
    textAlign: "left",
  },
  suggestList: {
    position: "absolute",
    zIndex: 5,
    top: "100%",
    left: 0,
    right: 0,
    margin: "2px 0 0",
    padding: 0,
    listStyle: "none",
    background: C.field,
    border: `1px solid ${line}`,
    borderRadius: 3,
    boxShadow: "0 4px 14px rgba(35,33,29,0.12)",
    maxHeight: 260,
    overflowY: "auto",
  },
  suggestItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 10,
    padding: "8px 10px",
    fontFamily: C.sans,
    fontSize: 14,
    color: ink,
    cursor: "pointer",
    borderBottom: `1px solid ${raised}`,
  },
  suggestTags: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: inkFaint,
    textAlign: "right",
    flexShrink: 1,
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  tagFilterRow: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 12 },
  tagFilterLabel: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    letterSpacing: "0.18em",
    color: inkFaint,
    marginRight: 2,
  },
  tagChip: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: ink,
    background: "transparent",
    border: `1px dashed ${inkFaint}`,
    borderRadius: 999,
    padding: "4px 10px",
  },
  tagChipOn: { background: ink, color: C.onFill, borderStyle: "solid", borderColor: ink },
  tagEditor: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTop: `1px dashed ${line}`,
  },
  tagInputRow: { display: "flex", gap: 6, alignItems: "center" },
  editTag: {
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: C.onFill,
    background: ink,
    borderRadius: 999,
    padding: "2px 4px 2px 9px",
  },
  editTagX: {
    background: "none",
    border: "none",
    color: C.onFill,
    fontSize: 14,
    lineHeight: 1,
    padding: "0 4px",
  },
  tagAddBtn: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: C.onFill,
    background: ink,
    border: `1px solid ${ink}`,
    borderRadius: 4,
    padding: "7px 10px",
    flexShrink: 0,
  },
  tagDoneBtn: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: ink,
    background: "transparent",
    border: `1px solid ${line}`,
    borderRadius: 4,
    padding: "7px 10px",
    flexShrink: 0,
  },
  libraryRowText: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  libraryMeta: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: inkFaint,
    textTransform: "capitalize",
  },
  libraryAddBtn: {
    flexShrink: 0,
    width: 28,
    height: 28,
    borderRadius: "50%",
    border: "1.5px solid",
    background: "transparent",
    fontSize: 16,
    lineHeight: 1,
  },
  libraryTruncated: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: inkFaint,
    marginTop: 10,
    textAlign: "center",
  },
  calTab: {
    position: "fixed",
    left: 0,
    top: "max(150px, 30vh)",
    zIndex: 41,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    width: 26,
    padding: "10px 0",
    color: ink,
    background: raised,
    border: `1px solid ${line}`,
    borderLeft: "none",
    borderRadius: "0 8px 8px 0",
    boxShadow: "2px 2px 10px rgba(0,0,0,0.12)",
    transition: "transform 0.22s ease",
    WebkitTapHighlightColor: "transparent",
  },
  calTabLabel: {
    writingMode: "vertical-rl",
    transform: "rotate(180deg)",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    letterSpacing: "0.16em",
    textTransform: "uppercase",
  },
  calDrawer: {
    position: "fixed",
    top: 0,
    bottom: 0,
    left: 0,
    zIndex: 40,
    width: "var(--ft-cal-w)",
    overflowY: "auto",
    boxSizing: "border-box",
    padding: "18px 16px 24px",
    color: ink,
    background: raised,
    borderRight: `1px solid ${line}`,
    boxShadow: "6px 0 24px rgba(0,0,0,0.18)",
  },
  calBackdrop: { position: "fixed", inset: 0, zIndex: 39, background: "rgba(0,0,0,0.32)" },
  calHead: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  calEyebrow: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: inkFaint },
  calClose: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, color: ink, background: "transparent", border: `1px solid ${line}`, borderRadius: 4, padding: 0 },
  calMonthRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 14 },
  calMonth: { margin: 0, fontFamily: C.display, fontWeight: 700, fontSize: 24, letterSpacing: "0.02em", lineHeight: 1, textTransform: "uppercase" },
  calLegend: { display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 12, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: inkFaint },
  calKey: { display: "inline-block", width: 8, height: 8, borderRadius: 1, marginRight: 6, verticalAlign: "middle" },
  dowRow: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    marginTop: 16,
    borderBottom: `1px solid ${line}`,
    paddingBottom: 6,
  },
  dowCell: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    textAlign: "center",
    color: inkFaint,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: 4,
    marginTop: 6,
  },
  emptyCell: { minHeight: 54 },
  dayCell: {
    minHeight: 54,
    background: raised,
    border: `1px solid ${line}`,
    borderRadius: 3,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "5px 0 4px",
  },
  dayCellSelected: {
    borderColor: ink,
    borderWidth: 2,
    background: C.field,
  },
  dayCellToday: {
    borderColor: inkFaint,
    borderStyle: "dashed",
  },
  dayNum: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: ink,
  },
  barTrack: {
    display: "flex",
    alignItems: "flex-end",
    gap: 2,
    height: 20,
    width: 14,
  },
  bar: {
    width: 5,
    minHeight: 2,
    borderRadius: 1,
    transition: "height 0.2s ease",
  },
  loading: {
    marginTop: 24,
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 13,
    color: inkFaint,
  },
  selectedHeader: {
    marginTop: 22,
    marginBottom: 10,
    fontFamily: C.display,
    fontWeight: 600,
    fontSize: 22,
    letterSpacing: "0.03em",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 10,
    borderBottom: `2px solid ${ink}`,
    paddingBottom: 6,
  },
  lastTime: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, fontSize: 13, lineHeight: 1.45, color: ink, background: C.field, border: "1px solid", borderLeftWidth: 3, borderRadius: 3, padding: "8px 10px" },
  dayNav: { display: "inline-flex", gap: 6, marginLeft: "auto", alignSelf: "center" },
  dayNavBtn: { background: "none", border: `1px solid ${line}`, borderRadius: 4, width: 34, height: 34, fontSize: 18, lineHeight: 1, color: ink, padding: 0 },
  errorTag: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: rust,
    fontWeight: 500,
  },
  sections: { display: "flex", flexDirection: "column", gap: 16 },
  section: {
    background: raised,
    border: `1px solid ${line}`,
    borderLeftWidth: 4,
    borderRadius: 4,
    padding: 14,
  },
  sectionHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  sectionTitle: {
    fontFamily: C.display,
    fontWeight: 700,
    fontSize: 18,
    letterSpacing: "0.06em",
  },
  addBtn: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 13,
    border: "1px solid",
    borderRadius: 4,
    padding: "8px 14px",
    minHeight: 40,
  },
  form: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 10, paddingBottom: 10, borderBottom: `1px solid ${line}` },
  fieldLabel: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: inkFaint,
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  input: {
    fontFamily: C.sans,
    fontSize: 14,
    padding: "7px 8px",
    border: `1px solid ${line}`,
    borderRadius: 3,
    background: C.field,
    color: ink,
  },
  submitBtn: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: "#fff",
    border: "none",
    borderRadius: 3,
    padding: "9px 0",
    marginTop: 2,
    fontWeight: 500,
  },
  rows: { display: "flex", flexDirection: "column", gap: 6 },
  emptyText: {
    fontFamily: C.sans,
    fontSize: 13,
    color: inkFaint,
    fontStyle: "italic",
    padding: "6px 2px",
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    borderRadius: 3,
    padding: "7px 9px",
    gap: 8,
  },
  rowMain: { fontFamily: C.sans, fontSize: 13.5, fontWeight: 500, flex: 1 },
  rowMono: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: ink },
  rowBtn: { width: "100%", border: "none", color: ink, font: "inherit", textAlign: "left", minHeight: 44 },
  rowChev: { fontSize: 18, lineHeight: 1, color: inkFaint, marginLeft: 2 },
  formDeleteBtn: { alignSelf: "flex-start", marginTop: 6, fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, background: "transparent", border: "none", textDecoration: "underline", padding: "8px 0", minHeight: 40 },
  editingNote: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: inkFaint },
  footerStack: { display: "flex", flexDirection: "column", gap: 4 },
  bwLine: { display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "2px 8px", fontWeight: 400, color: inkFaint, fontSize: 11 },
  bwEditBtn: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: rust,
    background: "none",
    border: "none",
    padding: 0,
    textDecoration: "underline",
  },
  bwForm: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 4, fontWeight: 400 },
  bwLabel: { flexBasis: "100%", fontSize: 11, color: inkFaint },
  bwError: { flexBasis: "100%", fontSize: 11, color: rust },
  bwNote: { flexBasis: "100%", fontSize: 11, color: inkFaint },
  bwHint: { fontSize: 11, color: inkFaint },
  footer: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    marginTop: 10,
    paddingTop: 8,
    borderTop: `1px solid ${line}`,
    fontWeight: 500,
  },
};
