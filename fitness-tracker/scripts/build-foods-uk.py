# Builds public/foods-uk.json from McCance and Widdowson's Composition of
# Foods Integrated Dataset (CoFID) 2021, the UK national food composition
# data, published by the Office for Health Improvement and Disparities under
# the Open Government Licence v3.0:
# https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid
#
#   pip install openpyxl
#   python3 scripts/build-foods-uk.py path/to/McCance_Widdowsons_..._2021..xlsx
#
# Same shape as public/foods.json: [name, group, kcal, protein, carbs, fat,
# fibre, sugar, portions] per 100 g (CoFID gives drinks per 100 ml).

import json
import pathlib
import sys

import openpyxl

GROUPS = {
    "A": "Cereals & baked goods", "B": "Dairy", "C": "Eggs", "D": "Vegetables", "F": "Fruit",
    "G": "Nuts & seeds", "H": "Herbs & spices", "J": "Fish & shellfish", "M": "Meat & poultry",
    "O": "Fats & oils", "P": "Drinks", "Q": "Alcoholic drinks", "S": "Sugars, sweets & snacks",
    "W": "Soups, sauces & misc",
}


def num(v):
    # "Tr" is a trace; "N" means present but not measured; blank means none.
    if v is None or v in ("", "N"):
        return None
    if v == "Tr":
        return 0.0
    try:
        return float(v)
    except ValueError:
        return None


def r1(n):
    return 0 if n is None else round(n * 10) / 10


def main(path):
    wb = openpyxl.load_workbook(path, read_only=True)
    rows = list(wb["1.3 Proximates"].iter_rows(values_only=True))
    head = list(rows[0])
    col = {name: head.index(name) for name in head if name}
    foods = []
    for r in rows[3:]:
        code, name, group = r[col["Food Code"]], r[col["Food Name"]], r[col["Group"]]
        if not code or not name or not group:
            continue
        kcal = num(r[col["Energy (kcal) (kcal)"]])
        if kcal is None:
            continue
        fibre = num(r[col["AOAC fibre (g)"]])
        if fibre is None:
            fibre = num(r[col["NSP (g)"]])
        foods.append([
            " ".join(str(name).split()),
            GROUPS.get(str(group)[0], "Other"),
            round(kcal),
            r1(num(r[col["Protein (g)"]])),
            r1(num(r[col["Carbohydrate (g)"]])),
            r1(num(r[col["Fat (g)"]])),
            r1(fibre),
            r1(num(r[col["Total sugars (g)"]])),
            [],
        ])
    foods.sort(key=lambda f: f[0].lower())
    out = pathlib.Path(__file__).resolve().parent.parent / "public" / "foods-uk.json"
    out.write_text(json.dumps({
        "source": "McCance and Widdowson's The Composition of Foods Integrated Dataset 2021 (CoFID). "
                  "Contains public sector information licensed under the Open Government Licence v3.0.",
        "fields": ["name", "group", "kcal", "protein", "carbs", "fat", "fibre", "sugar", "portions"],
        "foods": foods,
    }, separators=(",", ":"), ensure_ascii=False))
    print(f"wrote {len(foods)} foods")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python3 scripts/build-foods-uk.py COFID.xlsx")
    main(sys.argv[1])
