import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNutritionText } from "../src/labelParse.js";

test("UK table: per 100 g first, kJ and kcal, of which lines", () => {
  const r = parseNutritionText(`NUTRITION
Typical values Per 100g Per 30g serving %RI*
Energy 1590kJ 477kJ
378kcal 113kcal 6%
Fat 8,0g 2.4g 3%
of which saturates 1.2g 0.4g
Carbohydrate 60.Og 18.0g
of which sugars 21.0g 6.3g 7%
Fibre 8.0g 2.4g
Protein 9.5g 2.9g 6%
Salt 0.60g 0.18g
Reference intake of an average adult (8400kJ/2000kcal)`);
  assert.deepEqual(r.per100, { kcal: 378, protein: 9.5, carbs: 60, fat: 8, fibre: 8, sugar: 21 });
  assert.deepEqual(r.missing, []);
  assert.equal(r.servingG, 30);
  assert.equal(r.basis, "100g");
});

test("serving column first: takes the per 100 g one", () => {
  const r = parseNutritionText(`Per 40g bar | Per 100g
Energy 820kJ/196kcal 2050kJ/490kcal
Fat 9.2g 23g
Carbohydrate 20g 50g
of which sugars 12g 30g
Protein 8g 20g`);
  assert.equal(r.per100.kcal, 490);
  assert.equal(r.per100.fat, 23);
  assert.equal(r.per100.protein, 20);
  assert.deepEqual(r.missing, ["fibre"]);
});

test("US Nutrition Facts: per serving, converted with the serving grams", () => {
  const r = parseNutritionText(`Nutrition Facts
8 servings per container
Serving size 2/3 cup (55g)
Amount per serving
Calories 230
% Daily Value*
Total Fat 8g 10%
Saturated Fat 1g 5%
Total Carbohydrate 37g 13%
Dietary Fiber 4g 14%
Total Sugars 12g
Includes 10g Added Sugars 20%
Protein 3g`);
  assert.equal(r.basis, "serving");
  assert.equal(r.servingG, 55);
  assert.equal(r.per100.kcal, 418);
  assert.equal(r.per100.fat, 14.5);
  assert.equal(r.per100.carbs, 67.3);
  assert.equal(r.per100.sugar, 21.8);
  assert.equal(r.per100.fibre, 7.3);
  assert.equal(r.per100.protein, 5.5);
});

test("missing energy is estimated from the macros; nonsense is dropped", () => {
  const r = parseNutritionText(`per 100g\nFat 10g\nCarbohydrate 20g\nProtein 30g\nFibre 400g`);
  assert.equal(r.per100.kcal, 290);
  assert.equal(r.kcalEstimated, true);
  assert.ok(r.missing.includes("fibre") && r.missing.includes("sugar"));
});

test("trace values and a barcode", () => {
  const r = parseNutritionText(`Per 100ml\nEnergy 180kJ/43kcal\nFat <0.5g\nCarbohydrate 10.6g\nof which sugars 10.6g\nProtein <0.5g\n5000112637922`);
  assert.equal(r.per100.fat, 0);
  assert.equal(r.per100.protein, 0);
  assert.equal(r.barcode, "5000112637922");
});

import fs from "node:fs";
import { parseNutritionWords, massCandidates } from "../src/labelParse.js";
const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url))).map((w) => ({ text: w.t, x0: w.b[0], y0: w.b[1], x1: w.b[2], y1: w.b[3] }));

test("OCR slips in mass values", () => {
  assert.deepEqual(massCandidates("17.09").slice(0, 2), [17, 17.09]);
  assert.equal(massCandidates("10.4g")[0], 10.4);
  assert.equal(massCandidates("19.5¢")[0], 19.5);
  assert.deepEqual(massCandidates("195g"), [195, 19.5]);
  assert.deepEqual(massCandidates("12%"), []);
  assert.deepEqual(massCandidates("441kcal"), []);
});

const LABEL = { kcal: 441, protein: 10.4, carbs: 58, fat: 17, fibre: 7.2, sugar: 19.5 };
test("real reader output, sharp photo: word positions rebuild the table", () => {
  const r = parseNutritionWords(fixture("ocr-label-big.json"));
  assert.deepEqual(r.per100, LABEL);
  assert.equal(r.servingG, 45);
});
test("real reader output, low-res photo: dropped decimals fixed by the serving column", () => {
  const r = parseNutritionWords(fixture("ocr-label-small.json"));
  assert.deepEqual(r.per100, LABEL);
});
