# Round, countdown and lock-in audio

Source-traced on 2026-09-11 from client `web-1.7711-e06e090`. These are code triggers and scheduled delays, not a recording of speaker output. The party game-master wrapper explicitly installs the shared Duels audio lifecycle, passing `teams[0].players[0].playerId` as its reference player. Thus the own/opponent sound distinction below applies to the game-master view too.

## Round flow

| Trigger | Sound key | Timing / playback |
| --- | --- | --- |
| Host's round preview appears | EFFECT_MAP_ENTER | Mount callback, rate 1.4 |
| Host hovers the start control | EFFECT_HOVER | Hover callback, default rate 1 |
| Host clicks start | EFFECT_CLICK | Immediately in click handler |
| Preview slides away after that click | EFFECT_GENTLE_SWOOSH | 150 ms after click, rate 0.9; the handler then waits 750 + 850 ms before calling the start-round endpoint |
| Pre-round numeral 3, 2, then 1 | EFFECT_COUNT_DOWN_TICK | Once per countdown callback for values 2, 1, 0 (rendered as 3, 2, 1); follows round `startTime`, not three seconds after the HTTP response. Registry gain multiplier 1.3 |
| Countdown view starts leaving | EFFECT_GENTLE_SWOOSH | Unmounting-state transition, rate 0.9 |
| Live panorama view appears | EFFECT_PANO_REVEAL | Live-view effect on mount / sound-manager dependency change, default rate 1 |
| Qualifying first-team guess arrives | INTERACTION_YOU_GUESSED | State-change callback, no scheduled delay; conditions below |
| Qualifying opposing-team guess arrives | EFFECT_OPPONENT_GUESSED | State-change callback, no scheduled delay; conditions below |
| Final countdown window | EFFECT_TIMER_COUNTDOWN | One track aligned to the final 15 seconds, with 200 ms fade-in and late-entry seeking |
| Both teams have a current-round result | Countdown fades out | 1,000 ms fade-out; active round music returns to rate 1.0 |
| Result-map panel mounts | EFFECT_MAP_ENTER | Rate 1.4; later pin/map reveals have separate calls |

The start-button sequence and automatic countdown-exit sequence are separate code paths; do not blindly schedule both swooshes for every transition.

## What “lock-in” means to the audio code

This is triggered by a guess being **added to round state**, not by placing a tentative pin or merely pressing a local button. The handler ignores changes other than `added` and ignores arrivals when the round deadline is already in the past. It plays only if the combined guess count is **1 or equals the total number of players**.

For ordinary 1v1, each player's newly received guess can therefore trigger a cue. For team Duels, intermediate teammates' guesses do not each get a sound from this hook. In the game-master wrapper, team index 0 gets INTERACTION_YOU_GUESSED, and the other team gets EFFECT_OPPONENT_GUESSED, regardless of which guessed first. The reference is a team's player ID, not the host's identity or which camera is enlarged.

A separate player-view grace-period callback also plays EFFECT_OPPONENT_GUESSED. That is not an additional confirmed game-master cue; avoid duplicating it in the presenter. No separate tentative-pin/lock-in swoosh call was identified in the broadcast component itself.

## Final countdown scheduling

The shared lifecycle requires `timerStartTime` and `endTime`, and skips setup once `hasProcessedRoundTimeout` is true. Its scheduling can be expressed in milliseconds as:

```js
remaining = Math.min(
  endTime - Math.max(now, timerStartTime),
  Math.min(endTime - startTime, 15000)
);
delay = Math.max(0, endTime - remaining - now);
seekSeconds = (15000 - remaining) / 1000;
// After delay: music.rate(1.04); seek if > 0; countdown.fadeIn(200).
```

Consequently, a normal 60-second round starts this track at 15 seconds remaining. Joining with 8 seconds left seeks 7 seconds into the track. A guess that changes the deadline causes recalculation from the updated timestamps. This is distinct from the three individual pre-round numeral ticks. Match the authoritative deadline rather than starting a fresh full countdown clip on every guess.

