import { access, readFile } from "node:fs/promises";

const files = [
  "dist/manifest.json",
  "dist/background.js",
  "dist/extractor.js",
  "dist/offscreen.html",
  "dist/offscreen.js",
  "dist/tts-request.js",
  "dist/popup.html",
  "dist/popup.css",
  "dist/popup.js"
];

await Promise.all(files.map((file) => access(file)));

const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
if (manifest.manifest_version !== 3 || !manifest.background?.service_worker) {
  throw new Error("dist/manifest.json is not a valid Manifest V3 extension manifest");
}

const extractor = await readFile("dist/extractor.js", "utf8");
if (!extractor.includes("__articleTtsReaderExtractMainArticle")) {
  throw new Error("Readability extractor was not bundled");
}

console.log("Build verification passed.");
