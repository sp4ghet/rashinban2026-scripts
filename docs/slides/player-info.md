# Player info slides

The two-page Day 2 introduction graphic follows the supplied full-frame photo/red-panel design. Stream renders it in `info-stream.html`; English uses the separate 1920×1080 source `player-info-en.html`.

Build with `npm run build`, restart NodeCG to register the new asset category/state, and refresh the dashboard and OBS sources.

## Upload photos

Use **Assets → Player info slides — blank player photos**. Upload blank artwork with the photo, red panel and event logo already included, as in `meishin-blank.jpg`. The graphic overlays the text: do not upload the finished examples that already contain text. Use a 16:9 image with the photo occupying the left 5/12 of the frame.

- One photo for both pages: `<startgg_tag>-blank.jpg` or `<startgg_tag>.jpg`.
- Separate photos: `<startgg_tag>-1.jpg` for results and `<startgg_tag>-2.jpg` for profile. `-results` and `-profile` are equivalent suffixes.
- GeoGuessr UID or the sheet's start.gg entrant ID can replace the tag. Shared sheet names also match when unique. Matching ignores case and whitespace; English uses the same source identities and photos.
- JPEG, PNG and WebP are supported. One page's photo also serves as fallback for the other page. Page-specific photos take priority over generic photos. Remove duplicate same-name files in different formats: ambiguous matches are deliberately hidden.

The control row shows the matched filename, or the filename to upload. Missing/deleted/unreadable photos hide the graphic rather than leaving a previous photo visible. Replacing an upload refreshes it through NodeCG's asset hash. Duplicate canonical sheet identities are excluded; filenames shared by multiple players do not match either player. Use a unique UID filename to disambiguate.

## Stream operation

**Player info slides** is directly below **Slides**. Choose **Player**, choose **1 · Day 1 results** or **2 · Profile**, enable **Visible**, inspect Preview, then **TAKE**. Player selection is independent of Current Match. Top 8 entrants appear first when start.gg has seeded Day 2; other sheet players remain available for preparation. Auto selects the first listed player. Selecting a named player pins that identity across refreshes.

**Previous page / Next page** move through each player's results then profile, stopping at either end. Navigation preserves visibility. Revert, SWAP and Clear preview include the new layer.

**DAY 2 OPENING → 24. TOP 8 introductions** enables player info and disables bracket/interval in one Preview patch. Advancing to cue 25 disables player info and stages the schedule. TAKE publishes both changes together. Going backward or choosing a cue directly follows the same rule. Manually enabling player info, bracket or interval replaces the other fullscreen selections in Preview.

## English operation

Add `http://localhost:9090/bundles/rashinban/graphics/player-info-en.html` as a 1920×1080 OBS browser source. English has its own **Player info slides** row and Preview/TAKE selections. Set **Monitor scene → Player info slides** to inspect this source. OBS scene selection remains independent, as for the existing English sources. Stream actions never change the English bus.

## Automatic text

Profile text, age, rating and handle come from the existing `players` sheet. English uses matching `players_en` rows, falling back to the shared profile when a translation is missing or ambiguous. Text is displayed as authored; this does not machine-translate cells or query GeoGuessr ratings.

Results use the configured start.gg **Day 1 phase**, not the current match or a rolling history. All completed two-entrant Day 1 sets appear in completion order, with scores from the selected player's perspective, total set/game wins and losses, and percentages. Day 2, incomplete sets and byes are excluded. DQs show W-DQ/DQ-W, count toward set records, and add no games. Missing scores or winners produce unavailable totals rather than invented numbers. Group placement appears only when start.gg supplies a group placement or a matching Day 2 progression source; otherwise only the group is shown.

Sheet and bracket refreshes update content live. TAKE stages player/page/visibility, not a frozen copy of their text. Kaneda Gothic uses the existing Adobe kit; bundled fonts provide an offline fallback. Long text shrinks within the fixed layout.

## Validation

Run `npm test`, `npm run typecheck`, `npm run build`, then:

```powershell
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/validate-interval.mjs --player-info-only --adobe-fonts --photo=C:/Users/sp4ghet/Downloads/meishin-blank.jpg
```

Omit `--adobe-fonts` for the bundled font check. Screenshots are saved in ignored `artifacts/player-info/` (or its `offline` subdirectory). The harness uses isolated Replicants and extension handlers; production state is untouched. Checks cover both pages/languages, live text/photo changes, long text bounds and label spacing, literal sheet text, cue 24 entry/exit and independent Preview/TAKE/Revert/SWAP/Clear. OBS compositing still needs a production-machine check.
