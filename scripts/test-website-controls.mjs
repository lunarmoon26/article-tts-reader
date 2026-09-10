import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const bridgeDom = new JSDOM("<!doctype html><title>Post</title>", { url: "https://blog.haochuanz.net/posts/test" });
globalThis.window = bridgeDom.window;
globalThis.document = bridgeDom.window.document;
globalThis.CustomEvent = bridgeDom.window.CustomEvent;

const bridgeMessages = [];
const bridgeRuntimeListeners = [];
globalThis.chrome = {
  runtime: {
    onMessage: { addListener: (listener) => bridgeRuntimeListeners.push(listener) },
    sendMessage: async (message) => {
      bridgeMessages.push(message);
      if (message.action === "status") {
        return {
          ok: true,
          playback: {
            status: "error",
            message: "TTS endpoint returned HTTP 500: http://127.0.0.1:5005",
            title: "Current post",
            progress: { current: 2, total: 3 },
            active: false
          }
        };
      }
      return {
        ok: true,
        playback: {
          status: "playing",
          message: "Playing part 2 of 3",
          title: "Current post",
          progress: { current: 2, total: 3 },
          active: true
        }
      };
    }
  }
};

const bridgeEvents = { ready: [], status: [], result: [] };
for (const [name, bucket] of Object.entries(bridgeEvents)) {
  document.addEventListener(`article-tts-reader:${name}`, (event) => bucket.push(event.detail));
}

await import(`../dist/website-bridge.js?bridgeTest=${Date.now()}`);
assert.deepEqual(bridgeEvents.ready, []);

document.dispatchEvent(new CustomEvent("article-tts-reader:request-status", {
  detail: { protocolVersion: 1, requestId: "status-1" }
}));
await tick();
assert.deepEqual(bridgeMessages, [{ type: "WEBSITE_CONTROL", action: "status", pageUrl: "https://blog.haochuanz.net/posts/test" }]);
assert.equal(bridgeEvents.ready.length, 1);
assert.deepEqual(bridgeEvents.status.at(-1), {
  protocolVersion: 1,
  playback: {
    status: "error",
    message: "Reading failed. Check the extension popup.",
    title: "Current post",
    progress: { current: 2, total: 3 },
    active: false
  }
});
assert.deepEqual(bridgeEvents.result.at(-1), { protocolVersion: 1, requestId: "status-1", ok: true });

document.dispatchEvent(new CustomEvent("article-tts-reader:command", {
  detail: { protocolVersion: 1, requestId: "pause-1", action: "pause" }
}));
await tick();
assert.deepEqual(bridgeMessages.at(-1), { type: "WEBSITE_CONTROL", action: "pause", pageUrl: "https://blog.haochuanz.net/posts/test" });
assert.deepEqual(bridgeEvents.result.at(-1), { protocolVersion: 1, requestId: "pause-1", ok: true });

const messageCount = bridgeMessages.length;
document.dispatchEvent(new CustomEvent("article-tts-reader:command", {
  detail: { protocolVersion: 2, requestId: "bad-version", action: "stop" }
}));
document.dispatchEvent(new CustomEvent("article-tts-reader:command", {
  detail: { protocolVersion: 1, requestId: "bad-command", action: "configure" }
}));
await tick();
assert.equal(bridgeMessages.length, messageCount);

bridgeRuntimeListeners[0]({
  type: "WEBSITE_PLAYBACK_STATUS",
  playback: {
    status: "paused",
    message: "Playback paused.",
    title: "Current post",
    progress: { current: 2, total: 3 },
    active: true,
    sourceTabId: 99,
    sessionId: "private"
  }
});
assert.deepEqual(bridgeEvents.status.at(-1), {
  protocolVersion: 1,
  playback: {
    status: "paused",
    message: "Playback paused.",
    title: "Current post",
    progress: { current: 2, total: 3 },
    active: true
  }
});

const backgroundListeners = [];
const popupMessages = [];
const websiteMessages = [];
const offscreenControls = [];
let onTabUpdated;
const tabUrls = new Map();
const bridgeRegistrations = [];
const bridgeUnregistrations = [];
const sessionStorage = {};
const localStorage = {
  websiteControls: {
    enabled: true,
    patterns: ["https://blog.haochuanz.net/posts/*"]
  }
};
const event = { addListener: () => {} };

function storageArea(values) {
  return {
    async get(keys) {
      if (typeof keys === "string") return { [keys]: values[keys] };
      return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [key, values[key] ?? fallback]));
    },
    async set(entries) {
      Object.assign(values, entries);
    },
    async remove(key) {
      delete values[key];
    }
  };
}

