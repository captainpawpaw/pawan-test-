// Reads exercises out of a pasted web page.
//
// A page is first flattened into "blocks" in reading order: headings, table
// header rows, and rows (table rows, list items, or plain lines). Rows are
// then read as exercises. Each one gets its section's title as a tag (for a
// workout plan, the day: "Day 1: Legs and Abs"), plus anything the page says
// about it: sets, reps, rest, RPE, muscles, equipment.
//
// Works on pasted HTML (tables and lists keep their structure) and on plain
// text (tables usually paste as tab-separated lines).

const MAX_NAME = 70;
const MAX_WORDS = 9;

/* ---------- vocabulary ---------- */
const EQUIPMENT = [
  ["e-z curl bar", /\b(e-?z|ez)[ -]?(curl )?bar\b/i],
  ["barbell", /\bbarbell|\bbench press\b|\bback squat|\bfront squat|\bmilitary press|\bskull ?crusher|\bpreacher curl/i],
  ["dumbbell", /\bdumb ?bells?\b|\bdb\b/i],
  ["kettlebells", /\bkettle ?bells?\b|\bkb\b/i],
  ["cable", /\bcables?\b|\bpulldown|\bpushdown|\bface pull|\bwood ?chop/i],
  ["machine", /\bmachine\b|\bleg press\b|\bleg extension|\bhamstring curl|\brower\b|\btreadmill|\bbike\b|\belliptical|\bsmith\b/i],
  ["bands", /\bbands?\b/i],
  ["medicine ball", /\bmedicine ball|\bmed ball/i],
  ["exercise ball", /\b(exercise|stability|swiss) ball/i],
  ["foam roll", /\bfoam roll/i],
  ["body only", /\bpush[- ]?ups?\b|\bpull[- ]?ups?\b|\bchin[- ]?ups?\b|\bsit[- ]?ups?\b|\bplank|\bdips?\b|\bburpee|\bcrunch|\btwist\b|\blunges?\b(?!.*(dumbbell|barbell))/i],
];
const MUSCLES = [
  ["abdominals", /\babs?\b|\babdominals?\b|\bcore\b|\bsit[- ]?ups?\b|\bcrunch|\btwist\b|\bplank|\bwood ?chop/i],
  ["quadriceps", /\bquads?\b|\bquadriceps\b|\bsquat|\bleg press|\bleg extension|\blunges?\b/i],
  ["hamstrings", /\bhamstrings?\b|\bromanian|\brdl\b|\bhamstring curl|\bdeadlift/i],
  ["glutes", /\bglutes?\b|\bhip thrust|\bglute bridge/i],
  ["calves", /\bcalf|\bcalves\b/i],
  ["chest", /\bchest\b|\bpecs?\b|\bbench press|\bflye?s?\b|\bpush[- ]?ups?\b/i],
  ["lats", /\blats?\b|\bpulldown|\bpull[- ]?ups?\b|\bchin[- ]?ups?\b/i],
  ["middle back", /\bupper back|\bmiddle back|\brows?\b(?!er)/i],
  ["lower back", /\blower back|\bback extension|\bhyperextension/i],
  ["traps", /\btraps?\b|\bshrugs?\b/i],
  ["shoulders", /\bshoulders?\b|\bdelts?\b|\bdeltoids?\b|\bmilitary press|\bshoulder press|\blateral raise|\bface pull|\boverhead press/i],
  ["biceps", /\bbiceps?\b|\bcurls?\b(?!.*(leg|hamstring))/i],
  ["triceps", /\btriceps?\b|\bskull ?crusher|\bpushdown|\bdips?\b|\bkickback/i],
  ["forearms", /\bforearms?\b|\bwrist curl|\bfarmer/i],
];
const CARDIO = /\b(run|running|jog|jogging|sprints?|treadmill|rower|rowing|row sprint|bike|cycling|cycle|spin|elliptical|stair|stepper|swim|swimming|jump ?rope|skipping|hiit|intervals?|cardio|walk|walking)\b/i;
const NOT_CARDIO = /\b(lunges?|walking lunge|farmer'?s walk|db row|dumbbell row|barbell row|cable row|seated row|bent[- ]over row|upright row)\b/i;
const CATEGORY_WORDS = ["strength", "stretching", "plyometrics", "strongman", "powerlifting", "cardio", "olympic weightlifting"];

/* ---------- small helpers ---------- */
const squash = (s) => String(s || "").replace(/ /g, " ").replace(/[ \t\f\v]+/g, " ").trim();

// "Wood Chops" and "woodchop", "Sit-Up" and "sit up" all compare equal.
export function nameKey(s) {
  return squash(s)
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("es") && /(ch|sh|ss|x)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join("");
}

// A tidy, readable tag from a section title.
export function tagFromTitle(title) {
  return squash(title)
    .replace(/^#+\s*/, "")
    .replace(/[:\-–—\s]+$/, "")
    .replace(/\s*[–—]\s*/g, " - ")
    .toLowerCase()
    .slice(0, 48)
    .trim();
}

const SETS_REPS = [
  // "4 x 6-8 reps", "4×10", "3 x 20–30 steps"
  /(\d+)\s*(?:sets?\s*)?[x×]\s*(\d+(?:\s*[-–]\s*\d+)?)\s*(reps?|steps|seconds|secs?|s|minutes|mins?|m|rounds?|per side|each side)?/i,
  // "4 sets of 6-8 reps", "3 sets of 12"
  /(\d+)\s*sets?\s*(?:of|x|×)?\s*(\d+(?:\s*[-–]\s*\d+)?)\s*(reps?|steps|seconds|secs?|minutes|mins?|rounds?)?/i,
];
const ROUNDS = /(\d+)\s*(rounds?|intervals?)/i;

function parseSetsReps(text) {
  for (const re of SETS_REPS) {
    const m = text.match(re);
    if (m) return { sets: m[1], reps: m[2].replace(/\s+/g, "").replace("-", "–"), unit: (m[3] || "").toLowerCase(), match: m[0] };
  }
  const r = text.match(ROUNDS);
  if (r) return { sets: r[1], reps: "", unit: r[2].toLowerCase(), match: r[0] };
  return null;
}

const looksLikeSentence = (s) => /[.!?]\s+\S/.test(s) || /[.!?]$/.test(s) && s.split(/\s+/).length > 5;

const HEADING_TEXT = /^(#{1,6}\s*)?(day|week|workout|session|phase|block|training day)\s*[#]?\s*[0-9a-z]{1,3}\b/i;

/* ---------- blocks from HTML ---------- */
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "NAV", "FOOTER", "ASIDE", "FORM", "BUTTON", "SVG", "IFRAME", "SELECT"]);

function textOf(el) {
  return squash(el.textContent || "");
}

function walk(el, out) {
  for (const node of el.childNodes) {
    if (node.nodeType === 3) {
      const t = squash(node.textContent);
      if (t) out.push({ kind: "text", text: t });
      continue;
    }
    if (node.nodeType !== 1) continue;
    const tag = node.tagName;
    if (SKIP.has(tag)) continue;
    if (/^H[1-6]$/.test(tag)) {
      const t = textOf(node);
      if (t) out.push({ kind: "heading", text: t });
    } else if (tag === "TABLE") {
      tableBlocks(node, out);
    } else if (tag === "UL" || tag === "OL") {
      out.push({ kind: "listStart" });
      for (const li of node.children) {
        if (li.tagName !== "LI") continue;
        const clone = li.cloneNode(true);
        clone.querySelectorAll("ul,ol").forEach((n) => n.remove());
        const t = textOf(clone);
        if (t) out.push({ kind: "row", cells: [t], source: "list" });
        li.querySelectorAll(":scope > ul, :scope > ol").forEach((sub) => walk({ childNodes: [sub] }, out));
      }
      out.push({ kind: "listEnd" });
    } else if (tag === "P" || tag === "DT" || tag === "DD" || tag === "LI") {
      const t = textOf(node);
      if (!t) continue;
      const strong = node.querySelector("strong,b");
      const allBold = strong && squash(strong.textContent) === t;
      if ((allBold && t.length <= 80) || (HEADING_TEXT.test(t) && t.length <= 80)) out.push({ kind: "heading", text: t });
      else out.push({ kind: "row", cells: [t], source: "line" });
    } else if (tag === "BR") {
      continue;
    } else {
      walk(node, out);
    }
  }
}

function tableBlocks(table, out) {
  const cap = table.querySelector("caption");
  if (cap && textOf(cap)) out.push({ kind: "heading", text: textOf(cap) });
  out.push({ kind: "tableStart" });
  for (const tr of table.querySelectorAll("tr")) {
    const cells = [...tr.children].filter((c) => c.tagName === "TD" || c.tagName === "TH");
    const texts = cells.map(textOf);
    const filled = texts.filter(Boolean);
    if (!filled.length) continue;
    const allTh = cells.every((c) => c.tagName === "TH");
    if (filled.length === 1 && (texts.length === 1 || cells.some((c) => Number(c.getAttribute("colspan")) > 1) || HEADING_TEXT.test(filled[0]))) {
      out.push({ kind: "heading", text: filled[0] });
    } else if (isHeaderRow(texts) || (allTh && tr.parentElement?.tagName === "THEAD")) {
      out.push({ kind: "header", cells: texts });
    } else {
      out.push({ kind: "row", cells: texts, source: "table" });
    }
  }
  out.push({ kind: "tableEnd" });
}

/* ---------- blocks from plain text ---------- */
function textBlocks(text) {
  const out = [];
  let inTable = false;
  for (const rawLine of String(text).split(/\r?\n/)) {
    if (!rawLine.trim()) { if (inTable) { out.push({ kind: "tableEnd" }); inTable = false; } continue; }
    if (rawLine.includes("\t")) {
      const cells = rawLine.split("\t").map(squash);
      const filled = cells.filter(Boolean);
      if (!inTable) { out.push({ kind: "tableStart" }); inTable = true; }
      if (filled.length === 1 && HEADING_TEXT.test(filled[0])) out.push({ kind: "heading", text: filled[0] });
      else if (isHeaderRow(cells)) out.push({ kind: "header", cells });
      else out.push({ kind: "row", cells, source: "table" });
      continue;
    }
    if (inTable) { out.push({ kind: "tableEnd" }); inTable = false; }
    const line = squash(rawLine);
    const md = line.match(/^#{1,6}\s+(.*)$/);
    if (md) { out.push({ kind: "heading", text: md[1] }); continue; }
    if (HEADING_TEXT.test(line) && line.length <= 80 && !parseSetsReps(line.replace(HEADING_TEXT, ""))) { out.push({ kind: "heading", text: line }); continue; }
    if (/:$/.test(line) && line.length <= 60) { out.push({ kind: "heading", text: line.slice(0, -1) }); continue; }
    const bullet = line.match(/^(?:[-*•▪◦·‣]|\d{1,2}[.)]|[A-Z]\d?[.)])\s+(.*)$/);
    if (bullet) out.push({ kind: "row", cells: [bullet[1]], source: "list" });
    else out.push({ kind: "row", cells: [line], source: "line" });
  }
  if (inTable) out.push({ kind: "tableEnd" });
  return out;
}

