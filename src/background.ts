const DEFAULT_SETTINGS = {
  provider: "openai-compatible",
  endpoint: "http://127.0.0.1:8880/v1/audio/speech",
  apiKey: "",
  model: "kokoro",
  voice: "af_bella",
  speed: 1,
  gptSovitsTextLanguage: "en",
  gptSovitsReferenceAudioPath: "",
  gptSovitsReferenceText: "",
  gptSovitsReferenceLanguage: "en"
};

let offscreenCreation;
const pendingReadings = new Map();
const pendingWebsiteDocuments = new Map();
const pendingPlaybackControls = new Map();
let latestReadingSessionId;
let manuallyStoppedSessionId;
let handoffPlayback;
let playbackUpdateQueue: Promise<any> = Promise.resolve();

const DEFAULT_PLAYBACK = {
  status: "idle",
  message: "Save an endpoint, then open an article.",
  title: "",
  progress: { current: 0, total: 0 },
  sourceTabId: undefined,
  sessionId: undefined,
  active: false
};

const ACTIVE_PLAYBACK_STATUSES = new Set(["loading", "playing", "paused"]);
const TERMINAL_PLAYBACK_STATUSES = new Set(["complete", "stopped", "error"]);
const WEBSITE_PLAYBACK_STATUSES = new Set(["idle", "loading", "playing", "paused", "complete", "stopped", "error"]);
const WEBSITE_COMMANDS = new Set(["status", "start", "pause", "resume", "stop"]);
const DEFAULT_WEBSITE_CONTROLS = {
  enabled: false,
  patterns: ["https://blog.haochuanz.net/posts/*"]
};
const WEBSITE_BRIDGE_SCRIPT_ID = "article-tts-reader-website-bridge";
const DEV_WEBSITE_PATTERN = "http://localhost:3000/posts/*";
const DEV_CHROME_PATTERN = "http://localhost/*";
function websitePatterns(controls) {
  return [...controls.patterns, ...(controls.devMode ? [DEV_WEBSITE_PATTERN] : [])];
}
function chromeWebsitePattern(pattern) {
  if (pattern === DEV_WEBSITE_PATTERN) return DEV_CHROME_PATTERN;
  const url = new URL(pattern);
  return `${url.protocol}//${url.hostname}/*`;
}
let websiteBridgeSync: Promise<any> = Promise.resolve();

function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "read-main-article",
      title: "Read main article with Article TTS Reader",
      contexts: ["page"]
    });
    chrome.contextMenus.create({
      id: "read-selection",
      title: "Read selected text with Article TTS Reader",
      contexts: ["selection"]
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  createContextMenus();
  chrome.storage.session.remove("playback");
  restoreWebsiteBridge().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  createContextMenus();
  chrome.storage.session.remove("playback");
  restoreWebsiteBridge().catch(() => {});
});

