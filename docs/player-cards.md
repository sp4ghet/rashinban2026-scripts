# Player cards

Use **Broadcast → Stream switcher → Player cards** to prepare a card in Preview.
Choose **Player: P1 [player name]** or **P2 [player name]**, then **Position: Left / Right**.
Choose the page, enable **Visible**, then press **TAKE**. Player and position
remain independent: P1 stays red and P2 stays blue on either side.
The always-on `info-led.html` shows both players and follows the Stream Program
page after TAKE, even when Stream cards are hidden. Preview edits do not affect LED.
English cards use the English output's own Program selection.

## Layout and pages

Cards follow the supplied rounded red/blue design with a solid fill, white text,
outlined labels, and Kaneda Gothic headings. Free text uses Noto Sans JP;
names, handles, and career highlights preserve their submitted capitalization.
Oswald is the bundled offline heading fallback.

Stream cards are 800 px wide, positioned at x = 110 or 1010 and y = 90 in the
1920×1080 frame. Height follows the visible content, up to 900 px for the tested
profiles. Empty profile fields and their labels disappear. Long content first
reduces excess header/section spacing, then reduces body type when necessary.
The top edge stays fixed as a card shrinks.

LED cards keep the existing 480 px width at x = 36 and 1404, y = 24. The design
scales by 528 / 900 and fits within the top **1920×576** mapped area, leaving
at least 24 px of vertical clearance. Each player's height follows their own data.

- **Page 1 · Profile:** Age, Rating, Favorite game mode, Strengths, Favorite food,
  and Message, beneath the name and handle.
- **Page 2 · Results:** optional **Career highlights**, **Recent matches**, and
  **Day 1 results**. Without career highlights, Age and Rating occupy the top
  of the results page. With highlights, that section replaces Age/Rating.
- **Compact:** Favorite game mode, Strengths, and **Day 1 results**, beneath the
  name and handle. Age/Rating, food, message, highlights, and recent match rows
  are omitted.

**Career highlights** comes from a nonempty `major_tournament` column in the
tech data sheet's player profile. Existing sheet parsing retains this in `extra`;
no schema migration is required. Whitespace-only values hide the entire section.
Line breaks and capitalization are preserved, and the content is rendered as
plain text. English cards prefer a nonempty English value, falling back to the
shared sheet value when there is no translation.

**Recent matches** replaces the former “Recent games” heading. It shows up to
five completed tournament matches, newest first across all dates, with the round,
opponent, and score from the displayed player's perspective.

**Day 1 results** shows separate match and game win/loss totals with win rates.
It uses the Day 1 phase and all eligible Day 1 matches, independent of the five
recent rows. Day 2 scores never contribute. Incomplete records show a dash;
unavailable bracket data, unlinked players, and empty history have explicit states.

## Data

Profiles and Rating come from the existing `players` Google Sheet tab. The card
does not fetch ratings directly from GeoGuessr. Tournament results use the
configured start.gg bracket; refresh it through the existing configuration panel.

A manually selected player can receive results through the sheet's
`startgg_entrant_id`, or a unique matching start.gg tag/name when no usable ID is
available. Ambiguous matches remain unlinked. Opponent names prefer the player
directory, then start.gg.

Only completed matches with a recorded completion time and two entrants count.
Byes, active matches, future results, and the selected current match are omitted.
When the current match has a start or completion time, later results are excluded
from both recent matches and Day 1 totals. A missing score is `—`; a recorded
disqualification is `W–DQ` or `DQ–W`. Losing the current match clears and hides
cards. Old saved date/page settings remain ignored.

## Companion compatibility

POST routes under `/rashinban` still cut Stream Program directly:

- `/playercards/profile`, `/playercards/results`, `/playercards/compact`
- `/playercards/left`, `/playercards/right` select a player and preserve Position.
- `/playercards/show`, `/playercards/hide`, `/playercards/toggle`
- `/playercards/stats` remains an alias for Results; `/playercards/flip` switches
  Profile and Results. Persisted `stats` selections remain valid.

## Verification

Run `npm test`, `npm run typecheck`, and `npm run build`, followed by:

```powershell
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/validate-player-cards.mjs --cards-only
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/validate-player-cards.mjs --cards-only --adobe-fonts
```

The browser checks use built graphics, isolated fixture replicants, and the real
broadcast reducer. They verify all three pages on Stream, LED, and English;
highlights presence and translation fallback; Day 1 totals; sparse and long text;
safe text rendering; independent player/position controls; and Preview/TAKE.
Saved start.gg responses exercise newest-first ordering and current/later match
exclusions. The full command without `--cards-only` also checks other info layers.
Chrome must be installed, or supplied through `CHROME_PATH`.

Screenshots are saved in ignored `artifacts/player-cards/`, with offline-font
captures under `fallback-fonts/`. `design-stream-profile.png`,
`design-stream-highlights.png`, `design-stream-results.png`, and
`design-stream-compact.png` show the supplied Shiina example. A dark test
background stands in for the camera feed. No live NodeCG state is changed.
The Adobe check requires internet access and fails if Kaneda Gothic cannot load.