/* ---------- header rows ---------- */
const COLUMN_TESTS = [
  ["name", /^(exercises?|movements?|lifts?|exercise name|name|workout|activity)$/i],
  ["day", /^(day|days|session|workout day|split)$/i],
  ["sets", /^(sets?|rounds?)$/i],
  ["reps", /^(reps?|repetitions?|rep range|reps? \/ time|time|duration|distance|reps\/steps)$/i],
  ["load", /(%|1rm|load|intensity|weight)/i],
  ["rpe", /^(rpe|rir|effort)/i],
  ["rest", /^rest/i],
  ["muscles", /(muscles?|target|body ?parts?|focus)/i],
  ["equipment", /^equipment/i],
  ["category", /^(type|category)$/i],
  ["tags", /^(tags?|labels?)$/i],
  ["notes", /^(notes?|tips?|cues?|comments?|tempo)$/i],
];

function columnOf(header) {
  const h = squash(header).replace(/[()]/g, "");
  for (const [col, re] of COLUMN_TESTS) if (re.test(h)) return col;
  return null;
}

function isHeaderRow(cells) {
  const cols = cells.map(columnOf);
  return cols.includes("name") && cols.filter(Boolean).length >= 2;
}

/* ---------- rows to exercises ---------- */
function splitNameDetail(text) {
  // "Back squat: 4 sets of 6-8 reps", "Leg press – 4 x 10-15", "Back squat 4x6"
  const sr = parseSetsReps(text);
  let name = text, detail = "";
  const sep = text.match(/\s*(?::|\s[-–—]\s|\s\|\s)\s*/);
  if (sep && sep.index > 1) {
    name = text.slice(0, sep.index);
    detail = text.slice(sep.index + sep[0].length);
  } else if (sr && text.indexOf(sr.match) > 1) {
    name = text.slice(0, text.indexOf(sr.match));
    detail = text.slice(text.indexOf(sr.match));
  }
  name = squash(name).replace(/^(?:[-*•▪◦·‣]|\d{1,2}[.)]|[A-Z]\d[.)])\s+/, "").replace(/[,;]+$/, "");
  return { name, detail: squash(detail), sr };
}

