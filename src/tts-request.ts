export type TtsProvider = "kokoro" | "cosyvoice" | "chatterbox" | "higgs" | "openai";

export type TtsSettings = {
  provider: TtsProvider;
  endpoint: string;
  apiKey: string;
  model: string;
  voice: string;
  speed: number;
};

type TtsRequest = {
  endpoint: string;
  headers: Record<string, string>;
  body: Record<string, string | number | boolean>;
};

export function createTtsRequest(text: string, settings: TtsSettings): TtsRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

  if (settings.provider === "higgs") {
    return {
      endpoint: settings.endpoint,
      headers,
      body: { input: text }
    };
  }

  return {
    endpoint: settings.endpoint,
    headers,
    body: {
      model: settings.model,
      input: text,
      voice: settings.voice,
      response_format: "mp3",
      speed: Number(settings.speed)
    }
  };
}
