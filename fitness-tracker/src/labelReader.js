// Reads a packaged food from photos: the front of the pack (for its name) and
// its nutrition label. Inside a claude.ai artifact Claude reads the photos;
// on the website the label is read on the device (Tesseract, served from
// /ocr/), any barcode in the photos is decoded, and Open Food Facts fills in
// the name and anything the label photo missed.

import { parseNutritionText, parseNutritionWords, combineParses } from "./labelParse.js";
import { getSample, getImageLimits } from "./claudeRead";
import { lookupBarcode, onlineLookupsAllowed, NUTRIENTS } from "./food";

const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

/* ---------- images ---------- */
// Phone photos are large; shrink before reading (faster, and within Claude's limits).
// grow: also enlarge small images (up to 2.5x), which helps the text reader.
export async function shrinkImage(file, maxDim = 1800, quality = 0.85, type = "image/jpeg", grow = false) {
  const bmp = await createImageBitmap(file);
  const fit = maxDim / Math.max(bmp.width, bmp.height);
  const s = grow ? Math.min(2.5, fit) : Math.min(1, fit);
  const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise((res) => canvas.toBlob(res, type, quality));
  return new File([blob], (file.name || "photo").replace(/\.\w+$/, "") + ".jpg", { type });
}

// A small square thumbnail (data URL, a few KB) to show beside a saved food.
export async function thumbnail(file, size = 96) {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  canvas.getContext("2d").drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close?.();
  return canvas.toDataURL("image/jpeg", 0.7);
}