function normalizeWebsitePattern(value) {
  if (typeof value !== "string") throw new Error("Website patterns must be HTTPS URLs ending in *.");
  const pattern = value.trim();
  let url;
  try {
    url = new URL(pattern);
  } catch {
    throw new Error("Website patterns must be HTTPS URLs ending in *.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.hostname.includes("*") ||
    !url.pathname.endsWith("*") ||
    url.pathname.slice(0, -1).includes("*")
  ) {
    throw new Error("Website patterns must be exact HTTPS host paths ending in *, for example https://example.com/posts/*.");
  }
  return `https://${url.hostname.toLowerCase()}${url.pathname}`;
}

function normalizeWebsiteControls(value) {
  const patterns = [...new Set((Array.isArray(value?.patterns) ? value.patterns : []).map(normalizeWebsitePattern))];
  if (patterns.length === 0) throw new Error("Add at least one website URL pattern.");
  if (patterns.length > 20) throw new Error("Add no more than 20 website URL patterns.");
  return { enabled: Boolean(value?.enabled), patterns, devMode: value?.devMode === true };
}

async function getWebsiteControls() {
  const { websiteControls = DEFAULT_WEBSITE_CONTROLS } = await chrome.storage.local.get({ websiteControls: DEFAULT_WEBSITE_CONTROLS });
  try {
    return normalizeWebsiteControls(websiteControls);
  } catch {
    return DEFAULT_WEBSITE_CONTROLS;
  }
}

async function reconcileWebsiteBridge(controls) {
  await chrome.scripting.unregisterContentScripts({ ids: [WEBSITE_BRIDGE_SCRIPT_ID] }).catch(() => {});
  if (!controls.enabled) return { registered: false };
  const matches = websitePatterns(controls).map(chromeWebsitePattern);
  if (!(await chrome.permissions.contains({ origins: matches }))) {
    return { registered: false, missingPermission: true };
  }
  await chrome.scripting.registerContentScripts([{
    id: WEBSITE_BRIDGE_SCRIPT_ID,
    matches: [...new Set(matches)],
    js: ["website-bridge.js"],
    runAt: "document_start",
    persistAcrossSessions: true
  }]);
  return { registered: true };
}

function syncWebsiteBridge(controls) {
  const operation = websiteBridgeSync.then(() => reconcileWebsiteBridge(controls), () => reconcileWebsiteBridge(controls));
  websiteBridgeSync = operation.catch(() => {});
  return operation;
}

async function restoreWebsiteBridge() {
  return syncWebsiteBridge(await getWebsiteControls());
}

function enqueuePlaybackUpdate(operation) {
  const result = playbackUpdateQueue.then(operation, operation);
  playbackUpdateQueue = result.catch(() => {});
  return result;
}

async function writePlayback(playbackUpdate, expectedSessionId = undefined, ignoreTerminalStatus = false) {
  const { playback: previous = DEFAULT_PLAYBACK } = await chrome.storage.session.get("playback");
  if (expectedSessionId !== undefined && previous.sessionId !== expectedSessionId) return;
  if (ignoreTerminalStatus && TERMINAL_PLAYBACK_STATUSES.has(previous.status)) return;
  const playback = {
    ...DEFAULT_PLAYBACK,
    ...previous,
    ...playbackUpdate,
    progress: playbackUpdate.progress || previous.progress || DEFAULT_PLAYBACK.progress,
    active: ACTIVE_PLAYBACK_STATUSES.has(playbackUpdate.status || previous.status)
  };

  await chrome.storage.session.set({ playback });
  chrome.runtime.sendMessage({ type: "STATUS_UPDATE", playback }).catch(() => {});
  notifyWebsitePlayback(playback).catch(() => {});
  return playback;
}

function websiteIdlePlayback() {
  return {
    status: "idle",
    message: "Ready to read this article.",
    title: "",
    progress: { current: 0, total: 0 },
    active: false
  };
}

function sanitizeWebsitePlayback(playback, tabId, documentId, url) {
  if (
    !playback ||
    playback.sourceTabId !== tabId ||
    !playback.sourceDocumentId ||
    playback.sourceDocumentId !== documentId ||
    playback.sourceArticleUrl !== url
  ) return websiteIdlePlayback();
  const status = WEBSITE_PLAYBACK_STATUSES.has(playback.status) ? playback.status : "error";
  const total = Number.isInteger(playback.progress?.total) && playback.progress.total > 0
    ? playback.progress.total
    : 0;
  const current = total > 0 && Number.isInteger(playback.progress?.current)
    ? Math.min(Math.max(playback.progress.current, 0), total)
    : 0;
  return {
    status,
    message: status === "error"
      ? "Reading failed. Check the extension popup."
      : typeof playback.message === "string" ? playback.message.slice(0, 300) : "",
    title: typeof playback.title === "string" ? playback.title.slice(0, 300) : "",
    progress: { current, total },
    active: Boolean(playback.active)
  };
}

async function notifyWebsitePlayback(playback) {
  if (!Number.isInteger(playback.sourceTabId) || !playback.sourceDocumentId || !playback.sourceWebsitePattern) return;
  const controls = await getWebsiteControls();
  const tab = await chrome.tabs.get(playback.sourceTabId);
  if (
    tab.url !== playback.sourceArticleUrl ||
    !controls.enabled ||
    !websitePatterns(controls).includes(playback.sourceWebsitePattern) ||
    !(await chrome.permissions.contains({ origins: [chromeWebsitePattern(playback.sourceWebsitePattern)] }))
  ) return;
  await chrome.tabs.sendMessage(playback.sourceTabId, {
    type: "WEBSITE_PLAYBACK_STATUS",
    playback: sanitizeWebsitePlayback(playback, playback.sourceTabId, playback.sourceDocumentId, tab.url)
  }, { documentId: playback.sourceDocumentId });
}

function updatePlayback(playbackUpdate) {
  return enqueuePlaybackUpdate(() => writePlayback(playbackUpdate));
}

function updatePlaybackForSession(sessionId, playbackUpdate) {
  return enqueuePlaybackUpdate(() => writePlayback(playbackUpdate, sessionId, true));
}

function beginPlayback(playbackUpdate) {
  return enqueuePlaybackUpdate(async () => {
    const { playback: previousPlayback = DEFAULT_PLAYBACK } = await chrome.storage.session.get("playback");
    if (!handoffPlayback && previousPlayback.active) handoffPlayback = previousPlayback;
    const playback = await writePlayback(playbackUpdate);
    return { previousPlayback, playback };
  });
}

function restorePlayback(sessionId, previousPlayback) {
  return enqueuePlaybackUpdate(async () => {
    if (manuallyStoppedSessionId === sessionId) return;
    const { playback: currentPlayback = DEFAULT_PLAYBACK } = await chrome.storage.session.get("playback");
    if (currentPlayback.sessionId !== sessionId) return;
    const playback = handoffPlayback || previousPlayback;
    handoffPlayback = undefined;
    await chrome.storage.session.set({ playback });
    chrome.runtime.sendMessage({ type: "STATUS_UPDATE", playback }).catch(() => {});
    notifyWebsitePlayback(playback).catch(() => {});
    return playback;
  });
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL("offscreen.html");
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl]
  });

  if (contexts.length > 0) return;

  if (!offscreenCreation) {
    offscreenCreation = chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["AUDIO_PLAYBACK", "BLOBS"],
      justification: "Play neural text-to-speech audio and retain generated audio blobs while the extension popup is closed."
    });
  }

  try {
    await offscreenCreation;
  } finally {
    offscreenCreation = undefined;
  }
}

