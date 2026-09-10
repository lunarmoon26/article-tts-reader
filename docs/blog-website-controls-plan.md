# Blog Website Controls Plan

**Status:** Partially implemented — Stage 1 is complete; blog and integrated verification remain pending.

The protocol authority is [Blog Website Controls Protocol](./blog-website-controls-protocol.md). This plan sequences the two repositories without changing current playback behavior until the protocol has tests.

## Stage 0: preflight

1. Recheck both worktrees and preserve unrelated edits, especially the current changes under `src/background.js` in this repository.
2. Review the protocol's manifest scope, page-event payloads, tab ownership rule, and status redaction before editing.
3. Confirm that `https://blog.haochuanz.net/posts/*` remains the disabled-by-default pattern. Other sites require an explicit user whitelist entry and Chrome optional-host permission; do not add a static broad manifest match.

## Stage 1: extension bridge — complete

1. `src/website-bridge.js` validates protocol version, request IDs, and commands; forwards requests; and emits sanitized DOM events.
2. `src/manifest.json` keeps website bridge access optional. `src/background.js` dynamically registers only enabled user-approved patterns after Chrome grants their exact host permissions.
3. `src/background.js` reuses `startReading`, `writePlayback`, and offscreen controls through sender-tab-scoped website messages.
4. Status reads and controls require the sender tab's `sourceTabId`; updates use targeted `chrome.tabs.sendMessage` while retaining popup `STATUS_UPDATE` messages.
5. `build.mjs` copies the bridge and `scripts/verify-build.mjs` checks the built artifact and exact production scope.
6. `scripts/test-website-controls.mjs` covers bridge readiness, malformed details, all controls, tab mismatch rejection, redacted errors, and targeted updates.
7. The completed checks are:

   ```sh
   npm test
   npm run verify
   ```

## Stage 2: blog control surface

1. Add a client component for the protocol in `lunarmoon26.github.io` and mount it in `PostHeader` after `CoverImage` and before `DateFormatter`.
2. Model only the protocol states: unknown, unavailable, idle, loading, playing, paused, complete, stopped, and error. Keep controls disabled until readiness confirms the extension.
3. Render the GitHub installation link only for the unavailable state. Keep its destination in one named constant so a Chrome Web Store URL replaces it in one change.
4. Remove the Article TTS Reader footer link. Retain the project index entry.
5. Add static and browser coverage for the unavailable state, ready/idle state, active state, paused state, and an incoming error state. Check desktop and mobile layout order.
6. Run:

   ```sh
   bun run validate-frontmatter
   bun run build
   ```

## Stage 3: integrated verification

1. Build the extension and load `dist/` in Chromium with the extension enabled.
2. Open a published blog post with exactly one `[data-tts-content]` target.
3. Verify the disabled installation state without the extension, then the ready state after loading it.
4. With a configured test endpoint, verify start, loading status, playback progress, pause, resume, stop, completion, and source-tab navigation cleanup.
5. Open a second blog tab and verify it cannot inspect or control the first tab's session.
6. Open a non-blog origin and verify the bridge is absent.

## Release and rollback

- Ship the extension bridge before the blog control surface. A blog release without the bridge remains safe because controls stay disabled and link to installation guidance.
- Roll back the blog component independently by removing its mount. Roll back the extension bridge independently by removing its manifest declaration and built artifact.
- Do not remove existing popup or context-menu controls during this work. They remain the fallback control path.

## Documentation closure

When implementation passes, change both documents from **Proposed** to **Implemented** and reconcile any real protocol differences. Update `README.md` with the supported blog control surface and its exact origin restriction.
