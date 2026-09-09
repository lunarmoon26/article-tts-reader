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

chrome.runtime.onInstalled.addListener(createContextMenus);
chrome.runtime.onStartup.addListener(createContextMenus);

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
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Play neural text-to-speech audio while the extension popup is closed."
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

async function startReading(tabId, selectedText = "") {
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

  await ensureOffscreenDocument();
  await chrome.runtime.sendMessage({
    type: "OFFSCREEN_PLAY",
    payload: { article, settings }
  });

  return { title: article.title, characters: article.text.length };
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active browser tab found.");
  return tab.id;
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  const selectedText = info.menuItemId === "read-selection" ? info.selectionText || "" : "";
  startReading(tab.id, selectedText).catch((error) => {
    chrome.runtime.sendMessage({
      type: "STATUS_UPDATE",
      status: "error",
      message: error.message
    });
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case "GET_SETTINGS":
        sendResponse({ ok: true, settings: await chrome.storage.local.get(DEFAULT_SETTINGS) });
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
        await ensureOffscreenDocument();
        await chrome.runtime.sendMessage({ type: "OFFSCREEN_CONTROL", action: message.action });
        sendResponse({ ok: true });
        return;

      case "OFFSCREEN_STATUS":
        await chrome.runtime.sendMessage({
          type: "STATUS_UPDATE",
          status: message.status,
          message: message.message,
          progress: message.progress
        });
        sendResponse({ ok: true });
        return;

      default:
        return;
    }
  })().catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});
