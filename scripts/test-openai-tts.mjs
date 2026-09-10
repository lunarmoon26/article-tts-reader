import assert from "node:assert/strict";

const apiKey = process.env.OPENAI_API_KEY;
assert.ok(apiKey, "Set OPENAI_API_KEY in .env before running this test.");

const model = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const voice = process.env.OPENAI_TTS_VOICE || "coral";
const response = await fetch("https://api.openai.com/v1/audio/speech", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model,
    voice,
    input: "This is a local Article TTS Reader endpoint check.",
    response_format: "mp3"
  })
});

assert.equal(response.ok, true, `OpenAI TTS request failed: HTTP ${response.status} ${await response.text()}`);
assert.match(response.headers.get("content-type") || "", /^audio\//, "Expected an audio response.");
console.log(`OpenAI TTS endpoint passed with ${model}/${voice}.`);
