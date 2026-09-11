const $ = (selector: string): any => document.querySelector(selector);

const fields = {
  provider: $("#provider"),
  endpoint: $("#endpoint"),
  apiKey: $("#api-key"),
  model: $("#model"),
  voice: $("#voice"),
  customModel: $("#custom-model"),
  customVoice: $("#custom-voice"),
  speed: $("#speed"),
  websiteControlsEnabled: $("#website-controls-enabled"),
  websitePatterns: $("#website-patterns")
};
const status = $("#status");
const speechOptions = $("#speech-options");
const customSpeechOptions = $("#custom-speech-options");
const customModelSetting = $("#custom-model-setting");
const customVoiceSetting = $("#custom-voice-setting");
const playbackTask = $("#playback-task");
const playbackTitle = $("#playback-title");
const playbackProgress = $("#playback-progress");
const CUSTOM_OPTION = "__custom__";

const PRESETS = {
  kokoro: {
    endpoint: "http://127.0.0.1:8880/v1/audio/speech",
    model: "kokoro",
    voice: "af_bella"
  },
  cosyvoice: {
    endpoint: "http://127.0.0.1:8080/v1/audio/speech",
    model: "cosyvoice",
    voice: "Chinese Female"
  },
  chatterbox: {
    endpoint: "http://127.0.0.1:4123/v1/audio/speech",
    model: "chatterbox",
    voice: "default"
  },
  higgs: {
    endpoint: "http://127.0.0.1:8000/v1/audio/speech",
    model: "not-used",
    voice: "not-used"
  },
  openai: {
    endpoint: "https://api.openai.com/v1/audio/speech",
    model: "gpt-4o-mini-tts",
    voice: "coral"
  }
};

const OPENAI_TTS_MODELS = ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"];
const OPENAI_TTS_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"];
const OPENAI_LEGACY_TTS_VOICES = ["alloy", "ash", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer"];

function modelOptions(provider) {
  if (provider === "openai") return OPENAI_TTS_MODELS;
  return [PRESETS[provider]?.model || ""];
}

function voiceOptions(provider, model) {
  if (provider === "openai") {
    return ["tts-1", "tts-1-hd"].includes(model) ? OPENAI_LEGACY_TTS_VOICES : OPENAI_TTS_VOICES;
  }
  return [PRESETS[provider]?.voice || ""];
}

function usesSpeechOptions(provider) {
  return provider !== "higgs";
}

function selectedSpeechValue(select, customInput) {
  return select.value === CUSTOM_OPTION ? customInput.value.trim() : select.value;
}

function setOptions(select: any, values: string[], selected: string, supportsCustom: boolean) {
  const options = [...new Set(values.filter(Boolean))];
  select.replaceChildren(...options.map((value) => new Option(value, value)));
  if (supportsCustom) select.add(new Option("Custom…", CUSTOM_OPTION));

  const isKnown = options.includes(selected);
  select.value = isKnown ? selected : supportsCustom ? CUSTOM_OPTION : options[0] || "";
  return isKnown;
}

function renderSpeechOptions(provider, model = selectedSpeechValue(fields.model, fields.customModel), voice = selectedSpeechValue(fields.voice, fields.customVoice)) {
  const customOptionsAllowed = usesSpeechOptions(provider);
  const selectedModel = model ?? PRESETS[provider]?.model ?? "";
  const modelIsKnown = setOptions(fields.model, modelOptions(provider), selectedModel, customOptionsAllowed);
  fields.customModel.value = modelIsKnown ? "" : selectedModel;

  const activeModel = selectedSpeechValue(fields.model, fields.customModel);
  const selectedVoice = voice ?? PRESETS[provider]?.voice ?? "";
  const voiceIsKnown = setOptions(fields.voice, voiceOptions(provider, activeModel), selectedVoice, customOptionsAllowed);
  fields.customVoice.value = voiceIsKnown ? "" : selectedVoice;

  const showCustomModel = fields.model.value === CUSTOM_OPTION;
  const showCustomVoice = fields.voice.value === CUSTOM_OPTION;
  speechOptions.hidden = !usesSpeechOptions(provider);
  customSpeechOptions.hidden = speechOptions.hidden || (!showCustomModel && !showCustomVoice);
  customModelSetting.hidden = !showCustomModel;
  customVoiceSetting.hidden = !showCustomVoice;
  fields.customModel.required = showCustomModel;
  fields.customVoice.required = showCustomVoice;
}

function setStatus(message, state = "ready") {
  status.textContent = message;
  status.dataset.state = state;
}

function renderPlayback(playback) {
  const active = Boolean(playback?.active);
  const progress = playback?.progress || { current: 0, total: 0 };
  playbackTask.hidden = !active;
  playbackTitle.textContent = playback?.title || "Reading article";
  playbackProgress.hidden = !progress.total;
  playbackProgress.max = progress.total || 1;
  playbackProgress.value = Math.min(progress.current || 0, playbackProgress.max);
  setStatus(playback?.message || "Save an endpoint, then open an article.", playback?.status === "error" ? "error" : "ready");
  $("#play").textContent = active && playback?.status !== "paused" ? "Pause" : "Play";
  $("#play").disabled = false;
  $("#stop").disabled = !active;
}

function sendMessage(message: Record<string, unknown>): Promise<any> {
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
    model: selectedSpeechValue(fields.model, fields.customModel),
    voice: selectedSpeechValue(fields.voice, fields.customVoice),
    speed: Number(fields.speed.value)
  };
}

