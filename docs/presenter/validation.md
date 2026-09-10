# Presenter validation

Validation date: **2026-09-11 JST**. This is local implementation acceptance,
not event readiness. Live GeoGuessr access, a Google browser key, intended
player/camera feeds and final event assets were unavailable.

## Automated verification

From the repository root with Node 22.17.0:

| Command | Result |
| --- | --- |
| `npm test` | 130 tests passed, zero failures. |
| `npm run typecheck` | Exit 0. |
| `npm run build` | Exit 0, build complete. |

This covers snapshot/version guards, server-only credential loading and
sanitized errors, auth failure, spectator disconnect/backoff, replacement
lobbies, manual rounds, abort versus finish, result gating, media failures,
video cancellation, audio ownership, cue identities, phase recovery and
series persistence. Live transport tests inject HTTP/socket responses; they
do not establish compatibility with today's authenticated GeoGuessr service.

Integration fixes have observed RED/GREEN evidence:

- Unequal multipliers previously displayed only the common round multiplier.
  The new side-aware label follows series mapping and the displayed result
  round even if current player multipliers or the current round change.
- The dashboard lacked live party selection. Validated session selection now
  supports explicit IDs or blank discovery, rejects malformed values before
  stopping the current connection, and rejects selectors in replay mode.
- Resolved no-pin distance previously used the same dash as hidden/unmapped
  data. It now displays N/A; real zero-score guesses retain their distance.
- The production timeline is directly tested for stable submission identities,
  repeated-version suppression, no fabricated timeout guess and bootstrap
  silence, so the separate interaction helper cannot mask a production drift.

## Browser checks

The isolated runtime used port 9091 and a QA Chrome profile on CDP 9223;
the user's port 9090 instance was untouched. Final-code synthetic states
derived from recorded replay fixtures exercised 1920 × 1080 output:

- MOVE/NM/NMPZ × rendered/chroma × green/magenta: 12 layout combinations.
- Waiting-for-host, pre-round, live, transition, reveal, between-rounds,
  finished and aborted presentation. Scores/answer areas stay hidden before
  reveal; camera rectangles remain stable.
- Long names/handles, wins 0/1/2, reversed side mapping, unequal 3 versus 1.5
  multipliers and N/A results. Google imagery correctly reports unavailable
  without the key, while the rest of the layout remains usable.
- Live selection draft survives status updates; replay hides the selector.
- Dummy overlay plus existing lower-third show/hide/toggle and round
  increment/decrement actions.

The browser run completed without uncaught exceptions. Representative
screenshots and full structured results stay private and uncommitted under
[`artifacts/presenter-validation/`](../../artifacts/presenter-validation/):
[layout](../../artifacts/presenter-validation/layout-NMPZ-rendered-ff00ff.png),
[results](../../artifacts/presenter-validation/phase-results-reveal.png),
[live selector](../../artifacts/presenter-validation/dashboard-live-party.png),
[dummy](../../artifacts/presenter-validation/dummy-companion.png), and
[browser results](../../artifacts/presenter-validation/browser-results.json).
These files are local evidence and are not included in a fresh clone.

## OBS composition and timing

The isolated portable OBS 32.2.2 used 1920 × 1080 at 60 fps, NVENC H.264 MKV
and AAC stereo at 48 kHz. Regional nested scenes keep external player/camera
inputs below their keyed rectangles, preserve the in-slot lock and timer,
keep results unfiltered except cameras, and show a full unfiltered presenter
during single/double 5K. Green used similarity/smoothness/spill 400/80/100;
magenta used 250/80/100. The broader magenta threshold 400 erased red borders
and parts of the timer; the final capture preserves both and the lock badge.
Synthetic exact green/magenta patches in the actual results-map rectangle
and both test videos check compositing; they do not establish Google map
fidelity or acceptance of the intended external feeds.

**Observed audio limitation:** silent-bed/cue-only recordings lost short cues
in both separate and embedded output. AudioContext advanced and the actual
engine scheduled each source; recorded waveform analysis confirmed silence,
with OBS mute, volume and track routing checked. A continuous nonzero authored
220 Hz test stem restored the original 50 ms, 1 kHz countdown clicks. No hidden
signal or production audio workaround was added. Cue-only operation and
recovery from prolonged silence remain unaccepted on this machine.

