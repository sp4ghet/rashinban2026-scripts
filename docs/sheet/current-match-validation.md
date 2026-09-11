# Current Match validation — 2026-09-12

- Full regression suite: 239 tests passed; TypeScript check and esbuild passed.
- Integration tests cover shared presenter/ban-pick publication, profile refresh,
  stale edits, active-draft swap rejection, and NodeCG object ownership.
- Venue-account tests cover blue/red defaults independent of personal UID,
  replacement accounts, explicit unavailable accounts, side swaps, migration,
  duplicate mappings and publication when the detected duel changes. Live
  dashboard verification showed blue-left/red-right defaults waiting for a duel.
- Isolated browser preview exercised Load, Apply display override and Swap.
  The complete competitor and wins moved together. Dropdown labels contained
  names and UIDs, and the upcoming table appeared below the selector.
- Main NodeCG mounted successfully on port 9090. Existing matchup
  `sp4ghet vs Shiina` survived migration. No live matchup edits or GeoGuessr
  game actions were used for validation.
- The supplied spreadsheet's `players` tab, gid 0, has 26 columns and 11
  registration rows. Japanese names were checked through CSV export. The
  header is bold/frozen, columns widened, and data columns formatted as text.
- Live polling is enabled every 15 seconds. NodeCG reported 11 players,
  zero skipped rows, no missing columns and no fetch error. start.gg refresh
  also succeeded and populated the upcoming table.

GeoGuessr UIDs remain blank: the inspected start.gg account-link fields did
not expose them. Importing custom registration answers, if that is where the
URLs were collected, requires the organizer's answer export or another verified
source. See [start.gg findings](../startgg/README.md#geoguessr-registration-identity-checked-2026-09-12).

Screenshots and the isolated preview harness are local generated artifacts
under `artifacts/current-match-*` and `artifacts/player-sheet.png`.