function guessCategory(name, text) {
  const hay = `${name} ${text}`;
  const word = CATEGORY_WORDS.find((c) => new RegExp(`\\b${c}\\b`, "i").test(text));
  if (word) return word;
  if (CARDIO.test(name) && !NOT_CARDIO.test(name)) return "cardio";
  if (/\bstretch/i.test(hay)) return "stretching";
  if (/\b(jump|box jump|bound|plyo)/i.test(name)) return "plyometrics";
  return "strength";
}

const guessEquipment = (text) => (EQUIPMENT.find(([, re]) => re.test(text)) || [null])[0];
const guessMuscles = (text) => MUSCLES.filter(([, re]) => re.test(text)).map(([m]) => m).slice(0, 2);

function musclesFrom(text) {
  const found = MUSCLES.filter(([m, re]) => re.test(text) || text.toLowerCase().includes(m)).map(([m]) => m);
  return [...new Set(found)];
}

// library: [{ name, category, equipment, primaryMuscles }]
export function parsePage({ html = "", text = "", library = [] } = {}) {
  let blocks;
  if (html && typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    blocks = [];
    walk(doc.body, blocks);
    // Some sites put everything in divs; if that left no structure, fall back to text.
    if (!blocks.some((b) => b.kind === "row" || b.kind === "heading")) blocks = textBlocks(doc.body.innerText || doc.body.textContent || text);
  } else {
    blocks = textBlocks(text);
  }

  const byKey = new Map(library.map((e) => [nameKey(e.name), e]));
  const results = new Map(); // nameKey -> exercise
  let heading = null;
  let header = null;
  let lastDay = null;

  const add = (raw) => {
    const name = squash(raw.name);
    if (!name || name.length > MAX_NAME || name.split(/\s+/).length > MAX_WORDS) return;
    if (!/[a-z]/i.test(name)) return;
    const key = nameKey(name);
    if (!key) return;
    const match = byKey.get(key);
    const tag = raw.tag ? tagFromTitle(raw.tag) : null;
    const confident = raw.fromTable || Boolean(match) || Boolean(raw.sets || raw.reps);
    if (!confident && (looksLikeSentence(name) || raw.source === "line")) return;

    const plan = raw.sets || raw.reps || raw.notes
      ? { tag, sets: raw.sets || "", reps: raw.reps || "", unit: raw.unit || "", notes: raw.notes || "" }
      : null;

    let ex = results.get(key);
    if (!ex) {
      ex = {
        key,
        name: match ? match.name : name.replace(/^\w/, (c) => c.toUpperCase()),
        pageName: name,
        inLibrary: Boolean(match),
        category: raw.category || (match ? match.category : guessCategory(name, raw.all || "")),
        equipment: raw.equipment || (match ? match.equipment : guessEquipment(`${name} ${raw.all || ""}`)),
        primaryMuscles: raw.muscles?.length ? raw.muscles : match ? match.primaryMuscles : guessMuscles(name),
        tags: [],
        plans: [],
        confident,
      };
      results.set(key, ex);
    }
    ex.confident = ex.confident || confident;
    for (const t of [tag, ...(raw.tags || [])].filter(Boolean)) if (!ex.tags.includes(t)) ex.tags.push(t);
    if (plan) ex.plans.push(plan);
  };

  for (const b of blocks) {
    if (b.kind === "heading") { heading = b.text; continue; }
    if (b.kind === "tableStart") { header = null; lastDay = null; continue; }
    if (b.kind === "tableEnd") { header = null; continue; }
    if (b.kind === "header") { header = b.cells.map(columnOf); continue; }
    if (b.kind !== "row") continue;

    const cells = b.cells;
    const all = cells.join(" ");
    const hashtags = (all.match(/#([a-z][\w-]{1,30})/gi) || []).map((h) => h.slice(1).toLowerCase());

    if (header && b.source === "table") {
      // Rows under a merged "day" cell have one cell fewer.
      let row = cells;
      const dayIdx = header.indexOf("day");
      if (dayIdx >= 0 && row.length === header.length - 1) row = [...row.slice(0, dayIdx), lastDay || "", ...row.slice(dayIdx)];
      const get = (col) => {
        const i = header.indexOf(col);
        const v = i >= 0 ? squash(row[i]) : "";
        return /^([–—-]+|n\/?a|none)$/i.test(v) ? "" : v; // "–" means empty
      };
      if (dayIdx >= 0 && get("day")) lastDay = get("day");
      const nameCell = get("name") || squash(row[0]);
      const { name } = splitNameDetail(nameCell);
      const sr = parseSetsReps(`${get("sets")} x ${get("reps")}`) || parseSetsReps(all);
      const notes = [
        get("load") && `${get("load")}${/%|rm/i.test(get("load")) ? "" : ""}`,
        get("rpe") && `RPE ${get("rpe").replace(/^rpe\s*/i, "")}`,
        get("rest") && `rest ${get("rest").replace(/^rest\s*/i, "")}`,
        get("notes"),
      ].filter(Boolean).join(" · ");
      const tagCell = get("tags");
      add({
        name,
        tag: (dayIdx >= 0 && (get("day") || lastDay)) || heading,
        tags: [...hashtags, ...(tagCell ? tagCell.split(/[,;]/).map((t) => tagFromTitle(t)).filter(Boolean) : [])],
        sets: get("sets") || sr?.sets || "",
        reps: (get("reps") || sr?.reps || "").replace(/\s*[-–]\s*/, "–"),
        unit: sr?.unit || "",
        notes,
        muscles: get("muscles") ? musclesFrom(get("muscles")) : null,
        equipment: get("equipment") ? get("equipment").toLowerCase() : null,
        category: get("category") ? (CATEGORY_WORDS.find((c) => get("category").toLowerCase().includes(c)) || null) : null,
        all,
        fromTable: true,
        source: "table",
      });
      continue;
    }

    // A row without a header: one exercise per cell-1 text, details after it.
    const first = b.source === "table" ? cells.find(Boolean) || "" : cells[0];
    const rest = b.source === "table" ? cells.slice(cells.indexOf(first) + 1).join(" ") : "";
    const { name, detail, sr } = splitNameDetail(first);
    const srAll = sr || parseSetsReps(rest) || parseSetsReps(detail);
    const restMatch = `${detail} ${rest}`.match(/rest[:\s]*([\d.–\-]+\s*(?:min(?:ute)?s?|sec(?:ond)?s?|s))/i);
    const rpeMatch = `${detail} ${rest}`.match(/rpe[:\s]*([\d.–\-]+)/i);
    const notes = [rpeMatch && `RPE ${rpeMatch[1]}`, restMatch && `rest ${restMatch[1]}`].filter(Boolean).join(" · ");
    add({
      name: name.replace(/#[\w-]+/g, "").trim(),
      tag: heading,
      tags: hashtags,
      sets: srAll?.sets || "",
      reps: srAll?.reps || "",
      unit: srAll?.unit || "",
      notes,
      all,
      fromTable: b.source === "table" && cells.filter(Boolean).length >= 2,
      source: b.source,
    });
  }

  return [...results.values()];
}

// A short line describing a plan, e.g. "4 × 6–8 reps · RPE 8 · rest 2–3 min".
export function planText(p) {
  const sr = p.sets && p.reps ? `${p.sets} × ${p.reps}${p.unit && !/^reps?$/.test(p.unit) ? ` ${p.unit}` : " reps"}` : p.sets ? `${p.sets} ${p.unit || "sets"}` : p.reps || "";
  return [sr, p.notes].filter(Boolean).join(" · ");
}
