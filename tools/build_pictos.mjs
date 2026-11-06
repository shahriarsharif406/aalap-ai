// Copies a licensed pictogram subset (Twemoji, CC-BY 4.0) into web/pict.
//   npm i --no-save @twemoji/svg && node tools/build_pictos.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const pkgDir = process.env.TWEMOJI_DIR || path.dirname(require.resolve("@twemoji/svg/package.json", { paths: [process.cwd(), root] }));
const svgDir = fs.existsSync(path.join(pkgDir, "assets", "svg")) ? path.join(pkgDir, "assets", "svg") : pkgDir;
const out = path.join(root, "web", "pict");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "web", "data.js"), "utf8") + ";this.WORDS=WORDS;this.SCENE_EMOJI=SCENE_EMOJI;", ctx);
const cp = (e) => { const a = [...e].map((c) => c.codePointAt(0).toString(16)); return (a.includes("200d") ? a : a.filter((c) => c !== "fe0f")).join("-"); };

const core = new Set([...Object.values(ctx.WORDS).map((w) => cp(w[0])), ...Object.values(ctx.SCENE_EMOJI).map(cp), cp("🎉"), cp("⭐"), cp("🌟"), cp("✨"), cp("🔗"), cp("📷"), cp("🔊"), cp("🎧"), cp("🆘")]);
const files = new Set(fs.readdirSync(svgDir).filter((f) => f.endsWith(".svg")));
let n = 0;
const copy = (name) => { fs.copyFileSync(path.join(svgDir, name), path.join(out, name)); n++; };
// every single-codepoint emoji in the common pictograph ranges (so AI-made boards also get images)
for (const f of files) {
  const id = f.slice(0, -4);
  const single = !id.includes("-");
  const c = parseInt(id.split("-")[0], 16);
  const inRange = (c >= 0x1f300 && c <= 0x1f64f) || (c >= 0x1f680 && c <= 0x1f6ff) || (c >= 0x1f900 && c <= 0x1f9ff) || (c >= 0x2600 && c <= 0x27bf) || (c >= 0x1fa70 && c <= 0x1faff);
  if (core.has(id) || (single && inRange)) copy(f);
}
fs.writeFileSync(path.join(out, "core.json"), JSON.stringify([...core].filter((id) => files.has(id + ".svg"))));
const missing = [...core].filter((id) => !files.has(id + ".svg"));
console.log(`copied ${n} pictograms; missing core: ${missing.join(",") || "none"}`);
