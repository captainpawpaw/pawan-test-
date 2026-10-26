// Adds a spoon density (g per ml) to each food in public/foods-uk.json,
// borrowed from the closest food in the USDA list that has a measured spoon,
// cup or fl oz weight. The USDA list stays here, out of the app, so the app
// only ships UK data. Run after build-foods-uk.py:
//
//   node scripts/uk-spoons.mjs

import fs from "node:fs";
import { measuredDensity, densityIndex, similarDensity } from "../src/spoons.js";

const ukFile = new URL("../public/foods-uk.json", import.meta.url);
const uk = JSON.parse(fs.readFileSync(ukFile, "utf8"));
const usda = JSON.parse(fs.readFileSync(new URL("./data/foods-usda.json", import.meta.url), "utf8"));

const measured = usda.foods.map(([name, , , , , , , , portions]) => {
  const d = measuredDensity((portions || []).map(([g, label]) => ({ g, label })));
  return { name, density: d ? { d, how: "measured" } : null };
});
const idx = densityIndex(measured);

let found = 0;
uk.foods = uk.foods.map((f) => {
  const d = similarDensity(idx, f[0]);
  if (d) found++;
  return [...f.slice(0, 9), d ? Math.round(d * 100) / 100 : null];
});
uk.fields = ["name", "group", "kcal", "protein", "carbs", "fat", "fibre", "sugar", "portions", "spoon"];
fs.writeFileSync(ukFile, JSON.stringify(uk));
console.log(`${found} of ${uk.foods.length} UK foods have a borrowed spoon density`);
