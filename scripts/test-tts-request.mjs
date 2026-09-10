import assert from "node:assert/strict";
import { createTtsRequest } from "../dist/tts-request.js";

const common = {
  endpoint: "http://127.0.0.1:8880/v1/audio/speech",
  apiKey: "",
  model: "kokoro",
  voice: "af_bella",
  speed: 1
};

assert.deepEqual(createTtsRequest("Hello", { ...common, provider: "openai-compatible" }), {
  endpoint: common.endpoint,
  headers: { "Content-Type": "application/json" },
  body: {
    model: "kokoro",
    input: "Hello",
    voice: "af_bella",
    response_format: "mp3",
    speed: 1
  }
});

assert.deepEqual(createTtsRequest("Hello", {
  ...common,
  provider: "orpheus",
  endpoint: "http://127.0.0.1:5005/v1/audio/speech",
  model: "orpheus",
  voice: "tara"
}), {
  endpoint: "http://127.0.0.1:5005/v1/audio/speech",
  headers: { "Content-Type": "application/json" },
  body: {
    model: "orpheus",
    input: "Hello",
    voice: "tara",
    response_format: "wav",
    speed: 1
  }
});

assert.deepEqual(createTtsRequest("Hello", {
  ...common,
  provider: "gpt-sovits",
  endpoint: "http://127.0.0.1:9880/tts",
  gptSovitsTextLanguage: "en",
  gptSovitsReferenceAudioPath: "/voices/narrator.wav",
  gptSovitsReferenceText: "Reference words.",
  gptSovitsReferenceLanguage: "en"
}), {
  endpoint: "http://127.0.0.1:9880/tts",
  headers: { "Content-Type": "application/json" },
  body: {
    text: "Hello",
    text_lang: "en",
    ref_audio_path: "/voices/narrator.wav",
    prompt_text: "Reference words.",
    prompt_lang: "en",
    text_split_method: "cut5",
    speed_factor: 1,
    media_type: "wav",
    streaming_mode: false
  }
});

assert.throws(
  () => createTtsRequest("Hello", { ...common, provider: "gpt-sovits" }),
  /reference audio path is required/
);

console.log("TTS request tests passed.");
