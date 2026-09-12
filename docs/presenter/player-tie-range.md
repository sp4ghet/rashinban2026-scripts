# Player tie-range

The standalone player HUD uses the same scoring core as the presenter. Each
player chooses the tournament's **Full** or **Half** mode locally; no NodeCG
connection or presenter credential is needed.

## Install and configure

1. Build with `npm ci` and `npm run build`, or use the checked-in
   [`rashinban-tie-range.user.js`](../../tampermonkey/rashinban-tie-range.user.js).
2. In Tampermonkey, create a new script, replace its contents with that file,
   and save. Enable it for `https://www.geoguessr.com/`.
3. Open GeoGuessr and choose **RASHINBAN: Player tie-range settings** from the
   Tampermonkey menu. Select the same **Full** or **Half** setting as the host.
   The default is **Off**. The HUD also provides a settings button.
4. Configure before the duel is created. The first valid attachment captures
   the mode for that game, including a game waiting for its first round.

Changing the preference affects the **next duel**. Reloading preserves the
current game's captured mode and recalculates its HP from saved scores. If a
player attached with the wrong mode, agree on the setting and start a new duel.
Disabling the userscript and reloading restores the ordinary GeoGuessr display.

## Reading the HUD

The bars show custom HP and effective multipliers, oriented as **You** and
**Opponent**. If account identity is unavailable, explicit **Blue** / **Red**
labels avoid guessing which side is yours. Settled round scores and damage
appear only after the native result is visible or the game has advanced.

Tie-range changes the multiplier increment, not whether damage occurs. In Full
mode, a 2470–0 round at 1.5× deals **3705 damage**, and both players receive the
individual increment because the difference is within the 2530-point band.
Results count both scores for 750 ms alongside GeoGuessr's COUNT_DAMAGE cue.
After a 1-second hold, the winner's score moves into the loser's, subtraction
produces the difference, and the custom multiplier appears beside the damage.
Damage then flies to the losing HP bar, which starts counting down at impact. Reopening an existing result does
not replay the damage. The breakdown shows custom HP and
damage received; hover a custom HP cell to see the multiplier used. Its rows
remain clickable.
The game's delay, mutual increment, initial HP, and round limit still apply.

After the native answer marker appears, the results map shows the closer
player's distance circle and the tie-band boundary using the presenter's radius
calculation. A 5K uses one gold boundary. Circles follow native map pan/zoom;
no description is added. The script reads the existing map through Tampermonkey's
`unsafeWindow` permission. Unsupported map markup leaves the native map usable.
Geometry stays in memory and is never saved in Tampermonkey storage.

Custom knockout and round-limit outcomes remain visible while waiting for the
host on the duel results screen. Returning to the party lobby hides the HP,
results, and outcome overlays; the settings button remains available. A later
native round or abort does not replace a verified custom winner.
The script sends no guesses or game-control requests. The host still manages
rounds, aborts, and series scores.

## Supported games and recovery

Support is limited to **two teams with one player each**, with equal initial
health, multipliers enabled, and healing disabled. MOVE, NM, and NMPZ use the
same score-based rules. Multi-player teams and special scoring are rejected.
Party players remain on `/party/lobby`; direct `/duels/<id>` and
`/team-duels/<id>` pages, locale prefixes, and `/summary` are also recognized.

Polling normally runs every 2.5 seconds, with an immediate refresh when results
appear. The native score-count animation anchors the scoring clock, not the
polling response. Already revealed native counts remain visible while settled
arithmetic is in flight; a late response joins the current stage. Connection errors retain verified
numbers and display a warning; after ten seconds they are marked stale. Saved
numbers are marked stale until a current response verifies them. Missing
history or incompatible rules produces a diagnostic instead of fabricated HP.

An earlier round number or changed round start time can release a rolled-back
suffix. If the response still carries old results, the HUD waits for the
authoritative history to clear. When that clearing event was missed, it stays
in recovery rather than guessing which repeated scores belong to the restart.
The ten most recent compact game contexts are stored in Tampermonkey; no
locations, guesses, cookies, or credentials are persisted.

## Development and validation

`npm test`, `npm run typecheck`, and `npm run build` cover the shared arithmetic,
player decoder, persistence, controller, and display model.
`npm run validate:player` executes the **built userscript** in headless Chrome
with captured DOM, controlled API responses, and Tampermonkey API stubs. Set
`CHROME_PATH` when Chrome is outside the script's usual installation paths.
Screenshots are written to `artifacts/player-tie-range/`.

Live Chrome exploration on 2026-09-12 used two temporary guest players in a
private party. It verified player identity, live transport, native result
markup, damage, and a round-limit finish. The built HUD was injected into that
real player page with local Tampermonkey API stubs. Extension installation
itself and a live NMPZ duel were not exercised; movement modes share the tested
numeric adapter. Rollback races and early knockout followed by abort are
covered with controlled fixtures rather than claimed as live observations.

See the [capture notes](../geoguessr/samples/player-tie-range/README.md) for the
live/archived transport distinction and the
[presenter guide](tie-range.md) for host operation.

Version 0.1.2 also replays the six score pairs from the reported player
screenshots: Half round 4 deals 1344 at 2x, leaving the opponent at 350 HP;
round 6 deals 586 to the local side. This is a screenshot-derived regression,
not an additional live API capture.

Version 0.1.2 adds browser regressions for result wrappers without layout boxes,
visible content beneath accessibility-hidden ancestors, damage flight and HP
countdown, and map circles gated by answer-marker visibility. Circle attachment
is tested through a controlled Google Maps/React boundary; a live native duel
with these new circles has not yet been verified.

Version 0.1.4 follows the stages in [scoring-animation.md](../geoguessr/scoring-animation.md)
and [sfx-timing.md](../geoguessr/sfx-timing.md). The native multiplier marker
selects the x1 or multiplier sound timeline; damage always uses the custom
multiplier. No additional sounds are played. Browser tests cover the count,
collision, difference, multiplier label, flight, impact, and delayed-data
catch-up. HP interpolates for 800 ms after impact rather than reproducing
GeoGuessr's exact numeric spring. Speaker latency is not measured.
