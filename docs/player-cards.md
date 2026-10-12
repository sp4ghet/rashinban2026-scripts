# Player cards

Use **Broadcast → Stream switcher → Player cards** to prepare a card in Preview.
Choose **Player: P1 [player name]** or **P2 [player name]**, then choose **Position: Left / Right**
to place that card on either side of the stream. Choose the mode, turn on
**Visible**, then press **TAKE**. Position changes stay in Preview until TAKE,
independently of the selected player. P1 stays red and P2 stays blue on either
side. The LED switcher shows both players in their fixed positions.
Player names update with the current match; an unset player is shown as `TBD`.

Saved stream cards without a Position setting keep the side of their selected
player when upgraded. Once set, Position stays put when you change players.

At 1920×1080, stream cards are 800 px wide with larger text for a single-player
camera shot. All modes use the same 900 px card height. Profile and Compact
share the exact frame, header, font sizes, and upper-field positions; only the
food/message section changes to recent games. The LED wall maps only the top
**1920 × 576** pixels of its source.
Both LED cards are **480 × 528 px**, positioned at **y = 24 px** with 24 px
clearance from the top, bottom, and outer edges, in every mode. Their left
edges are **x = 24 px** and **x = 1416 px**, leaving **912 px** in the middle
for ban-pick results. Results use horizontal rows to fit the mapped height
while keeping opponent names readable.

Known alphanumeric labels, including tournament rounds and result status text,
use **Kaneda Gothic in uppercase**; numeric stats and scores also use Kaneda.
Player names, handles, opponent names, and free-text profile answers use
**Noto Sans JP** and preserve the submitted capitalization and Japanese text.

## Modes

- **Page 1 · Profile:** the existing Age, Rating, Favorite game mode, Strengths,
  Favorite food, and Message fields, plus player name and handle.
- **Page 2 · Results:** the player's five most recent completed tournament
  matches, newest first, across all dates. Each row shows the round, opponent,
  and score from the displayed player's perspective.
- **Compact:** Age, Rating, Favorite game mode, Strengths, and earlier completed
  tournament matches: the three most recent, newest first, across all dates.
  Choose this manually for later matches;
  there is no automatic mode switching or appearance counter.

Both modes select recent games automatically. There is no date filter or history
pagination. Players with fewer games show their available results. Old saved
date and page settings are ignored; the selected mode and player are retained.

## Data

Profiles and the Rating field come from the existing `players` Google Sheet tab.
The ratings populated on 2026-10-12 are GeoGuessr's `peakOverallRating` (all-time
overall peak); the card does not refresh ratings from GeoGuessr itself.

Tournament results use the configured start.gg bracket. Enable or refresh it in
the existing start.gg configuration panel. A manually selected player can still
receive results through their sheet profile's `startgg_entrant_id`, or a unique
matching start.gg tag/name when that ID is blank. Ambiguous matches stay unlinked. Opponent
names prefer the player directory, then start.gg.

Only completed matches with a recorded completion time and two entrants appear.
Byes, active matches, future results, and the selected current match are omitted.
When the current start.gg match has a start time (or completion time), later
results are also excluded, so loading an older match does not disclose its future
results. A missing score is `—`; a recorded disqualification is `W–DQ` or `DQ–W`.
Unavailable bracket data, an unlinked player, and an empty history have separate
empty states. Losing the current match clears and hides the cards.

## Companion compatibility

POST routes under `/rashinban` cut stream Program directly, as before:

- `/playercards/profile`, `/playercards/results`, `/playercards/compact`
- `/playercards/left`, `/playercards/right` select the player and preserve Position.
- `/playercards/show`, `/playercards/hide`, `/playercards/toggle`
- `/playercards/stats` remains an alias for Results; `/playercards/flip` switches
  between Profile and Results. Existing persisted `stats` selections remain valid.

## Verification

Run `npm test`, `npm run typecheck`, and `npm run build`, then:

```powershell
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/validate-player-cards.mjs
```

The browser check uses the real built overlays and switcher, fixture replicants,
and the real broadcast reducer. It compares the exact frame and shared-field
coordinates and typography between Profile and Compact, including wrapped
headers and missing results. It also verifies stream/LED visibility, all LED modes
inside the mapped 576 px band with 24 px margins, newest-first
results capped at five/three, obsolete date/page settings, long text, missing data, safe text rendering, and
manual selection through Preview/Take. Chrome must be installed, or supplied via
`CHROME_PATH`. Screenshots are saved in ignored `artifacts/player-cards/`; a dark
test background stands in for the video feed. No live NodeCG state is changed.

The default check uses the bundled fallback fonts. Add `--adobe-fonts` to check
the live Kaneda Gothic typography; this requires internet access and fails if
the Adobe font does not load.

The check also replays saved EVO Japan 2026 SF6 semifinal and final responses
through the real start.gg normalizer and cards. Before Punk's Grand Final, Page 2
shows the latest five games across May 2 and May 3; Compact shows the latest
three. These are the two loaded groups, not his full tournament history.
Screenshots `09-startgg-results.png`, `10-startgg-compact.png`, and
`11-startgg-earlier-match.png` show the replay. Profile fields are blank
because these test entrants are not in the RASHINBAN player directory.

To repeat with fresh, read-only start.gg API responses, use the existing
`STARTGG_TOKEN` in `.env` and run:

```powershell
node --env-file=.env scripts/startgg-fetch.mjs phase-group 3282663 artifacts/player-cards/startgg-live-semifinals.json
node --env-file=.env scripts/startgg-fetch.mjs phase-group 3282664 artifacts/player-cards/startgg-live-finals.json
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/validate-player-cards.mjs --startgg-live
```

This does not start or edit a tournament, change the configured event, or require
NodeCG to be running. Results are read from a completed event and replayed in an
isolated browser. The ordinary check uses saved responses and needs no token.
