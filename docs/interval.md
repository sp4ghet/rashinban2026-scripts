# Interval graphics

Restart NodeCG after building (`npm run build`) to register the new graphics and **Shared → Interval** dashboard panel.

1. Set the title, upcoming heading, and up to four matches in **Shared → Interval**. Leave unused rows blank; a populated row needs both player names. **Apply content** updates both outputs.
2. Start a duration in minutes, or set an explicit restart date/time in **JST**. Pause/Resume preserves the remaining time; Clear hides the countdown. Expired countdowns stay at `00:00`. Refreshing a browser or restarting NodeCG preserves the deadline or paused time.
3. In **Stream**, enable the **Interval** row, inspect Preview, then **TAKE**. Turning Interval off reveals the other selected layers. The **LED** interval page is always on, like the other LED pages; switch to its source in OBS/ATEM. Content/timer edits are shared and live; Stream TAKE controls visibility only.

Dashboard and graphics sample the NodeCG server clock and advance using a monotonic browser clock, so a remote LED computer's clock setting does not change the countdown. A running timer stays hidden until its first successful clock sample; brief disconnections retain the last server estimate.

The existing `info-stream.html` source includes Interval as its topmost layer. Standalone sources are also registered:

- `/bundles/rashinban/graphics/interval-stream.html` — follows Stream switcher visibility.
- `/bundles/rashinban/graphics/interval-led.html` — always visible, independent of Stream and legacy LED bus settings.

Both use a 1920×1080 OBS canvas. The LED artwork occupies the **top 1920×576**, with transparency below. Both graphics have transparent backgrounds so a KV video source underneath remains visible. Append `?channel=preview` to the Stream source to inspect its preview bus; LED ignores that parameter. Do not stack both `info-stream.html` and its standalone interval source in the same scene. The LED `info-led.html` page remains dedicated to player cards and Ban & Pick.

Stream preserves the geometry, typography, red bars, and compass of the [2025 interval reference](https://zashness.github.io/rashinban2025/interval.html). LED uses that visual treatment in the supplied designer sketch's arrangement: upcoming matches left, large central countdown, slides right, sponsors below the countdown. Adobe's Kaneda Gothic uses the existing licensed remote kit, and the original 900-weight Noto Sans JP loads from Google Fonts; locally bundled Oswald/Noto Sans JP provide offline fallbacks. Latin player names use the original 64px uppercase Kaneda, Japanese names use 48px heavy Noto, and long matchups shrink together rather than spreading names into equal columns. Only player names and the numeric countdown are shown. Countdown captions and round labels have been removed from the graphics, dashboard, and saved-state schema; older saved values are discarded when loaded.

The fixed slide placeholder is `bundles/rashinban/graphics/assets/interval-slides/placeholder.svg`, referenced in `src/graphics/layers/interval.ts`. Replace it with the final fixed slide artwork when available. There is no dashboard slide-upload workflow.

Sponsor artwork was copied from the [official 2026 sponsor section](https://rashinban.org/#sponsor) on 2026-10-17. TAMURA BUILDS stays visible on the left; the other six sponsors rotate **one at a time** on the right. Both outputs reproduce the [2025 sponsor animation](https://zashness.github.io/rashinban2025/assets/js/sponsors.js): every 12 seconds the current logo fades out over 300ms with `ease-in-out`, changes while invisible, then starts a 300ms fade-in at 600ms. Each browser source starts its cycle on load, as the original did. Logos are preloaded; if the next asset has not loaded, the current logo remains. There is no panel background or divider.

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

The browser check runs the built controls and graphics against the real extension message handlers with isolated transport/state fixtures. It checks persistence, duration/pause/resume/clear/JST scheduling, preview/revert/TAKE, both layouts, all logos, four-match bounds, empty states, expiry, and safe text rendering. It samples a real 12-second sponsor cycle on each output, verifies intermediate opacity in both directions, and checks that every logo changes only while invisible and fits its slot. Screenshots and animation samples go in `artifacts/interval/`. Pass `--adobe-fonts` to also check the licensed online font kit; the default checks offline font fallbacks. Set `CHROME_PATH` if Chrome is installed outside the default Windows location.
