import { test } from "node:test";
import assert from "node:assert/strict";
import { activeSplit, sessionOn, suggestFor } from "../src/splits.js";

const mon = new Date(2026, 9, 12), wed = new Date(2026, 9, 14), sun = new Date(2026, 9, 18);

test("Default: 3 x 10, first set 70%, no schedule", () => {
  const d = activeSplit(undefined);
  assert.deepEqual([d.id, d.sets, d.reps, d.firstPct], ["default", 3, 10, 70]);
  assert.equal(sessionOn(d, mon), undefined);
});

test("your own numbers apply; bad ones fall back to the split's", () => {
  const s = activeSplit({ id: "upper-lower", sets: 5, reps: "12", firstPct: 0 });
  assert.deepEqual([s.sets, s.reps, s.firstPct], [5, 12, 70]);
  assert.equal(activeSplit({ id: "nope" }).id, "default");
});

test("each split's week, Monday first", () => {
  assert.equal(sessionOn(activeSplit({ id: "upper-lower" }), mon).name, "Upper A");
  assert.equal(sessionOn(activeSplit({ id: "upper-lower" }), wed), null);
  assert.equal(sessionOn(activeSplit({ id: "ppl-6" }), wed).name, "Legs");
  assert.equal(sessionOn(activeSplit({ id: "ppl-6" }), sun), null);
  assert.equal(sessionOn(activeSplit({ id: "full-body" }), wed).name, "Full body");
});

test("suggestions: logged exercises for the session's muscles, most logged first", () => {
  const library = [{ name: "Bench", primaryMuscles: ["chest"] }, { name: "Squat", primaryMuscles: ["quadriceps"] }, { name: "Row", primaryMuscles: ["middle back"] }];
  const logged = [["Bench", 2], ["Squat", 5], ["Row", 4], ["Mystery", 9]];
  assert.deepEqual(suggestFor(sessionOn(activeSplit({ id: "ppl-6" }), mon), logged, library), ["Bench"]);
  assert.deepEqual(suggestFor(sessionOn(activeSplit({ id: "upper-lower" }), mon), logged, library), ["Row", "Bench"]);
  assert.deepEqual(suggestFor(sessionOn(activeSplit({ id: "full-body" }), mon), logged, library), ["Mystery", "Squat", "Row", "Bench"]);
});
