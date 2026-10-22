# Street View compass

The rendered player panoramas and every round preview share GeoGuessr's spectator compass appearance. Its ring stays stationary; its needle rotates by the negative displayed panorama heading. The left gameplay compass clears the minimap when that map is visible.

Reference inspected on 2026-10-22:

- [Spectator page](https://www.geoguessr.com/party/broadcast/65dd9286-59df-4470-926b-01913fb4f80f)
- [Original needle](https://www.geoguessr.com/_next/static/media/compass.f79e0d30.svg), stored locally as `graphics/assets/streetview-compass.svg`. Four triangles: `#B82A2A`, `#CC2F30`, `#E6E6E6`, `#FFF`, with a 1:4 width-to-height ratio.
- [Published compass styles](https://www.geoguessr.com/_next/static/css/349107d66d428d4f.css): white ring at 40% opacity; ring thickness and needle width each one-quarter of the diameter. No shadow, dark fill, tick marks, or extra outlines.
- [Spectator component](https://www.geoguessr.com/_next/static/chunks/31818-2e61fdbbc537eca4.js): normal player panes use `2rem` (32px); expanded panes use `4rem`. Presenter panes and previews use the normal 32px size.

Run `node scripts/validate-presenter-compass.mjs` for isolated browser placement checks. Add `--compare-reference` to fetch the published CSS and needle and compare rendered pixels at six headings, three backgrounds, and both native and enlarged sizes. Screenshots and the report are written to `artifacts/presenter-compass/`. This uses a synthetic panorama boundary and does not alter a live game.
