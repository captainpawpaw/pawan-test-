// Entering your body weight in kg, lb, or stones and pounds.
import React from "react";
import { C } from "./theme";
import { BW_UNITS } from "./units";

const mono = "'IBM Plex Mono', monospace";

// value: { main, extra } strings; extra is the pounds in "st & lb".
export function BodyWeightField({ id, unit, onUnit, value, onChange, placeholder, autoFocus }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const input = (k, label, ph, focus) => (
    <span style={s.part}>
      <input
        id={k === "main" ? id : `${id}-lb`}
        aria-label={label}
        type="number"
        inputMode="decimal"
        step="0.1"
        min="0"
        value={value[k] || ""}
        placeholder={ph}
        onChange={set(k)}
        autoFocus={focus}
        style={s.input}
      />
      <span aria-hidden="true" style={s.unit}>{k === "extra" ? "lb" : unit === "st" ? "st" : unit}</span>
    </span>
  );
  return (
    <span style={s.wrap}>
      <span role="group" aria-label="Weight unit" style={s.toggle}>
        {BW_UNITS.map(([u, label], i) => (
          <button
            key={u}
            type="button"
            aria-pressed={unit === u}
            onClick={() => onUnit(u)}
            style={{ ...s.btn, borderRadius: i === 0 ? "3px 0 0 3px" : i === BW_UNITS.length - 1 ? "0 3px 3px 0" : 0, ...(unit === u ? s.btnOn : {}) }}
          >
            {label}
          </button>
        ))}
      </span>
      <span style={s.fields}>
        {unit === "st" ? (
          <>
            {input("main", "Stones", placeholder?.main || "12", autoFocus)}
            {input("extra", "Pounds", placeholder?.extra || "7", false)}
          </>
        ) : input("main", unit === "lb" ? "Weight in pounds" : "Weight in kg", placeholder?.main || (unit === "lb" ? "175" : "78.5"), autoFocus)}
      </span>
    </span>
  );
}

const s = {
  wrap: { display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 8 },
  toggle: { display: "inline-flex" },
  btn: { fontFamily: mono, fontSize: 12, color: C.ink, background: "transparent", border: `1px solid ${C.line}`, marginLeft: -1, padding: "6px 9px", minHeight: 34 },
  btnOn: { background: C.ink, color: C.onFill, borderColor: C.ink },
  fields: { display: "inline-flex", gap: 6 },
  part: { display: "inline-flex", alignItems: "center", gap: 4 },
  input: { fontFamily: C.sans, fontSize: 14, padding: "7px 8px", border: `1px solid ${C.line}`, borderRadius: 3, background: C.field, color: C.ink, width: 72 },
  unit: { fontFamily: mono, fontSize: 12, color: C.inkFaint },
};
