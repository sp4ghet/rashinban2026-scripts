# GeoGuessr game-master scoring SFX

Traced from the loaded web-1.7711-e06e090 client on 2026-09-11. These are programmed sound-call times, not measured speaker onset. Loading, browser scheduling and audio latency can delay playback.

**Time zero is mounting the damage/scoring component**, not receipt of the round-ended WebSocket message. Earlier map reveals and the 5K presentation have their own clocks.

| Cue | x1 round | Multiplier >1 | Visual trigger | Downloaded MP3 filename |
| --- | ---: | ---: | --- | --- |
| COUNT_DAMAGE | 1,210 ms | 1,210 ms | Both scores start counting; count lasts 750 ms | new-round-score-count-damage-781eb9ae0a004172.mp3 |
| DAMAGE_CRASH | 3,210 ms | 3,210 ms | Scores collide; 250 ms into the difference animation | new-round-score-damage-crash-e35d67887afdaf00.mp3 |
| EFFECT_MULTIPLIER | omitted | 3,960 ms | Difference becomes multiplied damage and scales up | effect-multiplier-1b820c69eccad745.mp3 |
| LOST_HEALTH | 4,810 ms | 5,310 ms | Damage reaches health label; HP spring starts | round-score-damage-up-69626c55b4d11c2f.mp3 |

For a **tie**, COUNT_DAMAGE still starts at 1,210 ms, followed by **TIE_CRASH at 3,310 ms** (`round-score-tie-up-ea2aadf42e20ed4f.mp3`). Both scores meet and disappear. Difference, multiplier and health-loss cues are skipped.

The multiplier cue uses **playback rate 0.9**, all other cues above use the default 1.0. The sound manager's second `play` argument calls `rate(t)`; it is not a gain setting. These registry entries do not declare looping, and the count helper issues one play call with no timed stop. A presenter should not infer a loop from the 750 ms number animation.

For **5K or double-5K**, EFFECT_5K (`effect-5k-1a7bdf50be20c3ba.mp3`) is requested **1,100 ms after the 5K component's mount callback**, at rate 1.0 and registry volume multiplier 1.25. This is a separate phase: do not add 1,100 ms to the damage-stage clock. Tie and 5K branches were source-traced, not demonstrated in the two recorded comparison rounds.

Timing derivation: entry waits 10 + 1,200 ms; count 750 ms; hold 1,000 ms; difference helper 500 ms total (crash after 250). Then wait 1,000 ms at x1, or 500 ms followed by multiplier application and 1,000 ms at >1. Damage travel helper waits 350 ms before health application (visual travel is configured for 400 ms).

All filenames resolve under `assets/sfx/geoguessr/`. Machine-readable cues are in [sfx-cues.json](samples/scoring-animation/sfx-cues.json). Evidence: [scoring/health source](samples/scoring-animation/geoguessr-source.json), [registry, playback-rate implementation and 5K source](samples/scoring-animation/sfx-source.json). This maps the scoring sequence; it is not a complete mapping of all 128 downloaded sounds or every game mode.

Round play, lock-in, countdown and entry/exit cues are documented in [round-sfx-timing.md](round-sfx-timing.md).
