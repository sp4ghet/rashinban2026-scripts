# Pinpointing Duels

Date: 2026-10-07. Approved for implementation.

## Purpose and scope

Add the RASHINBAN 2026 "Pinpointing Duels" ruleset to the custom presenter and
to the player userscript. The ruleset replaces health with points. The rulebook
excerpt in force:

> Both players 5000 pts: only the player who guessed first scores 1 point.
> Only one player 5000 pts: that player scores 2 points.
> Both players 4999 pts or less: only the higher score scores 1 point.
> The first player to reach 7 points wins the game.

Decisions made with the organiser on 2026-10-07:

- **No early-send penalty.** The GeoClassics scripts zero a round score when
  the first guesser guesses early without a 5K. The event sets Time After
  Guess and Max Round Time both to 90 s, so the penalty would never matter.
- **Tie range applies when it is enabled.** In a "both under 5000" round the
  higher score scores only if it beats the other by more than the tie band
  (`floor((5000 - best) / divisor)`, Full divisor 1, Half divisor 2). With tie
  range off the band is 0, so any strictly higher score scores. Equal scores
  never score.
- **First to 7 is fixed.** No target setting in the dashboard or userscript.
- **Points replace HP on stream.** The presenter's HP boxes become point
  counters and the damage animation becomes a round verdict.
- The feature is called **Pinpointing Duels** in every label.

Research and the vendored reference scripts are in
[pinpointing-duels-userscripts.md](../../geoguessr/pinpointing-duels-userscripts.md).

## Shared rules core

`bundles/rashinban/src/presenter/pinpointing-core.ts` is a pure, browser-safe
module used by the extension and the userscript, beside `tie-range-core.ts`.

Input per settled round: `round`, both server scores (`roundResults[].score`),
and both sides' **guess time**: the `created` time of the side's first guess
made strictly before the round's `endTime`, or `null` when the side has no
such guess (no guess at all, or only the auto-submitted timeout guess, whose
`created` is after `endTime`). The tie-range mode (`off`, `full`, `half`) and
the two team IDs complete the input. Rounds must be contiguous from 1 with
integer scores from 0 through 5000.

Per round, in order, stopping after the round in which a side reaches 7:

- both 5000: 1 point to the earlier guess time; equal or unknown times give
  nothing (reason `fastest-5k`, winner `null`).
- exactly one 5000: 2 points to that side (reason `solo-5k`).
- otherwise: band as above; the higher score scores 1 point when the
  difference exceeds the band (reason `closest`), else nothing (reason `tie`).

Output: per round `{ round, scores, guessedAtMs, points, totalsBefore,
totalsAfter, winner (0 | 1 | null), reason, band, withinBand, fiveKs }`,
`totals`, `matchPoint` per side (total ≥ 5, because a solo 5K scores 2),
and `terminal: { round, winnerTeamId } | null`. Rounds after the terminal
round are ignored. `FIRST_TO` is exported as 7.

## Presenter

**Settings.** `PresenterSettings.pinpointing = { enabled: boolean }`, default
off, parsed with a migration default so existing settings keep their values.
The shared configuration schema allowlists the field. The dashboard gets a
**Pinpointing Duels** fieldset with an enable checkbox and an active/next-duel
status line. Tie range keeps its own controls and combines with pinpointing.

**Capture.** `RuleContext` gains `pinpointing: boolean`, captured with the
tie-range mode when a game ID is first accepted and never changed for that
game. Persisted contexts without the field read as `false`. Settled round
inputs (results, guesses, rounds) are frozen when either rule is active.
Reconnect, restart, replay resume and explicit replay restart behave exactly
as for tie range.

**Derivation.** `presenter/pinpointing.ts` exports
`derivePinpointing(state, tieRangeMode): DuelState`. It validates completed
history the way `deriveTieRange` does (paired unique results, panorama per
round, valid scores) and additionally requires `endAtMs` on every completed
round. It folds the core and returns a derived state with:

- `state.pinpointing = { firstTo: 7, totals, matchPoint, rounds }`.
- `state.tieRange = { mode, rounds: band metadata }` when tie range is on, so
  the existing results-map circles and label keep working. The HP replica is
  not applied; server health is left as received and not shown.
- A custom finish when a side reaches 7: `status: 'Finished'`, `winnerTeamId`,
  `isDraw: false`, `round` set to the terminal round, later rounds, guesses
  and results truncated. This matches the tie-range knockout, so later server
  rounds, an abort after the finish, and an authoritative rollback already
  behave correctly.
