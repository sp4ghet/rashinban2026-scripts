# Google Sheet data

Human-authored data lives in a Google Sheet shared as "anyone with the link
can view". The NodeCG extension polls each tab's CSV export
(`https://docs.google.com/spreadsheets/d/<sheetId>/export?format=csv&gid=<tabGid>`)
and publishes the rows as replicants. Overlays never fetch from Google
directly (in 2025 every overlay polled on its own; now there is one poller).

Configure the sheet id, tab gid, and interval in the "Player Cards"
dashboard panel; they are stored in the `sheetConfig` replicant.

## `players` tab

One row per entrant. The header row is matched case-insensitively; extra
columns are kept under `extra` for future card fields. Row values are kept
as text so the sheet controls formatting ("71.4%", "1st").

| Column | Card field | Notes |
| --- | --- | --- |
| `startgg_tag` | join key | **Required.** The start.gg gamer tag; compared ignoring case and spaces. |
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

The `currentMatch` replicant decides which two players the cards show:

- `auto`: the first set in the start.gg stream queue, else the first
  active/called set in the bracket.
- `set`: a start.gg set chosen in the dashboard.
- `tags`: two players picked from the sheet's player list (or typed) by the
  operator; works without start.gg, e.g. before seeding or for exhibitions.

Profiles are looked up by entrant id, then by tag, then by full start.gg
name. The dashboard shows which side has no matching row.
