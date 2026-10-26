import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// Files from public/ the app needs to open and work offline. The label
// reader (public/ocr, ~15 MB) is kept the first time it's used instead.
const OFFLINE_PUBLIC = ["exercises.json", "foods-uk.json", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];

// Writes sw.js, the offline worker, listing this build's files.
function offlineWorker() {
  return {
    name: "offline-worker",
    apply: "build",
    enforce: "post",
    generateBundle(_, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith(".map") && f !== "index.html");
      const files = ["./", ...built, ...OFFLINE_PUBLIC];
      // A new version whenever any stored file changes, so phones pick up updates.
      const h = createHash("sha256").update(files.join("\n"));
      for (const f of built) { const o = bundle[f]; h.update(o.type === "chunk" ? o.code : o.source); }
      for (const f of OFFLINE_PUBLIC) h.update(readFileSync(new URL(`./public/${f}`, import.meta.url)));
      const version = h.digest("hex").slice(0, 12);
      const source = readFileSync(new URL("./scripts/sw.template.js", import.meta.url), "utf8")
        .replace("__VERSION__", version)
        .replace("__PRECACHE__", JSON.stringify(files));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({
  plugins: [react(), offlineWorker()],
});
