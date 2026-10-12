import { test } from "node:test";
import assert from "node:assert/strict";
import { strengthHistory, lastSession, roundPlate } from "../src/lastTime.js";

const months = {
  "2026-09": { "28": { strength: [{ exercise: "Back Squat", sets: "3", reps: "5", weight: "95" }] } },
  "2026-10": {
    "05": { strength: [
      { exercise: "Back Squat", sets: "2", reps: "8", weight: "80" },
      { exercise: "back squat", sets: "4", reps: "5", weight: "100" },
      { exercise: "Back Squat", sets: "1", reps: "6", weight: "100" },
      { exercise: "Pull-up", sets: "3", reps: "10", weight: "", bw: true },
    ] },
    "12": { strength: [{ exercise: "Back Squat", sets: "5", reps: "5", weight: "105" }, { exercise: "Weighted Dip", sets: "3", reps: "8", weight: "15", bw: true }] },
  },
};
const h = strengthHistory(months);

test("the previous session's top set: heaviest, then most reps", () => {
  assert.deepEqual(lastSession(h, "Back Squat", "2026-10-12"), { date: "2026-10-05", weight: 100, reps: 6, sets: 1, bw: false, warmUp: 70 });
});

test("only sessions before the day being logged count", () => {
  assert.equal(lastSession(h, "Back Squat", "2026-10-13").weight, 105);
  assert.equal(lastSession(h, "Back Squat", "2026-10-05").weight, 95);
  assert.equal(lastSession(h, "Back Squat", "2026-09-28"), null);
  assert.equal(lastSession(h, "Deadlift", "2026-10-12"), null);
});

test("warm-up is 30% lighter, rounded to 2.5 kg; none for body weight alone", () => {
  assert.equal(lastSession(h, "Back Squat", "2026-10-13").warmUp, 72.5); // 73.5
  assert.equal(lastSession(h, "Pull-up", "2026-10-12").warmUp, null);
  assert.equal(lastSession(h, "Weighted Dip", "2026-10-13").warmUp, 10); // 10.5
  assert.equal(roundPlate(61.2), 60);
});
