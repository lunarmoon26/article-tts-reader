const $ = (selector) => document.querySelector(selector);

const fields = {
  provider: $("#provider"),
  endpoint: $("#endpoint"),
  apiKey: $("#api-key"),
  model: $("#model"),
  voice: $("#voice"),
  speed: $("#speed"),
  gptSovitsTextLanguage: $("#gpt-sovits-text-language"),
  gptSovitsReferenceAudioPath: $("#gpt-sovits-reference-audio"),
  gptSovitsReferenceText: $("#gpt-sovits-reference-text"),
  gptSovitsReferenceLanguage: $("#gpt-sovits-reference-language")
};
const status = $("#status");
const gptSovitsSettings = $("#gpt-sovits-settings");

const PRESETS = {
  "openai-compatible": {
    endpoint: "http://127.0.0.1:8880/v1/audio/speech",
    model: "kokoro",
    voice: "af_bella"
  },
  chatterbox: {
    endpoint: "http://127.0.0.1:4123/v1/audio/speech",
    model: "chatterbox",
    voice: "default"
  },
  orpheus: {
    endpoint: "http://127.0.0.1:5005/v1/audio/speech",
    model: "orpheus",
    voice: "tara"
  },
  "gpt-sovits": {
    endpoint: "http://127.0.0.1:9880/tts",
    model: "not-used",
    voice: "not-used"
  },
  openai: {
    endpoint: "https://api.openai.com/v1/audio/speech",
    model: "gpt-4o-mini-tts",
    voice: "coral"
  }
};

function setStatus(message, state = "ready") {
  status.textContent = message;
  status.dataset.state = state;
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!response?.ok) {
        reject(new Error(response?.error || "Extension request failed."));
      } else {
        resolve(response);
      }
    });
  });
}

function settingsFromForm() {
  return {
    provider: fields.provider.value,
    endpoint: fields.endpoint.value.trim(),
    apiKey: fields.apiKey.value.trim(),
    model: fields.model.value.trim(),
    voice: fields.voice.value.trim(),
    speed: Number(fields.speed.value),
    gptSovitsTextLanguage: fields.gptSovitsTextLanguage.value.trim(),
    gptSovitsReferenceAudioPath: fields.gptSovitsReferenceAudioPath.value.trim(),
    gptSovitsReferenceText: fields.gptSovitsReferenceText.value.trim(),
    gptSovitsReferenceLanguage: fields.gptSovitsReferenceLanguage.value.trim()
  };
}

function originPattern(endpoint) {
  const url = new URL(endpoint);
  return `${url.protocol}//${url.host}/*`;
}

function requestOriginPermission(origin) {
  return new Promise((resolve) => chrome.permissions.request({ origins: [origin] }, resolve));
}

async function saveSettings() {
  const settings = settingsFromForm();
  if (!settings.endpoint || !settings.model || !settings.voice || !Number.isFinite(settings.speed)) {
    throw new Error("Complete every required endpoint setting.");
  }

  let origin;
  try {
    origin = originPattern(settings.endpoint);
  } catch {
    throw new Error("Speech endpoint must be a full URL, including https:// or http://.");
  }

  if (!(await requestOriginPermission(origin))) {
    throw new Error("Endpoint access was not granted. Chrome must allow this endpoint to generate audio.");
  }

  await sendMessage({ type: "SAVE_SETTINGS", settings });
  return settings;
}

function setPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;
  fields.endpoint.value = preset.endpoint;
  fields.model.value = preset.model;
  fields.voice.value = preset.voice;
  if (name !== "openai") fields.apiKey.value = "";
  gptSovitsSettings.hidden = name !== "gpt-sovits";
}

$("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await saveSettings();
    setStatus("Endpoint saved.");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

fields.provider.addEventListener("change", () => setPreset(fields.provider.value));

$("#read").addEventListener("click", async () => {
  try {
    await saveSettings();
    const { reading } = await sendMessage({ type: "START_ARTICLE" });
    setStatus(`Preparing ${reading.title} (${reading.characters.toLocaleString()} characters)…`);
  } catch (error) {
    setStatus(error.message, "error");
  }
});

for (const action of ["pause", "resume", "stop"]) {
  $(`#${action}`).addEventListener("click", async () => {
    try {
      await sendMessage({ type: "CONTROL_PLAYBACK", action });
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "STATUS_UPDATE") return;
  const progress = message.progress?.total
    ? ` (${message.progress.current}/${message.progress.total})`
    : "";
  setStatus(`${message.message || message.status}${progress}`, message.status === "error" ? "error" : "ready");
});

const { settings } = await sendMessage({ type: "GET_SETTINGS" });
fields.provider.value = settings.provider;
fields.endpoint.value = settings.endpoint;
fields.apiKey.value = settings.apiKey;
fields.model.value = settings.model;
fields.voice.value = settings.voice;
fields.speed.value = settings.speed;
fields.gptSovitsTextLanguage.value = settings.gptSovitsTextLanguage;
fields.gptSovitsReferenceAudioPath.value = settings.gptSovitsReferenceAudioPath;
fields.gptSovitsReferenceText.value = settings.gptSovitsReferenceText;
fields.gptSovitsReferenceLanguage.value = settings.gptSovitsReferenceLanguage;
gptSovitsSettings.hidden = settings.provider !== "gpt-sovits";
