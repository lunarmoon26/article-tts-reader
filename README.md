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

## Playback lifecycle

- The extension extracts the page text once, splits it into 3,000-character chunks, then generates and plays one chunk at a time. A new chunk is not requested until the previous audio has finished. Its offscreen document retains generated audio blobs while a slow local server is still synthesizing a chunk.
- Playback runs in an offscreen extension document, so closing the popup does not interrupt it. Reopening the popup restores the active article title, chunk progress, and controls from session storage.
- **Pause** waits at the next safe boundary when a request is already in flight. **Stop** aborts the current request, unloads the active audio element, and prevents further chunks from being generated.
- Closing or navigating the source tab stops its active reading session, including client-side URL changes (such as Next.js navigation). The extension aborts its synthesis request and unloads audio. Releasing server-side inference also requires the TTS server to cancel upstream work on client disconnect; aborting a browser request alone cannot guarantee that.

## Website controls

The popup's **Website controls** section is disabled by default and starts with `https://blog.haochuanz.net/posts/*`. Enable it to grant that exact site path access, or replace/add one HTTPS host-path pattern per line (for example, `https://example.com/posts/*`). Wildcard hosts, ports, queries, and HTTP patterns are rejected. Chrome grants host access at the origin level, so the bridge is loaded across that enabled origin to support client-side navigation, but it accepts commands only on the configured path. Disabling the controls unregisters the bridge but keeps any Chrome permission already granted.

An enabled page can start and manage reading only for its own tab, and receives only sanitized playback status. It never receives endpoint settings, API keys, session IDs, or another tab's playback. The protocol is documented in [`docs/blog-website-controls-protocol.md`](docs/blog-website-controls-protocol.md).

For local development, enable **Website controls** and **Development mode: localhost:3000/posts/***, then save, approve Chrome access, and reload your local post. Development mode is off by default and allows only `http://localhost:3000/posts/*`. Chrome's host permissions and script match patterns cannot restrict ports, so the registration uses `http://localhost/*`; the bridge and background enforce port 3000 and `/posts/` at runtime. Disabling development mode blocks local commands and status updates without changing your HTTPS whitelist.

## Models and voices

The OpenAI preset offers the documented Speech API models—`gpt-4o-mini-tts`, `tts-1`, and `tts-1-hd`—and only shows voices supported by the selected model. The current lists are sourced from OpenAI's [Text-to-speech guide](https://platform.openai.com/docs/guides/text-to-speech). `gpt-4o-mini-tts` exposes all 13 built-in voices; `tts-1` and `tts-1-hd` expose their documented nine-voice subset.

All local/custom presets retain a **Custom…** choice for model and voice values not listed by the extension. The Orpheus preset includes the eight voices documented for [legraphista/Orpheus](https://ollama.com/legraphista/Orpheus).

### OpenAI endpoint smoke test

`.env` is ignored by Git and contains an empty local placeholder:

```dotenv
OPENAI_API_KEY=
```

Set a real key locally, then run a minimal paid OpenAI Speech API request:

```bash
npm run test:openai
```

The browser extension does not read `.env`; paste the key into its popup to use it for playback.

### Ollama Orpheus

The `legraphista/Orpheus` Ollama model cannot be used by pointing this extension directly at `http://localhost:11434/v1/audio/speech`: Ollama's documented OpenAI-compatible API exposes chat, completions, models, embeddings, and responses—not a Speech API endpoint. The model page instead requires an external inference server plus an [Orpheus-FastAPI](https://github.com/Lex-au/Orpheus-FastAPI) frontend to turn generated audio tokens into playable audio. Point the extension at that frontend's OpenAI-compatible `/v1/audio/speech` endpoint after you set it up.

## Local server example

Run a compatible local service, such as Kokoro-FastAPI, then use the default Local preset:

```bash
docker run -d --name kokoro-fastapi -p 127.0.0.1:8880:8880 ghcr.io/remsky/kokoro-fastapi:latest
```

Consult the server's documentation for supported models, voices, and performance options.

## Realistic voice presets

- **Chatterbox** is the recommended local option for natural cloned narration. Run an OpenAI-compatible Chatterbox API such as `travisvn/chatterbox-tts-api`, then select **Chatterbox TTS API** in the extension and set the stored voice name.
- **Orpheus** prioritizes expressive English speech and emotion tags. Select **Orpheus-FastAPI** after starting a compatible server, then choose its voice (the preset uses `tara`). Orpheus-FastAPI supports WAV output only; the extension requests WAV automatically for this preset.
- **GPT-SoVITS** is best when you already have a consented reference voice. Run the upstream API with `python api_v2.py -a 127.0.0.1 -p 9880`, select **GPT-SoVITS api_v2**, then set the reference audio path and its transcript/language. The file path is on the server host; the extension does not upload reference audio.

Pyodide/WASM is deliberately not used for GPT-SoVITS: the upstream stack depends on PyTorch, torchaudio, FastAPI, and native audio/model libraries. Use its local Python server instead. Browser-native inference would require a separate ONNX/WebGPU export and runtime, not a Pyodide port.

## Limitations

- Chrome and Edge block extensions from injecting into browser-internal pages, Chrome Web Store pages, and some PDF viewers.
- A site can mark its exact reading target with `data-tts-content` (for example, `<article data-tts-content>`). The extension uses that marker before its Readability and semantic-element heuristics, which also recognize common `article`, `main`, ARIA-main, microdata, and content-class patterns.
- Main-text extraction remains heuristic when a page does not provide `data-tts-content`. When neither Readability nor a substantial semantic content element can establish an article, select the desired text instead.
- The configured endpoint must accept `POST /v1/audio/speech` with `model`, `input`, `voice`, `speed`, and `response_format` fields, returning playable audio.

## License

MIT. Mozilla Readability remains subject to its upstream license; the build emits its license notice next to the bundled extractor.
