# Party Manager Implementation Plan

> Execute inline using the existing NodeCG/TypeScript stack. The user requested implementation immediately and delegated remaining workflow decisions.

**Goal:** A dedicated Party dashboard tab for preparing the lobby and operating broadcast duels.

**Architecture:** A server-only GeoGuessr client and manager publish sanitized party/duel status through a nonpersistent Replicant. Commands carry expected party/game/round identities and are serialized, checked against fresh server state, sent once, and verified through subsequent reads. The manager follows the presenter's live party selection; replay disables remote controls.

**Tech Stack:** TypeScript, NodeCG, native fetch, node:test; existing dashboard HTML/CSS conventions.

## Scope and decisions

- Live status, host identity, roster, map/rules, round timer, HP, guess status, start game, start round, pause after round, resume, abort, and paused-state rollback.
- Lobby roster: bench/unbench, swap positions, team assignment, kick/ban/unban, mute/unmute and host transfer. Destructive actions require an explicit dashboard confirmation.
- Lobby settings: Duels/TeamDuels, map, movement, timers, HP, multipliers, manual/automatic rounds and party access. Preserve fields the operator did not change. Settings edits are explicit drafts and reject concurrent changes.
- Reuse existing credentials without exposing cookies, chat access tokens, or privileged future panoramas. Join information is deliberately revealed by the operator.
- GeoGuessr state remains authoritative. Never auto-retry writes; distinguish accepted, confirmed, pending, failed and uncertain outcomes. Replay, wrong active party, non-host, stale state and wrong game/round disable writes.
- The current public web client (1.8333-9f74695) supplies roster routes missing from historical docs. Source verification is not live mutation validation.
- Presenter visual controls and tournament scoring remain independent; show useful match/Pinpointing status and a warning when server and presenter outcomes differ.

## Tasks

- [x] Add shared party types, sanitized parsers, settings validation and phase/command guards; test malformed state, future rounds, permission and replay boundaries.
- [x] Add server client/service and NodeCG registration; test exact requests, active-party mismatch, duplicate clicks, settings conflicts, 204 responses, verification/no-op/timeouts and secret redaction.
- [x] Add fullbleed Party tab with live controls, roster, settings drafts and activity feedback; verify interaction/layout against fixture-backed NodeCG messages.
- [x] Document protocol additions and operation; run the full tests, typecheck, build and diff check; review the final change and fix material findings.

## Review focus

Old commands after reconnect, ambiguous write outcomes, party changes during requests, newer rollback versions with decreasing round numbers, and competing settings edits must fail visibly without issuing a second mutation.

## Validation ledger

Initial checkout: main at acad8da; unrelated existing edit in graphics/info.css is outside this change. No live party writes are part of implementation validation.

- Full suite: 614 tests passed, including 25 focused party tests.
- Typecheck, build and `git diff --check` passed.
- `npm run validate:party` passed the browser-to-manager flow with fixture API responses: settings, game/round starts, pause/resume, rollback, abort, benching, conflicts, uncertain outcomes, replay and mobile layout. Desktop and mobile screenshots were visually inspected.
- Independent code review findings were fixed and verified with regression tests. Additional coverage pins commands across concurrent polling, preserves pending pause state on rejected aborts, and prevents confirmation before a write response arrives.
- Read-only live `/active` returned 204: no active party. Live mutation rehearsal remains outstanding; no party was created or modified.
- Concurrent repository changes are outside the feature scope and were preserved. No commit or push was requested or performed.

### Lobby readiness follow-up

- The operator's test party reproduced `isPresent: true` with `isPlaying: true` after a finished duel. The current public lobby source marks that state absent/translucent.
- Dashboard presence now distinguishes lobby, game/results, current duel and away states. Both dashboard and server wait for all selected players to return before starting; the finished phase no longer claims the lobby is ready.
- Regression tests failed against the original behavior and passed after the fix. Full suite: 616 passed, including 27 focused party tests. Typecheck, build, browser flow and diff check passed. The waiting-for-lobby screenshot was visually inspected.
- Live investigation used GET requests only; no test-party state was changed.

### Presenter scoring follow-up — 2026-10-15

- Party score cards consume the presenter's settled custom HP/multipliers or Pinpointing points. Active rules remain captured per duel; different configured rules appear as next-duel settings.
- Added round verdicts, match point, winner/draw/abort outcomes, and retained custom results after native abort. Native health remains visible in Game details; series wins stay manual.
- Unavailable custom calculations never substitute native HP. Same-round and earlier-round rollback waits for presenter reconciliation. Normalized party identity binds retained results to their originating party.
- Independent review found and verified fixes for abort winner fields, rollback lag, and automatic party changes. No important findings remain.
- Final verification: 631 tests passed, including 15 scoreboard tests; typecheck, build, browser validation and diff check passed. Custom score desktop/mobile screenshots were visually inspected. Browser validation used fixture API mutations only.

### Tournament presets follow-up — 2026-10-17

- Added twelve Day 1/Day 2 map and mode presets using the operator's map IDs and rulebook settings. Day 1 has three health duels; Day 2 has three Pinpointing Move and six health NoMove/NMPZ choices. All enable Half tie range, as clarified by rule 4.5.
- Loading fills an editable draft. Applying confirms native GeoGuessr settings before saving and verifying effective presenter rules. Presets preserve automatic-round cadence, unrelated setup, active-duel rules, and manual BO3 series scores.
- Stale configuration revisions, selection/host/game changes, save errors, and configuration overrides cannot silently confirm a partial application. Failed completion stays uncertain without automatic retries and blocks starting until acknowledged.
- Independent review completed with no remaining important findings. Post-save verification covers launch overrides that can otherwise mask persisted presenter rules.
- Final verification: 644 tests passed; typecheck, build, browser validation and diff check passed. Browser coverage includes preset drafts, health/Pinpointing switching, Half tie range, config conflicts, retained unrelated settings, and long map labels on mobile. Desktop and mobile preset screenshots were visually inspected. No live GeoGuessr mutation was sent.

### Preset apply error follow-up — 2026-10-17

- The operator's running NodeCG process started before the preset implementation. Validation-only Socket.IO probes returned `Unexpected command field` for presenter rule fields, confirming that the newer browser bundle was talking to the older extension.
- NodeCG serializes rejected acknowledgements as plain objects. The dashboard's `instanceof Error` check hid the server message behind a generic banner. It now reads string messages from serialized objects, Error instances, or string rejections.
- Browser regression reproduces a server-side preset revision rejection with NodeCG's serialized error shape, verifies its exact message and retained draft, then reloads and successfully applies the preset against the fixture API. The test failed before the fix and passes afterward; typecheck, build and diff check pass.
- Restarted the workspace's existing `npm run dev` terminal and restored its previous live test-party selection after startup loaded an older configured party ID. A validation-only probe confirms the updated preset handler; the live settings revision is unchanged and no GeoGuessr mutation was sent.
