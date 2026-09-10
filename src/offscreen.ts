import { createTtsRequest } from "./tts-request.ts";

let session;
const cancelledSessionIds = new Set();
const MAX_CANCELLED_SESSION_IDS = 32;

function rememberCancelledSession(sessionId) {
  if (!sessionId) return;
  cancelledSessionIds.add(sessionId);
  if (cancelledSessionIds.size > MAX_CANCELLED_SESSION_IDS) {
    cancelledSessionIds.delete(cancelledSessionIds.values().next().value);
  }
}

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

function report(status, message, progress, title, sessionId) {
  chrome.runtime.sendMessage({
    type: "OFFSCREEN_STATUS",
    status,
    message,
    progress,
    title,
    sessionId
  }).catch(() => {});
}

function stopSession() {
  if (!session) return;
  const stoppedSession = session;
  stoppedSession.cancelled = true;
  stoppedSession.controller?.abort();
  stoppedSession.audio?.pause();
  stoppedSession.audio?.removeAttribute("src");
  stoppedSession.audio?.load();
  stoppedSession.resume?.();
  session = undefined;
  return stoppedSession;
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

async function startAudio(audio, currentSession) {
  currentSession.startingAudio = true;
  try {
    while (!currentSession.cancelled) {
      currentSession.pauseInterruptedStart = false;
      try {
        await audio.play();
        return;
      } catch (error) {
        if (!currentSession.pauseInterruptedStart) throw error;
        await waitForResume(currentSession);
      }
    }
  } finally {
    currentSession.startingAudio = false;
  }
}

async function play(payload) {
  stopSession();
  const currentSession = {
    cancelled: false,
    paused: Boolean(payload.initiallyPaused),
    audio: undefined,
    controller: undefined,
    resume: undefined,
    startingAudio: false,
    pauseInterruptedStart: false,
    currentChunk: 0,
    totalChunks: 0,
    title: payload.article.title,
    sessionId: payload.sessionId
  };
  session = currentSession;

  try {
    const chunks = splitText(payload.article.text);
    if (chunks.length === 0) throw new Error("There is no readable text to speak.");
    currentSession.totalChunks = chunks.length;

    report(
      currentSession.paused ? "paused" : "loading",
      currentSession.paused ? "Playback paused." : `Preparing “${payload.article.title}”…`,
      { current: 0, total: chunks.length },
      currentSession.title,
      currentSession.sessionId
    );

    for (let index = 0; index < chunks.length; index += 1) {
      if (currentSession.cancelled) return;
      await waitForResume(currentSession);
      if (currentSession.cancelled) return;

      currentSession.currentChunk = index + 1;
      report("loading", `Generating part ${index + 1} of ${chunks.length}…`, { current: index + 1, total: chunks.length }, currentSession.title, currentSession.sessionId);
      const blob = await synthesize(chunks[index], payload.settings, currentSession);
      if (currentSession.cancelled) return;
      await waitForResume(currentSession);
      if (currentSession.cancelled) return;

      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      try {
        currentSession.audio = audio;
        await startAudio(audio, currentSession);
        if (currentSession.cancelled) return;
        await waitForResume(currentSession);
        if (currentSession.cancelled) return;
        report("playing", `Playing part ${index + 1} of ${chunks.length}`, { current: index + 1, total: chunks.length }, currentSession.title, currentSession.sessionId);
        await waitForAudioEnd(audio, currentSession);
      } finally {
        URL.revokeObjectURL(url);
        if (currentSession.audio === audio) currentSession.audio = undefined;
      }
    }

    if (!currentSession.cancelled) {
      report("complete", "Finished reading.", { current: chunks.length, total: chunks.length }, currentSession.title, currentSession.sessionId);
    }
  } catch (error) {
    if (!currentSession.cancelled && error.name !== "AbortError") {
      report("error", error.message, undefined, currentSession.title, currentSession.sessionId);
    }
  } finally {
    if (session === currentSession) session = undefined;
  }
}

function acceptPlayback(payload) {
  if (cancelledSessionIds.delete(payload.sessionId)) {
    report("stopped", "Playback stopped.", undefined, payload.article.title, payload.sessionId);
    return false;
  }
  play(payload);
  return true;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "OFFSCREEN_PLAY") {
    sendResponse({ ok: true, accepted: acceptPlayback(message.payload) });
    return;
  }

  if (message.type === "OFFSCREEN_CONTROL") {
    let handled = false;
    if (message.action === "pause" && session?.sessionId === message.sessionId) {
      handled = true;
      session.paused = true;
      if (session.startingAudio) session.pauseInterruptedStart = true;
      session.audio?.pause();
      report("paused", "Playback paused.", undefined, session.title, session.sessionId);
    } else if (message.action === "resume" && session?.sessionId === message.sessionId) {
      handled = true;
      const resumedSession = session;
      resumedSession.paused = false;
      resumedSession.resume?.();
      if (!resumedSession.startingAudio && resumedSession.audio?.paused) {
        resumedSession.audio.play().catch((error) => {
          if (session === resumedSession && !resumedSession.cancelled) {
            stopSession();
            report("error", error.message, undefined, resumedSession.title, resumedSession.sessionId);
          }
        });
      }
      const audioIsActive = Boolean(resumedSession.audio);
      report(
        audioIsActive ? "playing" : "loading",
        audioIsActive ? "Playback resumed." : `Generating part ${resumedSession.currentChunk} of ${resumedSession.totalChunks}…`,
        undefined,
        resumedSession.title,
        resumedSession.sessionId
      );
    } else if (message.action === "stop") {
      handled = true;
      const stoppedSession = (message.force || session?.sessionId === message.sessionId) ? stopSession() : undefined;
      if (message.force && stoppedSession?.sessionId !== message.sessionId) rememberCancelledSession(message.sessionId);
      if (!stoppedSession) rememberCancelledSession(message.sessionId);
      report("stopped", "Playback stopped.", undefined, stoppedSession?.title, message.sessionId);
    }
    sendResponse({ ok: true, handled });
  }
});
