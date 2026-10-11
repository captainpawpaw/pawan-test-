import { test } from "node:test";
import assert from "node:assert/strict";
import { measuredDensity, typicalDensity, densityIndex, similarDensity, withSpoons } from "../src/spoons.js";

test("density from a food's own volume measure", () => {
  assert.equal(measuredDensity([{ g: 13.5, label: "1 tbsp" }]), 13.5 / 14.787);
  assert.ok(Math.abs(measuredDensity([{ g: 120, label: "1/2 cup, chopped" }]) - 120 / (0.5 * 236.59)) < 1e-9);
  // a spoon beats a cup
  assert.equal(measuredDensity([{ g: 200, label: "1 cup" }, { g: 14, label: "1 tbsp" }]), 14 / 14.787);
  assert.equal(measuredDensity([{ g: 50, label: "1 large" }]), null);
});

test("every food gets 1 tbsp and 1 tsp", () => {
  const oil = withSpoons({ name: "Oil, olive", portions: [{ g: 13.5, label: "1 tbsp" }] });
  assert.equal(oil.portions.length, 1, "keeps a measured tbsp as it is");
  const honey = withSpoons({ name: "Honey", portions: [{ g: 339, label: "1 cup" }] });
  const tb = honey.portions.find((p) => p.label === "1 tbsp"), ts = honey.portions.find((p) => p.label === "1 tsp");
  assert.ok(!tb.approx && Math.abs(tb.g - 21.5) < 0.1 && Math.abs(ts.g - tb.g / 3) < 0.1, JSON.stringify(honey.portions));
  const sugar = withSpoons({ name: "Sugar, white", portions: [] });
  assert.ok(sugar.portions[0].approx && sugar.portions[0].how === "typical" && sugar.portions[0].g === 12.8);
  assert.equal(typicalDensity("Milk, semi-skimmed"), 1.03);
});

test("UK foods borrow a measured density from a similar USDA food", () => {
  const idx = densityIndex([{ name: "Cheese, cheddar", density: { d: 0.48, how: "measured" } }, { name: "Chicken, breast, roasted", density: { d: 0.59, how: "measured" } }]);
  assert.equal(similarDensity(idx, "Cheese, Cheddar, English"), 0.48);
  assert.equal(similarDensity(idx, "Ackee, canned"), null);
});
