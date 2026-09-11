# Scoring animation comparison, 2026-09-11

Compared the live GeoGuessr game-master/spectator screen with
`http://127.0.0.1:9091/bundles/rashinban/graphics/presenter.html?role=preview`.
The user requested a new duel: the previous ongoing test game was aborted
(204), then `/api/v4/parties/v2/start-game` returned 200 `{"message":"OK"}`.
New game: `6aa3bc28f617baa49875977e`, with auto-start enabled. Both views
received this same live game. The presenter remained a preview; no presenter
implementation or settings were modified.

The user's RASTER preference is verified in
[live-raster-options.json](samples/map-style/live-raster-options.json):
all three GeoGuessr maps use `61449c20e7fc278b`, RASTER, roadmap. The earlier
VECTOR findings should not be used as the desired rendering preference.

## Most useful visual comparison

These images are approximately simultaneous (capture requests 204 ms apart):

- [Presenter at 08:32:42.550 UTC](samples/scoring-animation/presenter-022.jpg): round 2 scores already
  settled at 4788 / 4732, right HP already 5700, label NEXT ROUND.
- [GeoGuessr at 08:32:42.754 UTC](samples/scoring-animation/geoguessr-023.jpg): score/damage motion still
  visible, multiplier x1.5 emphasized, right HP animating through 5767.

Round 2's actual calculation is `(4788 - 4732) * 1.5 = 84` damage, taking
right HP from 5784 to 5700. Round 1 was 4490 vs 4274, 216 damage at x1.
These provide both ordinary and multiplier-bearing scoring examples.

## Differences

| Aspect | GeoGuessr | Current presenter |
|---|---|---|
| Entry | Score panel slides in, central emblem pops in, scores rise into place | Brief ROUND COMPLETE panel, then results map and score labels appear |
| Counting | Both scores count from zero over 750 ms after an entry wait | Both count linearly over 1200 ms after a 200 ms lead |
| Subtraction | Winning score travels horizontally into losing score; impact turns it into the difference | No visual subtraction stage |
| Multiplier | Difference visibly becomes multiplied damage with xN label and a spring scale emphasis | Multiplier remains header information; no multiplication stage |
| Damage | Damage number flies to the losing HP label, grows/fades at impact, then HP animates | HP value and bar interpolate directly over 800 ms |
| Original scores | Ghost copies remain while the moving numbers act out the calculation | Final point totals remain stationary |
| HP movement | React Spring default numeric spring; bar uses the stiff preset | Linear numeric interpolation and scaleX; no explicit impact |
| Tie | Both scores move toward the center and disappear with tie-crash sound | No damage cue when no HP is lost, but no collision sequence |
| Sound staging | Separate count, collision, multiplier, and HP-loss cues | Generic results/count/damage timeline; does not express these intermediate stages |
| Layout | Large scores above HP bars, results map fills the lower panel | Scores flank a smaller central map, HP bars above |

The presenter therefore finishes the scoring explanation much earlier and
does not visually show how point difference becomes damage. The appropriate
change is to add those distinct stages, not merely make the count slower.
Keep the RASHINBAN layout/branding while mapping the calculation stages onto
its score labels and HP bars.

## Timing from GeoGuessr client code

These are programmed offsets relative to mounting the damage component,
not millisecond-accurate measurements from server timeout. Browser scheduling,
spring settling, and transitions can add latency.

1. Wait 10 + 1200 ms for entry.
2. Count both scores for 750 ms, playing COUNT_DAMAGE.
3. Hold the completed scores for 1000 ms.
4. For a non-tie, move the winner's score toward the loser over 400 ms;
   play DAMAGE_CRASH after 250 ms, show the difference at 350 ms, and apply
   a short horizontal wobble. This helper waits 500 ms in total.
5. At x1, hold 1000 ms. With multiplier >1, hold 500 ms, immediately replace
   the difference with multiplied damage, play EFFECT_MULTIPLIER, scale to
   1.3 with a wobbly spring, then hold 1000 ms.
6. Shoot damage toward the losing HP label (400 ms travel); after 350 ms,
   scale it to 1.75 and fade, then call the HP controller and LOST_HEALTH.
7. Wait 2000 ms after triggering HP damage. The HP spring isn't explicitly
   awaited by that controller.

Consequently HP damage begins about **4.81 s at x1**, or **5.31 s with a
multiplier**, after component mount. The current presenter schedules HP
damage at **1.4 s** and completes its interpolation at **2.2 s** after
scheduling ordinary results (`leadMs: 200`, `countMs: 1200`, `damageMs: 800`).
These clocks have different origins; use them to compare choreography, not
as an exact network-latency measurement.

Tie branch: after the count and hold, both scores travel halfway toward each
other over 400 ms; at 350 ms play TIE_CRASH, preserve ghost scores, scale/fade
the moving scores, and wait another 350 ms. No HP flight is performed.

Supporting CSS: score panel entry 700 ms, central emblem 450 ms with 300 ms
delay, distances fade over 400 ms with a 2000 ms delay; round-result panel
entry is 750 ms. See the captured CSS for keyframes and exact selectors.

## Evidence and limits

- [frames.json](samples/scoring-animation/frames.json): capture request timestamps for 70 JPEGs (35 per view).
  Same-number pairs are sequential, not simultaneous; use timestamps to
  align them. Captures span round-1 exit, round-2 play/results, and round-3
  entry. The near-simultaneous pair linked above is intentionally cross-index.
- [geoguessr-source.json](samples/scoring-animation/geoguessr-source.json): exact relevant client source excerpts and 48 CSS
  rules, plus server round results; build `web-1.7711-e06e090`.
- [presenter-source.json](samples/scoring-animation/presenter-source.json): snapshot of inspected timeline/projection/render
  source and CSS with SHA-256, since the presenter agent is editing separately.
- `*-dom-timeline.json`: first-round sampled DOM text and animation metadata.
  Background-tab throttling made these samples sparse; do not use the gaps
  to infer animation durations. The timing table comes from source instead.
- [geoguessr-initial.png](samples/scoring-animation/geoguessr-initial.png): initial live layout after starting the new duel.

No 5K or drawn-round animation was visually tested here; tie behavior above
comes from source. The observed scores and HP matched between views once
animations settled. This handoff reports presentation differences, not a
scoring-calculation bug. The duel was left running with auto-start enabled.
