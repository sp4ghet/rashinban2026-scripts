# Player tie-range captures

Captured from GeoGuessr in Chrome on **2026-09-12 JST**. Guest/player, team,
and game IDs are replaced with aliases. Panorama/guess geometry, credentials,
and unrelated profile fields are omitted. Native HP, damage, and multipliers
remain as evidence but are never used as custom scoring inputs.

| File | Observation |
| --- | --- |
| `player-rest-full.json` | Completed five-round player archive; Full custom result is blue 0 / red 5644. |
| `player-rest-live-limit.json` | Controlled MOVE game, three 0–0 rounds. Native terminal HP is forcibly zeroed for one side; settled history yields a custom 6000–6000 draw. |
| `player-live-manual.json` | Controlled manual NM game: Created, resolved 0–0 round, then 2470–0 at 1.5×. Damage is 3705; Full raises both next multipliers to 2×. |
| `player-dom.json` | Actual playing/result/summary DOM fragments from the temporary guests. Results-map content is omitted. Class hashes are evidence, not stable selectors. |

## Current player transport

Party players play inside `/party/lobby`, including localized URLs and join
codes; starting a duel does not navigate them to `/duels/<id>`. The duel root
is a portal outside `main`.

1. `GET /api/v4/parties/v2/active` on `www.geoguessr.com` identifies the active
   `lobbyId` and party game state.
2. `GET /api/v4/game-server/phonebook/<gameId>` returns an active game-server
   node. The live response is read from
   `https://gs2.geoguessr.com/<nodeId>/<gameId>` with credentials included.
3. A completed test game's phonebook returned
   `{gameId, gameServerNodeId: null, status: "Finished"}`. Completed archives
   are available from `https://game-server.geoguessr.com/api/duels/<gameId>`.

**Do not use the legacy archive as a live fallback.** During the manual duel,
that endpoint remained at Created/version 0 while the live node reached
versions 8 and 15 with settled results. The userscript rediscovers a failed
active node and only selects the archive after a positive completed/inactive
phonebook status.

Logged-in identity comes from the public `__NEXT_DATA__` account user ID.
Guests lack that field; `GET /api/v4/guest-users/id` supplies their normal
guest ID, matching `teams[].players[].playerId`. Neither lookup reads cookies.

The native summary has five columns: round, blue score, red score, blue HP,
red HP. Header profile links identify the health columns. Result disclosure
requires the mounted visible round result with a matching round number, or
the appropriate terminal summary. Future `rounds` with null start times are
preloaded and do not imply settlement.

An exploratory legacy rollback request returned 200 without changing the live
node's version or results; it is **not** evidence of a successful live undo.
Restart/truncated-history regressions therefore use explicitly synthesized
state variants. No captured file is presented as a successful rollback trace.
