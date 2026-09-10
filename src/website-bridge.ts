const PROTOCOL_VERSION = 1;
const REQUEST_STATUS_EVENT = "article-tts-reader:request-status";
const COMMAND_EVENT = "article-tts-reader:command";
const READY_EVENT = "article-tts-reader:ready";
const STATUS_EVENT = "article-tts-reader:status";
const RESULT_EVENT = "article-tts-reader:result";
const COMMANDS = new Set(["start", "pause", "resume", "stop"]);
const STATUSES = new Set(["idle", "loading", "playing", "paused", "complete", "stopped", "error"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRequestId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function dispatch(type, detail) {
  document.dispatchEvent(new CustomEvent(type, { detail }));
}

function normalizePlayback(playback) {
  const status = STATUSES.has(playback?.status) ? playback.status : "error";
  const total = Number.isInteger(playback?.progress?.total) && playback.progress.total > 0
    ? playback.progress.total
    : 0;
  const current = total > 0 && Number.isInteger(playback?.progress?.current)
    ? Math.min(Math.max(playback.progress.current, 0), total)
    : 0;
  return {
    status,
    message: status === "error"
      ? "Reading failed. Check the extension popup."
      : typeof playback?.message === "string" ? playback.message.slice(0, 300) : "",
    title: typeof playback?.title === "string" ? playback.title.slice(0, 300) : "",
    progress: { current, total },
    active: Boolean(playback?.active)
  };
}

function sendReady() {
  dispatch(READY_EVENT, { protocolVersion: PROTOCOL_VERSION });
}

function sendResult(requestId, response) {
  dispatch(RESULT_EVENT, {
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    ok: Boolean(response?.ok),
    ...(response?.ok ? {} : { error: "The extension could not complete this request." })
  });
}

async function forward(requestId, action) {
  try {
    const response = await chrome.runtime.sendMessage({ type: "WEBSITE_CONTROL", action, pageUrl: window.location.href });
    if (response?.playback) dispatch(STATUS_EVENT, {
      protocolVersion: PROTOCOL_VERSION,
      playback: normalizePlayback(response.playback)
    });
    sendResult(requestId, response);
  } catch {
    sendResult(requestId, { ok: false });
  }
}

function validDetail(detail) {
  return isRecord(detail) && detail.protocolVersion === PROTOCOL_VERSION && isRequestId(detail.requestId);
}

if (window.top === window) {
  document.addEventListener(REQUEST_STATUS_EVENT, (event) => {
    const detail = (event as CustomEvent).detail;
    if (!validDetail(detail)) return;
    sendReady();
    forward(detail.requestId, "status");
  });

  document.addEventListener(COMMAND_EVENT, (event) => {
    const detail = (event as CustomEvent).detail;
    if (!validDetail(detail) || !COMMANDS.has(detail.action)) return;
    forward(detail.requestId, detail.action);
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "WEBSITE_PLAYBACK_STATUS") return;
    dispatch(STATUS_EVENT, {
      protocolVersion: PROTOCOL_VERSION,
      playback: normalizePlayback(message.playback)
    });
  });
}
