# Remote watch-party presenter

Open `/bundles/rashinban/graphics/presenter-remote.html` on the remotely
reachable NodeCG host. The page is 1920x1080 and uses the stream layout.
No chroma key or local capture-device setup is needed.

- Player cameras come from the existing capture relay's `camera-left` and
  `camera-right` feeds. The default room is `main`; use
  `presenter-remote.html?videoRelay=watch-party` for a different room.
- All maps and Street View render in the viewer's browser using the configured
  Google Maps browser key and live presenter telemetry. Dashboard view-source
  and key-color changes do not change this page's rendering. Gameplay video
  tracks are not negotiated, even when `videoRelay` is supplied.
- Missing cameras show an opaque placeholder. Missing Google configuration
  reports the normal renderer failure; the page never falls back to keyed or
  relayed gameplay.
- Remote viewers play music, sound cues, and celebration soundtracks on the
  same local clock as their visuals. Each viewer has its own audio session,
  independent of the main program and its Separate/Embedded audio selection.
  The shared mute and volume settings still apply. Embedded 5K/10K soundtracks
  play with their local video; cue soundtracks do not play a second embedded copy.
- Remote pages cannot claim shared program/audio ownership or complete a program
  effect. Even `?role=program` cannot take over the main output. `?role=preview`
  or `?channel=preview` disables cameras, effects, and audio for preview use.

If the browser blocks autoplay, click **Enable audio in this browser** on the
remote page (or in OBS Interact). It disappears once audio is enabled. Each
remote browser needs its own activation. Rejoining skips historical one-shot
cues; audio stops if its clock synchronization expires or the page closes.

Keep `presenter-capture.html?relay=main` running on the capture computer with
both player-camera inputs assigned. Existing capture setup and recovery are
documented in [video inputs](video-inputs.md).

The relay currently uses direct WebRTC with no STUN/TURN configuration. Off-site
use needs peer connectivity (for example, a VPN that permits the media path),
as well as access to NodeCG and Google's imagery. Exposing only the NodeCG HTTP
port does not provide a WebRTC media route through arbitrary NAT/firewalls.
Allow the remote NodeCG origin in the Google browser key's referrer restrictions.

## Validation

Run `npm run build`, then
`node --experimental-strip-types scripts/validate-presenter-relay.mjs --remote`.
This uses isolated headless Chrome, synthetic camera devices, and the real
WebRTC relay. It checks camera-only negotiation, locally selected rendered
mode across source/key changes, opaque camera regions, and ownership isolation.
It also exercises real Web Audio output and synthetic WebM soundtracks: local
music/cue timing, audible 5K/10K video, autoplay activation, mute, cancellation,
and silent previews.
Reports/screenshots go to `artifacts/presenter-validation/remote/`.
The harness has no Google key and does not validate live Google imagery,
physical capture hardware, or an off-site network path.
