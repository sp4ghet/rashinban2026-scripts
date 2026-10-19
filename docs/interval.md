# Interval graphics

Restart NodeCG after building (`npm run build`) to register the new graphics and **Shared → Interval** dashboard panel.

1. Set the title and upcoming heading in **Shared → Interval**. Choose **Saved Next Match (automatic)** to follow the players staged in **Shared → Current Match → Next Match**, then **Apply content**. The preview and both outputs update when that saved match or its player profiles change, even with the dashboard closed. Empty or incomplete staging slots hide upcoming matches; **Make current** clears the staging slot and hides them until another match is saved. Choose **Manual match list** for up to four custom matchups. Leave unused rows blank; a populated row needs both names. The saved manual list is retained while using Next Match. Existing saved lists remain manual after upgrading; new configurations default to Next Match. **Apply content** updates both outputs without changing the timer.
2. Use the minutes field and **Start**, **Pause/Resume**, and **Clear** directly in the Stream switcher's **Interval** row. The row also shows the remaining time and timer status. These controls apply live to both outputs without changing scene visibility. The Shared Interval panel has the same controls plus a restart time in **JST**. **Set time** schedules its next occurrence using the server clock; a time that has already passed uses tomorrow. The date is chosen automatically. Pause/Resume preserves the remaining time; Clear hides the countdown. Expired countdowns stay at `00:00`. Refreshing a browser or restarting NodeCG preserves the deadline or paused time.
3. In **Stream**, enable the **Interval** row, inspect Preview, then **TAKE**. Turning Interval off reveals the other selected layers. The **LED** interval page is always on, like the other LED pages; switch to its source in OBS/ATEM. Content/timer edits are shared and live; Stream TAKE controls visibility only.

Dashboard and graphics sample the NodeCG server clock and advance using a monotonic browser clock, so a remote LED computer's clock setting does not change the countdown. A running timer stays hidden until its first successful clock sample; brief disconnections retain the last server estimate.

The existing `info-stream.html` source includes Interval as its topmost layer. Standalone sources are also registered:

- `/bundles/rashinban/graphics/interval-stream.html` — follows Stream switcher visibility.
- `/bundles/rashinban/graphics/interval-led.html` — always visible, independent of Stream and legacy LED bus settings.

Both use a 1920×1080 OBS canvas. The LED artwork occupies the **top 1920×576**, with transparency below. Both graphics embed the muted, looping `assets/videos/KV/RASHINBAN2026_loop_001.mp4` background. NodeCG serves this local file at `/rashinban/media/background/kv.mp4`, including byte-range requests. The asset stays in its existing ignored directory; worktrees fall back to the shared installation. Restart NodeCG after building to load the media route. Video pauses when its scene or browser document is hidden. LED crops the video to fill its 1920?576 band and keeps the area below transparent. Append `?channel=preview` to the Stream source to inspect its preview bus; LED ignores that parameter. Do not stack both `info-stream.html` and its standalone interval source in the same scene. The LED `info-led.html` page remains dedicated to player cards and Ban & Pick.

Stream preserves the geometry, typography, red bars, and compass of the [2025 interval reference](https://zashness.github.io/rashinban2025/interval.html). LED follows the supplied venue reference: no header/footer bars, compass, or interval title; upcoming matches at left, a large central countdown, a rounded 16:9 slide area at right, and TAMURA BUILDS centered below the countdown. The shared title remains visible on Stream. LED retains the 25% black scrim over the embedded KV video and transparency below the 576px band. Adobe's Kaneda Gothic uses the existing licensed remote kit, and the original 900-weight Noto Sans JP loads from Google Fonts; locally bundled Oswald/Noto Sans JP provide offline fallbacks. Latin player names use the original 64px uppercase Kaneda, Japanese names use 48px heavy Noto, and long matchups shrink together rather than spreading names into equal columns. Only player names and the numeric countdown are shown. Countdown captions and round labels have been removed from the graphics, dashboard, and saved-state schema; older saved values are discarded when loaded.

The fixed Stream slide placeholder is `bundles/rashinban/graphics/assets/interval-slides/placeholder.svg`; LED uses the plain light-gray `placeholder-led.svg` in the same directory to match the supplied reference. Both are selected in `src/graphics/layers/interval.ts`. Replace it with the final fixed slide artwork when available. There is no dashboard slide-upload workflow.

Sponsor artwork was copied from the [official 2026 sponsor section](https://rashinban.org/#sponsor) on 2026-10-17. LED shows only the fixed TAMURA BUILDS logo, as in the reference. On Stream, TAMURA BUILDS stays visible on the left and the other six sponsors rotate **one at a time** on the right. Stream reproduces the [2025 sponsor animation](https://zashness.github.io/rashinban2025/assets/js/sponsors.js): every 12 seconds the current logo fades out over 300ms with `ease-in-out`, changes while invisible, then starts a 300ms fade-in at 600ms. Each browser source starts its cycle on load, as the original did. Logos are preloaded; if the next asset has not loaded, the current logo remains. There is no panel background or divider.

- GeoGuessr / 味の素株式会社
- GeoGuessr Record / 調布駅前そけいヘルニアクリニック
- BFCC — Powered by バラジオ放送局 / かわいいしっしー

Original logos are bundled unchanged in `graphics/assets/interval-sponsors/`; attribution and brand rights remain with their owners. `node scripts/fetch-interval-sponsors.mjs` refreshes these seven known files from the official site. Changes to the public sponsor roster require updating that script and the renderer's sponsor list.

Validation:

```powershell
npm test
npm run typecheck
npm run build
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/validate-interval.mjs
```

The browser check runs the built controls and graphics against the real extension message handlers with isolated transport/state fixtures. It checks automatic Next Match and profile updates, promotion clearing, manual list retention, draft preservation, persistence, duration/pause/resume/clear/time-only JST scheduling (including tomorrow), preview/revert/TAKE, both layouts, all logos, four-match bounds, empty states, expiry, and safe text rendering. It verifies the unframed LED layout and fixed sponsor, samples a real 12-second sponsor cycle on Stream, verifies intermediate opacity in both directions, and checks that every logo changes only while invisible and fits its slot. Screenshots and animation samples go in `artifacts/interval/`, including `led-reference.png` with the embedded video. The check also operates the inline switcher timer controls (including invalid durations and preserving visibility), verifies scene replacement through Preview/Revert/TAKE, video decoding, looping, mute, pause when hidden, HTTP range delivery, and both standalone bracket layouts. The requested local MP4 must be present to run these checks. Pass `--adobe-fonts` to also check the licensed online font kit; the default checks offline font fallbacks. Set `CHROME_PATH` if Chrome is installed outside the default Windows location.
