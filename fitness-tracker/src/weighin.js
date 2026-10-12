// Weekly weigh-in: the app asks for your body weight at a day and time you
// choose. Setting (in the profile, so it syncs):
// { on, day: 0-6 (Sunday = 0), time: "HH:MM", since: ms the schedule was set,
//   skipped: ms of the weigh-in passed over, at: ms last changed (for syncing) }

export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const pad2 = (n) => String(n).padStart(2, "0");
export const isoDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function parseTime(time) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || ""));
  const h = m ? Math.min(23, Number(m[1])) : 8, min = m ? Math.min(59, Number(m[2])) : 0;
  return [h, min];
}

// The most recent weigh-in time at or before now (local time).
export function lastWeighIn(setting, now = new Date()) {
  const [h, m] = parseTime(setting.time);
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  d.setDate(d.getDate() - ((d.getDay() - Number(setting.day) + 7) % 7));
  if (d > now) d.setDate(d.getDate() - 7);
  return d;
}

export function nextWeighIn(setting, now = new Date()) {
  const d = lastWeighIn(setting, now);
  d.setDate(d.getDate() + 7);
  return d;
}

// The weigh-in to ask for now, or null: the latest one has passed, it came
// after the reminder was set up, and no weight is logged since that day.
export function weighInDue(setting, weights = [], now = new Date()) {
  if (!setting?.on) return null;
  const due = lastWeighIn(setting, now);
  if (setting.since && due.getTime() < setting.since) return null;
  if (Number(setting.skipped) >= due.getTime()) return null;
  const day = isoDay(due);
  if (weights.some((w) => w.date >= day)) return null;
  return due;
}

export function describeWeighIn(setting) {
  const [h, m] = parseTime(setting.time);
  const d = new Date(2000, 0, 1, h, m);
  return `${DAYS[Number(setting.day)] || DAYS[1]}s at ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

// A repeating calendar event, so the phone reminds you even with the app closed.
export function weighInCalendar(setting, url, now = new Date()) {
  const first = nextWeighIn(setting, now);
  const stamp = (d) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}T${pad2(d.getHours())}${pad2(d.getMinutes())}00`;
  const end = new Date(first.getTime() + 10 * 60000);
  const utc = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Training Ledger//Weigh-in//EN", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:weigh-in-${now.getTime()}@training-ledger`,
    `DTSTAMP:${utc}`,
    `DTSTART:${stamp(first)}`, `DTEND:${stamp(end)}`,
    `RRULE:FREQ=WEEKLY;BYDAY=${["SU", "MO", "TU", "WE", "TH", "FR", "SA"][Number(setting.day)]}`,
    "SUMMARY:Weigh in (Training Ledger)",
    `DESCRIPTION:Log your weight: ${url}`,
    `URL:${url}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Weigh in", "TRIGGER:PT0M", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
}
