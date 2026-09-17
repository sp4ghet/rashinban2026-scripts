# Player tie-range userscript

Date: 2026-09-12. Approved for implementation; updated with live player evidence.

## Purpose and decisions

Give each player the same custom HP, damage multipliers, and duel outcome as
the standalone tie-range presenter. The user confirmed that players will not
connect to NodeCG for now and may configure the tournament's tie-range mode
themselves. Support the presenter's two single-player teams in MOVE, NM, and
NMPZ, including embedded `/party/lobby` games and games reached through
`/duels/<id>` or `/team-duels/<id>`.
The latter URL does not imply support for multi-player teams.

Use the player's authenticated duel results and the same pure scoring code as
the presenter. Agreement requires the same mode, rules version, and settled
history. The script cannot verify the host's selected mode without a connection.
Numerical results must match; animation timing need not match the presenter's
broadcast delays and celebrations.

## Approach and alternatives

**Recommended: standalone client, shared scoring module.** Bundle the rules
with the userscript, fetch the player's duel state, and render a custom HUD.
This satisfies the offline-from-NodeCG requirement without maintaining a second
implementation of scoring arithmetic.

A NodeCG-fed HUD would also synchronize the active setting and corrections,
but requires connectivity the players will not have. Forking the vendored
Pinpointing Duels script would reuse some DOM work, but brings a different
points system and a MOVE-only restriction; use it as integration research only.

## Settings and installation

Produce `tampermonkey/rashinban-tie-range.user.js` from
`tampermonkey/src/rashinban-tie-range.user.ts`. The existing esbuild script
already discovers `*.user.ts` entry points and preserves their metadata headers.
Distribute a fixed tested userscript version alongside the tournament presenter.

Expose a Tampermonkey menu entry, **RASHINBAN tie-range settings**, with Off,
Full, and Half. Start Off until configured; save the preference across sessions.
Show a small persistent `Tie range: Full` or `Tie range: Half` label when active.
Players configure this once before their first duel and compare it with the host.
Do not expose manual HP or multiplier inputs: read those game settings from
GeoGuessr.

Capture the mode per game ID at first successful attachment, just as the
presenter does. Later edits show **Applies to next duel**. Reloading the same
game restores its captured mode. If configured incorrectly after attachment,
resolve the mismatch with the host and start a new duel; silently changing an
active game's rules is not supported.

