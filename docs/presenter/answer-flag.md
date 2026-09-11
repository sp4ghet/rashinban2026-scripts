# GeoGuessr correct-answer flag

The results map uses the authentic yellow flag from GeoGuessr's summary/game
master marker design. The image is copied unchanged to
`bundles/rashinban/graphics/assets/geoguessr-correct-location-flag.png` and served
locally. Player guesses retain their existing blue/red circles.

Public sources inspected on 2026-09-11, client build `1.7723-a9199da`:

- [Requested duel summary](https://www.geoguessr.com/duels/6aa195d8f53b98c6baf5c618/summary).
- [Original 64×64 flag PNG](https://www.geoguessr.com/_next/static/media/correct-location.56f20eda.png).
- [Summary marker JavaScript](https://www.geoguessr.com/_next/static/chunks/65889-bb3d56e17a7f39d7.js): module `834096` uses this image for `components.pin-correct-location`; module `523762` supplies the circular map wrapper.
- [Marker stylesheet](https://www.geoguessr.com/_next/static/css/07641d4e9b78205b.css): the circular wrapper is 2rem, or 2.5rem for large summary markers, positioned around its coordinate with negative half-size margins.

The overlay uses the large 40×40 size with an exact center anchor `(20, 20)`.
The answer marker is above player markers so a perfect guess does not cover the
flag. Selection uses an explicit `kind: 'answer'`, independent of label text.
Only the existing revealed-results path emits this role; live, lock-in and
celebration maps never receive an answer marker.

The same public bundle also contains a newer red teardrop answer pin. It was
inspected but is not shipped: the requested artwork is the yellow flag. The
flag PNG's SHA-256 is
`12f3ca3d7549a73f4eb0a827b044a2da02838cc7689f402c53a8812e8c996e40`.
No authenticated requests, cookies, API keys, screenshots of private account
data, or copied source bundles are included in this integration.
