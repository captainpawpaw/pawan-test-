// "Read with Claude": inside a claude.ai artifact, asks Claude to pull the
// exercises out of a pasted page whose layout the built-in reader can't
// follow. Elsewhere it's unavailable and the button stays hidden.

import { nameKey, tagFromTitle } from "./importParser";

const MAX_CHARS = 100_000;
const CATEGORIES = ["strength", "stretching", "plyometrics", "strongman", "powerlifting", "cardio", "olympic weightlifting"];

let samplePromise = null;
export function getSample() {
  if (!samplePromise) {
    samplePromise = (async () => {
      try {
        if (typeof window === "undefined" || !window.claude?.use) return null;
        return await window.claude.use("sample");
      } catch {
        return null;
      }
    })();
  }
  return samplePromise;
}

export async function getImageLimits() {
  const sample = await getSample();
  if (!sample) return null;
  const caps = await sample.limits().catch(() => null);
  return caps?.images || null;
}

const RULES = `Extract every exercise in its workout plan.

Rules:
- Only real exercises from the plan (skip intro text, tips, FAQs, links, ads).
- "tags": the title of the section the exercise sits under, exactly as the page writes it, e.g. "Day 1: Legs and Abs". If an exercise appears in several sections, list every section title. Add any other labels the page gives it.
- "sets" and "reps" as written (reps may be a range like "6-8", or "20-30 steps", or "30 sec"). Use "" when not given.
- "notes": other prescriptions for it, joined with " · " (e.g. "65-70% 1RM · RPE 8 · rest 2-3 min"). If it differs between sections, put each section's in "plans" instead.
- "category": one of ${CATEGORIES.join(", ")}.
- "equipment": e.g. barbell, dumbbell, cable, machine, kettlebells, bands, body only; "" if unclear.
- "muscles": main muscles worked, lowercase, e.g. ["quadriceps","glutes"].

Reply with only JSON in this shape:
{"exercises":[{"name":"Back Squat","category":"strength","equipment":"barbell","muscles":["quadriceps"],"plans":[{"tag":"Day 1: Legs and Abs","sets":"4","reps":"6-8","notes":"65-70% 1RM · RPE 8 · rest 2-3 min"}],"tags":["Day 1: Legs and Abs"]}],"lastSection":"Day 1: Legs and Abs"}
"lastSection" is the title of the section the page is in at its very end ("" if none).`;

const textPrompt = (pageText) => `You are reading a web page a user pasted into a workout tracker. ${RULES}

The page:
"""
${pageText.slice(0, MAX_CHARS)}
"""`;

const imagePrompt = (count, carry) => `The ${count === 1 ? "image is a screenshot" : `${count} images are screenshots`} of a workout plan (a web page, app or document) that a user wants to import into a workout tracker. ${count > 1 ? "They are consecutive parts of the same page, top to bottom, and may overlap a little; don't list an exercise twice because of an overlap. " : ""}${carry ? `The part before these ended inside the section "${carry}", so exercises at the very top belong to it until a new section title appears. ` : ""}Read the text in the images carefully, including tables. ${RULES}`;

const str = (v) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

