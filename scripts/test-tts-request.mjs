import assert from "node:assert/strict";
import { createTtsRequest } from "../dist/tts-request.js";

const common = {
  endpoint: "http://127.0.0.1:8880/v1/audio/speech",
  apiKey: "",
  model: "kokoro",
  voice: "af_bella",
  speed: 1
};

assert.deepEqual(createTtsRequest("Hello", { ...common, provider: "kokoro" }), {
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
  provider: "cosyvoice",
  endpoint: "http://127.0.0.1:8080/v1/audio/speech",
  model: "cosyvoice",
  voice: "Chinese Female"
}), {
  endpoint: "http://127.0.0.1:8080/v1/audio/speech",
  headers: { "Content-Type": "application/json" },
  body: {
    model: "cosyvoice",
    input: "Hello",
    voice: "Chinese Female",
    response_format: "mp3",
    speed: 1
  }
});

assert.deepEqual(createTtsRequest("Hello", {
  ...common,
  provider: "higgs",
  endpoint: "http://127.0.0.1:8000/v1/audio/speech"
}), {
  endpoint: "http://127.0.0.1:8000/v1/audio/speech",
  headers: { "Content-Type": "application/json" },
  body: { input: "Hello" }
});

console.log("TTS request tests passed.");
