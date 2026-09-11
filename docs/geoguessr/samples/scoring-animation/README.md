# Scoring and audio samples

Captured on 2026-09-11 from GeoGuessr client `web-1.7711-e06e090` and the local presenter preview.

- `geoguessr-*.jpg`, `presenter-*.jpg`, `geoguessr-initial.png`: visual comparisons. `frames.json` records capture request times; equal-numbered frames are not simultaneous.
- `*-dom-timeline.json`: sampled text/animation state; background-tab throttling makes timing sparse.
- `geoguessr-source.json`, `presenter-source.json`: source snapshots and scoring evidence.
- `game-master-*-source.json`: scene predicates and preview/result handlers.
- `sfx-cues.json`, `round-sfx-cues.json`: asset mappings and timing references.
- Other `*-source.json`, `round-sfx-registry.json` and `round-sfx-context.json`: audio call sites, registry definitions and lifecycle evidence.
- `countdown-audio-metadata.json`: decoded clip durations and related source searches.
- `music-live-inspection.json`: read-only inspection result; it did not recover active Howler voices.

See [scoring analysis](../../scoring-animation.md), [scoring SFX](../../sfx-timing.md), [round SFX](../../round-sfx-timing.md), [countdown corner cases](../../timer-countdown-notes.md) and [scene music](../../music-scenes.md).
