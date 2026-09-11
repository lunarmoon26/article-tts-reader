# Blog Website Controls Protocol

**Status:** Implemented — extension bridge and blog control surface

## Purpose

Article TTS Reader exposes a narrow, user-whitelisted page bridge. Its disabled-by-default whitelist starts with `https://blog.haochuanz.net/posts/*`; users may explicitly enable that pattern or add other exact HTTPS host-path patterns. The bridge lets a rendered post detect an installed extension, start reading its own article, control its own playback, and show sanitized progress.

The public page does not read or write endpoint settings, API keys, extension storage, tab IDs, session IDs, or arbitrary text. Article extraction remains inside the extension and continues to prefer the page's existing `[data-tts-content]` marker.

## Extension implementation

- `src/manifest.json` declares no static website bridge. The background dynamically registers one only for patterns enabled in the user's settings and granted through Chrome's optional-host permission prompt.
- `src/background.ts` supports internal `GET_PLAYBACK_STATUS`, `START_ARTICLE`, `CONTROL_PLAYBACK`, and `STATUS_UPDATE` messages, plus sender-tab-scoped `WEBSITE_CONTROL` messages.
- `src/extractor.ts` already prefers `[data-tts-content]` over its Readability and semantic fallbacks.
- `build.mjs` packages `website-bridge.js`, which turns the DOM event protocol into internal extension messages.
- `lunarmoon26.github.io/src/app/posts/[slug]/page.tsx` mounts `ArticleTtsControls` on every post. `PostHeader` renders it between the cover image and post date.
- `lunarmoon26.github.io/src/app/_components/article-tts-controls.tsx` owns the page control state, event validation, availability detection, command timeouts, and accessible button labels.

The page control surface never reads endpoint settings, API keys, extension storage, tab IDs, session IDs, arbitrary article text, or a playback title. It consumes only the validated, sanitized playback fields it displays: status, message, progress, and active state.

## Trust boundary

The extension dynamically registers one inert content script at each enabled origin so that client-side navigation can reach a post without a full reload. The background accepts commands only when the current page URL matches the configured path pattern:

```js
chrome.scripting.registerContentScripts([{
  id: "article-tts-reader-website-bridge",
  matches: enabledPatterns,
  js: ["website-bridge.js"],
  runAt: "document_start",
  persistAcrossSessions: true
}]);
```

Chrome grants each enabled pattern before registration. Host permissions apply to an origin rather than a path, and the bridge registration uses that origin so a Next.js-style client-side navigation can reach a matching post. That does not authorize homepage or other-path controls: the bridge forwards its current URL and the background validates it against the configured path before every command or status request. The bridge runs only in the top frame. It accepts only protocol version `1`, well-formed action names, and requests originating from that matched document. It does not use `externally_connectable`, automatic third-party site registration, localhost matches outside development mode, or user-controlled endpoint URLs. An enabled pattern must be an exact HTTPS host path ending in `*`, such as `https://example.com/posts/*`; wildcard hosts are rejected.

The DOM event boundary is appropriate because the page and the content script share the same document but do not share an extension runtime context. It is not an authorization mechanism outside the enabled whitelist. Disabling website controls unregisters the bridge; it does not automatically revoke an already-granted Chrome host permission.

## Version 1 page events

### Local development exception

The popup's opt-in development mode adds `http://localhost:3000/posts/*` while website controls are enabled. It is off by default. Chrome registration and permission requests use `http://localhost/*` because match patterns cannot restrict ports and the bridge must survive client-side navigation; the bridge and background restrict runtime access to port 3000 and `/posts/`. Other HTTP hosts and ports remain unauthorized. Disabling development mode blocks local requests and notifications; enabling requires saving, granting Chrome access, and reloading the page. This is the sole exception to the HTTPS-only whitelist above.

All event details include `protocolVersion: 1`.

### Page to bridge

| Event | Required detail | Meaning |
| --- | --- | --- |
| `article-tts-reader:request-status` | `requestId` | Requests an installation acknowledgement and the caller tab's sanitized playback state. The website dispatches this after registering listeners so it does not miss an early bridge load. |
| `article-tts-reader:command` | `requestId`, `action` | Requests `start`, `pause`, `resume`, or `stop` for the caller tab's reading session. |

