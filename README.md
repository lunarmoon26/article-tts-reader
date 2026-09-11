# Article TTS Reader

Manifest V3 extension for Chrome and Edge that extracts a page's main article with Mozilla Readability, then narrates it through one user-configured neural TTS endpoint.

It intentionally supports five maintained TTS choices:

- **Local:** [Kokoro 82M](https://github.com/hexgrad/kokoro), via a self-hosted OpenAI-compatible server such as [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI).
- **Local Chinese narration:** [CosyVoice 2](https://github.com/FunAudioLLM/CosyVoice), via the OpenAI-compatible [Vox Box](https://github.com/gpustack/vox-box) adapter.
- **Realistic local/voice-cloned:** [Chatterbox TTS API](https://github.com/travisvn/chatterbox-tts-api), exposed through an OpenAI-compatible endpoint.
- **Experimental local narration:** [Higgs TTS 3](https://huggingface.co/bosonai/higgs-tts-3-4b), served through SGLang-Omni.
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
- **Play/Pause** waits at the next safe boundary when a request is already in flight. **Stop** aborts the current request, unloads the active audio element, and prevents further chunks from being generated.
- Closing or navigating the source tab stops its active reading session, including client-side URL changes (such as Next.js navigation). The extension aborts its synthesis request and unloads audio. Releasing server-side inference also requires the TTS server to cancel upstream work on client disconnect; aborting a browser request alone cannot guarantee that.

## Website controls

The popup's **Website controls** section is disabled by default and starts with `https://blog.haochuanz.net/posts/*`. Enable it to grant that exact site path access, or replace/add one HTTPS host-path pattern per line (for example, `https://example.com/posts/*`). Wildcard hosts, ports, queries, and HTTP patterns are rejected. Chrome grants host access at the origin level, so the bridge is loaded across that enabled origin to support client-side navigation, but it accepts commands only on the configured path. Disabling the controls unregisters the bridge but keeps any Chrome permission already granted.

An enabled page can start and manage reading only for its own tab, and receives only sanitized playback status. It never receives endpoint settings, API keys, session IDs, or another tab's playback. The protocol is documented in [`docs/blog-website-controls-protocol.md`](docs/blog-website-controls-protocol.md).

For local development, enable **Website controls** and **Development mode: localhost:3000/posts/***, then save, approve Chrome access, and reload your local post. Development mode is off by default and allows only `http://localhost:3000/posts/*`. Chrome's host permissions and script match patterns cannot restrict ports, so the registration uses `http://localhost/*`; the bridge and background enforce port 3000 and `/posts/` at runtime. Disabling development mode blocks local commands and status updates without changing your HTTPS whitelist.

## Models and voices

The OpenAI preset offers the documented Speech API models—`gpt-4o-mini-tts`, `tts-1`, and `tts-1-hd`—and only shows voices supported by the selected model. The current lists are sourced from OpenAI's [Text-to-speech guide](https://platform.openai.com/docs/guides/text-to-speech). `gpt-4o-mini-tts` exposes all 13 built-in voices; `tts-1` and `tts-1-hd` expose their documented nine-voice subset.

Kokoro, CosyVoice, and Chatterbox retain a **Custom…** choice for model and voice values supported by their selected server.

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

## Local server example

Run a compatible local service, such as Kokoro-FastAPI, then use the default Local preset:

```bash
docker run -d --name kokoro-fastapi -p 127.0.0.1:8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest
```

Consult the server's documentation for supported models, voices, and performance options.

### CosyVoice 2

The **CosyVoice 2 (Vox Box)** preset targets `http://127.0.0.1:8080/v1/audio/speech`, model `cosyvoice`, and the adapter's built-in `Chinese Female` voice. Vox Box exposes an OpenAI-compatible endpoint, returning playable audio, while its CosyVoice backend supplies seven built-in voices. Start it locally with:

```bash
pip install vox-box
vox-box start --huggingface-repo-id FunAudioLLM/CosyVoice2-0.5B --data-dir ./vox-box-data --host 127.0.0.1 --port 8080
```

The CosyVoice source is Apache-2.0 licensed. To use a different built-in adapter voice, choose **Custom…** and query `GET /v1/voices` on the running server.

### Higgs TTS 3

The **Higgs TTS 3** preset targets a local SGLang-Omni server at `http://127.0.0.1:8000/v1/audio/speech` and sends its native minimal `{ "input": "…" }` request. Follow the model card's SGLang-Omni serving instructions for `bosonai/higgs-tts-3-4b`; the server must be running before using the preset.

Higgs TTS 3 is not a general production option: its weights use Boson's research and non-commercial license. The creator-use grant permits monetized audio content with prominent Higgs Audio attribution, but does not permit embedding the model in an application or service. Obtain a commercial license before any use beyond the documented grant. Never clone a voice without its owner's consent.

## Voice cloning

- **Chatterbox** is the recommended local option for natural cloned narration. Run an OpenAI-compatible Chatterbox API such as `travisvn/chatterbox-tts-api`, then select **Chatterbox TTS API** in the extension and set the stored voice name.

## Limitations

- Chrome and Edge block extensions from injecting into browser-internal pages, Chrome Web Store pages, and some PDF viewers.
- A site can mark its exact reading target with `data-tts-content` (for example, `<article data-tts-content>`). The extension uses that marker before its Readability and semantic-element heuristics, which also recognize common `article`, `main`, ARIA-main, microdata, and content-class patterns.
- Main-text extraction remains heuristic when a page does not provide `data-tts-content`. When neither Readability nor a substantial semantic content element can establish an article, select the desired text instead.
- Kokoro, CosyVoice, Chatterbox, and OpenAI require a `POST /v1/audio/speech` endpoint that accepts `model`, `input`, `voice`, `speed`, and `response_format`, returning playable audio. Higgs TTS 3 uses its local SGLang endpoint's minimal `{ "input": "…" }` schema.

## License

MIT. Mozilla Readability remains subject to its upstream license; the build emits its license notice next to the bundled extractor.
