# Google Sheet data

Human-authored data lives in a Google Sheet shared as "anyone with the link
can view". The NodeCG extension polls each tab's CSV export
(`https://docs.google.com/spreadsheets/d/<sheetId>/export?format=csv&gid=<tabGid>`)
and publishes the rows as replicants. Overlays never fetch from Google
directly (in 2025 every overlay polled on its own; now there is one poller).

Configure the players tab URL and refresh interval in **Config → Google Sheets**.
Settings remain stored in the `sheetConfig` replicant. Choose players in
**Broadcast → Current Match**.

## `players` tab

One row per entrant. The header row is matched case-insensitively; extra
columns are kept under `extra` for future card fields. Row values are kept
as text so the sheet controls formatting ("71.4%", "1st").

| Column | Card field | Notes |
| --- | --- | --- |
| `geoguessr_player_uid` | primary identity | GeoGuessr account UID (24 hexadecimal characters). A full GeoGuessr user URL is also accepted. |
| `startgg_tag` | legacy join key | Required only when UID is missing. Compared ignoring case and spaces. |
| `startgg_entrant_id` | join key | Optional numeric entrant id for an exact match when tags differ. |
| `name` | display name | Falls back to `startgg_tag`. |
| `twitter` | handle | With or without `@`. |
| `age`, `rating` | profile | |
| `favorite_mode`, `strengths`, `favorite_food`, `message` | profile | Free text; newlines allowed. |
| `winrate_all`, `winrate_move`, `winrate_nm`, `winrate_nmpz` | stats: match win rate | |
| `played_all`, `played_move`, `played_nm`, `played_nmpz` | stats: played | |
| `placement_all`, `placement_move`, `placement_nm`, `placement_nmpz` | stats: placement | |
| `rounds_played` | stats | |
| `best_country`, `worst_country` | stats: major country diff | ISO 3166-1 alpha-2 (`RU`, `PH`); rendered as flags. |

`samples/players-sample.csv` shows the expected shape and is used by the
unit tests.

## Current match

`matchState` is the persisted operator-owned matchup. `matchResolved` adds the
spreadsheet profiles and display names for every overlay. The old `currentMatch`
selection is read only for one-time migration.

Choose players in dropdowns labelled `Name (UID)`, or select Manual entry and
enter a name and UID/profile URL. Apply publishes both sides together. Upcoming
start.gg matches appear below the selectors; Load copies the two players, label
and series score. Bracket polling never replaces a loaded match. Discard edits
reloads the latest match after another operator changes it.

Profiles match by UID first. For legacy rows without a known UID, an exact
entrant ID, then a unique normalized tag/name, can supply the identity. Duplicate
matches are flagged; they never silently pick the first row. Explicit name and
handle overrides survive spreadsheet refreshes. Empty overrides use sheet data.

Series wins are 0–2 for the existing best-of-three presenter. Swap moves names,
UIDs, overrides and wins together. Reset an active Ban & Pick before changing
participants or swapping. Overlay visibility and page controls stay in their
own panels.

### Venue game accounts

Personal GeoGuessr UIDs identify spreadsheet profiles. They do not need to be
the accounts logged into venue PCs. Each side has an **In-game account** selector:
Left/A defaults to **Auto — blue team**, Right/B to **Auto — red team**. Detection
uses the connected party's current duel, including its pre-round preview. Before
a duel is available, the defaults wait for its team accounts.

Automatic mappings follow the team's account when another duel starts. You can
instead choose a detected account explicitly; if it disappears, the selection
stays visible as unavailable and results remain unmapped. Duplicate effective
mappings leave both sides unmapped. Swap moves the mapping with its competitor;
loading a new start.gg match restores blue-left/red-right defaults. Names, profile
data and series wins still come from Current Match, regardless of venue logins.

The supplied [player datastore](https://docs.google.com/spreadsheets/d/1xozkRDAEeRLqVPzvpqqDFAcpC3vcbTrd9xekrQ28B50/edit#gid=0)
has a `players` tab (gid 0), populated with the 11 event registrants' names and
entrant IDs on 2026-09-12. UID and profile fields are blank until verified data
is supplied. The sheet is the directory; live match state stays in NodeCG.
