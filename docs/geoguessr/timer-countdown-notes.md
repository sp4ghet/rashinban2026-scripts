# EFFECT_TIMER_COUNTDOWN corner-case audit

Audited the existing captured game-master/party Duels source, build `web-1.7711-e06e090`. No game state, guesses, bot loops or presenter runtime were changed for this audit.

**Main finding:** this is a deadline-aligned effect, not a first-guess-only effect and not the last-three-second numeral tick. GeoGuessr explicitly fades/stops it when ordinary round results arrive. The user's requested **play-to-end** behavior is a deliberate custom behavior, not a faithful copy of that stopping rule.

## Evidence

- [music-source.json](samples/scoring-animation/music-source.json): complete module 459354, lifecycle `p` and captured sound-manager/Howler wrapper. This is the principal evidence for every source claim below.
- [round-sfx-hook-source.json](samples/scoring-animation/round-sfx-hook-source.json): party game-master wrapper installs that lifecycle and passes its sound manager.
- [round-sfx-registry.json](samples/scoring-animation/round-sfx-registry.json): EFFECT_TIMER_COUNTDOWN references `new-effect-timer-countdown-0d655922bc0f0721..mp3`, type Effect, priority SECOND, no loop declared. The wrapper defaults loop to false.
- [countdown-audio-metadata.json](samples/scoring-animation/countdown-audio-metadata.json): browser-decoded duration **18.000 seconds** at 48 kHz. Local normalized filename is `assets/sfx/geoguessr/new-effect-timer-countdown-0d655922bc0f0721.mp3`.
- [../../presenter-protocol.md](presenter-protocol.md): captured first-guess deadline changes and pause/resume/rollback behavior. Those observations supplement, but do not replace, the hook predicates.

No new acoustic test was performed. “Confirmed” below means explicit captured source or previously captured protocol behavior; audible outcomes dependent on Howler internals, navigation or unusual server state are labeled inference/uncertain.

## Exact scheduling logic — confirmed source

The React scheduling effect depends on this tuple:

```text
[currentRound.hasProcessedRoundTimeout,
 currentRound.timerStartTime,
 currentRound.endTime,
 currentRound.startTime,
 sounds,
 selectedRoundMusicKey]
```

It does **not** depend directly on guess count, round number, game ID, `isPaused`, result presence or game status. React can replace the callback closure when the round object changes, but unchanged effect dependencies do not themselves cause the effect to execute again.

The effect first returns if `hasProcessedRoundTimeout` is true. It then returns if `timerStartTime`, `endTime` or the countdown sound object is absent/falsy. Otherwise it calculates, using GeoGuessr's clock helper `975490.c_()`:

```js
// Faithful algebraic rewrite of the captured expression; milliseconds.
const now = geoguessrClockNow();
const remaining = Math.min(
  endTime - Math.max(now, timerStartTime),
  Math.min(endTime - startTime, 15000)
);
const delayMs = Math.max(0, endTime - remaining - now);
const seekSeconds = (15000 - remaining) / 1000;

clearTimeout(pendingStart);
pendingStart = setTimeout(() => {
  selectedRoundMusic?.rate(1.04);
  if (seekSeconds > 0) countdown.seek(seekSeconds);
  countdown.fadeIn(200);
}, delayMs);
```

There is **no lower clamp on remaining**, no clamp on seek, no check of `isPlaying`, and no recheck of round state inside the timeout callback. A zero seek is not explicitly applied. The effect returns no cleanup function of its own.

## Corner cases

