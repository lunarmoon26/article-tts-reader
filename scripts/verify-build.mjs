import { access, readFile } from "node:fs/promises";

const files = [
  "dist/manifest.json",
  "dist/background.js",
  "dist/extractor.js",
  "dist/offscreen.html",
  "dist/offscreen.js",
  "dist/tts-request.js",
  "dist/website-bridge.js",
  "dist/popup.html",
  "dist/popup.css",
  "dist/popup.js"
];

await Promise.all(files.map((file) => access(file)));

const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
if (manifest.manifest_version !== 3 || !manifest.background?.service_worker) {
  throw new Error("dist/manifest.json is not a valid Manifest V3 extension manifest");
}

if (manifest.content_scripts || manifest.host_permissions) {
  throw new Error("Website bridge must be registered only from the user's enabled whitelist");
}

const background = await readFile("dist/background.js", "utf8");
if (!background.includes('"BLOBS"')) {
  throw new Error("Offscreen playback document must retain blob support for long-running TTS generation");
}
if (!background.includes("registerContentScripts") || !background.includes("article-tts-reader-website-bridge")) {
  throw new Error("Website bridge registration was not bundled");
}

const extractor = await readFile("dist/extractor.js", "utf8");
if (!extractor.includes("__articleTtsReaderExtractMainArticle")) {
  throw new Error("Readability extractor was not bundled");
}

console.log("Build verification passed.");
