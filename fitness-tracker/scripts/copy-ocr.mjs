// Copies the on-device label reader (Tesseract) into public/ocr, so the
// website serves it itself instead of loading it from a CDN. Runs before
// `vite build` and `vite dev`; public/ocr is not committed.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const out = new URL("../public/ocr/", import.meta.url).pathname;
fs.mkdirSync(out, { recursive: true });

const pkgDir = (name, from = require) => path.dirname(from.resolve(`${name}/package.json`));
// The core must be the version tesseract.js itself depends on.
const fromTesseract = createRequire(path.join(pkgDir("tesseract.js"), "package.json"));
const files = [
  [path.join(pkgDir("tesseract.js"), "dist", "worker.min.js"), "worker.min.js"],
  ...["lstm", "simd-lstm", "relaxedsimd-lstm"].map((v) => [path.join(pkgDir("tesseract.js-core", fromTesseract), `tesseract-core-${v}.wasm.js`), `tesseract-core-${v}.wasm.js`]),
  [path.join(pkgDir("@tesseract.js-data/eng"), "4.0.0_best_int", "eng.traineddata.gz"), "eng.traineddata.gz"],
];
for (const [from, name] of files) {
  const to = path.join(out, name);
  if (!fs.existsSync(to) || fs.statSync(to).size !== fs.statSync(from).size) fs.copyFileSync(from, to);
}
console.log(`label reader copied to public/ocr (${files.length} files)`);