| Case | Confirmed behavior and implications |
| --- | --- |
| 60-second timed round, nobody guesses | At round initialization a start is scheduled for `endTime - 15s`. No first guess is needed. |
| First guess early in a long round | Captured server behavior changes timerStartTime/endTime to the shorter guess deadline. Changed dependencies reschedule the pending start. With a 15-second response window it starts immediately, or seeks slightly forward if the state arrives late. The guess has its own separate lock-in sound. |
| No max round time, nobody guesses | No timerStartTime/endTime means no countdown scheduling. The first guess supplying them permits scheduling. |
| First guess with a response window longer than 15s | The effect waits until the final 15 seconds of that new deadline; it does not play immediately merely because a guess arrived. |
| Second/intermediate guess, deadline unchanged | Guess arrays are not scheduling dependencies. The countdown scheduling effect does not rerun just for that guess. The separate own/opponent guess SFX may play. |
| Duplicate state with the same dependency values | Does not rerun the scheduling effect. This provides ordinary duplicate suppression, but is not a per-round sound-once latch. |
| Deadline or timerStartTime changes while audio is already playing | Effect clears only the pending start timeout, then schedules another seek/fadeIn call. It does not explicitly stop an existing voice or test isPlaying. See the wrapper caveat below; exact overlap/restart behavior is not established by this hook alone. |
| Round resolves early after both guesses | When both teams have a roundResults entry for this round **and game status is Ongoing**, the separate result effect calls countdown.fadeOut(1000), resets selected round music to rate 1, and clears the pending start timeout. A pending, not-yet-started clip is therefore canceled; an already-playing clip is faded and stopped. |
| Normal timeout | Same result effect applies when the results arrive. It is results-driven, not a direct stop at `endTime`. There can be a short delay after zero before fade-out starts. |
| Processed flag changes to true, but results predicate is false | Scheduling effect returns early. **That early return does not itself clear the old pending timeout or stop audio.** Do not equate processed=true with an explicit audio stop in this source. |
| Match finishes on that round | The result predicate includes `status === Ongoing`; it is false for Finished. Therefore this particular result fade-out is not guaranteed on a final-round state received directly as Finished. Parent cleanup, other view handlers or natural completion can affect playback. A guaranteed final-match play-to-end/stop rule cannot be inferred from this hook. |
| Reconnect during countdown | On mount, remaining time is calculated against the current clock. At 8 seconds left, seek is 7 seconds and fade-in is 200 ms. It does not play a fresh full 18 seconds from the beginning. Remaining clip length is about 11 seconds absent other stopping behavior. |
| Reconnect after deadline, before processed/result state | Negative remaining can produce seek >15s; no upper clamp exists here. A seek beyond the 18s duration depends on Howler behavior. Do not copy this as a desired stale-state policy. |
| Round duration exactly 15s | Starts at the round start, seeking from approximately zero, provided required timestamps exist. |
| Round duration 10s | At round start, seek=5s, so it plays the corresponding final countdown portion. If allowed to finish naturally, that leaves about 13s of clip including the 3s tail. |
| Round duration 3s | At round start, seek=12s; this uses the same long countdown asset, not three repeated short ticks. About 6s of clip remains absent interruption. |
| Max number of rounds | Not read by the scheduling effect. Its significance is whether the server moves to Finished; use that case above. |

For short response windows after a guess, the same arithmetic applies to remaining time. The cap `endTime - startTime` is the current round's overall start-to-end span, not a direct read of the configured timeAfterGuess. Use timestamps instead of deriving the active deadline from options.

## Pause, review, resume, rollback, new round

**Confirmed source:** the countdown hook does not inspect `isPaused`, helpRequested or the game-master “Game is under review” overlay. Toggling those alone has no scheduling effect. The earlier pause probe held normal resolution at the deadline with `isPaused: true` and `hasProcessedRoundTimeout: false`; resume released normal results rather than granting extra guessing time.

**Inference for that pause shape:** if the same sound manager remains mounted, timestamps stay unchanged and neither results nor another sound handler stops it, the clip can continue naturally into its tail while review is shown. There is no explicit pause/resume of the audio playhead here. A changed deadline on resume would be handled as another rescheduling event, not as restoration of a saved playhead.

