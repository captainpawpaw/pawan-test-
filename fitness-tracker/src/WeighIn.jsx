// The weekly weigh-in prompt, and where you choose its day and time.
import React, { useState } from "react";
import { C } from "./theme";
import { DAYS, describeWeighIn, weighInCalendar } from "./weighin";

const mono = "'IBM Plex Mono', monospace";

// Asks for this week's weight.
export function WeighInPrompt({ setting, lastKg, onSave, onSkip, onSettings }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const save = async (ev) => {
    ev.preventDefault();
    const kg = Number(value);
    if (!value || !(kg > 20 && kg < 400)) { setError("Enter your weight in kg, e.g. 78.5"); return; }
    if (!(await onSave(Math.round(kg * 10) / 10))) setError("Couldn't save. Try again.");
  };
  return (
    <section aria-label="Weekly weigh-in" className="ft-card" style={s.card}>
      <div style={s.head}>
        <span style={s.eyebrow}>Weekly weigh-in</span>
        <button type="button" onClick={onSettings} style={s.link}>Change time</button>
      </div>
      <p style={s.text}>Time for your weekly weigh-in ({describeWeighIn(setting)}).</p>
      <form onSubmit={save} noValidate style={s.row}>
        <label htmlFor="weighin-kg" style={s.label}>Weight (kg)</label>
        <input
          id="weighin-kg"
          type="number"
          inputMode="decimal"
          step="0.1"
          min="20"
          value={value}
          placeholder={lastKg ? String(lastKg) : "78.5"}
          onChange={(e) => { setValue(e.target.value); setError(""); }}
          style={s.input}
        />
        <button type="submit" style={s.primary}>Save</button>
        <button type="button" onClick={onSkip} style={s.secondary}>Skip this week</button>
      </form>
      {lastKg != null && <p style={s.note}>Last time: {lastKg} kg</p>}
      {error && <p role="alert" style={s.error}>{error}</p>}
    </section>
  );
}

// Choose the day and time, or turn the reminder off.
export function WeighInSettings({ setting, onSave, onClose }) {
  const [on, setOn] = useState(setting?.on ?? true);
  const [day, setDay] = useState(String(setting?.day ?? 1));
  const [time, setTime] = useState(setting?.time || "08:00");
  const [saved, setSaved] = useState(false);
  const draft = { on, day: Number(day), time };
  const save = async (ev) => {
    ev.preventDefault();
    if (await onSave(draft)) { setSaved(true); if (!on) onClose(); }
  };
  const calendarHref = `data:text/calendar;charset=utf-8,${encodeURIComponent(weighInCalendar(draft, window.location.origin + window.location.pathname))}`;
  return (
    <section aria-label="Weekly weigh-in settings" className="ft-card" style={s.card}>
      <div style={s.head}>
        <span style={s.eyebrow}>Weekly weigh-in</span>
        <button type="button" onClick={onClose} style={s.link}>Close</button>
      </div>
      <form onSubmit={save} style={s.stack}>
        <label style={s.check}>
          <input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); setSaved(false); }} />
          Ask me for my weight each week
        </label>
        {on && (
          <div style={s.row}>
            <label htmlFor="weighin-day" style={s.label}>Day</label>
            <select id="weighin-day" value={day} onChange={(e) => { setDay(e.target.value); setSaved(false); }} style={s.input}>
              {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
            <label htmlFor="weighin-time" style={s.label}>Time</label>
            <input id="weighin-time" type="time" value={time} onChange={(e) => { setTime(e.target.value || "08:00"); setSaved(false); }} style={s.input} />
          </div>
        )}
        <div style={s.row}>
          <button type="submit" style={s.primary}>Save</button>
          {saved && on && <span role="status" style={s.note}>Saved. The app will ask {describeWeighIn(draft)}.</span>}
        </div>
      </form>
      {on && (
        <p style={s.note}>
          The app asks when you open it after that time. For a reminder on your phone even when the app is closed,{" "}
          <a href={calendarHref} download="weigh-in.ics" style={s.inlineLink}>add it to your calendar</a>.
        </p>
      )}
    </section>
  );
}

const s = {
  card: { margin: "12px 0 0", padding: "12px 14px", background: C.raised, border: `1px solid ${C.line}`, borderLeft: `3px solid ${C.blue}`, borderRadius: 4, color: C.ink },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
  eyebrow: { fontFamily: mono, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: C.inkFaint },
  text: { margin: "6px 0 8px", fontSize: 14 },
  stack: { display: "flex", flexDirection: "column", gap: 10, marginTop: 8 },
  row: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 },
  label: { fontFamily: mono, fontSize: 12, color: C.inkFaint },
  check: { display: "flex", alignItems: "center", gap: 8, fontSize: 14 },
  input: { fontFamily: C.sans, fontSize: 14, padding: "7px 8px", border: `1px solid ${C.line}`, borderRadius: 3, background: C.field, color: C.ink, minWidth: 90 },
  primary: { fontFamily: mono, fontSize: 12, color: C.onFill, background: C.ink, border: "none", borderRadius: 3, padding: "9px 14px", minHeight: 36 },
  secondary: { fontFamily: mono, fontSize: 12, color: C.ink, background: "transparent", border: `1px solid ${C.line}`, borderRadius: 3, padding: "8px 12px", minHeight: 36 },
  link: { fontFamily: mono, fontSize: 12, color: C.ink, background: "transparent", border: "none", textDecoration: "underline", padding: "6px 0", minHeight: 32 },
  inlineLink: { color: C.ink },
  note: { margin: "6px 0 0", fontSize: 12, color: C.inkFaint },
  error: { margin: "6px 0 0", fontSize: 12, color: C.rust },
};
