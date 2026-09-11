import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const popupHtml = await readFile(new URL("../src/popup.html", import.meta.url), "utf8");
const dom = new JSDOM(popupHtml, { url: "https://extension.test/popup.html" });
globalThis.document = dom.window.document;
globalThis.Option = dom.window.Option;

const settings = {
  provider: "openai",
  endpoint: "https://api.openai.com/v1/audio/speech",
  apiKey: "",
  model: "gpt-4o-mini-tts",
  voice: "coral",
  speed: 1
};
const listeners = [];
globalThis.chrome = {
  permissions: { request: (_permission, callback) => callback(true) },
  runtime: {
    lastError: undefined,
    onMessage: { addListener: (listener) => listeners.push(listener) },
    sendMessage: (message, callback) => {
      if (message.type === "GET_SETTINGS") callback({ ok: true, settings });
      else if (message.type === "GET_WEBSITE_CONTROLS") callback({
        ok: true,
        websiteControls: {
          enabled: false,
          patterns: ["https://blog.haochuanz.net/posts/*"]
        }
      });
      else if (message.type === "GET_PLAYBACK_STATUS") callback({
        ok: true,
        playback: { status: "idle", message: "Save an endpoint, then open an article.", active: false, progress: { current: 0, total: 0 } }
      });
      else callback({ ok: true });
    }
  }
};

await import(`../dist/popup.js?popupTest=${Date.now()}`);

const values = (selector) => [...document.querySelector(selector).options].map((option) => option.value);
assert.deepEqual(values("#provider"), ["kokoro", "cosyvoice", "chatterbox", "higgs", "openai"]);
assert.equal(document.querySelector("#gpt-sovits-settings"), null);
assert.deepEqual(values("#model"), ["gpt-4o-mini-tts", "tts-1", "tts-1-hd", "__custom__"]);
assert.ok(values("#voice").includes("marin"));
assert.ok(values("#voice").includes("cedar"));

document.querySelector("#model").value = "tts-1";
document.querySelector("#model").dispatchEvent(new dom.window.Event("change"));
assert.ok(!values("#voice").includes("marin"));
assert.ok(!values("#voice").includes("cedar"));

document.querySelector("#provider").value = "chatterbox";
document.querySelector("#provider").dispatchEvent(new dom.window.Event("change"));
assert.deepEqual(values("#model"), ["chatterbox", "__custom__"]);
assert.deepEqual(values("#voice"), ["default", "__custom__"]);

document.querySelector("#model").value = "__custom__";
document.querySelector("#model").dispatchEvent(new dom.window.Event("change"));
assert.equal(document.querySelector("#model").value, "__custom__");
assert.equal(document.querySelector("#custom-model-setting").hidden, false);

document.querySelector("#provider").value = "cosyvoice";
document.querySelector("#provider").dispatchEvent(new dom.window.Event("change"));
assert.equal(document.querySelector("#endpoint").value, "http://127.0.0.1:8080/v1/audio/speech");
assert.deepEqual(values("#model"), ["cosyvoice", "__custom__"]);
assert.deepEqual(values("#voice"), ["Chinese Female", "__custom__"]);

document.querySelector("#provider").value = "higgs";
document.querySelector("#provider").dispatchEvent(new dom.window.Event("change"));
assert.equal(document.querySelector("#endpoint").value, "http://127.0.0.1:8000/v1/audio/speech");
assert.equal(document.querySelector("#speech-options").hidden, true);

listeners.forEach((listener) => listener({
  type: "STATUS_UPDATE",
  playback: {
    status: "playing",
    message: "Playing part 2 of 8",
    title: "Test article",
    active: true,
    progress: { current: 2, total: 8 }
  }
}));
assert.equal(document.querySelector("#playback-task").hidden, false);
assert.equal(document.querySelector("#playback-title").textContent, "Test article");
assert.equal(document.querySelector("#playback-progress").value, 2);
assert.equal(document.querySelector("#playback-progress").max, 8);
assert.equal(document.querySelector("#play").textContent, "Pause");
assert.equal(document.querySelector("#play").disabled, false);
assert.equal(document.querySelector("#stop").disabled, false);
assert.equal(document.querySelector("#pause"), null);
assert.equal(document.querySelector("#resume"), null);
assert.equal(document.querySelector("#website-controls-enabled").checked, false);
assert.equal(document.querySelector("#website-patterns").value, "https://blog.haochuanz.net/posts/*");

listeners.forEach((listener) => listener({
  type: "STATUS_UPDATE",
  playback: { status: "paused", message: "Playback paused.", active: true, progress: { current: 2, total: 8 } }
}));
assert.equal(document.querySelector("#play").textContent, "Play");
assert.equal(document.querySelector("#play").disabled, false);

console.log("Popup model, voice, and playback-status tests passed.");