**Rollback/new round:** neither event name nor a round identity is directly checked. Changed start/end/timerStart timestamps normally rerun scheduling. If the new round has valid timestamps, this cancels the old pending start and schedules the new one. If it has absent timestamps, the early return does not cancel the old pending start. There is no explicit stop/reset of an already playing countdown on round change in this hook. Ordinary previous-round resolution usually supplies the stop, but rollback/review can differ.

**Race to avoid in the custom implementation:** the wrapper's fadeOut schedules a stop after one second, without a cancelable generation token. A new playback on the same sound object within that second can be affected by the old stop. This is a source-level race possibility, not an observed failure. A presenter can avoid it with per-playback handles and round/run identity.

## Sound-wrapper caveats and lifecycle cleanup

The callback uses the sound object's `fadeIn(200)` directly. That method sets volume to zero, calls `howl.play()`, then fades to its configured effect volume. It bypasses the wrapper's normal `play()` method, whose implementation would stop an existing playback by default. Consequently, do not claim that the normal play-method duplicate prevention protects the countdown's direct fadeIn path. Whether a repeated fadeIn resumes/restarts/creates another voice requires Howler-instance evidence beyond this hook.

`fadeOut(1000)` fades the Howl toward zero, waits 1000 ms and calls stop. The effect is nonlooping and lasts 18 seconds if started at zero and allowed to finish. The normal countdown alignment intentionally includes about 3 seconds after the nominal deadline, but ordinary results can cut that tail short.

The lifecycle hook's cleanup clears the pending timer. Its `handsOverMusic` option changes lobby-music cleanup only; it does not establish countdown play-to-end. Separately, unmounting the sound-manager hook calls unloadAll; each sound unload initiates a 750 ms fade and unload. Navigating away or replacing the sound manager can therefore interrupt the clip too. Music mute and effect mute are separate: this clip is controlled by effectVolume.

## Requested custom behavior: play to end

**User requirement supplied by the implementer:** let the countdown clip play to its end. This differs from GeoGuessr's confirmed ordinary-result fade/stop behavior. Do not describe the custom result as an exact audio clone.

Recommended implementation interpretation (recommendations, not newly verified user requirements):

1. Replace the last-three-second trigger with the deadline-aligned final-15-second scheduling above, retaining late-entry seeking. “Play to end” means the remaining clip after its chosen seek, not necessarily restart a full 18 seconds on reconnect.
2. On ordinary resolution/second guess, cancel a pending start that never fired. If playback already started, let it finish through the results scene; do not fade it out merely because round results arrive.
3. Keep that playback owned by a stable audio service so a scene-component unmount does not truncate it. Preload the asset; start it once per intended countdown run. Deduplicate unchanged snapshots and second guesses.
4. Track `(gameId, roundNumber, roundStartTime/run-generation)` plus the authoritative deadline. A rollback can replay the same round number; round number alone is not sufficient. Before playback, update the pending schedule when a deadline changes. While playing, avoid blindly spawning another voice on every timestamp update.
5. Explicitly decide interruption policy for rollback, a different new game, abort, navigation and mute. The user's play-to-end instruction does not uniquely specify these cases. A reasonable operational default is to honor explicit stop/mute and cancel obsolete pending starts, while allowing an ordinary result to overlap the current clip's tail. Do not silently call that default verified GeoGuessr behavior.
6. Define late/stale reconnect policy: if deadline passed, do not start a new countdown solely to play the tail unless that is intentionally desired. Clamp seeks to the valid asset range. Test early-resolution-before-start separately from early-resolution-after-start.

Suggested checks: 60s/no guess; early first guess; unchanged second guess; duplicate snapshots; first guess during an already-running final countdown; reconnect at 8s; 10s/3s round; result before any playback; result during playback; paused deadline; resume; rollback during an outstanding fade; next round with no timestamps; final knockout; abort. Confirm expected custom behavior separately from reference behavior in each test.
