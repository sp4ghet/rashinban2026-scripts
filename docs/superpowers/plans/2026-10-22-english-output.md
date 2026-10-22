# English output implementation plan

**Goal:** Add info-en.html and an English switcher with shared current-match data and an independent countdown.

**Architecture:** Reuse the Stream layer renderers and add an en Preview/Program bus. English player profiles and casters come from configurable players_en/casters_en tabs. Match identities, scores, picks, bracket and camera feeds remain shared. English controls stage their own visibility, card page, lower-third text and casters. The English operator selects either current-match player and a relay independently. Camera/card selection and visibility use the same linkage as Stream. The EN timer has its own persisted replicant; interval content remains shared.

**Tech stack:** Existing TypeScript, NodeCG, esbuild and node:test; no new dependencies.

## Tasks

- [x] Add regression tests and extend broadcast state with independent en operations, default migration and monitor URLs. Reuse the camera/card linked selection model on the EN bus without changing Stream.
- [x] Load configurable English sheet tabs independently; a failed English fetch must retain its previous values and cannot prevent Japanese tab updates. Match translations by stable identity and fall back to the shared profile when missing or ambiguous.
- [x] Register the independent EN interval timer and route English controls/renderers to it while sharing interval content and server clock.
- [x] Compose info-en.html, add English dashboard and caster selection, localize all name-bearing layers, retain the existing Stream layout and camera relay behavior.
- [x] Run typecheck, full suite and build. Exercise Preview/TAKE/Revert, both timer directions, independent player switching, English profiles, lower thirds, ban/pick, interval and bracket in a browser harness. Inspect screenshots and get an independent code review.

## Review focus

- Old persisted configuration and broadcast state must migrate without changing Stream or LED.
- Different display names must not mismatch players, scores, result opponents or camera sides.
- EN timer commands must never alter the main countdown, including pause/resume/clear and invalid commands.
- Stream Preview and Program edits must not change English selection or visibility; shared match updates must reach both.
- Missing English rows or a failed tab fetch must preserve useful graphics and avoid silently selecting another player.

## Review and validation record

Independent review found incomplete-translation identity/fallback cases. Fixed shared-profile identity preservation, upcoming-match fallback and stable bracket entrant IDs plus UID lookup through the shared player directory. Regression tests and browser checks reproduce the failures before their fixes. No deferred review findings.

Validated 32 actual English sheet profiles with fallback and confirmed-loaded Adobe fonts; Google CSV exports returned 32 players and 2 casters. Synthetic WebRTC camera acceptance passed 86 checks. NodeCG itself was not restarted during validation.
