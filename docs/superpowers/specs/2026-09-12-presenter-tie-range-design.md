# Standalone presenter tie-range

Date: 2026-09-12

Approved for implementation, including next-duel configuration changes,
immediate result-map circles, deciding round-limit finishes by remaining
custom HP, and the single-circle treatment for 5Ks.

## Purpose and scope

Add tie-range to ordinary health duels in the custom presenter. Follow
[the researched HP model](../../geoguessr/pinpointing-duels-userscripts.md#presenter-managed-hp-with-tie-range):
damage still applies inside the tie band, but both teams receive the individual
multiplier increment. This feature works independently of movement mode.

This does not implement pinpointing points, early-send penalties, first-to-N,
automatic series scoring, or automatic server abort. The host continues to
control the GeoGuessr game. Existing 5K celebrations and result reveal gates
remain in use.

## Approach

Use a pure rules module in the NodeCG extension to derive presentation state
from normalized GeoGuessr state and a rule captured for the duel. Keep the
received state separately for protocol version handling, reconnect, rollback,
and diagnostics. All presenter consumers use the same derived result.

Two alternatives were considered: computing independently in graphics would
duplicate rules across program, preview, and audio consumers; mutating the
received state would entangle custom game completion with server progression.
The separate derivation gives the rules a small, independently testable boundary.

## Configuration and duel identity

Add a Tie range section to Config > Duels Presenter:

- Enable tie-range, default off.
- Full / Half selector, default Full and disabled while the feature is off.
- Active duel mode and a clear next-duel setting when it differs.

Store these preferences in persistent presenter settings. Migrate existing
settings by adding defaults without resetting audio, timing, or display choices.
Validate modes on the extension side.

Capture the setting when a new game ID is first accepted, including a Created
duel awaiting the host. A settings edit after that point applies to the next
game ID. Reconnect, explicit spectator reconnect, and NodeCG restart must reuse
the existing game's setting. If attaching to an already-running game for the
first time, use the configured setting and calculate its completed history.

Persist the active game's rule context independently of transient connection
state. It includes its game ID, selected mode, and the settled round inputs
needed to retain results across reconnect and restart. A transport reset must
not clear it. An explicitly restarted replay is a new replay run and captures
the latest setting even if the fixture reuses a game ID. Keep replay context
separate from live context.

When NodeCG starts in replay mode, resume the saved fixture at its last accepted
snapshot and preserve its captured rule. Rebase remaining replay timestamps to
the current clock. An explicit replay restart starts from the beginning using
the next-duel setting.

## Rules and arithmetic

Inputs are the server's resolved team scores, initial HP, individual increment,
mutual increment, and rounds-without-multipliers setting. Read increments from
`roundWinMultiplierIncrement` and `multiplierIncrement` in tenths, and the delay
from `roundsWithoutDamageMultiplier`. Initial team multipliers are 1x.

For each resolved round in order:

```text
best = max(scoreA, scoreB)
band = 0 when disabled, otherwise floor((5000 - best) / divisor)
divisor = 1 for Full, 2 for Half
difference = abs(scoreA - scoreB)
withinTieRange = difference <= band
```

If the difference is positive, deal the full score difference times the
higher-scoring team's pre-round multiplier, rounded half-to-even. Clamp the
loser's remaining HP at zero. Preserve the full damage amount separately from
the clamped HP loss for the animation. Represent multiplier arithmetic in
tenths to avoid floating-point ambiguity at half-to-even boundaries.

When the game continues and the round number is at least the configured delay,
add the mutual increment to both teams. Add the individual increment to both
teams when within the band, or only to the higher-scoring team otherwise.
An exact score tie deals no damage and increments both. Do not apply next-round
increments after a terminal round, matching the captured server behavior.

Use the server's resolved scores for decisions. Do not recompute them from
coordinates or let visualization tolerances change the result. In particular,
5000 versus 4999 has band zero and is decisive; 5000 versus 5000 is an exact tie.

Keep exact-score tie and within-tie-range as distinct fields. The existing
scoring animation treats a tie as no damage; setting that flag on unequal
scores would suppress valid damage. Add separate metadata for the band and
multiplier outcome.

Disabled mode keeps the existing server-backed presentation. Separately test
the pure calculation with divisor disabled against captured server histories
to verify the HP replica's foundation.

## Results map

Show these overlays only when the active duel has tie-range enabled.

Show the geometry at the existing answer-reveal gate, immediately when the
results map becomes visible. Preparing hidden geometry must not reveal the
answer or scores early, including during a 5K celebration.

For a non-5K result with a usable closer guess:

- Center both geographic circles on the answer.
- Inner radius is the closer guess's distance, with an outline in that player's
  mapped display color. For equal scores, use the geographically closer guess;
  an exact distance tie uses a neutral outline.
- Outer radius is the greatest geographic distance still scoring within the
  tie band, with a neutral dashed outline.
- Lightly shade the annulus and draw guess markers and the answer above it.
- Retain guess-to-answer lines and a small score-band/verdict label explaining
  whether both multipliers increase.

An unequal-score guess within the outer boundary still takes damage. Text must
describe the multiplier outcome rather than imply a damage-free round.

The radius conversion uses the map's `maxErrorDistance`, called M here. For
the integer minimum tying score `t = best - band`, invert the rounded scoring
formula at the lower edge of that score bucket:

```text
radius = -(M / 10) * ln((t - 0.5) / 5000), for 1 <= t <= 5000
radius = max(25 meters, radius)
```

This accounts for score rounding and the special distance-under-25-meters 5K
rule. Full and Half operate on score deficits, so they do not correspond to
fixed multiples of geographic distance. Exact boundary membership follows
the score formula, including the strict under-25 rule when that is the larger
radius; the drawn stroke is explanatory, not a second scoring system.

If `t <= 0`, every score ties for multiplier purposes. Omit the outer boundary
and annular fill, keep a valid inner circle, and label “All guesses within tie
range.” If a computed radius covers the entire globe, use a geographic
coverage label rather than a misleading finite ring. A missing guess can have
score zero without a map location; determine its result from that score.

When either score is 5000, use one neutral gold circle around the answer at
the effective 5K radius. Omit the closer-guess circle and annulus. Label it
“5K required to tie” for a single 5K, and “Both 5K” for a double 5K. This makes
the only tying area visible even though the score band is zero. The radius
can exceed 25 meters when the map's normal formula rounds a larger distance
to 5000.

Frame ordinary results to include the finite circles and both guesses with
padding. Handle antimeridian crossings and polar bounds. Preserve geographic
distances even where the map projection distorts the screen shape. For global
coverage, use world framing rather than trying to fit an unbounded circle.

Sample all outlines and fill boundaries on the same 6,371,000-meter sphere
used by recorded GeoGuessr guess distances.

If map scale is absent or invalid, omit the calculated boundary and show the
score-band explanation; do not guess a radius. A missing guess omits its pin
and any inner circle that depends on it. These conditions do not prevent
score-based HP calculations.

## State progression and game completion

Only fold rounds for which both team results are resolved. Freeze each round's
scoring inputs on first accepted resolution. Repeated versions and ordinary
reconnect snapshots do not increment multipliers again or alter settled rounds.
On cold attachment, seed settled inputs from the available completed history.

Use existing authoritative rollback detection to invalidate settled rounds
from the rollback target onward, then derive HP and multipliers again. Retain
the game's selected rule. A confirmed rollback may remove a custom winner;
ordinary later rounds or an abort cannot.

Stop the custom fold at the first knockout. Keep the terminal round's map,
scores, and result animation until it completes, then show the custom winner.
Later server rounds must not replace that result. An abort following the custom
finish preserves it; an abort before custom completion retains the normal
cancelled-game presentation. Continue receiving raw messages so rollback and
new-game detection remain possible after a custom finish.

If all configured maximum rounds resolve without a knockout, higher remaining
custom HP wins; equal HP is a draw. Do not award a result just because the
current round number reaches the limit before its result resolves.

Reconnecting or restarting into a completed custom game restores the final
presentation without replaying historical animations. Series wins remain
manually controlled.

The extension must distinguish genuine lack of progression from insufficient
rule input. Missing required HP/multiplier options or gaps in completed history
must produce a dashboard diagnostic and withhold an unverified custom result;
silently substituting server HP would change the selected rule. Geometry-only
metadata failure is independent and uses the map fallback described above.

## Integration boundaries

- Protocol/types: retain multiplier settings and map scale in normalized state.
- New presenter rules module: deterministic round fold, terminal decision, and
  tie-band metadata. A separate geometry helper converts thresholds to radii.
- Extension registration: manage raw state, persisted duel context, derived
  state, reconnect, replay, and rollback. Publish the derived state consistently
  for timeline, program, preview, and audio consumers.
- Scoring/projection/scene: consume custom results while preserving current
  damage animation and result reveal timing; use the custom terminal outcome.
- Renderer map frame and Google adapter: add circle/annulus geometry, framing,
  overlay lifecycle cleanup, and explanatory labels.
- Presenter settings and dashboard: validated controls, migration, and active
  versus next-duel indication.

Avoid unrelated refactoring. Raw protocol state must never be replaced by the
custom state inside snapshot normalization or rollback detection.

## Verification

Use focused unit and integration tests, the repository typecheck/build, and
visual inspection of rendered replay results:

- Disabled calculation parity against all completed captures, including mutual
  increments, delayed multipliers, half-to-even damage, and terminal increments.
- Full/Half boundary equality, odd deficits, exact ties, low-score unbounded
  bands, 5000/4999, double 5K, and missing guesses.
- Early custom knockout, host abort after knockout, later server rounds,
  maximum-round HP winner/draw, and manual series behavior.
- Settings migration and validation; next-duel changes; same-game reconnect and
  restart; replay restart; repeated snapshots; authoritative rollback.
- Radius conversion at integer score boundaries and the effective 5K radius,
  finite/unbounded circles, missing scale, map wrapping, and polar framing.
- Results-map reveal timing, single/double-5K circle treatment, annular shading,
  pin visibility, and overlay cleanup between rounds and games.

Fixtures remain local; validation does not require changing a live GeoGuessr
game or sending host actions.