function originPattern(endpoint) {
  const url = new URL(endpoint);
  return `${url.protocol}//${url.host}/*`;
}

function requestOriginPermission(origin) {
  return new Promise((resolve) => chrome.permissions.request({ origins: [origin] }, resolve));
}

function requestOriginPermissions(origins) {
  return new Promise((resolve) => chrome.permissions.request({ origins }, resolve));
}

function normalizeWebsitePattern(value) {
  const pattern = value.trim();
  const url = new URL(pattern);
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
    throw new Error("Use exact HTTPS host paths ending in *, for example https://example.com/posts/*.");
  }
  return `https://${url.hostname.toLowerCase()}${url.pathname}`;
}

function websiteControlsFromForm() {
  const patterns = [...new Set(fields.websitePatterns.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).map(normalizeWebsitePattern))];
  if (patterns.length === 0) throw new Error("Add at least one website URL pattern.");
  if (patterns.length > 20) throw new Error("Add no more than 20 website URL patterns.");
  return { enabled: fields.websiteControlsEnabled.checked, patterns, devMode: $("#website-dev-mode").checked };
}

function renderWebsiteControls(websiteControls) {
  fields.websiteControlsEnabled.checked = Boolean(websiteControls?.enabled);
  $("#website-dev-mode").checked = Boolean(websiteControls?.devMode);
  fields.websitePatterns.value = Array.isArray(websiteControls?.patterns) ? websiteControls.patterns.join("\n") : "";
}

async function saveWebsiteControls() {
  const websiteControls = websiteControlsFromForm();
  const origins = [...websiteControls.patterns, ...(websiteControls.devMode ? ["http://localhost/posts/*"] : [])];
  if (websiteControls.enabled && !(await requestOriginPermissions(origins))) {
    throw new Error("Website access was not granted. Chrome must allow every enabled pattern.");
  }
  const response = await sendMessage({ type: "SAVE_WEBSITE_CONTROLS", websiteControls });
  renderWebsiteControls(response.websiteControls);
  return response.websiteControls;
}

async function saveSettings() {
  const settings = settingsFromForm();
  const missingSpeechOption = usesSpeechOptions(settings.provider) && (!settings.model || !settings.voice);
  if (!settings.endpoint || missingSpeechOption || !Number.isFinite(settings.speed)) {
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
  renderSpeechOptions(name, preset.model, preset.voice);
  if (name !== "openai") fields.apiKey.value = "";
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

$("#save-website-controls").addEventListener("click", async () => {
  try {
    const websiteControls = await saveWebsiteControls();
    setStatus(websiteControls.enabled
      ? "Website controls saved. Reload matching pages to activate them."
      : "Website controls disabled.");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

fields.provider.addEventListener("change", () => setPreset(fields.provider.value));
fields.model.addEventListener("change", () => {
  renderSpeechOptions(fields.provider.value, selectedSpeechValue(fields.model, fields.customModel), selectedSpeechValue(fields.voice, fields.customVoice));
});
fields.voice.addEventListener("change", () => {
  renderSpeechOptions(fields.provider.value, selectedSpeechValue(fields.model, fields.customModel), selectedSpeechValue(fields.voice, fields.customVoice));
});

$("#play").addEventListener("click", async () => {
  try {
    const { playback: currentPlayback } = await sendMessage({ type: "GET_PLAYBACK_STATUS" });
    if (currentPlayback.active && currentPlayback.status !== "paused") {
      await sendMessage({ type: "CONTROL_PLAYBACK", action: "pause" });
    } else if (currentPlayback.status === "paused") {
      await sendMessage({ type: "CONTROL_PLAYBACK", action: "resume" });
    } else if (!currentPlayback.active) {
      await saveSettings();
      await sendMessage({ type: "START_ARTICLE" });
    }
    const { playback } = await sendMessage({ type: "GET_PLAYBACK_STATUS" });
    renderPlayback(playback);
  } catch (error) {
    setStatus(error.message, "error");
  }
});

for (const action of ["stop"]) {
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
  renderPlayback(message.playback);
});

const { settings } = await sendMessage({ type: "GET_SETTINGS" });
fields.provider.value = settings.provider;
fields.endpoint.value = settings.endpoint;
fields.apiKey.value = settings.apiKey;
renderSpeechOptions(settings.provider, settings.model, settings.voice);
fields.speed.value = settings.speed;

const { websiteControls } = await sendMessage({ type: "GET_WEBSITE_CONTROLS" });
renderWebsiteControls(websiteControls);

const { playback } = await sendMessage({ type: "GET_PLAYBACK_STATUS" });
renderPlayback(playback);

export {};
