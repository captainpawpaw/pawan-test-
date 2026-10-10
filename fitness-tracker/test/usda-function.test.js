import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, mapFood } from "../functions/api/usda.js";

test("maps a FoodData Central food to per-100 g values", () => {
  const f = mapFood({
    fdcId: 1, description: "GREEK YOGURT", brandOwner: "Acme", dataType: "Branded", servingSize: 170, servingSizeUnit: "g",
    foodNutrients: [{ nutrientNumber: "208", value: 59 }, { nutrientNumber: "203", value: 10.3 }, { nutrientNumber: "205", value: 3.6 }, { nutrientNumber: "204", value: 0.4 }],
  });
  assert.equal(f.name, "Greek yogurt (Acme)");
  assert.deepEqual(f.per100, { kcal: 59, protein: 10.3, carbs: 3.6, fat: 0.4, fibre: 0, sugar: 0 });
  assert.deepEqual(f.portions, [{ g: 170, label: "1 serving" }]);
});

test("needs a key, and keeps it out of the response", async () => {
  const noKey = await onRequestGet({ request: new Request("https://x/api/usda?q=egg"), env: {} });
  assert.equal(noKey.status, 503);
  let called = "";
  globalThis.fetch = async (url) => { called = url; return new Response(JSON.stringify({ foods: [{ fdcId: 2, description: "Egg, whole, raw", dataType: "SR Legacy", foodNutrients: [{ nutrientNumber: "208", value: 143 }] }] }), { headers: { "content-type": "application/json" } }); };
  const res = await onRequestGet({ request: new Request("https://x/api/usda?q=egg"), env: { USDA_API_KEY: "SECRET" } });
  const body = await res.text();
  assert.ok(called.includes("api_key=SECRET") && called.includes("query=egg"));
  assert.ok(!body.includes("SECRET"));
  assert.equal(JSON.parse(body).foods[0].per100.kcal, 143);
});