function endpointOriginPattern(endpoint) {
  const url = new URL(endpoint);
  return `${url.protocol}//${url.host}/*`;
}

async function hasEndpointPermission(endpoint) {
  return chrome.permissions.contains({ origins: [endpointOriginPattern(endpoint)] });
}

async function extractMainArticle(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["extractor.js"]
  });

  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => globalThis.__articleTtsReaderExtractMainArticle()
  });

  return result?.result;
}

function readingCanStart(tabId, sessionId) {
  return pendingReadings.get(tabId) === sessionId && latestReadingSessionId === sessionId;
}

async function reportStartFailure(error) {
  if (error.sessionId === manuallyStoppedSessionId) return;
  if (error.sessionId !== latestReadingSessionId) return;
  await enqueuePlaybackUpdate(async () => {
    const { playback = DEFAULT_PLAYBACK } = await chrome.storage.session.get("playback");
    if (playback.active && playback.sessionId !== error.sessionId) return;
    return writePlayback({ status: "error", message: error.message });
  });
}

async function startReading(tabId, selectedText = "", websiteSource = undefined) {
  const sessionId = crypto.randomUUID();
  latestReadingSessionId = sessionId;
  manuallyStoppedSessionId = undefined;
  pendingReadings.set(tabId, sessionId);
  if (websiteSource?.documentId) pendingWebsiteDocuments.set(sessionId, websiteSource);

  try {
    const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);

    try {
      new URL(settings.endpoint);
    } catch {
      throw new Error("Enter a valid full speech endpoint URL in the extension popup.");
    }

    if (!(await hasEndpointPermission(settings.endpoint))) {
      throw new Error("Save the endpoint in the extension popup and allow access before starting playback.");
    }

    let article;
    if (selectedText.trim()) {
      article = { title: "Selected text", text: selectedText.trim() };
    } else {
      article = await extractMainArticle(tabId);
    }

    if (!article?.text) {
      throw new Error(article?.reason || "Could not identify the page's main article. Select the text you want read instead.");
    }

    if (!readingCanStart(tabId, sessionId)) {
      throw new Error("The source tab changed before playback could start.");
    }

    await ensureOffscreenDocument();
    if (!readingCanStart(tabId, sessionId)) {
      throw new Error("The source tab changed before playback could start.");
    }

    const { previousPlayback } = await beginPlayback({
      status: "loading",
      message: `Preparing “${article.title}”…`,
      title: article.title,
      progress: { current: 0, total: 0 },
      sourceTabId: tabId,
      sourceDocumentId: websiteSource?.documentId,
      sourceWebsitePattern: websiteSource?.pattern,
      sourceArticleUrl: websiteSource?.url,
      sessionId
    });
    if (!readingCanStart(tabId, sessionId)) {
      await restorePlayback(sessionId, previousPlayback);
      throw new Error("The source tab changed before playback could start.");
    }

    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: "OFFSCREEN_PLAY",
        payload: {
          article,
          settings,
          sessionId,
          initiallyPaused: pendingPlaybackControls.get(sessionId) === "pause"
        }
      });
    } catch (error) {
      await restorePlayback(sessionId, previousPlayback);
      throw error;
    }
    if (!response?.accepted) {
      await restorePlayback(sessionId, previousPlayback);
      throw new Error("Playback was cancelled before it could start.");
    }
    if (pendingReadings.get(tabId) === sessionId) pendingReadings.delete(tabId);
    pendingWebsiteDocuments.delete(sessionId);
    pendingPlaybackControls.delete(sessionId);
    if (latestReadingSessionId === sessionId) handoffPlayback = undefined;

    return { title: article.title, characters: article.text.length };
  } catch (error) {
    error.sessionId = sessionId;
    throw error;
  } finally {
    if (pendingReadings.get(tabId) === sessionId) pendingReadings.delete(tabId);
    pendingWebsiteDocuments.delete(sessionId);
    pendingPlaybackControls.delete(sessionId);
  }
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active browser tab found.");
  return tab.id;
}

