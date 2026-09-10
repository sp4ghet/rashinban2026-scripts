# Presenter media

Upload files in NodeCG's **Assets** tab, under **Presenter music**, **Presenter cue sounds**, or **Presenter celebrations**. Select them in **Duels Presenter → Celebration media**, then **Apply media**. The menus use NodeCG's public `assets:music`, `assets:effects`, and `assets:video` inventories. An unavailable saved selection stays visible so the operator can replace it.

Single and double 5K use independent videos. Two perfect scores select exactly one double video. If that selection is empty or missing, results reveal normally; the presenter never substitutes two single videos. The media status shows missing files, playback failures, natural completion, and watchdog expiry.

The explicitly active `presenter.html?role=program` source plays celebrations. Preview sources preload selections but stay silent and do not play or complete effects. A program that takes over after a cue has started does not replay that clip. Losing ownership, changing rounds, aborting, or closing the page stops playback. Cancellation suppresses stale completion callbacks.

The clip fills the 1920×1080 graphic above all other content, including both camera windows. Its opaque black backing also covers cameras when the source has transparency or a different aspect ratio. Cameras return when the clip ends. Score reveal/counting and then damage begin at the shared timestamps published after effective completion, with the configured lead between completion and reveal.

## Soundtrack and duration

- **Embedded:** the video's original soundtrack plays only on the active program graphic, including when general audio output is set to a separate browser source. Presenter mute and effects gain apply immediately. No rate or pitch adjustment is used.
- **Cue:** the video is muted. A `five-k` cue sound must be selected. Cue audio dispatch is implemented by the later cue-audio task; this selection does not yet produce that audio.
- **Silent:** the video is muted and no celebration soundtrack should be dispatched.

The video must expose finite, positive duration metadata. A clip longer than its configured maximum wait is rejected. The local watchdog is bounded by both the configured wait and duration plus one second; the server independently enforces the configured wait. Rejection, decoding error, and autoplay denial all complete once and reveal results normally. Configure enough maximum wait for the entire clip and normal startup overhead; the accepted range is 500–120000 ms.

Ordinary Chrome can deny audible autoplay without user activation. Browser-source autoplay behavior must be checked in the actual OBS setup. The presenter reports failure instead of silently switching to a muted playback attempt.

## Manifest API

`presenterMedia` persists separately from presentation settings. Submit a complete value with `presenter:control { action: 'media', body: manifest }`, or `POST /rashinban/presenter/media`. Invalid input is rejected without replacing the previous value. Invalid persisted data resets to the silent empty manifest on startup.

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

Sound keys are `pin`, `guess`, `countdown`, `results`, `count`, `damage`, and `five-k`. URLs must be canonical, root-relative NodeCG asset URLs within the matching category of this bundle. Remote URLs, cross-bundle/category URLs, query strings, fragments and path traversal are rejected. Use the inventory URLs directly; filenames are URI-encoded by NodeCG. Unknown manifest fields and unsupported soundtrack values are rejected.

## Playback evidence and OBS setup

On 2026-09-11, temporary VP8/Opus WebM clips played through the real presenter in isolated Chrome: single duration 2.024 s, double duration 2.016 s. Natural completion, empty/missing media, invalid container, autoplay rejection, ownership transfer, cancellation, mute, cue-mode silence, and camera coverage/restoration were exercised. Temporary generated assets are not committed.

The isolated OBS composition check also played these VP8/Opus WebM fixtures full-screen with visible green/magenta patches. That check used a separate synthetic page with muted video. It establishes visual format acceptance for those files, not integrated presenter audio timing or arbitrary WebM codecs. MP4 is uploadable but has not been accepted by an OBS playback test. Other codecs and the actual event files still require testing.

Use an unfiltered full-frame presenter layer during 5K playback. A whole-page chroma key removes matching colors from the video itself. The tested OBS arrangement switches phase-specific scene/group composition: keyed player/camera slots during live play, keyed cameras during results, and full unfiltered graphic during 5K. Integrated presenter-to-OBS phase switching and audiovisual measurement remain Task 11 acceptance work.

NodeCG behavior was checked against the installed 2.8.0 primary source (`src/server/bundle-parser/assets.ts` and `src/server/server/assets.ts`) and the official [Replicant documentation](https://www.nodecg.dev/docs/classes/replicant/) and [concepts documentation](https://www.nodecg.dev/docs/concepts-and-terminology/). Browser Replicants are read on change events; asset categories are declared in the bundle manifest.
