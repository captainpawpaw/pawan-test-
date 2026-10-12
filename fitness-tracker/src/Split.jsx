// Choosing a training split, and the day's session from it on the Log tab.
import React, { useState } from "react";
import { C } from "./theme";
import { SPLITS, activeSplit } from "./splits";

const mono = "'IBM Plex Mono', monospace";
const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function SplitSettings({ setting, onSave, onClose }) {
  const cur = activeSplit(setting);
  const [id, setId] = useState(cur.id);
  const [nums, setNums] = useState({ sets: String(cur.sets), reps: String(cur.reps), firstPct: String(cur.firstPct) });
  const [saved, setSaved] = useState(false);
  const pick = (next) => {
    const sp = SPLITS.find((s) => s.id === next);
    setId(next);
    setNums({ sets: String(sp.sets), reps: String(sp.reps), firstPct: String(sp.firstPct) });
    setSaved(false);
  };
  const chosen = SPLITS.find((s) => s.id === id);
  const save = async (ev) => {
    ev.preventDefault();
    const out = { id, ...Object.fromEntries(Object.entries(nums).map(([k, v]) => [k, Number(v) || chosen[k]])) };
    if (await onSave(out)) setSaved(true);
  };
  const num = (key, label, min, max) => (
    <label style={s.numLabel}>
      {label}
      <input type="number" inputMode="numeric" min={min} max={max} value={nums[key]} onChange={(e) => { setNums((n) => ({ ...n, [key]: e.target.value })); setSaved(false); }} style={s.num} />
    </label>
  );
  return (
    <section aria-label="Training split settings" className="ft-card" style={s.card}>
      <div style={s.head}>
        <span style={s.eyebrow}>Training split</span>
        <button type="button" onClick={onClose} style={s.link}>Close</button>
      </div>
      <form onSubmit={save} style={s.stack}>
        <div role="radiogroup" aria-label="Split" style={s.stack}>
          {SPLITS.map((sp) => (
            <label key={sp.id} style={{ ...s.option, ...(sp.id === id ? s.optionOn : {}) }}>
              <input type="radio" name="split" value={sp.id} checked={sp.id === id} onChange={() => pick(sp.id)} style={s.radio} />
              <span>
                <strong>{sp.name}</strong>
                <span style={s.about}>{sp.about}</span>
                {sp.week && <span style={s.week}>{sp.week.map((w, i) => `${DAY_SHORT[i]} ${w || "rest"}`).join(" · ")}</span>}
              </span>
            </label>
          ))}
        </div>
        <div style={s.row}>
          {num("sets", "Sets", 1, 20)}
          {num("reps", "Reps", 1, 100)}
          {num("firstPct", "First set %", 10, 100)}
        </div>
        <div style={s.row}>
          <button type="submit" style={s.primary}>Save</button>
          {saved && <span role="status" style={s.note}>Saved: {chosen.name}, {nums.sets} × {nums.reps}, first set {nums.firstPct}%.</span>}
        </div>
      </form>
    </section>
  );
}

// session: from sessionOn(); undefined = no schedule (nothing shown).
export function DayPlan({ split, session, suggestions, onPick }) {
  if (session === undefined) return null;
  return (
    <div role="note" aria-label="Today's plan" style={s.plan}>
      {session ? (
        <>
          <span><strong>{session.name}</strong>: {session.about} · {split.sets} × {split.reps}, first set {split.firstPct}%</span>
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
  option: { display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 10px", border: `1px solid ${C.line}`, borderRadius: 4, fontSize: 14, cursor: "pointer" },
  optionOn: { borderColor: C.rust, background: C.field },
  radio: { marginTop: 3, accentColor: C.rust },
  about: { display: "block", fontSize: 13, color: C.inkFaint, marginTop: 2 },
  week: { display: "block", fontFamily: mono, fontSize: 11, color: C.inkFaint, marginTop: 4, lineHeight: 1.5 },
  numLabel: { display: "flex", flexDirection: "column", gap: 4, fontFamily: mono, fontSize: 12, color: C.inkFaint },
  num: { fontFamily: C.sans, fontSize: 14, padding: "7px 8px", border: `1px solid ${C.line}`, borderRadius: 3, background: C.field, color: C.ink, width: 80 },
  primary: { fontFamily: mono, fontSize: 12, color: C.onFill, background: C.ink, border: "none", borderRadius: 3, padding: "9px 14px", minHeight: 36 },
  link: { fontFamily: mono, fontSize: 12, color: C.ink, background: "transparent", border: "none", textDecoration: "underline", padding: "6px 0", minHeight: 32 },
  note: { fontSize: 12, color: C.inkFaint },
  plan: { display: "flex", flexDirection: "column", gap: 8, margin: "0 0 12px", padding: "8px 10px", fontSize: 13, lineHeight: 1.45, color: C.ink, background: C.raised, border: `1px solid ${C.line}`, borderLeft: `3px solid ${C.rust}`, borderRadius: 3 },
  chips: { display: "flex", flexWrap: "wrap", gap: 6 },
  chip: { fontFamily: mono, fontSize: 12, color: C.rust, background: "transparent", border: `1px solid ${C.rust}`, borderRadius: 999, padding: "6px 10px", minHeight: 32 },
};
