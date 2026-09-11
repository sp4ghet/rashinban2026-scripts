# Presenter showcase replay

Select **Presenter showcase** in the dashboard's Replay fixture menu, then apply
the input. This is a deterministic **synthetic** two-minute MOVE duel, not a
recording of a real match. It uses the already mapped captured players:
left/blue `6aa29a4e4752c83aa99d7655`, right/red `65701c932c6e4a0a9881791e`.
Existing custom player mappings still apply; the fixture does not rewrite them.

The initial snapshot also contains the unstarted second round, matching the
privileged game-master API. Once round 1 scoring finishes, the presenter previews
that distinct next panorama while keeping round 1's settled HP. This happens in
both automatic and manual start modes. At the two-round limit, it retains the
final results until Finished arrives, then holds the winner and round summary.

| Elapsed | What to watch |
| --- | --- |
| 0–3s | Round 1 pre-round countdown and exact-pano prewarm |
| 4–22s | Both players' movement, pan/zoom, expanded/collapsed maps, bounds and pins |
| 15s | Left locks; right view expands; 15-second urgent countdown |
| 16s | Synthetic spawn reset reaches the locked player; their locked view must remain frozen |
| 28s | Right locks; both maps show pins |
| 30–60s | Single 5K: 5000 vs 4700, 300 damage, HP 6000 / 5700; celebration then scoring |
| 60–63s | Round 2 pre-round countdown |
| 64–82s | Both players' movement and maps repeat |
| 75–76s | Right locks first, then receives the synthetic spawn reset; left view expands |
| 88s | Left locks |
| 90–120s | Double 5K: 5000 / 5000, tie collision, no damage; HP stays 6000 / 5700 |
| 120s | Match finishes with blue winning on remaining health after the two-round limit |

Each result remains available for 30 seconds, including enough time for the
five-second single-5K clip and scoring, or the missing-effect watchdog. A double
5K uses only the separately configured double-5K asset. If that asset is absent,
the normal missing-media fallback continues to the tied scores; the single-5K
clip is not duplicated. Use the Program graphic to test embedded audio. If the
audio setting is Separate, also open the separate audio source. The silent
preview deliberately emits no audio. Google imagery still requires
the presenter's configured Google API key.

`scripts/generate-presenter-showcase.mjs` generates
`docs/geoguessr/samples/gs2-ws-presenter-showcase.json`. Run it with Node from the
repository root; add `--check` to compare without writing. It uses the sanitized
full-duel capture for protocol structure and player/team IDs, and
`gs2-ws-LiveStreamSamples-movement-trace.json` for ordered movement/POV/zoom
payloads. The clock is deliberately compressed. Outcomes, map interactions,
pin positions, spawn-reset batches, and the game/party IDs are synthetic.

The three exact captured panorama IDs were verified through Google's panorama
service on 2026-09-11. Coordinates for the second and third panoramas use that
lookup, correcting the capture's delayed position values. Panoramas can change
upstream; the fixture never substitutes nearby imagery. It stays MOVE throughout
the same game and does not exercise NMPZ mode changes.
