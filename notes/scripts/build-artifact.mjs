// Builds dist-artifact/notes.html: one self-contained page for publishing as a
// claude.ai artifact. React loads from cdnjs (the artifact CSP allows it); the
// app's own JS and CSS are inlined.
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const REACT = "https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js";
const REACT_DOM = "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js";
const FONT = "https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap";

const globals = {
  name: "react-globals",
  setup(b) {
    b.onResolve({ filter: /^react(-dom)?(\/client)?$/ }, (a) => ({ path: a.path, namespace: "global" }));
    b.onLoad({ filter: /.*/, namespace: "global" }, (a) => ({
      contents: `module.exports = window.${a.path.startsWith("react-dom") ? "ReactDOM" : "React"};`,
    }));
  },
};

const result = await build({
  entryPoints: ["src/main.jsx"],
  bundle: true,
  minify: true,
  write: false,
  format: "iife",
  target: "es2020",
  outdir: "out",
  jsx: "transform",
  jsxFactory: "React.createElement",
  jsxFragment: "React.Fragment",
  inject: ["scripts/react-shim.js"],
  plugins: [globals],
  loader: { ".css": "css" },
});

const js = result.outputFiles.find((f) => f.path.endsWith(".js")).text;
const css = result.outputFiles.find((f) => f.path.endsWith(".css")).text;

const html = `<title>Notes</title>
<link rel="stylesheet" href="${FONT}">
<style>${css}</style>
<div id="root"></div>
<script src="${REACT}"></script>
<script src="${REACT_DOM}"></script>
<script>${js.replace(/<\/script/gi, "<\\/script")}</script>
`;

await mkdir("dist-artifact", { recursive: true });
await writeFile("dist-artifact/notes.html", html);
console.log(`dist-artifact/notes.html ${(html.length / 1024).toFixed(1)} kB`);