globalThis.chrome = {
  contextMenus: {
    removeAll: (callback) => callback(),
    create: () => {},
    onClicked: event
  },
  offscreen: { createDocument: async () => {} },
  permissions: { contains: async () => true },
  runtime: {
    getURL: (path) => `chrome-extension://test/${path}`,
    getContexts: async () => [],
    onInstalled: event,
    onStartup: event,
    onMessage: { addListener: (listener) => backgroundListeners.push(listener) },
    sendMessage: async (message) => {
      if (message.type === "STATUS_UPDATE") popupMessages.push(message);
      if (message.type === "OFFSCREEN_PLAY") return { ok: true, accepted: true };
      if (message.type === "OFFSCREEN_CONTROL") {
        offscreenControls.push(message);
        return { ok: true, handled: true };
      }
      return { ok: true };
    }
  },
  scripting: {
    executeScript: async (options) => options.files ? [] : [{ result: { title: "Tab three post", text: "A readable article." } }],
    registerContentScripts: async (scripts) => bridgeRegistrations.push(scripts),
    unregisterContentScripts: async (details) => bridgeUnregistrations.push(details)
  },
  storage: {
    local: storageArea(localStorage),
    session: storageArea(sessionStorage)
  },
  tabs: {
    onRemoved: event,
    onUpdated: { addListener: (listener) => { onTabUpdated = listener; } },
    get: async (tabId) => ({ id: tabId, url: tabUrls.get(tabId) }),
    sendMessage: async (tabId, message, options) => websiteMessages.push({ tabId, message, options }),
    query: async () => [{ id: 1 }]
  }
};

await import(`../dist/background.js?backgroundTest=${Date.now()}`);
const backgroundListener = backgroundListeners[0];

function websiteRequest(message, tabId, url = "https://blog.haochuanz.net/posts/test", documentId = `document-${tabId}`) {
  tabUrls.set(tabId, url);
  return new Promise((resolve) => {
    backgroundListener({ ...message, ...(message.type === "WEBSITE_CONTROL" ? { pageUrl: url } : {}) }, { tab: { id: tabId }, url, documentId, frameId: 0 }, resolve);
  });
}

sessionStorage.playback = {
  status: "playing",
  message: "Playing part 1 of 2",
  title: "Private title from tab one",
  progress: { current: 1, total: 2 },
  sourceTabId: 1,
  sourceDocumentId: "document-1",
  sourceArticleUrl: "https://blog.haochuanz.net/posts/test",
  sessionId: "tab-one-session",
  active: true
};

assert.deepEqual(await websiteRequest({ type: "WEBSITE_CONTROL", action: "status" }, 2), {
  ok: true,
  playback: {
    status: "idle",
    message: "Ready to read this article.",
    title: "",
    progress: { current: 0, total: 0 },
    active: false
  }
});
assert.equal((await websiteRequest({ type: "WEBSITE_CONTROL", action: "pause" }, 2)).ok, false);
assert.equal((await websiteRequest({ type: "WEBSITE_CONTROL", action: "status" }, 1)).playback.title, "Private title from tab one");
assert.equal((await websiteRequest({ type: "WEBSITE_CONTROL", action: "status" }, 1, undefined, "new-document")).playback.title, "");
assert.equal((await websiteRequest({ type: "WEBSITE_CONTROL", action: "stop" }, 1, undefined, "new-document")).ok, false);
assert.equal((await websiteRequest({ type: "WEBSITE_CONTROL", action: "status" }, 1, "https://example.com/posts/test")).ok, false);

sessionStorage.playback = undefined;
const started = await websiteRequest({ type: "WEBSITE_CONTROL", action: "start" }, 3);
assert.equal(started.ok, true);
assert.equal(started.playback.status, "loading");
assert.equal(sessionStorage.playback.sourceTabId, 3);
assert.equal(websiteMessages.at(-1).tabId, 3);
assert.deepEqual(Object.keys(websiteMessages.at(-1).message.playback).sort(), ["active", "message", "progress", "status", "title"]);

assert.equal((await websiteRequest({ type: "WEBSITE_CONTROL", action: "pause" }, 3)).ok, true);
assert.equal((await websiteRequest({ type: "WEBSITE_CONTROL", action: "resume" }, 3)).ok, true);
assert.equal((await websiteRequest({ type: "WEBSITE_CONTROL", action: "stop" }, 3)).ok, true);
assert.equal(sessionStorage.playback.status, "stopped");

