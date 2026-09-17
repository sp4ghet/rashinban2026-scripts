# Presenter media

Upload files in NodeCG's **Assets** tab, under **Presenter music**, **Presenter cue sounds**, or **Presenter celebrations**. Select them in **Duels Presenter → Celebration media**, then **Apply media**. The menus use the merged `presenterAssets` inventory and identify inherited files. Upload shared media from the main checkout; worktree uploads override a shared file with the same category and filename. Deleting a local file reveals the shared file again. See [configuration and media inheritance](../configuration.md). An unavailable saved selection stays visible so the operator can replace it.

Single and double 5K use independent videos. Two perfect scores select exactly one double video. If that selection is empty or missing, results reveal normally; the presenter never substitutes two single videos. The media status shows missing files, playback failures, natural completion, and watchdog expiry.

The explicitly active `presenter.html?role=program` source plays celebrations. Preview sources preload selections but stay silent and do not play or complete effects. A program that takes over after a cue has started does not replay that clip. Losing ownership, changing rounds, aborting, or closing the page stops playback. Cancellation suppresses stale completion callbacks.

The clip fills the 1920×1080 graphic above all other content, including both camera windows. Its opaque black backing also covers cameras when the source has transparency or a different aspect ratio. Cameras return when the clip ends. Score reveal/counting and then damage begin at the shared timestamps published after effective completion, with the configured lead between completion and reveal.

## Soundtrack and duration

- **Embedded:** the video's original soundtrack plays only on the active program graphic, including when general audio output is set to a separate browser source. Presenter mute and effects gain apply immediately. No rate or pitch adjustment is used.
- **Cue:** the video is muted. A `five-k` cue sound must be selected. The selected sound plays through the current audio owner at the shared effect timestamp and stops when the video completes or is interrupted, including a program ownership change.
- **Silent:** the video is muted and no celebration soundtrack should be dispatched.

The video must expose finite, positive duration metadata. A clip longer than its configured maximum wait is rejected. The local watchdog is bounded by both the configured wait and duration plus one second; the server independently enforces the configured wait. Rejection, decoding error, and autoplay denial all complete once and reveal results normally. Configure enough maximum wait for the entire clip and normal startup overhead; the accepted range is 500–120000 ms.

Ordinary Chrome can deny audible autoplay without user activation. Browser-source autoplay behavior must be checked in the actual OBS setup. The presenter reports failure instead of silently switching to a muted playback attempt.

## Continuous music and audio output

For separate audio, add `/bundles/rashinban/graphics/presenter-audio.html?role=audio` as an OBS browser source and select **Separate** in the dashboard. The plain URL is a silent preview. Only one audio page holds the lease; duplicate pages remain silent. For embedded fallback, select **Embedded** and use the active `presenter.html?role=program` graphic. Missing Google Maps configuration does not prevent music in either mode. The video soundtrack exception above still plays on the active program only; the music engine never duplicates it.

All selected stems decode before a shared scheduled start. Every layer loops continuously, including layers with zero gain. A reloaded owner joins the phase derived from the shared game music epoch. Changing rounds or music context changes gain with the configured fade; it does not restart sources or alter playback rate or pitch. Abort and finished states fade to silence using the idle fade. A new game replaces the old sources and establishes its new epoch.

The first authored stem defines the common loop length. Each decoded layer must have finite loop bounds within its decoded duration, with the same loop length (within one microsecond). A missing, invalid, or incompatible layer stays silent while valid compatible layers play. Dashboard client rows report loading, ready, partial, decode failure, silent empty configuration, or suspended audio, and list unavailable stem IDs and sound-kind IDs (for example, sound-pin) without raw error text. Graphics never wait for audio assets.

For a local browser test requiring activation, append `&audioUnlock=1` to either active URL and click **Enable audio in this browser**. Activation is local to that browser page; a dashboard click cannot unlock another browser source. The button disappears after the AudioContext runs. The dashboard displays audio readiness independently of map readiness.

Audio mode changes keep the old lease in a releasing state until its browser has silenced and stopped its sources, allowed queued output to drain, and acknowledged the lease token. Missing sources fall back to the six-second lease expiry. A separate master gate schedules silence on the audio clock one second plus reported device buffering before the deadline, so a blocked JS thread cannot keep the stems audible until another source activates. Renewals replace this gate deadline without touching music fades. Accepted clock samples have round trips below one second; the conservative margin covers midpoint uncertainty and adds the AudioContext base/output latency. Browser suspension clears the previous graph before local unlock. Browser and OBS output latency still require the final integrated acceptance test; no frame-perfect claim is made.

## Interaction and result sounds

Pin placement uses shared state/telemetry coordinate history with a 150 ms minimum interval; panning and repeated coordinates stay silent. Submission plays once per game/round/player, including the first guess, and is never inferred from a no-pin timeout. A known deadline schedules only the remaining 3, 2, 1 seconds; shortening it replaces pending ticks. Result entry, counting, score collision or tie, multiplication, and HP impact have separate timestamped cues. Count loops stop when score counting ends, before subtraction. Zero health loss has no damage sound. Select custom `collision`, `tie`, and `multiplier` assets in the dashboard to hear those new stages; empty selections remain silent and no GeoGuessr audio is bundled.

