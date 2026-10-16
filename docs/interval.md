# Interval graphics

Restart NodeCG after building (`npm run build`) to register the new graphics and **Shared → Interval** dashboard panel.

1. Set the title, upcoming heading, countdown label, and up to four matches in **Shared → Interval**. Leave unused rows blank; a populated row needs both player names. **Apply content** updates both outputs. Round labels are optional.
2. Start a duration in minutes, or set an explicit restart date/time in **JST**. Pause/Resume preserves the remaining time; Clear hides the countdown. Expired countdowns stay at `00:00`. Refreshing a browser or restarting NodeCG preserves the deadline or paused time.
3. In **Stream** or **LED**, enable the **Interval** row, inspect Preview, then **TAKE**. Each output has independent visibility. Turning Interval off reveals the other selected layers. Content/timer edits are shared and live; TAKE controls visibility only.

Dashboard and graphics sample the NodeCG server clock and advance using a monotonic browser clock, so a remote LED computer's clock setting does not change the countdown. A running timer stays hidden until its first successful clock sample; brief disconnections retain the last server estimate.

The existing `info-stream.html` and `info-led.html` sources include Interval as their topmost layer. Standalone sources are also registered, using the same switcher visibility:

- `/bundles/rashinban/graphics/interval-stream.html`
- `/bundles/rashinban/graphics/interval-led.html`

Both use a 1920×1080 OBS canvas. The LED artwork occupies the **top 1920×576**, with black below. Append `?channel=preview` to inspect the preview bus. Do not stack both an info source and its standalone interval source in the same scene.

Stream follows the [2025 interval reference](https://zashness.github.io/rashinban2025/interval.html). LED follows the supplied designer sketch: upcoming matches left, large central countdown, slides right, sponsors below the countdown. Both use the existing 2026 key visual and font stack. Adobe's Kaneda Gothic uses the existing licensed remote kit; locally bundled Oswald/Noto Sans JP provide offline fallbacks.

The fixed slide placeholder is `bundles/rashinban/graphics/assets/interval-slides/placeholder.svg`, referenced in `src/graphics/layers/interval.ts`. Replace it with the final fixed slide artwork when available. There is no dashboard slide-upload workflow.

Sponsor artwork was copied from the [official 2026 sponsor section](https://rashinban.org/#sponsor) on 2026-10-17. TAMURA BUILDS stays visible; the remaining sponsors rotate in pairs every ten seconds, synchronized by wall-clock time across outputs:

- GeoGuessr / 味の素株式会社
- GeoGuessr Record / 調布駅前そけいヘルニアクリニック
- BFCC — Powered by バラジオ放送局 / かわいいしっしー

Original logos are bundled unchanged in `graphics/assets/interval-sponsors/`; attribution and brand rights remain with their owners. `node scripts/fetch-interval-sponsors.mjs` refreshes these seven known files from the official site. Changes to the public sponsor roster require updating that script and the renderer's sponsor groups.

Validation:

```powershell
npm test
npm run typecheck
npm run build
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/validate-interval.mjs
```

The browser check runs the built controls and graphics against the real extension message handlers with isolated transport/state fixtures. It checks persistence, duration/pause/resume/clear/JST scheduling, preview/revert/TAKE, both layouts, all logo downloads, four-match bounds, empty states, expiry, and safe text rendering. Screenshots go in `artifacts/interval/`. Pass `--adobe-fonts` to also check the licensed online font kit; the default checks offline font fallbacks. Set `CHROME_PATH` if Chrome is installed outside the default Windows location.
