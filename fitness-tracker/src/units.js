// Body weight units. Weights are stored in kg; these convert for entry and display.
export const BW_UNITS = [["kg", "kg"], ["lb", "lb"], ["st", "st & lb"]];
const LB = 0.45359237;
const r1 = (n) => Math.round(n * 10) / 10;
const trim = (n) => Number(r1(n)).toLocaleString(undefined, { maximumFractionDigits: 1 });

export const validUnit = (u) => (BW_UNITS.some(([id]) => id === u) ? u : "kg");

// Entry fields -> kg (one decimal), or null if empty/invalid.
export function toKg(unit, main, extra) {
  const a = Number(main), b = Number(extra || 0);
  if (main === "" || main == null || !Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) return null;
  const kg = unit === "lb" ? a * LB : unit === "st" ? (a * 14 + b) * LB : a;
  return kg > 0 ? r1(kg) : null;
}

// kg -> entry fields ({ main, extra } as strings) in a unit.
export function fromKg(kg, unit) {
  if (!(Number(kg) > 0)) return { main: "", extra: "" };
  if (unit === "lb") return { main: String(r1(kg / LB)), extra: "" };
  if (unit === "st") {
    let st = Math.floor(kg / LB / 14), lb = r1(kg / LB - st * 14);
    if (lb >= 14) { st += 1; lb = r1(lb - 14); }
    return { main: String(st), extra: String(lb) };
  }
  return { main: String(r1(kg)), extra: "" };
}

export function bwText(kg, unit) {
  const { main, extra } = fromKg(kg, unit);
  if (!main) return "";
  if (unit === "st") return `${main} st ${trim(Number(extra))} lb`;
  return `${trim(Number(main))} ${unit === "lb" ? "lb" : "kg"}`;
}

// For charts: one number per weight in the unit (stone as a decimal).
export function bwValue(kg, unit) {
  return unit === "lb" ? r1(kg / LB) : unit === "st" ? Math.round((kg / LB / 14) * 100) / 100 : r1(kg);
}
export const bwUnitLabel = (unit) => (unit === "lb" ? "lb" : unit === "st" ? "st" : "kg");

// Lifting weights: kg or lb. Stored in kg; shown and typed in the chosen unit.
export const LIFT_UNITS = [["kg", "kg"], ["lb", "lb"]];
export const validLiftUnit = (u) => (u === "lb" ? "lb" : "kg");
// kg -> the number shown (lb to one decimal; kg as stored, up to two decimals)
export const liftValue = (kg, unit) => (unit === "lb" ? r1(Number(kg) / LB) : Math.round(Number(kg) * 100) / 100);
export const liftText = (kg, unit) => `${Number(liftValue(kg, unit)).toLocaleString(undefined, { maximumFractionDigits: unit === "lb" ? 1 : 2 })} ${unit === "lb" ? "lb" : "kg"}`;
// A typed value -> kg as stored (a string, like the rest of an entry), "" stays "".
export function liftToKg(value, unit) {
  if (value === "" || value == null) return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return unit === "lb" ? String(Math.round(n * LB * 1000) / 1000) : String(value);
}
// kg as stored -> the text in a form field
export const liftField = (kg, unit) => (kg === "" || kg == null ? "" : unit === "lb" ? String(liftValue(kg, unit)) : String(kg));
// A suggested weight rounded to what plates allow: 2.5 kg, or 5 lb.
export const roundLift = (kg, unit) => (unit === "lb" ? Math.max(0, Math.round(kg / LB / 5) * 5) * LB : Math.max(0, Math.round(kg / 2.5) * 2.5));
