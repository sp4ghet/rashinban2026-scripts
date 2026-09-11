# Score explanation sequence

The presenter retains its RASHINBAN result-map, score and HP layout while
animating entry, counting, subtraction or a tie, multiplication, damage flight
and HP impact. Muted original scores remain visible while the moving copies
explain the calculation. Damage numbers use authoritative server damage;
HP always settles at authoritative before/after health, including capped loss.
The attacking player's round multiplier is used rather than a global multiplier.

Offsets below are from result reveal, after any selected 5K video and the
configured lead. They follow the source-derived GeoGuessr scoring handoff at
`docs/geoguessr/samples/scoring-animation/README.md` in the main checkout
(client `web-1.7711-e06e090`, inspected 2026-09-11).

| Stage | Default timing |
| --- | --- |
| Entry wait / score count starts | 1210 ms |
| Count | 750 ms |
| Completed scores hold | 1000 ms |
| Subtraction | 400 ms travel; collision at 250 ms, difference at 350 ms; 500 ms total |
| x1 difference hold | 1000 ms |
| Other multiplier | 500 ms wait, then multiplier emphasis and 1000 ms hold |
| Damage flight | 400 ms travel; impact at 350 ms |
| HP impact | 4810 ms at x1, 5310 ms with multiplier |
| After impact | 2000 ms hold, or longer if the configured HP duration requires it |
| Tie | Scores converge after count/hold, collide at 350 ms and fade for another 350 ms; no HP flight |

New settings default to a 750 ms count. Existing operator values are preserved:
a saved 1200 ms count adds 450 ms to all subsequent stages. `damageMs` controls
the finite HP animation duration (default 800 ms). Numeric HP and the bar use
deterministic damped springs, normalized to settle exactly at their endpoints;
this approximates React Spring's numeric/default and stiff-bar behavior without
depending on its asynchronous settling. Zero count and damage durations skip
the choreography deterministically.

All motion derives from the shared clock and timeline. Reconnect/bootstrap
restores completed results without replaying motion or historical sounds.
New rounds, games and aborts replace the sequence and its pending cues. Custom
5K variants still gate the entire result reveal and never substitute one video
for another. See [media selection](media.md) for optional collision, tie and
multiplier sounds.

Browser QA used isolated synthetic frames with actual Google rendering and no
game or Replicant writes. Entry/count/subtraction/multiplier/flight/impact/final
stages were inspected, including HP 5784 remaining unchanged until impact and
settling at 5700 for `(4788 - 4732) × 1.5 = 84`. This validates the local
choreography, not an exact latency match to another browser's GeoGuessr springs.