// Turns Claude's JSON into exercises shaped like parsePage() output, adding
// to `out` (a Map by name key) so several replies can be combined.
function collect(data, library, out) {
  const list = Array.isArray(data?.exercises) ? data.exercises : Array.isArray(data) ? data : [];
  const byKey = new Map(library.map((e) => [nameKey(e.name), e]));
  for (const raw of list) {
    const name = str(raw?.name).slice(0, 70);
    const key = nameKey(name);
    if (!key) continue;
    const match = byKey.get(key);
    const plans = (Array.isArray(raw.plans) && raw.plans.length ? raw.plans : [{ tag: "", sets: raw.sets, reps: raw.reps, notes: raw.notes }])
      .map((p) => ({
        tag: str(p?.tag) ? tagFromTitle(str(p.tag)) : null,
        sets: str(p?.sets),
        reps: str(p?.reps).replace(/\s*-\s*(?=\d)/, "–"),
        unit: "",
        notes: str(p?.notes),
      }))
      .filter((p) => p.sets || p.reps || p.notes);
    const tags = [...new Set([...(Array.isArray(raw.tags) ? raw.tags : []), ...plans.map((p) => p.tag)].map((t) => tagFromTitle(str(t))).filter(Boolean))];
    const prev = out.get(key);
    if (prev) {
      tags.forEach((t) => prev.tags.includes(t) || prev.tags.push(t));
      for (const pl of plans) {
        if (!prev.plans.some((x) => x.tag === pl.tag && x.sets === pl.sets && x.reps === pl.reps)) prev.plans.push(pl);
      }
      continue;
    }
    out.set(key, {
      key,
      name: match ? match.name : name,
      pageName: name,
      inLibrary: Boolean(match),
      category: match ? match.category : CATEGORIES.includes(str(raw.category).toLowerCase()) ? str(raw.category).toLowerCase() : "strength",
      equipment: match ? match.equipment : str(raw.equipment).toLowerCase() || null,
      primaryMuscles: match ? match.primaryMuscles : (Array.isArray(raw.muscles) ? raw.muscles : []).map((m) => str(m).toLowerCase()).filter(Boolean).slice(0, 3),
      tags,
      plans,
      confident: true,
    });
  }
  return typeof data?.lastSection === "string" ? data.lastSection.trim() : "";
}

export async function readWithClaude(pageText, library, { signal } = {}) {
  const sample = await getSample();
  if (!sample) throw { code: "not_granted", message: "Claude isn't available here." };
  const out = new Map();
  collect(await sample.json(textPrompt(pageText), { signal, modelTier: "default" }), library, out);
  return [...out.values()];
}

/* ---------- screenshots ---------- */
// Claude sees each image at about 1.2 megapixels, so a tall phone screenshot
// would become too small to read. Cut tall images into overlapping pieces.
const PIECE_RATIO = 1.25; // height / width of each piece
const OVERLAP = 0.08;

async function loadImage(file) {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function splitScreenshot(file) {
  const img = await loadImage(file);
  const w = img.width, h = img.height;
  if (!w || !h || h <= w * PIECE_RATIO * 1.15) return [file];
  const pieceH = Math.round(w * PIECE_RATIO);
  const step = Math.round(pieceH * (1 - OVERLAP));
  const pieces = [];
  for (let y = 0; y < h; y += step) {
    const ph = Math.min(pieceH, h - y);
    if (pieces.length && ph < pieceH * 0.25) break; // last sliver is inside the overlap
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = ph;
    canvas.getContext("2d").drawImage(img, 0, y, w, ph, 0, 0, w, ph);
    pieces.push(await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.9)));
    if (y + ph >= h) break;
  }
  return pieces.filter(Boolean);
}

// files: screenshots in page order. onProgress(done, total) after each call.
export async function readScreenshotsWithClaude(files, library, { signal, onProgress } = {}) {
  const sample = await getSample();
  if (!sample) throw { code: "not_granted", message: "Claude isn't available here." };
  const limits = await getImageLimits();
  if (!limits) throw { code: "images_unavailable", message: "Screenshots can't be read here." };
  const pieces = [];
  for (const f of files) pieces.push(...(await splitScreenshot(f)));
  const per = Math.max(1, Math.min(limits.maxCount || 1, 6));
  const total = Math.ceil(pieces.length / per);
  const out = new Map();
  let carry = "";
  for (let i = 0; i < pieces.length; i += per) {
    const batch = pieces.slice(i, i + per);
    const data = await sample.json(imagePrompt(batch.length, carry), { signal, images: batch, modelTier: "default" });
    carry = collect(data, library, out) || carry;
    onProgress?.(i / per + 1, total);
  }
  return [...out.values()];
}