/* ---------- barcode in a photo ---------- */
async function barcodeIn(file) {
  try {
    if ("BarcodeDetector" in window) {
      const det = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
      const bmp = await createImageBitmap(file);
      const codes = await det.detect(bmp);
      bmp.close?.();
      if (codes[0]?.rawValue) return codes[0].rawValue;
    }
  } catch { /* fall through to zxing */ }
  const url = URL.createObjectURL(file);
  try {
    const { BrowserMultiFormatReader } = await import("@zxing/browser");
    const result = await new BrowserMultiFormatReader().decodeFromImageUrl(url);
    return result?.getText() || null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------- on-device text reading ---------- */
let workerPromise = null;
let onOcrProgress = null;
function ocrWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const base = new URL(`${import.meta.env.BASE_URL}ocr/`, window.location.href).href;
      const worker = await createWorker("eng", 1, {
        workerPath: `${base}worker.min.js`,
        corePath: base,
        langPath: base.replace(/\/$/, ""),
        logger: (m) => onOcrProgress?.(m),
      });
      // Sparse text: finds every word on a label table, with its position.
      await worker.setParameters({ tessedit_pageseg_mode: "11" });
      return worker;
    })().catch((e) => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

// The biggest line of text on a photo is usually the product name.
function nameFromLines(lines) {
  const cands = (lines || [])
    .map((l) => ({ text: l.text.replace(/[^\p{L}\p{N}&'’ -]/gu, " ").replace(/\s+/g, " ").trim(), h: l.bbox.y1 - l.bbox.y0, conf: l.confidence }))
    .filter((l) => l.text.length >= 3 && /\p{L}{3}/u.test(l.text) && l.conf > 55 && !/nutrition|typical|energy|per 100|ingredients/i.test(l.text));
  cands.sort((a, b) => b.h - a.h);
  return cands[0]?.text ? cands[0].text.replace(/\b\p{L}/gu, (c) => c.toUpperCase()).slice(0, 60) : "";
}

const counted = (r) => Object.keys(r.per100).length;

export async function readLabelOnDevice(files, { onProgress } = {}) {
  onProgress?.({ step: "barcode", progress: 0 });
  let barcode = null;
  for (const f of files) { barcode = await barcodeIn(f); if (barcode) break; }

  const worker = await ocrWorker();
  const reads = [];
  for (let i = 0; i < files.length; i++) {
    onOcrProgress = (m) => {
      if (m.status === "recognizing text") onProgress?.({ step: "read", photo: i + 1, of: files.length, progress: m.progress });
      else onProgress?.({ step: "load", status: m.status, progress: m.progress });
    };
    const img = await shrinkImage(files[i], 2200, 0.92, "image/jpeg", true);
    const { data } = await worker.recognize(img, {}, { text: true, blocks: true });
    const lines = (data.blocks || []).flatMap((b) => (b.paragraphs || []).flatMap((p) => p.lines || []));
    const words = lines.flatMap((l) => l.words || []).map((w) => ({ text: w.text, ...w.bbox }));
    reads.push({ text: data.text || "", lines, parsed: combineParses(parseNutritionWords(words), parseNutritionText(data.text || "")) });
  }
  onOcrProgress = null;

  // The label is the photo the parser got the most out of; the name comes from another one.
  const best = reads.reduce((a, b) => (!a || counted(b.parsed) > counted(a.parsed) ? b : a), null);
  const parsed = best?.parsed || parseNutritionText("");
  const front = reads.filter((r) => r !== best);
  let name = nameFromLines((front[0] || best || {}).lines);
  barcode = barcode || parsed.barcode;

  const out = { name, brand: "", per100: { ...parsed.per100 }, servingG: parsed.servingG, barcode, sources: ["label"], kcalEstimated: parsed.kcalEstimated, text: best?.text || "" };

  // Barcode known: Open Food Facts gives the name, brand and anything the photo missed.
  if (barcode && onlineLookupsAllowed()) {
    onProgress?.({ step: "lookup", progress: 0 });
    try {
      const p = await lookupBarcode(barcode);
      if (p) {
        const m = p.name.match(/^(.*) \(([^)]+)\)$/);
        out.name = (m ? m[1] : p.name) || out.name;
        out.brand = m ? m[2] : "";
        for (const k of NUTRIENTS) if (out.per100[k] == null && p.per100?.[k] != null) out.per100[k] = p.per100[k];
        if (!out.servingG && p.portions?.[0]?.g) out.servingG = p.portions[0].g;
        out.sources.push("off");
        out.kcalEstimated = out.kcalEstimated && !p.per100?.kcal;
      }
    } catch { /* offline: keep what the photo gave */ }
  }
  out.missing = NUTRIENTS.filter((k) => out.per100[k] == null);
  return out;
}

/* ---------- Claude ---------- */
const CLAUDE_RULES = `The photos show a packaged food: the front of the pack and its nutrition information label (maybe also the barcode).
Read them and reply with only JSON in this shape:
{"name":"Product name as on the pack","brand":"Brand or empty","per100":{"kcal":0,"protein":0,"carbs":0,"fat":0,"fibre":0,"sugar":0},"servingGrams":null,"barcode":null,"note":"one short sentence on anything unclear, or empty"}
Rules: per100 values are per 100 g (or 100 ml); if the label only gives values per serving, convert using the serving size. carbs is total carbohydrate, sugar is "of which sugars". Use null for any value the photos don't show. Don't guess values that aren't on the label.`;

export async function claudeLabelAvailable() {
  return Boolean(await getSample());
}

export async function readLabelWithClaude(files, { signal } = {}) {
  const sample = await getSample();
  if (!sample) throw { code: "not_granted" };
  const limits = await getImageLimits();
  const max = Math.max(1, Math.min(4, limits?.maxCount || 1));
  const imgs = [];
  for (const f of files.slice(0, max)) {
    let img = await shrinkImage(f, 1600, 0.85);
    if (limits?.maxInputBytes && img.size > limits.maxInputBytes) img = await shrinkImage(f, 1100, 0.75);
    imgs.push(img);
  }
  const data = await sample.json(CLAUDE_RULES, { signal, images: imgs, modelTier: "default" });
  const per100 = {};
  for (const k of NUTRIENTS) {
    const v = Number(data?.per100?.[k]);
    if (data?.per100?.[k] != null && Number.isFinite(v) && v >= 0) per100[k] = k === "kcal" ? Math.round(v) : r1(v);
  }
  return {
    name: String(data?.name || "").trim().slice(0, 80),
    brand: String(data?.brand || "").trim().slice(0, 60),
    per100,
    servingG: Number(data?.servingGrams) > 0 ? r1(data.servingGrams) : null,
    barcode: /^\d{8,14}$/.test(String(data?.barcode || "")) ? String(data.barcode) : null,
    sources: ["claude"],
    note: typeof data?.note === "string" ? data.note.trim() : "",
    missing: NUTRIENTS.filter((k) => per100[k] == null),
  };
}