### Pre-round and end-of-round sound distinction

The confirmed pre-round numeral sound is `new-effect-count-down-tick-f9be693554415c60.mp3`. Decoding the MP3 gives a duration of **1.044 seconds**, replayed for each displayed numeral. It is distinct from `new-effect-timer-countdown-0d655922bc0f0721.mp3`, whose decoded duration is **18 seconds**, despite being aligned to a 15-second countdown window.

The user also reports an end-of-round sound. Its identity in Duels is **not yet conclusively matched**. The countdown track has three seconds of asset duration beyond the nominal deadline, and the lifecycle fades it out over one second once both round results exist. Its tail, or the result-map entry cue, are candidates; duration and source scheduling alone do not establish which audible sound the user means.

There is also a downloaded `round-end-e08bdc3b4a4c7409.mp3`, alias `roundEnded`/`boom`. Its confirmed call site is in the quiz/question-state audio hook: play when state becomes `Ended`, provided the question is not `StaticContent`, the game is not single-player, and audio is not disabled. **Do not assign this file to Duels solely from its name**; no call to it was identified in the traced Duels lifecycle. Evidence: [party-round-end-source.json](samples/scoring-animation/party-round-end-source.json). Decoded countdown durations are in [countdown-audio-metadata.json](samples/scoring-animation/countdown-audio-metadata.json).

## Background music and other transitions

See [music-scenes.md](music-scenes.md) for the complete scene/track table, crossfades, countdown layering and volume controls.

During active play the lifecycle selects MUSIC_HEALING_ROUND for healing rounds; otherwise MUSIC_ROUND_FOUR whenever multiplier >1; otherwise MUSIC_ROUND_ONE/TWO/THREE by round number, with FOUR as the fallback. Healing currently shares the round-one audio asset. These entries loop. The timer effect speeds the active music to 1.04; results restore 1.0. Waiting/results select MUSIC_DUELS_LOBBY, seeking to 6 seconds when starting that track after results. The music manager uses 750 ms crossfades between tracks, or 250 ms fade-in without an existing music channel.

Music filenames/source definitions are in [round-sfx-registry.json](samples/scoring-animation/round-sfx-registry.json); music was excluded from the existing MP3 download set.

The outer party door transition has DOORS_CLOSING immediately and DOORS_BOOM 300 ms later with animations enabled (0 ms without animation). `isInstant` skips these two calls. Opening the doors plays EFFECT_PANO_REVEAL. These belong to the party transition shell; do not add them to every round merely because the assets exist. EFFECT_STRESS_1 and EFFECT_STRESS_2 occur in the loaded sound registry, but no playback call was found across the loaded source set, so no trigger is assigned to them.

## Local files and evidence

All 11 effects referenced above are downloaded under `assets/sfx/geoguessr/`; [round-sfx-cues.json](samples/scoring-animation/round-sfx-cues.json) maps keys to exact hashed filenames and source URLs. The registry specifies no loop for these effects. Default rate/gain multiplier is 1 unless stated above; effective gain also depends on the user's sound settings.

- [round-sfx-source.json](samples/scoring-animation/round-sfx-source.json): lifecycle, timers, guess conditions and preview/countdown calls.
- [round-sfx-hook-source.json](samples/scoring-animation/round-sfx-hook-source.json): party wrapper wiring, shared hook use, and door/countdown callbacks.
- [round-sfx-registry.json](samples/scoring-animation/round-sfx-registry.json): effect/music definitions, guess grouping and door option meanings.
- [broadcast-sound-calls.json](samples/scoring-animation/broadcast-sound-calls.json): broadcast call sites; some `.play` entries are avatar animations, not audio.
- [Scoring cues](sfx-timing.md): subsequent score collision, multiplier, HP and tie timing.