### Bridge to page

| Event | Required detail | Meaning |
| --- | --- | --- |
| `article-tts-reader:ready` | `protocolVersion` | Proves that a compatible bridge is active on this document. |
| `article-tts-reader:status` | `playback` | Reports the caller tab's sanitized state whenever it is requested or changes. |
| `article-tts-reader:result` | `requestId`, `ok` | Acknowledges one request. A failed result includes a user-safe `error` string. |

`playback` contains only:

```ts
{
  status: "idle" | "loading" | "playing" | "paused" | "complete" | "stopped" | "error";
  message: string;
  title: string;
  progress: { current: number; total: number };
  active: boolean;
}
```

The bridge sends an idle state when the extension has no website-started reading session for its sender tab and document. It never reports another tab's title, progress, or status, or a previous document's session after navigation. Popup and context-menu sessions remain controlled through the extension.

Background notifications target the source document and check that its whitelist entry remains enabled and permitted. Disabling the bridge blocks further commands and notifications even on already-open pages; reload pages after enabling it. Patterns permit a single trailing `*`, not embedded wildcards. Chrome host permissions are origin-wide; the bridge's path restriction is enforced by script registration and background validation.

## Extension behavior

1. `website-bridge.js` registers its document event listeners before announcing readiness.
2. For a status request, the bridge calls a new internal background message that returns playback only when its `sourceTabId` matches `sender.tab.id`; it then emits `ready`, `status`, and the matching `result`.
3. For `start`, the background calls `startReading(sender.tab.id)`. It does not query the active tab.
4. For `pause`, `resume`, and `stop`, the background applies the existing playback control only when the active session belongs to `sender.tab.id`.
5. `writePlayback` sends the existing internal popup update and a targeted `chrome.tabs.sendMessage` update to the source tab. The bridge converts the targeted update into a sanitized `status` event.
6. A missing content script or a non-matching page creates no error in the extension. The website simply receives no `ready` event.

## Website control behavior

Each post renders a **Listen with Article TTS Reader** control between its cover image and date. The control has an icon-only, accessible **Play/Pause** toggle and a **Stop** button.

- Initial state is `checking`: both buttons are disabled, the status line says that it is checking for the extension, and the component dispatches `article-tts-reader:request-status` after registering its `ready`, `status`, and `result` listeners.
- A valid `ready` or `status` event marks the bridge available. If neither arrives within 1 second, the controls remain disabled, the status line explains that the extension must be installed and Website controls enabled for the site, and a link to `https://github.com/lunarmoon26/article-tts-reader` is shown.
- The toggle sends `start` when playback is inactive, `pause` while active and not paused, and `resume` while paused. Stop is enabled only while playback is active.
- While a command acknowledgement is pending, both controls are disabled. After 10 seconds without an acknowledgement, the control clears its pending state and reports a retryable timeout without claiming that playback stopped.
- The status line displays the extension message and appends `Segment current of total.` when a positive progress total is available. The page does not display the sanitized playback title.

## Acceptance criteria

1. A post without the extension shows disabled controls and an installation link after the 1-second detection timeout, with no console error.
2. A post with the extension receives `ready`, displays the current state for that tab, and never exposes endpoint settings or another tab's playback details.
3. Start reads the page's marked article body. Pause, resume, and stop affect only the same tab's session.
4. Status transitions from loading through playing, paused, complete, stopped, or error update the post control without reopening the extension popup.
5. The extension injects no bridge outside the user's enabled whitelist; a page on another origin or path cannot use the protocol.
6. Desktop and mobile post layouts preserve cover, controls, date, and tag order.

## Non-goals

- Chrome Web Store publishing or installation flows.
- Endpoint setup, API key entry, provider selection, or voice selection on the website.
- Controlling playback on another tab or synchronizing site state across tabs.
- A generic website SDK or automatic support for arbitrary third-party origins. Each website remains disabled until the user explicitly whitelists it and grants Chrome access.
