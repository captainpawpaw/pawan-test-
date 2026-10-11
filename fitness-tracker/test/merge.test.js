import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeBooks, mergeMonth, mergeProfile, mergeTags, mergeTombstones, sameMonth } from "../src/merge.js";

const lift = (id, exercise = "Back Squat") => ({ id, exercise, sets: "3", reps: "5", weight: "80" });
const run = (id) => ({ id, activity: "Run", duration: "30" });

test("combines entries from both copies without duplicates", () => {
  const a = { "01": { strength: [lift("a1")], cardio: [] } };
  const b = { "01": { strength: [lift("a1"), lift("b1")], cardio: [run("b2")] }, "02": { strength: [], cardio: [run("b3")] } };
  const m = mergeMonth(a, b);
  assert.deepEqual(m["01"].strength.map((e) => e.id), ["a1", "b1"]);
  assert.deepEqual(m["01"].cardio.map((e) => e.id), ["b2"]);
  assert.deepEqual(m["02"].cardio.map((e) => e.id), ["b3"]);
});

test("a deletion on either side removes the entry and drops empty days", () => {
  const a = { "01": { strength: [lift("x")], cardio: [] } };
  const m = mergeMonth(a, a, { x: 1 });
  assert.deepEqual(m, {});
});

test("tombstones keep the latest time", () => {
  assert.deepEqual(mergeTombstones({ x: 5, y: 1 }, { x: 3, z: 2 }), { x: 5, y: 1, z: 2 });
});

test("books merge months and deletions from both sides", () => {
  const local = { months: { "2026-09": { "30": { strength: [lift("l1"), lift("gone")], cardio: [] } } }, deleted: {} };
  const remote = { months: { "2026-08": { "15": { strength: [], cardio: [run("r1")] } } }, deleted: { gone: 9 } };
  const m = mergeBooks(local, remote);
  assert.deepEqual(Object.keys(m.months).sort(), ["2026-08", "2026-09"]);
  assert.deepEqual(m.months["2026-09"]["30"].strength.map((e) => e.id), ["l1"]);
  assert.equal(m.deleted.gone, 9);
});

test("merging is order-independent and repeatable", () => {
  const a = { months: { "2026-09": { "01": { strength: [lift("a")], cardio: [] } } }, deleted: { q: 1 } };
  const b = { months: { "2026-09": { "01": { strength: [lift("b"), lift("q")], cardio: [] } } }, deleted: {} };
  const ab = mergeBooks(a, b), ba = mergeBooks(b, a);
  assert.ok(sameMonth(ab.months["2026-09"], ba.months["2026-09"]));
  assert.ok(sameMonth(mergeBooks(ab, b).months["2026-09"], ab.months["2026-09"]));
});

test("sameMonth ignores entry order and empty days", () => {
  const a = { "01": { strength: [lift("1"), lift("2")], cardio: [] }, "02": { strength: [], cardio: [] } };
  const b = { "01": { strength: [lift("2"), lift("1")], cardio: [] } };
  assert.ok(sameMonth(a, b));
  assert.ok(!sameMonth(a, {}));
});

test("tags keep the most recent change per exercise", () => {
  const a = { "Back Squat": { tags: ["legs"], at: 5 }, "Rower": { tags: ["warmup"], at: 1 } };
  const b = { "Back Squat": { tags: ["legs", "monday"], at: 3 }, "Rower": { tags: [], at: 2 }, "Skullcrusher": { tags: ["arms"], at: 1 } };
  const m = mergeTags(a, b);
  assert.deepEqual(m["Back Squat"].tags, ["legs"]);
  assert.deepEqual(m["Rower"].tags, []);
  assert.deepEqual(m["Skullcrusher"].tags, ["arms"]);
  assert.deepEqual(mergeBooks({ tags: a }, { tags: b }).tags, m);
});

test("body weight setting keeps the latest change", () => {
  const a = { bodyweight: { weights: [{ date: "2026-10-01", kg: 80 }], at: 5 } };
  const b = { bodyweight: { weights: [{ date: "2026-10-01", kg: 80 }, { date: "2026-10-09", kg: 79 }], at: 9 } };
  assert.equal(mergeProfile(a, b).bodyweight.weights.length, 2);
  assert.equal(mergeBooks({ profile: b }, { profile: a }).profile.bodyweight.at, 9);
});
