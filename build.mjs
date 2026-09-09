import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const staticFiles = [
  "manifest.json",
  "background.js",
  "offscreen.html",
  "offscreen.js",
  "tts-request.js",
  "popup.html",
  "popup.css",
  "popup.js"
];

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

await Promise.all(
  staticFiles.map((file) => cp(`src/${file}`, `dist/${file}`))
);

await build({
  entryPoints: ["src/extractor.js"],
  outfile: "dist/extractor.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome114",
  legalComments: "linked"
});
