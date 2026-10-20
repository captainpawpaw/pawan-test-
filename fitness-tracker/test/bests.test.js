import { test } from "node:test";
import assert from "node:assert/strict";
import { strengthHistory } from "../src/lastTime.js";
import { personalBests, newBests, recordIds, bestsList } from "../src/bests.js";
import { nameKey } from "../src/importParser.js";

const months = {
  "2026-10": {
    "01": { strength: [{ id: "a", exercise: "Back Squat", sets: "3", reps: "8", weight: "100" }, { id: "p1", exercise: "Pull-up", sets: "3", reps: "8", weight: "", bw: true }] },
    "05": { strength: [{ id: "b", exercise: "back squat", sets: "3", reps: "12", weight: "80" }, { id: "c", exercise: "Back Squat", sets: "1", reps: "5", weight: "110" }] },
    "08": { strength: [{ id: "d", exercise: "Back Squat", sets: "1", reps: "5", weight: "110" }, { id: "p2", exercise: "Pull-up", sets: "3", reps: "6", weight: "10", bw: true }] },
  },
};
const bests = personalBests(strengthHistory(months));

test("heaviest weight and most reps, set by the first set that beat them", () => {
  const sq = bests.get(nameKey("Back Squat"));
  assert.deepEqual(sq.weight, { value: 110, reps: 5, bw: false, date: "2026-10-05", id: "c" });
  assert.deepEqual(sq.reps, { value: 12, weight: 80, bw: false, date: "2026-10-05", id: "b" });
});

test("body-weight sets: reps count, and added weight counts as weight", () => {
  const pu = bests.get(nameKey("Pull-up"));
  assert.equal(pu.reps.value, 8);
  assert.equal(pu.weight.value, 10);
  assert.equal(pu.weight.bw, true);
});

test("what a new set beats", () => {
  assert.deepEqual(newBests(bests, { exercise: "Back Squat", weight: "112.5", reps: "3" }), { weight: { value: 112.5, was: 110 }, reps: null });
  assert.deepEqual(newBests(bests, { exercise: "Back Squat", weight: "60", reps: "15" }), { weight: null, reps: { value: 15, was: 12 } });
  assert.equal(newBests(bests, { exercise: "Back Squat", weight: "110", reps: "12" }), null);
  assert.equal(newBests(bests, { exercise: "Deadlift", weight: "200", reps: "1" }), null);
});

test("record holders and the list, latest first", () => {
  assert.deepEqual([...recordIds(bests)].sort(), ["b", "c", "p1", "p2"]);
  assert.deepEqual(bestsList(bests).map((b) => b.name), ["Pull-up", "Back Squat"]);
});