async function stopReadingForSourceTab(tabId) {
  const pendingSessionId = pendingReadings.get(tabId);
  pendingReadings.delete(tabId);
  if (pendingSessionId) pendingWebsiteDocuments.delete(pendingSessionId);
  const displacedPlayback = handoffPlayback?.active && handoffPlayback.sourceTabId === tabId
    ? handoffPlayback
    : undefined;
  if (displacedPlayback) {
    handoffPlayback = {
      ...displacedPlayback,
      status: "stopped",
      message: "Source tab closed or navigated; playback stopped.",
      active: false
    };
  }
  const stoppedPlayback = await enqueuePlaybackUpdate(async () => {
    const { playback = DEFAULT_PLAYBACK } = await chrome.storage.session.get("playback");
    if (!playback.active || playback.sourceTabId !== tabId) return;
    return writePlayback({
      status: "stopped",
      message: "Source tab closed or navigated; playback stopped."
    }, playback.sessionId);
  });
  const sessionIds = [...new Set([pendingSessionId, stoppedPlayback?.sessionId, displacedPlayback?.sessionId].filter(Boolean))];
  await Promise.all(sessionIds.map((sessionId) => chrome.runtime.sendMessage({
    type: "OFFSCREEN_CONTROL",
    action: "stop",
    sessionId
  })));
}

chrome.tabs.onRemoved.addListener((tabId) => {
  stopReadingForSourceTab(tabId).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" || changeInfo.url !== undefined) stopReadingForSourceTab(tabId).catch(() => {});
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  const selectedText = info.menuItemId === "read-selection" ? info.selectionText || "" : "";
  startReading(tab.id, selectedText).catch((error) => {
    reportStartFailure(error).catch(() => {});
  });
});