Continuous-music capture initially put audio about 79–96 ms after video.
The local measured compensation is a **90 ms OBS Render Delay** on the shared
program source, with both audio sync offsets at zero. It adds video latency;
external feeds/cameras need consistent alignment in the final composition.
Short embedded and separate probes each captured all three events without
duplicates, at +6.833 ms and +8.833 ms respectively. These values are calibration
evidence, not a long-run result or a universal OBS preset.

The final **30-minute recording passed**. It used that continuous stem
(all context gains 0.5, music/effects gain 1), real timeline countdown cues
every 30 seconds, the real audio scheduler and a reversible visual marker
following the same presenter clock. It refreshed the graphic and audio page,
switched scenes, and changed separate → embedded → separate ownership.
Settled checkpoints confirmed both requested audio modes and their active leases.
The complete MKV is 1806.485 seconds and 177,519,217 bytes. Measurement retained
the original container timestamps for both streams, sampled visual frames at
60 fps and detected audio onsets in 5 ms windows around 1 kHz.

| Measurement | Observed result |
| --- | --- |
| Visual flashes / audio onsets / matched pairs | 60 / 60 / 60 |
| Missing, extra, unmatched or suppressed onsets | 0 |
| All audio-minus-video offsets | −13.167 to +18.833 ms; median −3.167 ms |
| Start / middle / end offsets | −3.167 / −3.167 / −13.167 ms |
| End-minus-start change | −10.000 ms |
| Fitted drift | −0.587 ppm, projected −2.115 ms/hour |
| First cue after graphic / audio refresh | −13.167 / −8.167 ms |
| First cue after scene switch | −8.167 ms |
| First cue after embedded / separate handoff | +13.833 / −3.167 ms |

All 60 pairs met the ±50 ms bound. The strict analyzer also required absolute
end/start drift ≤50 ms and fitted drift ≤100 ms/hour. No duplicate onset or
accumulating drift above those limits was detected. Negative offset means audio
preceded the recorded visual frame. This is continuous-music acceptance with
the measured video delay; it does not clear the silent-source limitation above.
Separate output passed under those conditions, so no embedded-only fallback
was selected. Embedded output was measured during the same session.

The clean bundle was restored byte-for-byte afterward, original media/settings
and replay config were restored, and the temporary OBS delay was removed.
The final browser/OBS composition rerun passed 21 cases with no uncaught errors.

Private diagnostic evidence includes the
[failed silent-source result](../../artifacts/presenter-validation/av-smoke-failed.json),
[embedded calibration](../../artifacts/presenter-validation/av-embedded-compensated-smoke.json),
[separate calibration](../../artifacts/presenter-validation/av-separate-compensated-smoke.json)
and [reusable analyzer/harness notes](../../artifacts/presenter-validation/harness/README.md).
Final evidence: [measurement JSON](../../artifacts/presenter-validation/av-alignment-result.json),
[action/checkpoint log](../../artifacts/presenter-validation/av-events.jsonl),
[complete recording](../../artifacts/presenter-validation/av-30min-final.mkv),
[green composition](../../artifacts/presenter-validation/obs-live-00ff00.png),
[magenta composition](../../artifacts/presenter-validation/obs-live-ff00ff.png),
[unfiltered results](../../artifacts/presenter-validation/obs-results.png) and
[double 5K](../../artifacts/presenter-validation/obs-double-5k.png).

## External checks still required

| Needed input | Required acceptance |
| --- | --- |
| Valid test-party `_ncfa` cookie and current client version | Actual auth expiry/replacement, live spectator socket loss/reconnect, host abort, manual next round and a new lobby with stable series wins. |
| Authorized Google Maps JavaScript browser key/project/referrers | Actual panorama IDs, MOVE/NM POV/zoom, fixed NMPZ view, player-map visibility/bounds/pins, results markers and readable attribution in OBS. |
| Intended player and camera feeds | Crop/scale and regional key edges in every phase; real green/magenta map pixels; hide/mute external feeds for results and celebrations. |
| Final authored stems, sounds and single/double videos | Decoded loop compatibility, transitions, codec/autoplay behavior, soundtrack ownership, loudness and a repeat timing run on the event machine. |
| Operator scene actions or external phase automation | Switch the documented live/results/full-screen compositions at actual game/effect boundaries. The presenter does not control OBS scenes automatically. |

Do not treat unavailable-key placeholders or synthetic color patches as live
map fidelity. Do not treat a calibrated analyzer, a short fixture or browser
AudioContext inspection as a 30-minute OBS synchronization result.
