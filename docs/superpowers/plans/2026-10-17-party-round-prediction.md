# Party Round Prediction Implementation Plan

> Execute inline with the existing TypeScript/NodeCG stack. The operator requested implementation and already delegated workflow decisions.

**Goal:** Show each player's current round score and whether their current pins would end the duel, inside the Party tab's Live duel card.

**Architecture:** A pure dashboard prediction module consumes existing presenter state, captured rules, live pin telemetry, connection identity, and party status. It never publishes scores or controls the game. Locked guesses use server scores; other pins use the documented map-distance formula. Health damage shares the presenter's half-even rounding, and Pinpointing reuses its points fold.

**Scope:** Two operator-only cards with projected score, lock state, remaining HP/points, and conditional win/loss. Both players need usable current-round pins before predicting an outcome. Active duel rules govern prediction, including Half tie range. Missing data, stale identity, rollback lag, settled rounds, and disconnected feeds cannot show a confident outcome. Double-5000 Pinpointing predictions wait for confirmed guess ordering. Health round limits are included; native healing predictions remain unavailable without a known healing rule.

- [x] Add domain tests covering missing pins, lethal/nonlethal differences, winner multiplier and half-even rounding, Half tie range, locked scores, Pinpointing, data identity, freshness, rollback, and recorded score formula evidence.
- [x] Implement `src/party/prediction.ts` and share the existing damage rounding helper without changing settled scoring.
- [x] Add compact projection cards to `dashboard/party-control.html/css/ts`, subscribing to existing pin telemetry and updating expiry checks.
- [x] Extend browser fixture validation for live pin updates, waiting/ending/continuing states, and mobile layout. Update the operator guide.
- [x] Run tests, typecheck, build, browser validation and diff checks; independently review the scoring/identity boundaries. No live party writes.

**Validation:** 658/658 tests, typecheck, build, `validate:party`, and diff checks passed. Desktop/mobile health projections and desktop Pinpointing projections were visually inspected. Independent review found an older pin event could overwrite a newer guess position; both telemetry event types now share timestamp ordering. The regression failed before the fix and passed afterward; independent focused verification passed 22/22 prediction and telemetry tests. No live GeoGuessr mutations were made. Restart NodeCG to load the shared telemetry fix and reload the dashboard.
