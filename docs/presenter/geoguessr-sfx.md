# GeoGuessr SFX setup

The researched MP3s in the main checkout's `assets/sfx/geoguessr` are mapped
to presenter events using aliases from that directory's `manifest.json`.

| Presenter event | Captured alias |
| --- | --- |
| Guess submitted | `INTERACTION_YOU_GUESSED` |
| Final 15-second countdown | `EFFECT_TIMER_COUNTDOWN` |
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

The countdown uses `new-effect-timer-countdown-0d655922bc0f0721.mp3`, an 18-second
nonlooping clip aligned to the final 15 seconds of the authoritative deadline.
A first guess normally shortens that deadline; longer response windows still
wait until 15 seconds remain. Short rounds and late connections seek forward,
while connections after the deadline do not start a stale tail. Repeated
snapshots and second guesses do not restart it. A same-number round restart
with a new start timestamp creates a fresh countdown run.

Once started, the clip finishes naturally through results, including its
three-second tail. Results cancel a pending start that has not fired. This is
the user's requested departure from GeoGuessr's one-second result fade-out.
Pause/review alone leaves the clip running; explicit mute, lease loss, abort,
new game/round, rollback, or source disposal still take precedence.
See the main checkout's
`docs/geoguessr/samples/scoring-animation/timer-countdown-notes.md` for the
research agent's source audit and wrapper caveats. No browser pitch/tempo
adjustments are applied to the custom music.

The `round-start`
event follows the authoritative round start, with no historical replay on join.

The current single-5K video uses its embedded soundtrack. Assigning `five-k`
does not play an additional effect over it: that cue is used only when the
selected celebration's soundtrack setting is **Separate five-k cue**. Program
graphics play embedded audio; Separate audio mode also needs an audio source.
Pin placement is silent in the presenter. Player-client land/water placement
sounds are not assigned to the game-master overlay.
