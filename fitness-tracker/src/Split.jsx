// Choosing a training split, and the day's session from it on the Log tab.
import React, { useState } from "react";
import { C } from "./theme";
import { SPLITS, activeSplit } from "./splits";

const mono = "'IBM Plex Mono', monospace";
const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Fine-tune the chosen split's sets and reps. The split itself, and the
// first-set weight, are chosen in the menu.
export function SplitSettings({ setting, onSave, onClose }) {
  const cur = activeSplit(setting);
  const [nums, setNums] = useState({ sets: String(cur.sets), reps: String(cur.reps) });
  const [saved, setSaved] = useState(false);
  const save = async (ev) => {
    ev.preventDefault();
    const out = { id: cur.id, ...Object.fromEntries(Object.entries(nums).map(([k, v]) => [k, Number(v) || cur[k]])) };
    if (await onSave(out)) setSaved(true);
  };
  const reset = () => { const base = SPLITS.find((x) => x.id === cur.id); setNums({ sets: String(base.sets), reps: String(base.reps) }); setSaved(false); };
  const num = (key, label, min, max) => (
    <label style={s.numLabel}>
      {label}
      <input type="number" inputMode="numeric" min={min} max={max} value={nums[key]} onChange={(e) => { setNums((n) => ({ ...n, [key]: e.target.value })); setSaved(false); }} style={s.num} />
    </label>
  );
  return (
    <section aria-label="Training split settings" className="ft-card" style={s.card}>
      <div style={s.head}>
        <span style={s.eyebrow}>Training split · {cur.name}</span>
        <button type="button" onClick={onClose} style={s.link}>Close</button>
      </div>
      <p style={s.about}>{cur.about}</p>
      {cur.week && <p style={s.week}>{cur.week.map((w, i) => `${DAY_SHORT[i]} ${w || "rest"}`).join(" · ")}</p>}
      <form onSubmit={save} style={s.stack}>
        <div style={s.row}>
          {num("sets", "Sets", 1, 20)}
          {num("reps", "Reps", 1, 100)}
        </div>
        <div style={s.row}>
          <button type="submit" style={s.primary}>Save</button>
          <button type="button" onClick={reset} style={s.link}>Back to {cur.name.split(" ·")[0]}'s numbers</button>
          {saved && <span role="status" style={s.note}>Saved: {nums.sets} × {nums.reps}.</span>}
        </div>
      </form>
      <p style={s.note}>Change the split itself in the menu (☰), under Training split.</p>
    </section>
  );
}

// session: from sessionOn(); undefined = no schedule (nothing shown).
export function DayPlan({ split, firstPct, session, suggestions, onPick }) {
  if (session === undefined) return null;
  return (
    <div role="note" aria-label="Today's plan" style={s.plan}>
      {session ? (
        <>
          <span><strong>{session.name}</strong>: {session.about} · {split.sets} × {split.reps}, first set {firstPct}%</span>
          {suggestions.length > 0 && (
            <span style={s.chips}>
              {suggestions.map((name) => (
                <button key={name} type="button" onClick={() => onPick(name)} style={s.chip}>+ {name}</button>
              ))}
            </span>
          )}
        </>
      ) : (
        <span><strong>Rest day</strong> in your {split.name.split(" ·")[0]} split. Light cardio is fine.</span>
      )}
    </div>
  );
}

const s = {
  card: { margin: "12px 0 0", padding: "12px 14px", background: C.raised, border: `1px solid ${C.line}`, borderLeft: `3px solid ${C.rust}`, borderRadius: 4, color: C.ink },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
  eyebrow: { fontFamily: mono, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: C.inkFaint },
  stack: { display: "flex", flexDirection: "column", gap: 8, marginTop: 8 },
  row: { display: "flex", alignItems: "flex-end", flexWrap: "wrap", gap: 10 },
  about: { margin: "6px 0 0", fontSize: 13, color: C.inkFaint },
  week: { margin: "4px 0 0", fontFamily: mono, fontSize: 11, color: C.inkFaint, lineHeight: 1.5 },
  numLabel: { display: "flex", flexDirection: "column", gap: 4, fontFamily: mono, fontSize: 12, color: C.inkFaint },
  num: { fontFamily: C.sans, fontSize: 14, padding: "7px 8px", border: `1px solid ${C.line}`, borderRadius: 3, background: C.field, color: C.ink, width: 80 },
  primary: { fontFamily: mono, fontSize: 12, color: C.onFill, background: C.ink, border: "none", borderRadius: 3, padding: "9px 14px", minHeight: 36 },
  link: { fontFamily: mono, fontSize: 12, color: C.ink, background: "transparent", border: "none", textDecoration: "underline", padding: "6px 0", minHeight: 32 },
  note: { margin: "8px 0 0", fontSize: 12, color: C.inkFaint },
  plan: { display: "flex", flexDirection: "column", gap: 8, margin: "0 0 12px", padding: "8px 10px", fontSize: 13, lineHeight: 1.45, color: C.ink, background: C.raised, border: `1px solid ${C.line}`, borderLeft: `3px solid ${C.rust}`, borderRadius: 3 },
  chips: { display: "flex", flexWrap: "wrap", gap: 6 },
  chip: { fontFamily: mono, fontSize: 12, color: C.rust, background: "transparent", border: `1px solid ${C.rust}`, borderRadius: 999, padding: "6px 10px", minHeight: 32 },
};
