import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const staticFiles = [
  "manifest.json",
  "offscreen.html",
  "popup.html",
  "popup.css"
];

const extensionEntryPoints = [
  "src/background.ts",
  "src/offscreen.ts",
  "src/tts-request.ts",
  "src/website-bridge.ts",
  "src/popup.ts"
];

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

await Promise.all(
  staticFiles.map((file) => cp(`src/${file}`, `dist/${file}`))
);

await build({
  entryPoints: extensionEntryPoints,
  outdir: "dist",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome114",
  legalComments: "linked"
});

await build({
  entryPoints: ["src/extractor.ts"],
  outfile: "dist/extractor.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome114",
  legalComments: "linked"
});