async function websiteSender(message, sender) {
  if (!Number.isInteger(sender?.tab?.id) || sender.frameId !== 0 || typeof sender.documentId !== "string") return;
  let matchingPattern;
  try {
    if (typeof message.pageUrl !== "string") return;
    const url = new URL(message.pageUrl);
    const controls = await getWebsiteControls();
    if (!controls.enabled) return;
    matchingPattern = websitePatterns(controls).find((pattern) => url.href.startsWith(pattern.slice(0, -1)));
    if (!matchingPattern || !(await chrome.permissions.contains({ origins: [chromeWebsitePattern(matchingPattern)] }))) return;
  } catch {
    return;
  }
  return { tabId: sender.tab.id, documentId: sender.documentId, pattern: matchingPattern, url: message.pageUrl };
}

async function websitePlaybackForTab({ tabId, documentId, url }) {
  const { playback = DEFAULT_PLAYBACK } = await chrome.storage.session.get("playback");
  return sanitizeWebsitePlayback(playback, tabId, documentId, url);
}

async function controlWebsitePlayback(websiteSource, action) {
  const { tabId, documentId } = websiteSource;
  const candidatePendingSessionId = pendingReadings.get(tabId);
  const pendingSource = pendingWebsiteDocuments.get(candidatePendingSessionId);
  const pendingSessionId = pendingSource?.documentId === documentId && pendingSource?.url === websiteSource.url
    ? candidatePendingSessionId
    : undefined;
  if (pendingSessionId) {
    if (action === "stop") {
      pendingReadings.delete(tabId);
      pendingWebsiteDocuments.delete(pendingSessionId);
      pendingPlaybackControls.delete(pendingSessionId);
      manuallyStoppedSessionId = pendingSessionId;
      const { playback = DEFAULT_PLAYBACK } = await chrome.storage.session.get("playback");
      if (playback.sessionId === pendingSessionId) {
        await updatePlaybackForSession(pendingSessionId, { status: "stopped", message: "Playback stopped." });
      }
      await chrome.runtime.sendMessage({
        type: "OFFSCREEN_CONTROL",
        action: "stop",
        sessionId: pendingSessionId
      }).catch(() => {});
      return { ok: true, playback: await websitePlaybackForTab(websiteSource) };
    }

    if (action === "pause") pendingPlaybackControls.set(pendingSessionId, "pause");
    if (action === "resume") pendingPlaybackControls.delete(pendingSessionId);
    const { playback = DEFAULT_PLAYBACK } = await chrome.storage.session.get("playback");
    if (playback.sessionId === pendingSessionId) {
      await updatePlaybackForSession(pendingSessionId, {
        status: action === "pause" ? "paused" : "loading",
        message: action === "pause" ? "Playback paused." : "Playback resumed."
      });
    }
    return { ok: true, playback: await websitePlaybackForTab(websiteSource) };
  }

  const { playback = DEFAULT_PLAYBACK } = await chrome.storage.session.get("playback");
  if (!playback.active || playback.sourceTabId !== tabId || playback.sourceDocumentId !== documentId || playback.sourceArticleUrl !== websiteSource.url) {
    return { ok: false, playback: websiteIdlePlayback(), error: "This tab has no active reading session." };
  }

  if (action === "stop") {
    manuallyStoppedSessionId = playback.sessionId;
    await updatePlaybackForSession(playback.sessionId, { status: "stopped", message: "Playback stopped." });
  }
  if (action !== "stop") await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_CONTROL",
    action,
    sessionId: playback.sessionId
  }).catch(() => ({ handled: false }));
  if (!response?.handled) {
    await updatePlaybackForSession(playback.sessionId, {
      status: "stopped",
      message: "Playback is no longer available."
    });
    return { ok: false, playback: await websitePlaybackForTab(websiteSource), error: "Playback is no longer available." };
  }
  return { ok: true, playback: await websitePlaybackForTab(websiteSource) };
}

