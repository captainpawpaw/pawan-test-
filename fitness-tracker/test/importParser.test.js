import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parsePage, nameKey, tagFromTitle, planText } from "../src/importParser.js";

const library = JSON.parse(fs.readFileSync(new URL("../public/exercises.json", import.meta.url)));
library.push(
  { name: "Walking Lunges", category: "strength", equipment: "dumbbell", primaryMuscles: ["quadriceps"] },
  { name: "Cable Wood Chops", category: "strength", equipment: "cable", primaryMuscles: ["abdominals"] },
  { name: "Weighted Sit Up", category: "strength", equipment: "plate", primaryMuscles: ["abdominals"] },
);
const text = fs.readFileSync(new URL("./fixtures/fitbod-like.txt", import.meta.url), "utf8");
const byName = (list) => Object.fromEntries(list.map((e) => [e.name, e]));

test("nameKey ignores case, spacing, hyphens and plurals", () => {
  assert.equal(nameKey("Cable Woodchop"), nameKey("Cable Wood Chops"));
  assert.equal(nameKey("Weighted Sit-Up"), nameKey("Weighted Sit Up"));
  assert.equal(nameKey("Walking lunge"), nameKey("Walking Lunges"));
  assert.notEqual(nameKey("Push Press"), nameKey("Push Up"));
});

test("day titles become tags", () => {
  assert.equal(tagFromTitle("Day 1: Legs and Abs"), "day 1: legs and abs");
  assert.equal(tagFromTitle("## Day 2 – Chest, Back, Conditioning"), "day 2 - chest, back, conditioning");
});

test("reads a pasted tab-separated plan: day title tags, sets, reps, notes", () => {
  const out = parsePage({ text, library });
  const ex = byName(out);
  assert.equal(out.length, 15, out.map((e) => e.name).join(", "));
  assert.deepEqual(ex["Back Squat"].tags, ["day 1: legs and abs"]);
  assert.equal(ex["Back Squat"].plans[0].sets, "4");
  assert.equal(ex["Back Squat"].plans[0].reps, "6–8");
  assert.equal(planText(ex["Back Squat"].plans[0]), "4 × 6–8 reps · 65-70% · RPE 8 · rest 2-3 min");
  assert.equal(planText(ex["Leg Press"].plans[0]), "4 × 10–15 reps · RPE 8-9 · rest 2-3 min");
  // matched to existing names
  assert.ok(ex["Walking Lunges"].inLibrary);
  assert.deepEqual(ex["Walking Lunges"].tags, ["day 1: legs and abs", "day 4: legs and abs"]);
  assert.equal(ex["Walking Lunges"].plans.length, 2);
  assert.ok(ex["Cable Wood Chops"]);
  assert.ok(ex["Weighted Sit Up"]);
  assert.deepEqual(ex["Dumbbell Row"]?.tags || ex["Dumbbell Row".toString()]?.tags, ["day 2: chest, back, conditioning"]);
  // cardio and new exercises
  assert.equal(ex["Rower Sprints"].category, "cardio");
  assert.equal(ex["Rower Sprints"].inLibrary, false);
  const dl = ex["Sumo, Trap Bar, or Conventional Deadlift"];
  assert.ok(dl && dl.category === "strength");
  assert.ok(dl.primaryMuscles.includes("hamstrings"));
  // prose is not an exercise
  assert.ok(!out.some((e) => /progress|weight each week|program/i.test(e.name)));
});

test("reads bulleted plans with sets in the text", () => {
  const out = parsePage({
    library,
    text: `Day 3: Shoulders and Arms\n- Seated Barbell Military Press: 4 sets of 6-8 reps, rest 2 min\n- Dumbbell Lateral Raise – 3 x 12-15\n• Skullcrusher 3x10 #arms\n\nWhy this works\nIt trains shoulders twice a week.`,
  });
  const ex = byName(out);
  assert.equal(out.length, 3, out.map((e) => e.name).join(", "));
  const press = Object.values(ex).find((e) => /military press/i.test(e.name));
  assert.equal(press.plans[0].sets, "4");
  assert.match(planText(press.plans[0]), /rest 2 min/);
  const skull = Object.values(ex).find((e) => /skull/i.test(e.name));
  assert.deepEqual(skull.tags.sort(), ["arms", "day 3: shoulders and arms"]);
});
