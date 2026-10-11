import { test } from "node:test";
import assert from "node:assert/strict";
import { adjustScale, bucketize, bucketizeScore, bucketizeWeightReps, scoreSessions, flattenMonths, metricsFor, niceRange, niceTicks, periodStart, DAY } from "../src/progress.js";

const months = {
  "2026-09": {
    "28": { strength: [{ id: "a", exercise: "Back Squat", sets: "4", reps: "6", weight: "100" }, { id: "b", exercise: "Dip", sets: "3", reps: "10", bw: true, weight: "10" }], cardio: [] },
    "30": { strength: [{ id: "c", exercise: "Back Squat", sets: "3", reps: "5", weight: "110" }], cardio: [{ id: "d", activity: "Run", duration: "30", distance: "3" }] },
  },
  "2026-10": { "05": { strength: [{ id: "e", exercise: "Back Squat", sets: "3", reps: "5", weight: "105" }], cardio: [] } },
};
const rows = flattenMonths(months);

test("weeks start on Monday", () => {
  assert.equal(periodStart(new Date(2026, 9, 4), "week").getDate(), 28); // Sun 4 Oct -> Mon 28 Sep
});

test("best weight is the max per period, volume the sum", () => {
  const squat = rows.filter((r) => r.name === "Back Squat");
  const best = bucketize(squat, "best", "week");
  assert.deepEqual(best.map((b) => b.value), [110, 105]);
  const vol = bucketize(squat, "volume", "month");
  assert.deepEqual(vol.map((b) => b.value), [4 * 6 * 100 + 3 * 5 * 110, 3 * 5 * 105]);
});

test("body-weight sets use body weight on that date", () => {
  const dip = rows.filter((r) => r.name === "Dip");
  assert.equal(bucketize(dip, "volume", "day", () => 80)[0].value, 3 * 10 * 90);
  assert.equal(bucketize(dip, "volume", "day", () => null)[0].value, 3 * 10 * 10);
});

test("metrics offered fit the selection", () => {
  assert.deepEqual(metricsFor(rows.filter((r) => r.name === "Back Squat")), ["score", "weightreps", "best", "e1rm", "volume", "reps", "sets"]);
  assert.deepEqual(metricsFor(rows.filter((r) => r.type === "strength")), ["score", "volume", "reps", "sets"]);
  assert.deepEqual(metricsFor(rows.filter((r) => r.name === "Run")), ["minutes", "distance"]);
});

test("scale follows the zoom", () => {
  assert.equal(adjustScale("week", 26 * 7 * DAY, 360), "week");
  assert.equal(adjustScale("week", 10 * DAY, 360), "day");
  assert.equal(adjustScale("day", 400 * DAY, 360), "week");
  assert.equal(adjustScale("week", 5 * 365 * DAY, 360), "month");
  assert.equal(adjustScale("month", 40 * 365 * DAY, 360), "year");
  assert.equal(adjustScale("year", 365 * DAY, 360), "month");
});

test("axis ticks are round", () => {
  assert.deepEqual(niceTicks(121), [0, 50, 100, 150]);
  assert.deepEqual(niceTicks(21792), [0, 10000, 20000, 30000]);
  const r = niceRange(60, 121);
  assert.ok(r[0] <= 60 && r[0] > 0 && r[r.length - 1] >= 121, String(r));
});

test("weight & reps keeps max and min of each per period", () => {
  const squat = rows.filter((r) => r.name === "Back Squat");
  const wk = bucketizeWeightReps(squat, "week");
  assert.deepEqual(wk.map((b) => [b.wMax, b.wMin, b.rMax, b.rMin]), [[110, 100, 6, 5], [105, 105, 5, 5]]);
  const dip = bucketizeWeightReps(rows.filter((r) => r.name === "Dip"), "day", () => 80);
  assert.equal(dip[0].wMax, 90);
});

test("volume uses max weight; min weight only feeds the min line", () => {
  const rs = flattenMonths({ "2026-10": { "06": { strength: [
    { id: "m1", exercise: "Bench", sets: "4", reps: "10", weight: "60", minWeight: "40" },
    { id: "m2", exercise: "Bench", sets: "2", reps: "5", weight: "70" },
  ], cardio: [] } } });
  assert.equal(bucketize(rs, "volume", "day")[0].value, 4 * 10 * 60 + 2 * 5 * 70);
  const wr = bucketizeWeightReps(rs, "day")[0];
  assert.deepEqual([wr.wMax, wr.wMin], [70, 40]);
});

test("Ledger score: 100 at the start, half strength and half work", () => {
  const day = (d, sets, reps, weight) => ({ [d]: { strength: [{ id: d, exercise: "Bench", sets: String(sets), reps: String(reps), weight: String(weight) }], cardio: [] } });
  const rs = flattenMonths({ "2026-09": { ...day("01", 3, 10, 60), ...day("08", 3, 10, 60) }, "2026-10": day("06", 6, 10, 60) });
  const ss = scoreSessions(rs);
  assert.deepEqual(ss.map((s) => Math.round(s.score)), [100, 100, 150]); // same strength, double the work
  const e1 = 60 * (1 + 10 / 30);
  const heavier = flattenMonths({ "2026-09": day("01", 3, 10, 60), "2026-10": day("06", 3, 10, 66) });
  const sc = scoreSessions(heavier)[1].score; // 10% heavier: strength +10%, work +10%
  assert.ok(Math.abs(sc - 110) < 1e-9, String(sc));
  assert.ok(e1 > 0);
});

test("Ledger score: warm-up pattern doesn't matter, only max weight, sets and reps", () => {
  const a = flattenMonths({ "2026-10": { "01": { strength: [{ id: "a", exercise: "Row", sets: "4", reps: "8", weight: "50", minWeight: "25" }], cardio: [] } } });
  const b = flattenMonths({ "2026-10": { "01": { strength: [{ id: "b", exercise: "Row", sets: "4", reps: "8", weight: "50", minWeight: "45" }], cardio: [] } } });
  assert.deepEqual(scoreSessions(a).map((s) => s.work), scoreSessions(b).map((s) => s.work));
});

test("Ledger score: a tag averages its exercises equally", () => {
  const rs = flattenMonths({ "2026-10": {
    "01": { strength: [{ id: "a", exercise: "Squat", sets: "3", reps: "5", weight: "100" }, { id: "b", exercise: "Curl", sets: "3", reps: "10", weight: "10" }], cardio: [] },
    "20": { strength: [{ id: "c", exercise: "Squat", sets: "3", reps: "5", weight: "120" }, { id: "d", exercise: "Curl", sets: "3", reps: "10", weight: "10" }], cardio: [] },
  } });
  const m = bucketizeScore(rs, "month");
  assert.equal(m.length, 1);
  // Squat: 100 then 120 (avg 110); Curl: 100, 100 -> (110 + 100) / 2
  assert.equal(m[0].value, 105);
  assert.equal(m[0].exercises, 2);
});

test("score is offered first for strength", () => {
  assert.equal(metricsFor(rows.filter((r) => r.name === "Back Squat"))[0], "score");
});
