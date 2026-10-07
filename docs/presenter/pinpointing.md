# Pinpointing Duels

Points replace health. The rulebook in force for RASHINBAN 2026:

- Both players score 5000: only the player who guessed first scores 1 point.
- Only one player scores 5000: that player scores 2 points.
- Both players score 4999 or less: only the higher score scores 1 point.
- The first player to reach 7 points wins the game.

Equal scores below 5000 score nothing. Two 5Ks with the same guess time, or
with no deliberate guess time on record, score nothing. When tie range is
enabled as well, the "higher score" rule only awards the point if the
difference exceeds the tie band (`floor((5000 - best) / divisor)`); otherwise
the round is a tie. There is no early-send penalty.

A player's guess time is the server time of their first guess made before the
round deadline. A guess auto-submitted at the deadline never counts as a guess
time, so it cannot win a double 5K.

## Presenter

Open **Config > Duels Presenter**, enable **Pinpointing Duels** under its own
heading, and select **Apply presentation**. The setting is captured when the
presenter first receives a new duel, exactly like tie range, and the panel
shows the active and next-duel rules. Reconnecting or restarting NodeCG keeps
the current duel's rules. Tie range can be enabled at the same time; its
results-map circles then explain why a close round scored nothing.

On stream each HP box becomes that side's row of seven pips, filled from the
outer edge in the side's colour as points come in, with the count beside
them and a gold highlight at match point (5 or 6 points, since a solo 5K
scores 2). The
DAMAGE boxes read POINTS with FIRST TO 7 or MATCH POINT. After the score count
a banner announces the round verdict (`+2 · SOLO 5K`, `+1 · FASTEST 5K`,
`+1 · CLOSEST`, `DOUBLE 5K · NO POINT`, or `TIE · NO POINT`) and the scoring
side's counter ticks up. The `collision` cue sound plays for a scoring round
and the `tie` cue for a round without a point; 5K videos are unchanged.

When a player reaches 7 the presenter shows the winner. The GeoGuessr duel is
still running, so the host should abort it; the abort keeps the presenter's
result. Server health is ignored: give the party a very high initial health
(for example 1,000,000) so the native duel cannot end first. If it does end
first, the presenter shows GAME FINISHED without a winner and the dashboard
warns that the server duel finished before 7 points. Series wins remain
manually controlled.

Missing round history or deadlines withhold the duel with a "Pinpointing
calculation unavailable" warning until a complete snapshot arrives.

## Player userscript

The [player userscript](player-tie-range.md) carries the same rules. Choose
**RASHINBAN: Player settings** from the Tampermonkey menu (or the HUD button)
and tick **Pinpointing Duels**; set tie range to match the host as well. Both
are captured when the duel begins and changes apply to the next duel.

The HUD shows `You 3 / 7` and `Opponent 2 / 7`, each above its own row of
seven pips filled in the side's colour, with a MATCH POINT badge,
hides the native HP bars and damage animation, counts the round scores with
GeoGuessr's own timing, then shows the verdict text. The native summary's HP
columns show running points instead. At 7 points the HUD shows
**You win 7–4** (or **You lose**) with "Custom duel finished — wait for the
host". A duel the server finishes before 7 points shows "Duel ended without a
custom winner".

The player endpoint carries both players' guess timestamps (confirmed live on
2026-10-07, client web-1.8229): the HUD awards the faster 5K exactly as the
presenter does. Should a snapshot ever omit them, a double 5K scores nothing
for either side and the host's presenter decides.

## Verification

`npm test` covers the shared rules core, presenter derivation on the recorded
captures, settings migration, verdict choreography, dashboard capture, and the
player decoder, controller and display model. The design is in
[2026-10-07-pinpointing-duels-design.md](../superpowers/specs/2026-10-07-pinpointing-duels-design.md).