Cues use the same AudioContext and ownership gate as music. Expired one-shots are ignored after 250 ms; new owners ignore historical one-shots and join only the remaining count interval. Future cues survive refresh when still eligible, without replaying earlier cues. Generation replacement cancels pending sounds. Already started one-shots finish their selected asset unless the sequence or audio ownership is canceled.

**Preview here** next to each sound selection plays that selection only in the dashboard at 50% volume, including unsaved selections. Count preview stops after three seconds; other previews stop after ten seconds. **Stop local preview** stops immediately. Preview does not publish any live control message or change the game/timeline.

## Manifest API

`presenterMedia` is a nonpersistent projection of file configuration, saved separately from presentation settings. Submit a complete value with `presenter:control { action: 'media', body: manifest }`, or `POST /rashinban/presenter/media`. Invalid input is rejected without replacing the previous value. Invalid file edits report an error and retain the last valid configuration.

```json
{
  "stems": [],
  "fadeMs": { "idle": 0, "round": 0, "urgent": 0, "results": 0 },
  "sounds": {},
  "fiveK": { "single": null, "double": null }
}
```

A selected video has this form:

```json
{
  "url": "/assets/rashinban/video/single-5k.webm",
  "watchdogMs": 10000,
  "soundtrack": "embedded"
}
```

Music stems contain `id`, `url`, `loopStartS`, `loopEndS`, and gains for `idle`, `round`, `urgent`, and `results`. IDs must be unique, nonempty, and contain only letters, digits, underscores or hyphens (80 characters maximum). All gains are finite values from 0 to 1. Loop bounds are finite seconds from 0 to 86400, with end strictly after start; decoding and loop-to-file-duration checks belong to the music player. Fade values are finite milliseconds from 0 to 120000. At most 32 stems are accepted.

Sound keys are `pin`, `guess`, `countdown`, `results`, `count`, `collision`, `tie`, `multiplier`, `damage`, and `five-k`. URLs must be canonical, root-relative NodeCG asset URLs within the matching category of this bundle. Remote URLs, cross-bundle/category URLs, query strings, fragments and path traversal are rejected. Use the inventory URLs directly; filenames are URI-encoded by NodeCG. Unknown manifest fields and unsupported soundtrack values are rejected.

## Playback evidence and OBS setup

On 2026-09-11, temporary VP8/Opus WebM clips played through the real presenter in isolated Chrome: single duration 2.024 s, double duration 2.016 s. Natural completion, empty/missing media, invalid container, autoplay rejection, ownership transfer, cancellation, mute, cue-mode silence, and camera coverage/restoration were exercised. Temporary generated assets are not committed.

The same isolated Chrome setup exercised three synthetic 48 kHz PCM WAV music layers: shared scheduled starts, advancing muted layers, partial missing-file playback, separate/embedded handoff, silent duplicate/preview sources, and lease expiry while the owning page's JavaScript was blocked for 7.2 seconds. The audio clock continued and its pre-scheduled gate reached zero before takeover. These are test tones; see [final OBS validation](validation.md) for measured audiovisual timing and its limits.

The final isolated OBS check played both VP8/Opus WebM fixtures through the real presenter, with natural completion and visible green/magenta patches in its full-screen unfiltered layer. It establishes acceptance for those files, not arbitrary WebM codecs or final soundtracks. MP4 is uploadable but has not been accepted by an OBS playback test. Other codecs and the actual event files still require testing.

Use an unfiltered full-frame presenter layer during 5K playback. A whole-page chroma key removes matching colors from the video itself. The tested OBS arrangement switches phase-specific scene/group composition: keyed player/camera slots during live play, keyed cameras during results, and full unfiltered graphic during 5K. These switches require operator actions or external automation; no presenter-to-OBS bridge is included. See [OBS setup](obs.md) for exact rectangles and composition.

**OBS silent-source limitation:** 50 ms test cues were lost after silence in
both separate and embedded output, despite correct scheduler calls. Continuous
nonzero authored music restored the clicks; short checks then aligned within
9 ms using a measured 90 ms OBS video delay. The long timing test applies to
that continuous-music condition. Empty music/cue-only operation and recovery
from prolonged silence remain unaccepted on this OBS setup. No generated
keep-alive signal was added to production. Test the intended assets and audio
paths before use; selecting embedded alone does not resolve this observation.

NodeCG behavior was checked against the installed 2.8.0 primary source (`src/server/bundle-parser/assets.ts` and `src/server/server/assets.ts`) and the official [Replicant documentation](https://www.nodecg.dev/docs/classes/replicant/) and [concepts documentation](https://www.nodecg.dev/docs/concepts-and-terminology/). Browser Replicants are read on change events; asset categories are declared in the bundle manifest.
