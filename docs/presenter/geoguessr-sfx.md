# GeoGuessr SFX setup

The researched MP3s in the main checkout's `assets/sfx/geoguessr` are mapped
to presenter events using aliases from that directory's `manifest.json`.

| Presenter event | Captured alias |
| --- | --- |
| Guess submitted | `INTERACTION_YOU_GUESSED` |
| Countdown tick | `EFFECT_COUNT_DOWN_TICK` |
| Round Street View reveal | `EFFECT_PANO_REVEAL` |
| Results entry | `SCORE_ROWS_SLIDE_IN` |
| Score counting | `COUNT_DAMAGE` |
| Score collision | `DAMAGE_CRASH` |
| Tie collision | `TIE_CRASH` |
| Multiplier | `EFFECT_MULTIPLIER` |
| HP damage | `LOST_HEALTH` |
| Optional 5K cue soundtrack | `EFFECT_5K` |

Run `node scripts/install-geoguessr-sfx.mjs <source-directory>` from the NodeCG
working directory to verify the source hashes and copy these ten files into
`assets/rashinban/effects`. The script prints the `sounds` mapping; select those
assets in the presenter dashboard or merge that mapping into the current media
manifest through the presenter media control. It does not change music stems,
video selection, volume, or audio ownership.

These are deliberate mappings to our presenter events; the research does not
establish that every file was played in the observed GeoGuessr match. Countdown
ticks use the presenter's last-three-seconds schedule. The new `round-start`
event follows the authoritative round start, with no historical replay on join.

The current single-5K video uses its embedded soundtrack. Assigning `five-k`
does not play an additional effect over it: that cue is used only when the
selected celebration's soundtrack setting is **Separate five-k cue**. Program
graphics play embedded audio; Separate audio mode also needs an audio source.
Pin placement is silent in the presenter. Player-client land/water placement
sounds are not assigned to the game-master overlay.
