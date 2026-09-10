# GeoGuessr Presenter Mode — capture-first design

Date: 2026-09-10

## Goal

Drive custom stream graphics (layouts per game mode, music cues, a custom 5K
effect, data merged from Google Sheets) from the live state of a GeoGuessr
party, instead of screen-capturing the built-in broadcast page.

## Decision: capture first, choose the display architecture later

Three options were considered:

1. **Tampermonkey forwards to NodeCG** (leading candidate). A userscript on
   the geoguessr tab is a dumb forwarder; the NodeCG extension normalises the
   messages into replicants; OBS graphics render them. Audio, layouts and
   external data all live in the existing bundle.
2. **Rewrite the broadcast page in place** with a userscript. Fast to
   prototype, but audio in a captured tab, cross-origin data, and geoguessr UI
   changes all make it fragile.
3. **Standalone page connecting to the socket directly.** Ruled out for the
   browser: auth rides on geoguessr cookies. (Connecting from the NodeCG
   extension with a copied `_ncfa` cookie does work, see below, and is a
   fourth option worth keeping in mind.)

The user chose to capture real traffic before committing. Protocol findings
are in `docs/geoguessr/presenter-protocol.md`; raw samples in
`docs/geoguessr/samples/`.

## What was built

- `tampermonkey/src/capture.ts` — framework-free hook that wraps
  `WebSocket` (connect / send / recv, text and binary) and `fetch`
  (method, url, status, bodies). Tested in Node with `node --test` against a
  real `ws` server and Node's native WebSocket client (`npm test`).
- `tampermonkey/src/geoguessr-capture.user.ts` — userscript entry.
  `@run-at document-start`, `@grant none`, matches all of geoguessr.com.
  Buffers interesting events, logs them to the console under `[rb-capture]`,
  and mounts a small panel with **Download** (JSON) and **Clear**. Also
  exposes `window.__rbCapture`.
- `scripts/build.mjs` builds every `tampermonkey/src/*.user.ts` to
  `tampermonkey/<name>.user.js` with the `==UserScript==` header kept as a
  banner. The built userscript **is committed** (unlike bundle output) so it
  can be installed from the repo.

## Key protocol facts that shape the next step

- The broadcast page polls the party over REST every 5 s and only renders
  **Duels / TeamDuels**; other modes show the idle screen.
- Game state arrives on `wss://gs2.geoguessr.com/<node>/<lobby>/spectate/ws`
  as JSON text. Every `Duel*` message carries the whole state with a
  `version`, so a consumer just replaces state.
- The same socket can be opened from Node with the `_ncfa` cookie. That
  means the NodeCG extension could subscribe directly and the browser
  userscript becomes optional, at the cost of copying a cookie into config.

## Scope decided during capture

- 1v1 Duels only. Healing rounds never enabled. TeamDuels and other modes are
  out of scope.
- Four duels were captured (`docs/geoguessr/samples/`), covering a 5K, a max
  round timer, no-pin timeouts, a player refresh, a host abort, and party
  chat/emotes. There is no special 5K message; it is a `DuelPlayerGuessed`
  with `score: 5000`, detectable the instant the guess lands.
- Chat and emotes require a second socket (`wss://api.geoguessr.com/ws`)
  subscribed to the party chat topic with the party's `chatAccessToken`.
  In-game chat topics are denied to spectators, but in-game messages arrive
  on the party topic when in-game chat is not isolated.

## Next

1. Pick between option 1 (userscript forwarder) and the extension-side
   subscriber (cookie in NodeCG config), then define the `duelState`
   replicant shape and the derived events (round start, guess, 5K, round
   result, finish).
2. Build the normaliser in the extension with
   `gs2-ws-full-duel-sequence.json` as the test fixture.
