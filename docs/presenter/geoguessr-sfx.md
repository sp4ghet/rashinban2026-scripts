# GeoGuessr SFX setup

The researched MP3s in the main checkout's `assets/sfx/geoguessr` are mapped
to presenter events using aliases from that directory's `manifest.json`.

| Presenter event | Captured alias |
| --- | --- |
| First team's guess submitted | `INTERACTION_YOU_GUESSED` |
| Opposing team's guess submitted | `EFFECT_OPPONENT_GUESSED` |
| Pre-round 3, 2, 1 | `EFFECT_COUNT_DOWN_TICK` |
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
working directory to verify the source hashes and copy these twelve files into
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

If the timer expires, the clip keeps its complete, unmodified three-second tail
and ends naturally, with no scheduled fade or stop. If both guesses or results arrive before the deadline,
an active clip fades out over one second; a pending clip is canceled. A 200ms
fade-in follows the research.
Pause/review alone leaves the clip running; explicit mute, lease loss, abort,
new game/round, rollback, or source disposal still take precedence.
See the main checkout's
`docs/geoguessr/samples/scoring-animation/timer-countdown-notes.md` for the
research agent's source audit and wrapper caveats. No browser pitch/tempo
adjustments are applied to the custom music.

The `pre-round-tick` cue uses `new-effect-count-down-tick-f9be693554415c60.mp3`
once at start minus 3, 2 and 1 seconds, at the registry's 1.3 effect gain.
It follows the server start in manual and automatic games, remains silent on
an unscheduled preview, and skips elapsed ticks when joining late. A changed
start cancels/replaces pending ticks. It is separate from the continuous
final-15-second countdown. Research: the main checkout's
`docs/geoguessr/samples/scoring-animation/round-sfx-timing.md`.

The `round-start`
event follows the authoritative round start, with no historical replay on join.

The current single-5K video uses its embedded soundtrack. Assigning `five-k`
does not play an additional effect over it: that cue is used only when the
selected celebration's soundtrack setting is **Separate five-k cue**. Program
graphics play embedded audio; Separate audio mode also needs an audio source.
Pin placement is silent in the presenter. Player-client land/water placement
sounds are not assigned to the game-master overlay.

Submission sounds follow GeoGuessr's team order, not who guessed first or the
configured left/right window mapping. Team zero uses `guess`; team one uses
`opponent-guess` (`new-effect-opponent-guessed-2fbbb4fd1c36d3df.mp3`). Both retain
the same submission-event behavior across results. Timeout-inserted guesses
do not trigger submission sounds.
