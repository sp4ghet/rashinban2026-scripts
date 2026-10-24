# Stream slides

After building, restart NodeCG and refresh the Stream dashboard and OBS
`info-stream.html` browser source.

The **Slides** row controls the stream info overlay. Choose **Mode**, then
use **Previous**, **Next**, or the **Slide** selector. All changes stage in
Preview; **TAKE** sends the selected image and bracket visibility to Program.
**Left/Right arrow** also selects the previous/next slide anywhere in the Stream
dashboard, including while a button, dropdown, text field, or monitor has focus.
Changing mode selects its first cue. Navigation stops at the first/last cue;
each mode ends with **CLEAR** to remove the slide. **Visible** can hide the
current sequence without losing its place. Revert, Swap and Clear Preview
work with slide selection just as they do with other layers.

Script ordering comes from [配信資料_RASHINBAN2026](https://docs.google.com/presentation/d/1S7uiuFNzdkZ2w9I5JL7pv3RDBWY7kJKRp5Rz6-QfrUU/edit).

| Mode | Sequence |
| --- | --- |
| DAY 1 OPENING | GeoGuessr 1–2 → Game Modes → Duels 1–4 → Day 1 maps → RASHINBAN → tournament format → Day 1 rules → tie range → prize pool 1–2 → corporate award → Voicemod/Ajinomoto prizes → sponsors → community partners → Day 1 schedule → clear |
| DAY 2 OPENING | GeoGuessr 1–2 → Game Modes → Duels 1–4 → RASHINBAN → tournament format → map pool → Ban & Pick → Pinpointing Duels → Move/NM rules → tie range → **live bracket** → prizes/sponsors/partners/bonus prizes → clear for Top 8 introductions → Day 2 schedule → clear |
| DAY 1 ENDING | **Live bracket** → sponsors → tomorrow's Day 2 schedule → clear |
| DAY 2 ENDING | Tamura Builds award → ceremony prizes → clear for organizer address → sponsors → clear |
| 2 SPONSORS | Tamura company → service → recruitment → Voicemod overview → clear for demonstration → product/trial → annual-license prize → GIVEAWAY → clear |
| 1 SPONSOR | Tamura company → service → recruitment → GIVEAWAY → clear |

A bracket cue uses the existing live bracket graphic, not an image. Advancing
past it stages the bracket off and the next image on; TAKE applies both together.
Going backward or selecting a cue directly follows the same rule. Selecting
Interval or Bracket manually hides Slides; selecting a slide hides Interval.
Clear cues remove slide/bracket output while preserving other selected layers,
so the operator can use the existing camera/player controls during talk.

34 unique images are bundled in `graphics/assets/stream-slides/`. They are
unchanged local copies, with provenance, sizes, dimensions and hashes in
[assets.json](assets.json). No Google login or network access is needed for
playback. GIVEAWAY is the user-supplied 1920 × 1080 artwork added on 2026-10-24.
The filenames mentioning Voicemod prizes are ambiguous: visual
inspection identifies the product/trial promotion separately from the actual
Top 8 annual-license prize.

The interval uses its own 107-image automatic loop; see [interval.md](../interval.md).
Slide controls are available on the Japanese Stream dashboard. EN and LED
controls remain independent.

Validation:

```powershell
npm run typecheck
npm test
npm run build
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/validate-interval.mjs --slides-only
```

The focused browser check uses isolated extension/replicant fixtures. It visits
every cue, checks both bracket transitions and Preview/TAKE isolation, and samples
the 10-second hold and 500 ms crossfade on both interval layouts. Screenshots go to
`artifacts/interval/offline/`. Real OBS/venue output acceptance remains a separate
production check.