const restarted = await websiteRequest({ type: "WEBSITE_CONTROL", action: "start" }, 3);
await websiteRequest({
  type: "OFFSCREEN_STATUS",
  status: "error",
  message: "TTS endpoint returned HTTP 500: http://127.0.0.1:5005",
  progress: { current: 1, total: 1 },
  title: "Tab three post",
  sessionId: sessionStorage.playback.sessionId
}, 3);
await tick();
assert.equal(restarted.ok, true);
assert.deepEqual(websiteMessages.at(-1), {
  tabId: 3,
  options: { documentId: "document-3" },
  message: {
    type: "WEBSITE_PLAYBACK_STATUS",
    playback: {
      status: "error",
      message: "Reading failed. Check the extension popup.",
      title: "Tab three post",
      progress: { current: 1, total: 1 },
      active: false
    }
  }
});
assert.ok(popupMessages.length > 0);

const configured = await websiteRequest({
  type: "SAVE_WEBSITE_CONTROLS",
  websiteControls: {
    enabled: true,
    patterns: ["https://reader.example/articles/*"]
  }
}, 3);
assert.deepEqual(configured.websiteControls, {
  enabled: true,
  devMode: false,
  patterns: ["https://reader.example/articles/*"]
});
assert.deepEqual(bridgeRegistrations.at(-1), [{
  id: "article-tts-reader-website-bridge",
  matches: ["https://reader.example/*"],
  js: ["website-bridge.js"],
  runAt: "document_start",
  persistAcrossSessions: true
}]);
assert.equal((await websiteRequest({ type: "WEBSITE_CONTROL", action: "status" }, 4, "https://reader.example/articles/test")).ok, true);
assert.equal((await websiteRequest({
  type: "SAVE_WEBSITE_CONTROLS",
  websiteControls: { enabled: true, patterns: ["https://reader.example/*/articles/*"] }
}, 3)).ok, false);
await websiteRequest({ type: "WEBSITE_CONTROL", action: "start" }, 4, "https://reader.example/articles/test");
await tick();

const disabled = await websiteRequest({
  type: "SAVE_WEBSITE_CONTROLS",
  websiteControls: {
    enabled: false,
    patterns: ["https://reader.example/articles/*"]
  }
}, 3);
assert.equal(disabled.bridge.registered, false);
assert.deepEqual(bridgeUnregistrations.at(-1), { ids: ["article-tts-reader-website-bridge"] });
assert.equal((await websiteRequest({ type: "WEBSITE_CONTROL", action: "status" }, 4, "https://reader.example/articles/test")).ok, false);
const notificationsBefore = websiteMessages.length;
await websiteRequest({
  type: "OFFSCREEN_STATUS",
  status: "playing",
  message: "Playing part 1 of 2",
  title: "Private after disable",
  sessionId: sessionStorage.playback.sessionId
}, 4);
await tick();
assert.equal(websiteMessages.length, notificationsBefore);

const devUrl = "http://localhost:3000/posts/test";
assert.equal((await websiteRequest({ type: "WEBSITE_CONTROL", action: "status" }, 5, devUrl)).ok, false);
await websiteRequest({ type: "SAVE_WEBSITE_CONTROLS", websiteControls: {
  enabled: true, devMode: true, patterns: ["https://reader.example/articles/*"]
}}, 3);
assert.ok(bridgeRegistrations.at(-1)[0].matches.includes("http://localhost/*"));
assert.equal((await websiteRequest({ type: "WEBSITE_CONTROL", action: "status" }, 5, devUrl)).ok, true);
for (const url of ["http://localhost:3001/posts/test", "http://localhost:3000/other/test", "http://127.0.0.1:3000/posts/test", "http://example.com/posts/test"]) {
  assert.equal((await websiteRequest({ type: "WEBSITE_CONTROL", action: "status" }, 5, url)).ok, false);
}
await websiteRequest({ type: "SAVE_WEBSITE_CONTROLS", websiteControls: {
  enabled: true, devMode: false, patterns: ["https://reader.example/articles/*"]
}}, 3);
assert.equal((await websiteRequest({ type: "WEBSITE_CONTROL", action: "status" }, 5, devUrl)).ok, false);
assert.ok(!bridgeRegistrations.at(-1)[0].matches.includes("http://localhost/*"));

await websiteRequest({ type: "WEBSITE_CONTROL", action: "start" }, 6, "https://reader.example/articles/one");
const navigatingSession = sessionStorage.playback.sessionId;
assert.equal((await websiteRequest({ type: "WEBSITE_CONTROL", action: "status" }, 6, "https://reader.example/articles/two")).playback.status, "idle");
assert.equal((await websiteRequest({ type: "WEBSITE_CONTROL", action: "pause" }, 6, "https://reader.example/articles/two")).ok, false);
onTabUpdated(6, { url: "https://reader.example/articles/two" });
await tick();
assert.equal(sessionStorage.playback.status, "stopped");
assert.ok(offscreenControls.some((message) => message.action === "stop" && message.sessionId === navigatingSession));

console.log("Website controls protocol tests passed.");
