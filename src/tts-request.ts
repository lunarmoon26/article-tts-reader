export type TtsProvider = "openai-compatible" | "chatterbox" | "orpheus" | "gpt-sovits" | "openai";

export type TtsSettings = {
  provider: TtsProvider;
  endpoint: string;
  apiKey: string;
  model: string;
  voice: string;
  speed: number;
  gptSovitsTextLanguage?: string;
  gptSovitsReferenceAudioPath?: string;
  gptSovitsReferenceText?: string;
  gptSovitsReferenceLanguage?: string;
};

type TtsRequest = {
  endpoint: string;
  headers: Record<string, string>;
  body: Record<string, string | number | boolean>;
};

export function createTtsRequest(text: string, settings: TtsSettings): TtsRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

  if (settings.provider === "gpt-sovits") {
    const required = [
      ["reference audio path", settings.gptSovitsReferenceAudioPath],
      ["text language", settings.gptSovitsTextLanguage],
      ["reference language", settings.gptSovitsReferenceLanguage]
    ];
    const missing = required.find(([, value]) => !value?.trim());
    if (missing) throw new Error(`GPT-SoVITS ${missing[0]} is required.`);

    return {
      endpoint: settings.endpoint,
      headers,
      body: {
        text,
        text_lang: settings.gptSovitsTextLanguage,
        ref_audio_path: settings.gptSovitsReferenceAudioPath,
        prompt_text: settings.gptSovitsReferenceText,
        prompt_lang: settings.gptSovitsReferenceLanguage,
        text_split_method: "cut5",
        speed_factor: Number(settings.speed),
        media_type: "wav",
        streaming_mode: false
      }
    };
  }

  return {
    endpoint: settings.endpoint,
    headers,
    body: {
      model: settings.model,
      input: text,
      voice: settings.voice,
      response_format: settings.provider === "orpheus" ? "wav" : "mp3",
      speed: Number(settings.speed)
    }
  };
}