async function handleWebsiteControl(message, sender) {
  const websiteSource = await websiteSender(message, sender);
  if (!websiteSource || !WEBSITE_COMMANDS.has(message.action)) {
    return { ok: false, error: "This request is not available." };
  }
  if (message.action === "status") return { ok: true, playback: await websitePlaybackForTab(websiteSource) };
  if (message.action === "start") {
    try {
      await startReading(websiteSource.tabId, "", websiteSource);
      return { ok: true, playback: await websitePlaybackForTab(websiteSource) };
    } catch {
      return {
        ok: false,
        error: "Unable to start reading. Check the extension popup.",
        playback: await websitePlaybackForTab(websiteSource)
      };
    }
  }
  return controlWebsitePlayback(websiteSource, message.action);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case "GET_SETTINGS":
        sendResponse({ ok: true, settings: await chrome.storage.local.get(DEFAULT_SETTINGS) });
        return;

      case "GET_PLAYBACK_STATUS": {
        const { playback = DEFAULT_PLAYBACK } = await chrome.storage.session.get("playback");
        sendResponse({ ok: true, playback });
        return;
      }

      case "GET_WEBSITE_CONTROLS":
        sendResponse({ ok: true, websiteControls: await getWebsiteControls() });
        return;

      case "SAVE_WEBSITE_CONTROLS": {
        const controls = normalizeWebsiteControls(message.websiteControls);
        if (controls.enabled && !(await chrome.permissions.contains({ origins: websitePatterns(controls).map(chromeWebsitePattern) }))) {
          throw new Error("Chrome must allow every enabled website before its controls can be activated.");
        }
        await chrome.storage.local.set({ websiteControls: controls });
        const bridge = await syncWebsiteBridge(controls);
        sendResponse({ ok: true, websiteControls: controls, bridge });
        return;
      }

      case "WEBSITE_CONTROL":
        sendResponse(await handleWebsiteControl(message, sender));
        return;

      case "SAVE_SETTINGS":
        await chrome.storage.local.set({ ...DEFAULT_SETTINGS, ...message.settings });
        sendResponse({ ok: true });
        return;

      case "START_ARTICLE": {
        const reading = await startReading(await activeTabId());
        sendResponse({ ok: true, reading });
        return;
      }

      case "CONTROL_PLAYBACK":
        if (message.action === "stop") {
          pendingReadings.clear();
          pendingPlaybackControls.clear();
          manuallyStoppedSessionId = latestReadingSessionId;
          handoffPlayback = undefined;
          await updatePlayback({ status: "stopped", message: "Playback stopped." });
        }
        {
          const { playback = DEFAULT_PLAYBACK } = await chrome.storage.session.get("playback");
          const pendingSessionId = [...pendingReadings.values()].find((sessionId) => sessionId === latestReadingSessionId);
          if (pendingSessionId && message.action !== "stop") {
            if (message.action === "pause") pendingPlaybackControls.set(pendingSessionId, "pause");
            if (message.action === "resume") pendingPlaybackControls.delete(pendingSessionId);
            if (playback.sessionId === pendingSessionId) {
              await updatePlaybackForSession(pendingSessionId, {
                status: message.action === "pause" ? "paused" : "loading",
                message: message.action === "pause" ? "Playback paused." : "Playback resumed."
              });
            }
            sendResponse({ ok: true });
            return;
          }

          if (message.action !== "stop") await ensureOffscreenDocument();
          let controlResponse;
          try {
            controlResponse = await chrome.runtime.sendMessage({
              type: "OFFSCREEN_CONTROL",
              action: message.action,
              sessionId: playback.sessionId,
              force: message.action === "stop"
            });
          } catch (error) {
            if (message.action === "stop") {
              sendResponse({ ok: true });
              return;
            }
            throw error;
          }
          if (message.action !== "stop" && controlResponse?.handled === false) {
            await updatePlaybackForSession(playback.sessionId, {
              status: "stopped",
              message: "Playback is no longer available."
            });
          }
        }
        sendResponse({ ok: true });
        return;

      case "OFFSCREEN_STATUS":
        if (handoffPlayback?.sessionId === message.sessionId && TERMINAL_PLAYBACK_STATUSES.has(message.status)) {
          handoffPlayback = {
            ...handoffPlayback,
            status: message.status,
            message: message.message,
            progress: message.progress || handoffPlayback.progress,
            active: false
          };
        }
        await updatePlaybackForSession(message.sessionId, {
          status: message.status,
          message: message.message,
          progress: message.progress,
          title: message.title,
          sessionId: message.sessionId
        });
        sendResponse({ ok: true });
        return;

      default:
        return;
    }
  })().catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

export {};
