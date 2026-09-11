# Presenter tie-range

Open **Config > Duels Presenter**, enable **Tie range**, choose **Full** or
**Half**, and select **Apply presentation**. Tie-range is off by default.

Settings apply when the presenter first receives a new duel, including a duel
waiting for the host to start. The panel shows the active rule and any different
setting saved for the next duel. Reconnecting or restarting NodeCG keeps the
current duel's rule.

## Round behavior

Damage always uses the score difference and the higher-scoring team's current
multiplier. Tie-range changes which teams receive the individual multiplier
increment afterward:

- Inside the band, both teams receive the increment.
- Outside the band, only the higher-scoring team receives it.
- An exact score tie deals no damage and increments both teams.

The party's mutual increment and rounds without multipliers still apply. The
presenter uses its own HP and multipliers while this rule is active. The native
GeoGuessr display continues using the server's ordinary health rules.

The band is `floor((5000 - bestScore) / divisor)`, where Full uses divisor 1 and
Half uses 2. Equality is inside the band. For example, with Full, 4000 versus
3000 increases both multipliers; 4000 versus 2999 increases only the winner's.

## Reading the map

The circles appear immediately with the revealed results map:

- The inner outline passes through the closer guess and uses its player's color.
- The dashed outer outline marks the furthest location whose score would still
  fall within the tie band.
- The shaded area between them shows the tie range for the farther guess.

The outer boundary uses the map's scoring scale and score rounding. Full and
Half therefore do not mean twice or 1.5 times the closer guess's distance.

When a player scores 5000, a single gold circle marks the area that also scores
5000, labeled **5K required to tie**. For two 5Ks the label is **Both 5K**. This
area can extend beyond 25 meters on maps where distance-based scores round to
5000.

When no opposing score can escape the tie band, the map says **All guesses
within tie range** and omits a finite outer boundary. If the map's scoring scale
is unavailable, the score explanation remains available without an estimated
boundary.

## Finishing and reviewing a game

The presenter announces its winner after the custom knockout animation. If the
server duel is still running, the host can abort it; that preserves the
presenter's completed result. Series wins remain manually controlled.

At the configured round limit, higher remaining custom HP wins; equal HP is a
draw. A confirmed round undo recomputes HP and multipliers from the retained
history and can reopen a completed custom game.

An explicit replay restart uses the newly configured rule from the beginning
of the fixture. Restarting NodeCG in replay mode resumes the saved fixture's
position and rule. Replay settings do not overwrite the saved live-duel rule.

For arithmetic and lifecycle details, see the
[design](../superpowers/specs/2026-09-12-presenter-tie-range-design.md) and
[research](../geoguessr/pinpointing-duels-userscripts.md).
