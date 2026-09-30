import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { storage } from "./storage";
import * as drive from "./driveSync";

/* ---------- date helpers ---------- */
const pad2 = (n) => String(n).padStart(2, "0");
const monthKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
const todayDayNum = () => pad2(new Date().getDate());
const isSameMonth = (d) => monthKey(d) === monthKey(new Date());
const MONTH_NAMES = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
const DOW = ["S","M","T","W","T","F","S"];

function buildGrid(d) {
  const year = d.getFullYear(), month = d.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(pad2(day));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function strengthVolume(entries) {
  return (entries || []).reduce((sum, e) => sum + (Number(e.sets) || 0) * (Number(e.reps) || 0) * (Number(e.weight) || 0), 0);
}
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
const CUSTOM_STRENGTH_NAMES = CUSTOM_EXERCISES.filter((e) => e.category !== "cardio").map((e) => e.name);
const CUSTOM_CARDIO_NAMES = CUSTOM_EXERCISES.filter((e) => e.category === "cardio").map((e) => e.name);

export default function App() {
  const [cursor, setCursor] = useState(new Date());
  const [monthData, setMonthData] = useState({});
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(false);
  const [selected, setSelected] = useState(isSameMonth(new Date()) ? todayDayNum() : "01");
  const [strengthNames, setStrengthNames] = useState([...CUSTOM_STRENGTH_NAMES].sort());
  const [cardioNames, setCardioNames] = useState([...CUSTOM_CARDIO_NAMES].sort());
  const [fullExercises, setFullExercises] = useState([...CUSTOM_EXERCISES].sort((a, b) => a.name.localeCompare(b.name)));
  const [exercisesLoading, setExercisesLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("log");
  const [prefill, setPrefill] = useState(null);

  const key = monthKey(cursor);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}exercises.json`)
      .then((r) => r.json())
      .then((data) => {
        const strength = new Set(CUSTOM_STRENGTH_NAMES);
        const cardio = new Set(CUSTOM_CARDIO_NAMES);
        data.forEach((e) => {
          if (!e.name) return;
          if (e.category === "cardio") cardio.add(e.name);
          else strength.add(e.name);
        });
        setStrengthNames([...strength].sort());
        setCardioNames([...cardio].sort());

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

  // Re-read the month on screen when a Drive sync brings in changes to it.
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  useEffect(() => {
    drive.initDriveSync();
    return drive.onMonthsChanged((keys) => {
      if (keys.includes(monthKey(cursorRef.current))) loadMonth(cursorRef.current, true);
    });
  }, [loadMonth]);

  const persist = async (next) => {
    setMonthData(next);
    try {
      const result = await storage.set(`month:${monthKey(cursor)}`, JSON.stringify(next), false);
      setSaveError(!result);
      if (result) drive.scheduleSync();
    } catch (e) {
      setSaveError(true);
    }
  };

  const dayEntries = monthData[selected] || { strength: [], cardio: [] };

  const addEntry = (type, entry) => {
    const current = monthData[selected] || { strength: [], cardio: [] };
    const updated = { ...current, [type]: [...(current[type] || []), { id: uid(), ...entry }] };
    persist({ ...monthData, [selected]: updated });
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
    Object.values(monthData).forEach((v) => { m = Math.max(m, strengthVolume(v.strength)); });
    return m;
  }, [monthData]);
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

  const selectedLabel = () => {
    const dow = new Date(cursor.getFullYear(), cursor.getMonth(), Number(selected)).toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
    return `${dow} ${Number(selected)} ${MONTH_NAMES[cursor.getMonth()].slice(0, 3)}`;
  };

  const pickFromLibrary = (exercise) => {
    const type = exercise.category === "cardio" ? "cardio" : "strength";
    setPrefill({ type, value: exercise.name, token: Date.now() });
    setActiveTab("log");
  };

  return (
    <div style={styles.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        input:focus, button:focus { outline: 2px solid #23211D; outline-offset: 1px; }
        button { cursor: pointer; }
        @media (min-width: 720px) {
          .ft-sections { flex-direction: row !important; }
          .ft-section { flex: 1 1 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .ft-bar { transition: none !important; }
        }
      `}</style>

      <header style={styles.header}>
        <div style={styles.eyebrowRow}>
          <div style={styles.eyebrow}>TRAINING LEDGER</div>
          <DriveStatus />
        </div>
        <div style={styles.monthRow}>
          <button aria-label="Previous month" onClick={() => changeMonth(-1)} style={styles.navBtn}>‹</button>
          <div style={styles.monthTitle}>{MONTH_NAMES[cursor.getMonth()]} <span style={styles.year}>{cursor.getFullYear()}</span></div>
          <button aria-label="Next month" onClick={() => changeMonth(1)} style={styles.navBtn}>›</button>
        </div>
      </header>

      <div style={styles.tabRow}>
        {[["log", "LOG"], ["exercises", "EXERCISES"]].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            style={{
              ...styles.tabBtn,
              color: activeTab === id ? ink : inkFaint,
              borderBottomColor: activeTab === id ? ink : "transparent",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "exercises" ? (
        <ExerciseLibrary exercises={fullExercises} loading={exercisesLoading} onPick={pickFromLibrary} />
      ) : (
      <>
      <div style={styles.dowRow}>
        {DOW.map((d, i) => <div key={i} style={styles.dowCell}>{d}</div>)}
      </div>

      <div style={styles.grid}>
        {grid.map((day, i) => {
          if (!day) return <div key={i} style={styles.emptyCell} />;
          const data = monthData[day] || { strength: [], cardio: [] };
          const vol = strengthVolume(data.strength);
          const dur = cardioDuration(data.cardio);
          const isSelected = day === selected;
          const isToday = isSameMonth(cursor) && day === todayDayNum();
          return (
            <button
              key={i}
              onClick={() => setSelected(day)}
              style={{
                ...styles.dayCell,
                ...(isSelected ? styles.dayCellSelected : {}),
                ...(isToday && !isSelected ? styles.dayCellToday : {}),
              }}
            >
              <span style={styles.dayNum}>{String(Number(day))}</span>
              <span style={styles.barTrack}>
                <span className="ft-bar" style={{ ...styles.bar, background: "#B5551F", height: `${Math.round((vol / maxVol) * 100)}%` }} />
                <span className="ft-bar" style={{ ...styles.bar, background: "#1F6E64", height: `${Math.round((dur / maxDur) * 100)}%` }} />
              </span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div style={styles.loading}>Loading ledger…</div>
      ) : (
        <>
          <div style={styles.selectedHeader}>
            <span>{selectedLabel()}</span>
            {saveError && <span style={styles.errorTag}>Not saved — try again</span>}
          </div>

          <div className="ft-sections" style={styles.sections}>
            <Section
              className="ft-section"
              sectionType="strength"
              prefill={prefill}
              accent="#B5551F"
              accentSoft="#E0C4AC"
              title="STRENGTH"
              emptyText="No lifts logged for this day."
              addLabel="Log a set"
              fields={[
                { key: "exercise", label: "Exercise", type: "text", placeholder: "Back squat", options: strengthNames, listId: "strength-exercise-list" },
                { key: "sets", label: "Sets", type: "number", placeholder: "3" },
                { key: "reps", label: "Reps", type: "number", placeholder: "5" },
                { key: "weight", label: "Weight (kg)", type: "number", placeholder: "80" },
              ]}
              onAdd={(vals) => addEntry("strength", vals)}
              renderRow={(e) => (
                <>
                  <span style={styles.rowMain}>{e.exercise || "Exercise"}</span>
                  <span style={styles.rowMono}>{e.sets || 0}×{e.reps || 0} @ {e.weight || 0}kg</span>
                </>
              )}
              entries={dayEntries.strength}
              onDelete={(id) => deleteEntry("strength", id)}
              footer={dayEntries.strength && dayEntries.strength.length > 0 ? `Volume: ${strengthVolume(dayEntries.strength).toLocaleString()} kg` : null}
            />
            <Section
              className="ft-section"
              sectionType="cardio"
              prefill={prefill}
              accent="#1F6E64"
              accentSoft="#C3DAD5"
              title="CARDIO"
              emptyText="No sessions logged for this day."
              addLabel="Log a session"
              fields={[
                { key: "activity", label: "Activity", type: "text", placeholder: "Run", options: cardioNames, listId: "cardio-activity-list" },
                { key: "duration", label: "Minutes", type: "number", placeholder: "30" },
                { key: "distance", label: "Distance (mi)", type: "number", placeholder: "3.1" },
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
              footer={dayEntries.cardio && dayEntries.cardio.length > 0 ? `Total time: ${cardioDuration(dayEntries.cardio)} min` : null}
            />
          </div>
        </>
      )}
      </>
      )}
    </div>
  );
}

function DriveStatus() {
  const [st, setSt] = useState({ state: "off" });
  useEffect(() => drive.subscribe(setSt), []);
  if (!drive.driveSupported()) return null;

  const time = st.lastSynced ? st.lastSynced.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  const view = {
    off: { label: "Connect Google Drive", action: drive.connect, hint: "Back up and sync your log" },
    connecting: { label: "Connecting…" },
    syncing: { label: "Syncing…" },
    synced: { label: `Synced ${time}`, action: drive.connect, hint: "Sync now", done: true },
    "needs-auth": { label: "Tap to sync with Drive", action: drive.connect, hint: "Google needs you to sign in again", warn: true },
    error: { label: "Sync failed · retry", action: drive.connect, warn: true },
  }[st.state] || { label: "" };

  return (
    <div style={styles.driveWrap}>
      {view.action ? (
        <button
          onClick={view.action}
          title={view.hint}
          style={{ ...styles.driveBtn, ...(view.warn ? styles.driveBtnWarn : {}), ...(view.done ? styles.driveBtnDone : {}) }}
        >
          <span aria-hidden="true" style={{ ...styles.driveDot, background: view.done ? teal : view.warn ? rust : inkFaint }} />
          {view.label}
        </button>
      ) : (
        <span style={styles.driveBtn} role="status">
          <span aria-hidden="true" style={{ ...styles.driveDot, background: inkFaint }} />
          {view.label}
        </span>
      )}
      {st.state === "synced" && (
        <button onClick={drive.disconnect} style={styles.driveLink} title="Stop syncing. Your log stays in this browser and in Drive.">
          Disconnect
        </button>
      )}
      {st.message && <span style={styles.driveMsg} role="alert">{st.message}</span>}
    </div>
  );
}

function Section({ accent, accentSoft, title, emptyText, addLabel, fields, onAdd, renderRow, entries, onDelete, footer, className, sectionType, prefill }) {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState({});

  useEffect(() => {
    if (prefill && prefill.type === sectionType) {
      setOpen(true);
      setVals({ [fields[0].key]: prefill.value });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  const submit = (e) => {
    e.preventDefault();
    const primary = fields[0].key;
    if (!vals[primary]) return;
    onAdd(vals);
    setVals({});
    setOpen(false);
  };

  return (
    <div className={className} style={{ ...styles.section, borderLeftColor: accent }}>
      <div style={styles.sectionHead}>
        <span style={{ ...styles.sectionTitle, color: accent }}>{title}</span>
        <button
          onClick={() => setOpen((o) => !o)}
          style={{ ...styles.addBtn, borderColor: accent, color: open ? "#F5F1E8" : accent, background: open ? accent : "transparent" }}
        >
          {open ? "Cancel" : "+ Add"}
        </button>
      </div>

      {open && (
        <form onSubmit={submit} style={styles.form}>
          {fields.map((f) => (
            <label key={f.key} style={styles.fieldLabel}>
              {f.label}
              <input
                type={f.type}
                placeholder={f.placeholder}
                value={vals[f.key] || ""}
                onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
                style={styles.input}
                step={f.type === "number" ? "any" : undefined}
                list={f.options ? f.listId : undefined}
                autoComplete="off"
              />
              {f.options && f.options.length > 0 && (
                <datalist id={f.listId}>
                  {f.options.map((name) => <option key={name} value={name} />)}
                </datalist>
              )}
            </label>
          ))}
          <button type="submit" style={{ ...styles.submitBtn, background: accent }}>{addLabel}</button>
        </form>
      )}

      <div style={styles.rows}>
        {(!entries || entries.length === 0) ? (
          <div style={styles.emptyText}>{emptyText}</div>
        ) : (
          entries.map((e) => (
            <div key={e.id} style={{ ...styles.row, background: accentSoft + "40" }}>
              {renderRow(e)}
              <button aria-label="Delete entry" onClick={() => onDelete(e.id)} style={styles.deleteBtn}>×</button>
            </div>
          ))
        )}
      </div>
      {footer && <div style={{ ...styles.footer, color: accent }}>{footer}</div>}
    </div>
  );
}

const RESULT_CAP = 120;

function ExerciseLibrary({ exercises, loading, onPick }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return exercises.filter((e) => {
      const isCardio = e.category === "cardio";
      if (filter === "strength" && isCardio) return false;
      if (filter === "cardio" && !isCardio) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        (e.equipment && e.equipment.toLowerCase().includes(q)) ||
        e.primaryMuscles.some((m) => m.toLowerCase().includes(q))
      );
    });
  }, [exercises, query, filter]);

  const shown = filtered.slice(0, RESULT_CAP);

  return (
    <div style={styles.library}>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search exercises, equipment, or muscle…"
        style={{ ...styles.input, marginBottom: 10 }}
        autoComplete="off"
      />
      <div style={styles.filterRow}>
        {[["all", "All", ink], ["strength", "Strength", "#B5551F"], ["cardio", "Cardio", "#1F6E64"]].map(([id, label, color]) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            style={{
              ...styles.filterChip,
              borderColor: color,
              color: filter === id ? "#F5F1E8" : color,
              background: filter === id ? color : "transparent",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={styles.loading}>Loading exercise library…</div>
      ) : filtered.length === 0 ? (
        <div style={styles.emptyText}>No exercises match that search.</div>
      ) : (
        <>
          <div style={styles.libraryList}>
            {shown.map((e) => {
              const isCardio = e.category === "cardio";
              const accent = isCardio ? "#1F6E64" : "#B5551F";
              const meta = [e.category, e.equipment, e.primaryMuscles[0]].filter(Boolean).join(" · ");
              return (
                <div key={e.name} style={styles.libraryRow}>
                  <div style={styles.libraryRowText}>
                    <span style={styles.rowMain}>{e.name}</span>
                    {meta && <span style={styles.libraryMeta}>{meta}</span>}
                  </div>
                  <button
                    onClick={() => onPick(e)}
                    aria-label={`Log ${e.name}`}
                    style={{ ...styles.libraryAddBtn, borderColor: accent, color: accent }}
                  >
                    +
                  </button>
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

/* ---------- styles ---------- */
const ink = "#23211D";
const inkFaint = "#706B5E";
const paper = "#EDE8DE";
const raised = "#F5F1E8";
const line = "#D9D2C2";
const rust = "#B5551F";
const teal = "#1F6E64";

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
    fontFamily: "'Inter', sans-serif",
    backgroundColor: paper,
    color: ink,
    minHeight: "100vh",
    padding: "20px 16px 40px",
    maxWidth: 640,
    margin: "0 auto",
  },
  header: { marginBottom: 4 },
  eyebrowRow: { display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "4px 12px", marginBottom: 6 },
  driveWrap: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: "4px 10px", marginLeft: "auto" },
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
    paddingTop: 4,
  },
  monthRow: { display: "flex", alignItems: "baseline", justifyContent: "space-between" },
  monthTitle: {
    fontFamily: "'Barlow Condensed', sans-serif",
    fontWeight: 700,
    fontSize: 34,
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
  tabRow: {
    display: "flex",
    gap: 18,
    marginTop: 18,
    borderBottom: `1px solid ${line}`,
  },
  tabBtn: {
    background: "none",
    border: "none",
    borderBottom: "2px solid transparent",
    fontFamily: "'Barlow Condensed', sans-serif",
    fontWeight: 700,
    fontSize: 15,
    letterSpacing: "0.08em",
    padding: "0 2px 8px",
  },
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
  libraryRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: raised,
    border: `1px solid ${line}`,
    borderRadius: 4,
    padding: "9px 10px",
    gap: 8,
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
    background: "#fff",
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
    fontFamily: "'Barlow Condensed', sans-serif",
    fontWeight: 600,
    fontSize: 22,
    letterSpacing: "0.03em",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    borderBottom: `2px solid ${ink}`,
    paddingBottom: 6,
  },
  errorTag: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: "#B5551F",
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
    fontFamily: "'Barlow Condensed', sans-serif",
    fontWeight: 700,
    fontSize: 18,
    letterSpacing: "0.06em",
  },
  addBtn: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    border: "1px solid",
    borderRadius: 3,
    padding: "4px 9px",
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
    fontFamily: "'Inter', sans-serif",
    fontSize: 14,
    padding: "7px 8px",
    border: `1px solid ${line}`,
    borderRadius: 3,
    background: "#fff",
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
    fontFamily: "'Inter', sans-serif",
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
  rowMain: { fontFamily: "'Inter', sans-serif", fontSize: 13.5, fontWeight: 500, flex: 1 },
  rowMono: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: ink },
  deleteBtn: {
    background: "none",
    border: "none",
    fontSize: 16,
    color: inkFaint,
    lineHeight: 1,
    padding: "0 2px",
  },
  footer: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    marginTop: 10,
    paddingTop: 8,
    borderTop: `1px solid ${line}`,
    fontWeight: 500,
  },
};
