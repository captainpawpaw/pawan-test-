// Builds scripts/data/foods-usda.json from the USDA National Nutrient Database for
// Standard Reference, Release 28 (public domain). Takes the release's
// ABBREV.txt and FOOD_DES.txt (e.g. from the fda-nutrient-database npm
// package's data/ folder):
//
//   node scripts/build-foods.mjs path/to/ABBREV.txt path/to/FOOD_DES.txt
//
// Each food: [name, group, kcal, protein, carbs, fat, fibre, sugar, portions]
// per 100 g, with portions as [[grams, "1 large"], ...].

import fs from "node:fs";

const [abbrevPath, desPath] = process.argv.slice(2);
if (!abbrevPath || !desPath) {
  console.error("usage: node scripts/build-foods.mjs ABBREV.txt FOOD_DES.txt");
  process.exit(1);
}

const GROUPS = {
  "0100": "Dairy & egg", "0200": "Spices & herbs", "0400": "Fats & oils", "0500": "Poultry",
  "0600": "Soups & sauces", "0700": "Sausages & deli", "0800": "Breakfast cereals", "0900": "Fruit",
  "1000": "Pork", "1100": "Vegetables", "1200": "Nuts & seeds", "1300": "Beef", "1400": "Drinks",
  "1500": "Fish & shellfish", "1600": "Beans & lentils", "1700": "Lamb, veal & game", "1800": "Baked goods",
  "1900": "Sweets", "2000": "Grains & pasta", "2100": "Fast food", "2200": "Meals & sides",
  "2500": "Snacks", "3600": "Restaurant food",
};

// SR28 text files: fields split by ^, text fields wrapped in ~.
const rows = (path) => fs.readFileSync(path, "latin1").split(/\r?\n/).filter(Boolean)
  .map((l) => l.split("^").map((f) => f.replace(/^~|~$/g, "")));

const des = new Map();
for (const f of rows(desPath)) des.set(f[0], { group: f[1], name: f[2] });

const num = (s) => (s === "" || s == null ? null : Number(s));
const r1 = (n) => (n == null || Number.isNaN(n) ? 0 : Math.round(n * 10) / 10);

const foods = [];
for (const f of rows(abbrevPath)) {
  const d = des.get(f[0]);
  if (!d) continue;
  const group = GROUPS[d.group];
  if (!group) continue; // skips baby foods and a few specialist groups
  const kcal = num(f[3]);
  if (kcal == null) continue;
  const n = f.length;
  const portions = [];
  for (const [g, desc] of [[num(f[n - 5]), f[n - 4]], [num(f[n - 3]), f[n - 2]]]) {
    if (g > 0 && desc) portions.push([r1(g), desc.replace(/\s+/g, " ").trim()]);
  }
  foods.push([d.name, group, Math.round(kcal), r1(num(f[4])), r1(num(f[7])), r1(num(f[5])), r1(num(f[8])), r1(num(f[9])), portions]);
}
foods.sort((a, b) => a[0].localeCompare(b[0]));
fs.writeFileSync(new URL("./data/foods-usda.json", import.meta.url), JSON.stringify({
  source: "USDA National Nutrient Database for Standard Reference, Release 28 (2015). Public domain.",
  fields: ["name", "group", "kcal", "protein", "carbs", "fat", "fibre", "sugar", "portions"],
  foods,
}));
console.log(`wrote ${foods.length} foods`);
