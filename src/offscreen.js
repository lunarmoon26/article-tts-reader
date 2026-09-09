import { createTtsRequest } from "./tts-request.js";

let session;

function splitText(text, limit = 3000) {
  const chunks = [];
  let current = "";
  const paragraphs = text.split(/\n{2,}/).flatMap((paragraph) =>
    paragraph.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g) || [paragraph]
  );

  for (const part of paragraphs) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const next = current ? `${current} ${trimmed}` : trimmed;
    if (next.length <= limit) {
      current = next;
      continue;
    }
    if (current) chunks.push(current);
    current = trimmed;
    while (current.length > limit) {
      const splitAt = Math.max(current.lastIndexOf(" ", limit), Math.floor(limit * 0.8));
      chunks.push(current.slice(0, splitAt).trim());
      current = current.slice(splitAt).trim();
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function report(status, message, progress) {
  chrome.runtime.sendMessage({
    type: "OFFSCREEN_STATUS",
    status,
    message,
    progress
  });
}

function stopSession() {
  if (!session) return;
  session.cancelled = true;
  session.controller?.abort();
  session.audio?.pause();
  session.audio?.removeAttribute("src");
  session.audio?.load();
  session.resume?.();
  session = undefined;
}

function waitForResume(currentSession) {
  if (!currentSession.paused) return Promise.resolve();
  return new Promise((resolve) => {
    currentSession.resume = resolve;
  });
}

async function waitForAudioEnd(audio, currentSession) {
  await new Promise((resolve, reject) => {
    audio.addEventListener("ended", resolve, { once: true });
    audio.addEventListener("error", () => reject(new Error("Browser could not play the TTS audio response.")), { once: true });
    currentSession.controller.signal.addEventListener("abort", resolve, { once: true });
  });
}

async function synthesize(text, settings, currentSession) {
  currentSession.controller = new AbortController();
  const request = createTtsRequest(text, settings);

  const response = await fetch(request.endpoint, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
    signal: currentSession.controller.signal
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 300);
    throw new Error(`TTS endpoint returned HTTP ${response.status}${details ? `: ${details}` : ""}`);
  }

  return response.blob();
}

async function play(payload) {
  stopSession();
  const currentSession = { cancelled: false, paused: false, audio: undefined, controller: undefined, resume: undefined };
  session = currentSession;

  const chunks = splitText(payload.article.text);
  if (chunks.length === 0) throw new Error("There is no readable text to speak.");

  report("loading", `Preparing “${payload.article.title}”…`, { current: 0, total: chunks.length });

  for (let index = 0; index < chunks.length; index += 1) {
    if (currentSession.cancelled) return;
    await waitForResume(currentSession);
    if (currentSession.cancelled) return;

    report("loading", `Generating part ${index + 1} of ${chunks.length}…`, { current: index, total: chunks.length });
    const blob = await synthesize(chunks[index], payload.settings, currentSession);
    if (currentSession.cancelled) return;
    await waitForResume(currentSession);
    if (currentSession.cancelled) return;

    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentSession.audio = audio;
    await audio.play();
    report("playing", `Playing part ${index + 1} of ${chunks.length}`, { current: index + 1, total: chunks.length });
    await waitForAudioEnd(audio, currentSession);
    URL.revokeObjectURL(url);
    currentSession.audio = undefined;
  }

  if (!currentSession.cancelled) {
    report("complete", "Finished reading.", { current: chunks.length, total: chunks.length });
  }
  if (session === currentSession) session = undefined;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "OFFSCREEN_PLAY") {
    play(message.payload).catch((error) => {
      if (error.name !== "AbortError") report("error", error.message);
    });
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "OFFSCREEN_CONTROL") {
    if (message.action === "pause" && session) {
      session.paused = true;
      session.audio?.pause();
      report("paused", "Playback paused.");
    } else if (message.action === "resume" && session) {
      session.paused = false;
      session.resume?.();
      if (session.audio?.paused) session.audio.play().catch((error) => report("error", error.message));
      report("playing", "Playback resumed.");
    } else if (message.action === "stop") {
      stopSession();
      report("stopped", "Playback stopped.");
    }
    sendResponse({ ok: true });
  }
});