Match `https://www.geoguessr.com/*` so arrival through SPA navigation works,
but activate only on supported duel routes. Use `@noframes`. Store preferences
and compact per-game context with `GM_getValue` / `GM_setValue`, and expose
settings with `GM_registerMenuCommand`, as supported by the
[Tampermonkey API](https://www.tampermonkey.net/documentation.php).

## Player data and lifecycle

Party discovery reads `GET /api/v4/parties/v2/active` on GeoGuessr. Resolve
its lobby ID through `/api/v4/game-server/phonebook/<id>`, then read the active
player snapshot at `https://gs2.geoguessr.com/<nodeId>/<id>` with credentials
included. The legacy `game-server.geoguessr.com/api/duels/<id>` response was
observed stuck at Created/version 0 during an active game. Use it only after
the phonebook positively reports Finished/inactive/archive status. The player
script uses no spectator endpoint, game-master cookie, or NodeCG credential.

Fetch immediately on duel entry and then every 2.5 seconds, matching the
vendored script's cadence. Use one in-flight request, a timeout, and bounded
backoff for network errors or rate limiting. Check for route changes with the
same lifecycle scheduler; discard responses belonging to an old route or game.
Refresh immediately on focus restoration. Stop fetching when leaving a duel.
Continue checking after custom completion so a rollback or new game can be seen.

Normalize into a small scoring input: game ID, version, status, current round,
team/player IDs, initial HP, multiplier options, maximum rounds, round identity,
and paired resolved team scores. Use `teams[].roundResults[].score`; do not
infer a resolved result from a provisional guess, elapsed timer, or DOM text.
Resolve the local player's team from account identity and player membership,
not team array position or the presenter's left/right mapping. If identity is
unavailable, use explicit blue/red team labels until it is known.

The existing presenter decoder requires panorama data and spectator message
envelopes. Do not fabricate those fields to make a player response pass it.
Keep a player-specific decoder and share a narrower scoring input instead.
No location or opponent guess data is needed by the HP HUD.

## Shared rules contract

The in-progress presenter implementation provides `deriveTieRange` in
`bundles/rashinban/src/presenter/tie-range.ts`, with context handling in
`tie-range-context.ts`. Integrate against its completed version. Extract its
arithmetic into a browser-safe pure core accepting the input above; preserve
`deriveTieRange` as the presenter adapter. Both adapters call that core, and
existing presenter parity tests must continue to pass. Do not import paths
from `.worktrees/` into production code.

The shared output contains per-round pre/post HP, pre-round multiplier,
next-round multiplier, damage dealt, band, within-band verdict, and terminal
round/winner/draw. Keep team IDs throughout; orient only at rendering time.

Rules follow the [presenter design](2026-09-12-presenter-tie-range-design.md):

- Full band is `5000 - bestScore`; Half is `floor((5000 - bestScore) / 2)`.
- A positive score difference always deals damage, including inside the band.
  Multiply by the winner's pre-round multiplier, round half-to-even, and clamp
  remaining HP at zero. Keep full damage separate from clamped HP loss.
- Store multiplier arithmetic in tenths. Respect the game's individual and
  mutual increments and rounds-without-multipliers setting.
- At the increment step, both teams receive the individual increment inside
  the inclusive band; otherwise only the higher-scoring team receives it.
- Exact ties deal zero damage. A 5000/4999 result is outside the band.
- Stop at the first custom knockout or resolved maximum round. At the round
  limit, higher remaining custom HP wins; equal HP draws. Terminal rounds
  receive no next-round multiplier increment.

Example: with 6000 HP, Full, individual +0.5, mutual 0, and increments enabled,
4000 versus 3500 deals 500 damage and leaves both multipliers at 1.5x for the
next round. Labeling this as a damage-free tie would be incorrect.

## Reloads, rollback, and failures

Recalculate from settled inputs rather than adding damage on each poll. Persist
the captured mode, rules version, accepted source version, round identities,
and settled score inputs per game. Bound storage to the ten most recent games;
never evict the current game. A reload restores numbers without replaying old
damage animations. Separate game keys prevent one tab from changing another
game's context.

Reject older responses and process equal versions idempotently. Freeze paired
settled results on acceptance, consistent with the presenter. A confirmed
authoritative rollback releases the affected suffix and reruns the fold,
including removal of a custom winner. Reuse the presenter's rollback semantics
where the player transport exposes equivalent evidence. Missing history alone
is not sufficient proof of rollback; ambiguous snapshots enter a recovery
state rather than erase settled rounds.

A failed fetch retains the last verified values with **Reconnecting**. After
ten seconds without a successful response, show **HP may be out of date**.
Successful polling is freshness evidence even if the game version is unchanged.
Missing required rules or incomplete history shows **Custom HP unavailable**;
never substitute native HP while labeling it as tie-range HP. A reload or
late join with no complete history and no valid local context also uses this
state. Restore normal UI when Off or outside supported duels.

## Player display

Mount a script-owned HUD with isolated styles. Show **You** and **Opponent**,
numeric HP plus bars, and each team's effective multiplier. Preserve the
native timer, guessing controls, map, and navigation. Replace or cover only
native HP and multiplier surfaces once the custom HUD has valid data. Scope
DOM selectors to known containers and restore every modification on teardown.
A small MutationObserver reattaches the HUD when React replaces those containers.

During results, show the completed round's damage and pre-round multipliers,
then clearly label the next-round multipliers. Explain an unequal-score band
result with **Within tie range — both multipliers increase**, alongside the
actual damage. Account for delayed increments and terminal rounds rather than
announcing an increase that will not happen. Reveal result details only after
the native results screen appears, or after the game has advanced beyond that
completed round. Do not derive or expose live opponent scores.

Suppress conflicting native damage and outcome labels only in verified result
containers. If a changed GeoGuessr layout prevents safe replacement, keep the
custom HUD clearly labeled and show **Native values may differ** instead of
hiding broad page sections.

At custom completion, keep the terminal HP and show **You win**, **You lose**,
or **Draw**, with **Custom duel finished — wait for the host**. Preserve this
through a later server round or host abort. Do not send guesses, abort the
game, advance rounds, or change series scores. A confirmed rollback can clear
the outcome. Results-map tie circles and presenter-style celebration effects
are outside this first player-script version.

## Implementation and verification boundaries

Suggested modules under `tampermonkey/src/`: the userscript entry point,
`tie-range-player-state.ts` for decoding/lifecycle/context, and
`tie-range-player-ui.ts` for HUD and DOM adapters. Add colocated `*.test.ts`
files, already covered by the root `npm test` glob. Document installation and
operator/player setup in `docs/presenter/player-tie-range.md`.

Live exploration captured sanitized player state and native HUD/results DOM
from two temporary guest players. The installed-bundle browser harness uses
controlled fetch and Tampermonkey API stubs; the bundle was also injected in a
real guest page with those storage/menu stubs and actual player transport.
See [capture evidence](../../geoguessr/samples/player-tie-range/README.md) and
[validation limits](../../presenter/player-tie-range.md). A legacy rollback
request returned 200 without changing live state; successful live undo is not
claimed. Restart handling is verified with synthesized variants.

Test identical presenter/player outputs for all recorded complete histories
and Full/Half boundaries, delayed/mutual increments, half-even damage, exact
ties, missing guesses, early knockout, and round-limit winner/draw. Exercise
duplicate/out-of-order responses, reload, rollback, source gaps, mode locking,
SPA navigation, reversed team order, and transport failures. Browser validation
must cover MOVE/NM/NMPZ, results reveal, DOM remounts, early finish followed by
host abort, and teardown. Finish implementation with `npm test`,
`npm run typecheck`, and `npm run build`.
