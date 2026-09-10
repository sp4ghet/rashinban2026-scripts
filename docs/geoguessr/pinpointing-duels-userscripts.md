# "Pinpointing Duels" userscripts (GeoClassics) - research notes

Researched 2026-09-11 for RASHINBAN 2026. The plan is to run a pinpointing
ruleset on top of the custom presenter
([design](../superpowers/specs/2026-09-11-custom-presenter-design.md)) instead
of installing the game-master userscript on the GeoGuessr broadcast page. These
notes record what the scripts do, exactly how they score, what they depend on,
and how that maps onto the protocol we already capture
([presenter-protocol.md](presenter-protocol.md)).

Snapshots of the exact versions analysed are vendored under
[`reference/`](reference/) (both MIT licensed):

| Script | Greasyfork | Version | Code updated | Installs | Snapshot |
|---|---|---|---|---|---|
| Pinpointing Duels (player) | [527469](https://greasyfork.org/en/scripts/527469-pinpointing-duels) | 2.1.0 | 2025-08-20 | 142 | [`reference/pinpointing-duels-2.1.0.user.js`](reference/pinpointing-duels-2.1.0.user.js) |
| Pinpointing Duels (Game Master - HellCup Edition) | [528306](https://greasyfork.org/en/scripts/528306-pinpointing-duels-game-master-hellcup-edition) | 2.1.7 | 2026-01-16 | 61 | [`reference/pinpointing-duels-game-master-hellcup-2.1.7.user.js`](reference/pinpointing-duels-game-master-hellcup-2.1.7.user.js) |

Author: GeoClassics (Discord server, `twitch.tv/GeoClassics`). Script 528306
was created 2025-02-28 as "Pinpointing Duels (Game Master)"; the "HellCup
Edition" rename and the first-guess banner / penalty animation features arrived
with v2.1.6 and v2.1.7 on 2026-01-16. The player script has not changed since
2025-08-20.

## What the format is

A Moving duel where **health is irrelevant** and the winner is the first team
to reach N points (default 10). Points are awarded per round from the guesses
GeoGuessr already records; the scripts never touch gameplay, they only read the
duel state and draw a scoreboard over the native UI.

Recommended party settings from the script page:

- Moving (the scripts are a no-op unless moving, zooming **and** rotating are
  all allowed)
- Max Round Time: 90 s
- Time After Guess: 15 s
- Initial Health: 1,000,000 (so the native duel never ends by damage; the host
  aborts once someone reaches N, or players "guess Antarctica" for the
  remaining rounds)

Note the captured `options.maxNumberOfRounds` is 30, so a party duel cannot
run for ever regardless of health.

## Scoring rules (from code, not from the description)

The Greasyfork description ("first to 5K gets a point, closer guess gets
another point") is out of date. The 2.x code does this per round, in round
order, stopping once either side has reached N:

1. **Team round score** = score of the team's *first* guess in the round
   (earliest `created`, only if `created < rounds[i].endTime`). If the team has
   no such guess (only an auto-submitted timeout guess, or no guess at all) the
   team's best score in the round is used instead, and its "first guess time"
   is treated as infinite.
2. **Early-send penalty.** If the team that guessed first (strictly earlier
   than the other team) did **not** 5K, and its guess time is earlier than
   `startTime + maxRoundTime - roundTime`, its round score becomes **0**. Only
   the earlier of the two teams can be penalised. With the recommended 90/15 s
   settings that means: guessing in the first 75 s without a 5K scores 0. With
   `maxRoundTime: 0` the window is negative, so the penalty can never trigger:
   **the penalty requires a max round time**.
3. **Points:**
   - both teams 5K: **1 point** to the faster one (by `created`); identical
     timestamps award nothing
   - exactly one team 5K: **2 points** to that team ("solo 5K")
   - otherwise: **1 point** to the higher round score, but only if it beats the
     other by more than the tie distance (see below); else **tie, 0 points**
4. **Tie range** (setting `tieRange`; 0 = disabled, 1 = "Full", 2 = "Half"):
   the closer guess only wins the round if it beats the other by more than a
   band that grows with how far off the *better* guess was. Independent of the
   5K rules; see [Tie range as a standalone rule](#tie-range-as-a-standalone-rule).
5. **Match point** is shown when either side has `>= N - 2` (a solo 5K is worth
   2), **game over** at `>= N`. Rounds played after N is reached are ignored.
6. **5K definition** used everywhere: `distance < 25` m, or the standard score
   formula rounds to 5000.

Score formula the scripts recompute from `distance`:

```
score = round(5000 * exp(-10 * distance / options.map.maxErrorDistance)), 5000 if distance < 25 m
```

I checked this against all 25 server-computed `guesses[].score` values in our
three full-duel captures: **0 mismatches**. Our state already carries `score`,
so a reimplementation should use `guesses[].score` directly and only fall back
to the formula for tests.

Settings stored with `GM_setValue`: `firstTo` (3..30, default 10), `tieRange`
(0/1/2), `scoreBoxOffset` (% from edge, default 30), `scoreBoxTop` (px, default
86).

## Tie range as a standalone rule

The tie range is the one piece of the scripts that does not depend on
pinpointing at all. It is a rule for deciding whether a "closest guess" round
is decisive or a tie, given only the two round scores, and it can be applied to
normal duels or to any closest-guess points format.

Definition (identical in both scripts, `updateScores`):

```
best   = max(scoreA, scoreB)
k      = 1 for "Full Tie Range", 2 for "Half Tie Range"   (0 = disabled)
tieDistance = floor((5000 - best) / k)

winner = A  if scoreA > scoreB + tieDistance
       = B  if scoreB > scoreA + tieDistance
       = tie otherwise
```

Reading it in terms of how far each guess was from 5000 (its "deficit"):

- **Full**: the loser's deficit must be more than **twice** the winner's
  deficit. A 4,000 (deficit 1,000) only beats guesses below 3,000.
- **Half**: the loser's deficit must be more than **1.5x** the winner's
  deficit. A 4,000 only beats guesses below 3,500.

Consequences worth knowing before adopting it:

- The band is relative, not fixed. A near-5K wins against almost anything; a
  mediocre best guess needs a large margin. Under Full, a best score of 2,500
  or less can **never** win the round, not even against 0. Under Half the
  floor is 1,667.
- It is evaluated only when neither side has a 5K. A 5K (or `distance <
  25 m`) gives `tieDistance = 0`, so a 5K vs 4,999 is still a win for the 5K.
- Combined with the pinpointing early-send penalty (round score forced to 0),
  a penalised side often still ties: under Full the opponent needs at least
  2,501 to take the point.
- Both scripts print the band in the round banner ("TIE RANGE: 1000 POINTS")
  so viewers can see why a round tied.

Examples, with the distance the best guess corresponds to on the world map
(`maxErrorDistance` 14,999,250 m, the value in our captures; other maps scale
distances but not scores):

| best score | best guess distance | Full: band | Full: loser must be | Half: band | Half: loser must be |
|---|---|---|---|---|---|
| 4,900 | 30 km | 100 | < 4,800 | 50 | < 4,850 |
| 4,500 | 158 km | 500 | < 4,000 | 250 | < 4,250 |
| 4,000 | 335 km | 1,000 | < 3,000 | 500 | < 3,500 |
| 3,500 | 535 km | 1,500 | < 2,000 | 750 | < 2,750 |
| 3,000 | 766 km | 2,000 | < 1,000 | 1,000 | < 2,000 |
| 2,501 | 1,039 km | 2,499 | < 2 | 1,249 | < 1,252 |
| 2,500 | 1,040 km | 2,500 | never wins | 1,250 | < 1,250 |
| 2,000 | 1,374 km | 3,000 | never wins | 1,500 | < 500 |
| 1,667 | 1,648 km | 3,333 | never wins | 1,666 | < 1 |
| 1,000 | 2,414 km | 4,000 | never wins | 2,000 | never wins |

Applying it to **normal (health) duels**: GeoGuessr's server decides its own
damage and health and the presenter cannot change that, but the presenter can
run a parallel health model of its own. The workable version, where tie-range
rounds still deal damage and only the multiplier step changes, is worked out
in [Presenter-managed HP with tie range](#presenter-managed-hp-with-tie-range)
below and comes with a guarantee that our game never outlasts the server's.
Using the band to withhold *points* instead (no health involved) is the
pinpointing scripts' own use and needs the high-health safety net.

Implementation note for the presenter: the rule needs only `scoreA`,
`scoreB`, and the mode, so it belongs in the same pure ruleset function as
the rest of the pinpointing logic, parameterised by `tieRange` (0/1/2). The
`k` divisor is the only knob; nothing stops us offering other divisors (e.g.
3 for a "third" band) if the organisers want something between Half and off.

### Presenter-managed HP with tie range

Idea (2026-09-11, the user's model): keep GeoGuessr's damage duel as is, but
let the presenter own health and multipliers with one change: a round whose
margin is inside the tie band still deals damage at the winner's current
multiplier, but afterwards **both** multipliers increase instead of only the
strict winner's. The captured server rules
([presenter-protocol.md](presenter-protocol.md#multipliers-and-damage-confirmed-against-all-four-captured-duels))
already increase both on an *exact* tie, so this is GeoGuessr's own rule with
a wider definition of "tie" for the multiplier step only:

```
band = tieRange ? floor((5000 - max(a, b)) / tieRange) : 0
diff = |a - b|
if diff > 0:        loser.hp -= roundHalfEven(diff * winner.mult)     # always, as the server does
if diff > band:     winner.mult += 0.5                                  # strict win
else:               a.mult += 0.5; b.mult += 0.5                        # tie-range or exact tie
```

With `tieRange = 0` this is exactly the server rule and reproduces every
`damageDealt` / `healthAfter` in the three completed captures, including the
half-to-even roundings. The presenter drives its own health bar from
`roundResults[].score` alone and ignores `teams[].health`,
`currentMultiplier` and `damageDealt`. It is a fold over resolved rounds, so a
reconnect snapshot recomputes it from scratch with no drift.

**Ordering guarantee: the custom game ends in the same round as the server
game or earlier, never later.** Per team, our multiplier only ever increases
in a superset of the cases the server increases it (strict win, exact tie,
plus tie-range rounds), so `mult_custom >= mult_server` at every round. Every
round deals the same score difference times a multiplier that is at least
the server's, so `hp_custom <= hp_server` at every round. Consequences:

- The party can run with a **normal initial health** (no 1,000,000 trick):
  the server can never finish the game before we do. If both reach 0 in the
  same round the server sends `DuelFinished` and the result agrees with ours.
- When ours ends first the host aborts, so `DuelAborted` is a normal end for
  this format too. The players' native health bar is then slightly optimistic
  (never pessimistic) until the abort; the stream shows the real one.
- `maxNumberOfRounds` cannot bite before it would bite the server game.

What it looked like on the captured duels (initial HP 6000, +0.5 per win):

| duel | server ends | Full ends | Half ends | what changed |
|---|---|---|---|---|
| full-duel-sequence | r5 | r5 | r5 | rounds 1 and 2 are tie-range: red's multiplier keeps pace; the r5 kill lands at ×3.5 instead of ×2 |
| maxroundtime | r4 | r4 | r4 | rounds 2 and 3 are tie-range (r3: 1434 vs 0 is inside the band); r4 kill at ×2.5 instead of ×2 |
| manual-rounds | r4 | r3 | r3 | two 1-point rounds are tie-range, then 4577 vs 0 at ×2 (server: ×1) is lethal a round earlier |

A rejected variant, recorded so it is not re-proposed: dealing **no** damage
on tie-range rounds (the pinpointing scripts' "TIE, 0 points" reading applied
to health). That breaks the ordering guarantee: under Full a best score of
2,500 or lower is always a tie, so repeated `2500 vs 0` rounds never damage
anyone on our side while the server ends the game in round 2. It would need
the 1,000,000-health safety net and a max-round tie-break.

Party settings involved (see the protocol notes for the field mapping and
the 2026-09-10 capture that confirmed them): "Individual Multiplier
Increment" is the per-win step above; "Mutual Multiplier Increment" adds to
**both** players after every round; "Rounds without multipliers" (N) skips the
increments after rounds `1..N-1`, so round `N+1` is the first played with a
multiplier. The complete replica, verified against all four completed
captures including one with Mutual 0.5x and N = 2:

```
after round n, if n >= N:
    both.mult += mutual
    if diff > band: winner.mult += individual
    else:           both.mult  += individual        # tie-range or exact tie
```

Mutual raises our and the server's multipliers equally, so the ordering
guarantee is unaffected. Read `individual`, `mutual` (tenths) and `N` from
`options.roundWinMultiplierIncrement`, `options.multiplierIncrement` and
`options.roundsWithoutDamageMultiplier` rather than hard-coding them.

## How the scripts get their data

Both poll a REST endpoint on an interval instead of using the WebSocket:

| | Player script | Game-master script |
|---|---|---|
| Runs on | `/duels/<id>`, `/team-duels/<id>` (the player's own game page) | any URL containing `duels` (intended: the broadcast / presenter page) |
| Endpoint | `GET https://game-server.geoguessr.com/api/duels/<duelId>` | `GET https://game-server.geoguessr.com/api/duels/<duelId>/spectate` |
| Interval | 2.5 s, plus on SPA navigation | 2 s, plus on SPA navigation |
| Duel id | second path segment of the URL | second path segment of the URL |
| Auth | browser cookies (`credentials: "include"`) | same |
| Extra | reads own `userId` from `__NEXT_DATA__` to orient "you / opponent" | resolves nicks via `GET /api/v3/users/<playerId>` (fallback "Guest") |

The state shape they read (`currentRoundNumber`, `rounds[].startTime/endTime/
hasProcessedRoundTimeout`, `teams[].players[].guesses[]{roundNumber, created,
distance, score}`, `options.roundTime/maxRoundTime/movementOptions/map.
maxErrorDistance`) is **the same duel state** we receive in every `Duel*`
WebSocket message (`samples/gs2-ws-full-duel-sequence.json`), so nothing in
the ruleset needs a second data source.

On 2026-09-11 the legacy host still answers `401` (not `404`) for both routes
without cookies, so the routes exist; whether the payload still matches was not
verified (needs a cookie). Our presenter uses the `gs2.geoguessr.com` phonebook
+ spectator snapshot + WebSocket path documented in the protocol notes instead.

### Semantics confirmed against our captures

- `rounds[].hasProcessedRoundTimeout` flips `false -> true` exactly on
  `DuelRoundTimedOut` for that round (checked on the full sequence, versions
  5..46). The scripts use it as "round resolved, safe to score". In our
  pipeline that is the `DuelRoundTimedOut` message / `roundResults[]` entry.
- **Auto-submitted guesses have `created` slightly after `endTime`** (e.g.
  round 1 of the max-round-time capture: `created 13:19:54.788` vs
  `endTime 13:19:54.032`). That is why the scripts require
  `created < endTime` to count a guess as a deliberate "first guess"; a
  timeout submission still counts for points via the best-score fallback but
  never as "guessed first" and never triggers the early penalty.
- `options.roundTime` is the party UI's "Time After Guess" (15 s);
  `options.maxRoundTime` is "Max Round Time" (0 when off). Both confirmed in
  the protocol notes.
- All timestamps compared by the scripts (`created`, `startTime`, `endTime`)
  are server clock, so the ruleset is clock-drift free. The only local-clock
  use is the GM script's "has the round timed out yet" guess for banner
  suppression.

## Player script vs. game-master script

**Player script (527469)** - meant for the two players, not for a stream:

- Hides the native health bars (`health-bar-2_*` prefix selectors) and appends
  two score boxes into the duels HUD.
- After each resolved round shows a centred banner ("YOU WIN THE ROUND! 2
  POINTS FOR SOLO 5K", "MATCH POINT!", tie range) anchored to the damage
  animation, and a second banner naming who got the early-send penalty.
- Full-screen end screen "YOU WIN THE GAME! 7-3" with the Antarctica hint.
- Score boxes flash green for 5 s when a side's total changes.

**Game-master / HellCup script (528306)** - meant for the presenter/broadcast
page, and the one closest to what RASHINBAN needs:

- Uses the `/spectate` endpoint and blue/red = `teams[0]`/`teams[1]` (no
  "you / opponent" orientation).
- Hides the presenter's health bars and the round-multiplier widget, and
  inserts the score boxes into the cam HUD wrapper.
- **"Locked in" banner** during the round: the first time a side has a guess
  in the current round it shows "`<nick>` has locked in their guess" for 5 s
  (one per side per round). It does not reveal whether the guess was a 5K.
- **Penalty reveal at scoring time:** if the first-locking side was early and
  did not 5K, when the native round-result table appears it shows "`<nick>`
  locked in early and didn't 5K - 0 points", sets
  `data-pp-<side>-punished` on `<body>`, injects CSS that hides that side's
  native score / damage animation, and rewrites the visible score numbers to
  `0` (re-applied 120 ms later and on every DOM mutation). This is purely
  cosmetic; GeoGuessr's own health/damage is untouched underneath.
- Result banner inserted at the top of the native round-score table with the
  player's nick ("2 points for a solo 5K by `<nick>`", "BLUE WINS").
- Swaps the active-round background image (four imgur PNGs) depending on
  match-point state: none / blue MP / red MP / both MP.
- End screen "BLUE WINS THE GAME! 10-6" with a FINISH button, 2.5 s after
  the winning round resolves; suggests the host abort the game.

## Why the game-master script has probably stopped working

It hard-codes hashed CSS-module class names from a specific GeoGuessr build:
`.cam-hud_wrapper__4whN_`, `.cam-hud_playerBadge__RViHv`,
`.round-score-animations_scoreTable__BpRHh`,
`wc-health-bar_container__zK0hz`, `.views_roundMultiplier__iQZZW`,
`.views_activeRoundWrapper__1_J5M`, `.overlay_backdrop__ueiEF`,
`button_button__aR6_e button_variantPrimary__u3WzI`. Next.js regenerates the
hash suffix whenever the component's CSS changes. Partial evidence from build
`1.7700-ffc8ed0` (2026-09-11): the shared CSS bundle served with an
unauthenticated page ships `button_variantPrimary__egYwL` / `__ngvcn` (the
script wants `__u3WzI`), and none of the `cam-hud_*`, `round-score-animations_*`,
`wc-health-bar_*` names appear in it. The broadcast page's own chunks were not
fetched (needs a login), so this is not a full confirmation; the scoring logic
itself does not depend on the DOM and would still compute correctly.

The player script is more robust (prefix selectors like `[class^="duels_hud__"]`)
but also pre-dates the 2025-2026 UI changes; the current shared CSS has
`health-bar_*` where it looks for `health-bar-2_*`.

Neither script has any notion of BO3/series, team names beyond blue/red,
sound, or custom media.

## Mapping onto the RASHINBAN 2026 presenter

Everything above reduces to a pure function over the state we already
normalise:

```
pinpointing(duelState, { firstTo, tieRange }) ->
  { rounds[]: { winner: blue|red|tie, points, reason: fastest5k|solo5k|closest|tie,
                penalised: blue|red|null, tieDistance },
    totals: { blue, red }, matchPoint: blue|red|both|null, finished: blue|red|null }
```

Inputs per round: `rounds[i].startTime`, `endTime`, resolved flag
(`DuelRoundTimedOut` seen / `hasProcessedRoundTimeout`), each player's guess
for the round (`created`, `score`), `options.roundTime`, `options.maxRoundTime`.

Event mapping:

| Presenter moment | Source in our protocol | Script behaviour to reproduce |
|---|---|---|
| "X locked in" | first `DuelPlayerGuessed` per team per round (real time, no polling) | 5 s banner, no score shown |
| Round scoring | `DuelRoundTimedOut` | compute the round verdict; reveal penalty, points, match point; update totals |
| Health bars | ignore `teams[].health` | replace with points boxes; never show damage |
| Game end | totals reach N, **before** any `DuelFinished` | show winner screen; the host then aborts, so expect `DuelAborted` (or Antarctica rounds) as the *normal* end |
| Series / BO3 | not covered by the scripts | our own Replicant, as designed |

Points of attention for the implementation:

- Use `guesses[].score` from the state, not the formula; the 25/25 check above
  shows they are identical.
- A 5K on the *first* guess is visible in `DuelPlayerGuessed` immediately. The
  GM script deliberately does not reveal it in the "locked in" banner; keep
  that (it also matches the design's "no early score reveal" rule).
- Treat `DuelAborted` after the winner screen as expected, not as an error, and
  do not let it change the series score by itself.
- Freeze the ruleset's inputs per round at `DuelRoundTimedOut` so a later
  reconnect snapshot cannot re-score a round differently (same rule as the
  design's results freeze).
- With `roundTime` 15 s and `maxRoundTime` 90 s the penalty window ends at
  75 s. Show the window on screen (e.g. a colour change on the timer) since
  the native UI does not, and both scripts only reveal it after the fact.
- Settings needed in the dashboard: first-to N, tie-range mode, and a switch
  between pinpointing and normal health duels. Tie range is a separate toggle
  from pinpointing since it can be layered on a normal duel's presentation.

## Open questions to settle with the organisers

- Confirm the ruleset in force for RASHINBAN 2026 is the 2.x one above (2 for
  solo 5K, 1 for fastest 5K, 1 for closest, early penalty) and not the v1
  description on Greasyfork.
- Tie-range mode (off / full / half) and first-to value.
- Whether "both 5K with identical timestamps" (no point) and "both sides
  early, both miss" (only the earliest is penalised) are intended or just
  script artefacts.
- Whether the tournament wants the `maxRoundTime` 90 s / `roundTime` 15 s
  settings, since the early penalty is undefined without a max round time.
- Whether the player script should still be installed by the players for
  their own on-screen score (it does not interact with our presenter).
