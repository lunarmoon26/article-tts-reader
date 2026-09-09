# Article TTS Reader

Manifest V3 extension for Chrome and Edge that extracts a page's main article with Mozilla Readability, then narrates it through one user-configured OpenAI-compatible TTS endpoint.

It supports the following neural TTS choices:

- **Local:** a self-hosted endpoint such as [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI), defaulting to `http://127.0.0.1:8880/v1/audio/speech`.
- **Realistic local/voice-cloned:** [Chatterbox TTS API](https://github.com/travisvn/chatterbox-tts-api) and [Orpheus-FastAPI](https://github.com/Lex-au/Orpheus-FastAPI), both exposed through OpenAI-compatible endpoints.
- **Direct voice cloning:** [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) `api_v2.py`, using its native `/tts` request schema and a reference-audio file located on the TTS server.
- **Hosted:** OpenAI's `/v1/audio/speech` endpoint, or another compatible hosted endpoint.

The extension sends article text and an optional API key only to the endpoint you explicitly save. It asks Chrome for permission to that endpoint's origin when saving. Keys are stored in `chrome.storage.local`.

## Build and load

```bash
npm install
npm test
npm run verify
```

Then open `chrome://extensions` or `edge://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `dist/`.

Open a normal HTTP(S) article, click the extension, save your endpoint settings, and select **Read main article**. For pages that are not articles or for a custom portion, select the text and use **Read selected text with Article TTS Reader** from the page context menu.

## Local server example

Run a compatible local service, such as Kokoro-FastAPI, then use the default Local preset:

```bash
docker run -d --name kokoro-fastapi -p 127.0.0.1:8880:8880 ghcr.io/remsky/kokoro-fastapi:latest
```

Consult the server's documentation for supported models, voices, and performance options.

## Realistic voice presets

- **Chatterbox** is the recommended local option for natural cloned narration. Run an OpenAI-compatible Chatterbox API such as `travisvn/chatterbox-tts-api`, then select **Chatterbox TTS API** in the extension and set the stored voice name.
- **Orpheus** prioritizes expressive English speech and emotion tags. Select **Orpheus-FastAPI** after starting a compatible server, then choose its voice (the preset uses `tara`).
- **GPT-SoVITS** is best when you already have a consented reference voice. Run the upstream API with `python api_v2.py -a 127.0.0.1 -p 9880`, select **GPT-SoVITS api_v2**, then set the reference audio path and its transcript/language. The file path is on the server host; the extension does not upload reference audio.

Pyodide/WASM is deliberately not used for GPT-SoVITS: the upstream stack depends on PyTorch, torchaudio, FastAPI, and native audio/model libraries. Use its local Python server instead. Browser-native inference would require a separate ONNX/WebGPU export and runtime, not a Pyodide port.

## Limitations

- Chrome and Edge block extensions from injecting into browser-internal pages, Chrome Web Store pages, and some PDF viewers.
- Main-text extraction is heuristic. When Readability cannot establish an article, the extension declines to read the full page; select the desired text instead.
- The configured endpoint must accept `POST /v1/audio/speech` with `model`, `input`, `voice`, `speed`, and `response_format` fields, returning playable audio.

## License

MIT. Mozilla Readability remains subject to its upstream license; the build emits its license notice next to the bundled extractor.