- A server finish before 7 points keeps `status: 'Finished'` with
  `winnerTeamId: null` and `isDraw: false` (label GAME FINISHED) and raises a
  dashboard warning. An abort before 7 keeps the cancelled presentation.

Missing inputs raise, and `register.ts` publishes the warning
"Pinpointing calculation unavailable: ..." while withholding the duel, as it
does for tie range. `present()` picks `derivePinpointing` when the context
captured pinpointing, else `deriveTieRange`.

**Timeline and scoring.** With `state.pinpointing` present,
`scoreCalculation` returns `{ tied: winner === null, hasDamage: false,
winnerId, loserId, difference, damage: 0, multiplier: 1, pinpointing: {
points, reason, totalsBefore, totalsAfter, matchPoint } }`. `scoreSequence`
keeps entry, count and score-hold, then a new `verdict` stage at the usual
subtract moment and completes 2.5 s later. No subtract, difference,
multiplier, flight or impact stages; `damageAtMs` is null. Cues: `results`,
`count`, then `collision` for a scoring round or `tie` for a round without a
point. The 5K video effects and their reveal delay are unchanged.
`ScoreProjection` gains `verdictProgress`, and `Projection.players[]` gains
`points` (totalsBefore until the verdict stage starts, then totalsAfter) and
`matchPoint`.

**Graphic.** `body[data-ruleset="pinpointing"]` restyles the two HP boxes as
point counters: the number of points, a fill of points out of 7 in the side
colour, and a match-point highlight. The DAMAGE boxes read POINTS with
"FIRST TO 7", or MATCH POINT for a side on match point. During the verdict
stage a banner in the scoring layer shows `+2 SOLO 5K`, `+1 FASTEST 5K`,
`+1 CLOSEST` on the scoring side, or `TIE · NO POINT` in the centre, and the
scoring side's counter ticks up. The summary shows `NAME WINS` as today with
the counters still visible.

## Player userscript

The existing `rashinban-tie-range.user.js` is extended (same file and
userscript name, version 0.2.0) rather than adding a second script.

- The settings panel and the Tampermonkey menu entry (renamed **RASHINBAN:
  Player settings**) offer the tie-range mode and a **Pinpointing Duels**
  checkbox. Both are captured per game at first attachment; later edits show
  "applies next duel". The HUD button shows the configured rules.
- `PlayerGameContext` schema version 2 adds `pinpointing: boolean` and, per
  settled round, `guessedAtMs: [number | null, number | null]` decoded from
  `teams[].players[].guesses[].created` against `rounds[].endTime`. Version 1
  contexts migrate with pinpointing off and null timings. Settled rounds are
  compared including timings; rollback handling is unchanged.
- If the player endpoint does not expose the opponent's guess timing, a
  both-5K round scores nothing and the HUD shows "Guess timing unavailable,
  host decides". This could not be verified offline (the recorded player
  captures omit guesses) and is a live validation item.
- `PlayerTieRangeView` gains `pinpointing: PinpointingOutput | null`; the HP
  output is computed only when pinpointing is off and tie range is on. The
  display model gets a pinpointing branch: teams with `points`, `matchPoint`
  and `firstTo`, a round result with points and reason, and a terminal
  "You win 7–4" / "You lose 4–7" with "Custom duel finished — wait for the
  host". The HUD shows `You 3 / 7 · Opponent 2 / 7`, suppresses the native HP
  bars and damage animation as today, counts the scores with native timing,
  then shows the verdict text instead of damage flight. The native summary's
  HP columns are replaced by running points. Tie-range circles on the results
  map remain when tie range is on.

## Verification

- Core unit tests: every branch, earlier/equal/null timings, solo 5K jumping
  from 5 or 6 to 7, closest with and without the band, exact ties, match
  point, termination and ignored later rounds, input validation.
- Presenter tests: derivation on recorded captures, truncation at 7, server
  finish before 7, abort before and after, context capture and migration,
  settings parse and migration, scoring sequence stages and cues, projection
  points, register integration (latching, restart, replay).
- Player tests: decoder timings and missing guesses, schema migration, view
  model and controller statuses.
- `npm test`, `npm run typecheck`, `npm run build`.

Documentation: `docs/presenter/pinpointing.md` for operators and players,
updates to `docs/presenter/player-tie-range.md`, `docs/presenter/tie-range.md`
and `docs/configuration.md`.
