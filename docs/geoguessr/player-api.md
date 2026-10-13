# GeoGuessr player profiles, statistics, and analytics API

Investigated **2026-10-10**, against web client `1.8279-c9cc17a`; documented
2026-10-12. These are observed website API behaviors, not a guaranteed public
API contract. This document summarizes that investigation; the endpoints were
not re-tested when writing it.

The example player was [siesta](https://www.geoguessr.com/user/5dc5c0bb7e473f4c34d2c66f)
(`5dc5c0bb7e473f4c34d2c66f`). Requests were compared without authentication and
with the existing `sp4ghet` session, which belongs to a different account.
All API checks used read-only GET requests. Credentials are omitted.

## Findings

- Another player's best three and worst three countries are available without
  logging in or matching them in a duel.
- Public profile data includes extensive aggregate statistics, including
  per-mode duel totals and win rates.
- An authenticated account can retrieve another player's accessible match
  history. Detailed results for a tested completed duel were public by game ID.
- The analytics page's guess-history feed is scoped to the signed-in account.
  No other-player equivalent was found. Additional analytics can be calculated
  from accessible match results, but lifetime coverage was not established.

## Endpoint inventory

All paths below use `https://www.geoguessr.com`. `{userId}` is the profile's
24-character ID. Status codes describe the tested account/player, not every
possible account, subscription, or privacy setting.

| GET path | Data | Observed access |
| --- | --- | --- |
| `/api/v3/users/{userId}` | Nickname, selected country, creation date, avatar assets, XP, level/title, club, Pro/verified status, rating fields | Anonymous `200` |
| `/api/v3/users/{userId}/stats` | Classic game/round totals, average/best scores, distances, Battle Royale results, daily-challenge and country-streak records | Anonymous `200` |
| `/api/v3/profiles/profile/{userId}` | Combined profile, basic and extended statistics, Explorer scores/medals, badges, trophies, bio/configuration, friend count/previews, peak ratings | Anonymous `200` |
| `/api/v4/ranked-system/progress/{userId}` | Best/worst countries, guess-first rate, win streak, recent results, nullable rank fields | Anonymous `200` |
| `/api/v4/ranked-system/peak-rating/{userId}` | Overall and per-mode peak rating fields | Anonymous `200`; see rating caveat below |
| `/api/v4/stats/users/{userId}` | Extended statistics as a separate response | Anonymous `401`; other-account session `200` |
| `/api/v4/game-history/{userId}` | Accessible matches, opponents, modes, winners, scores, round locations | Anonymous `401`; other-account session `200` |
| `/api/v4/game-history/{userId}/game-ids` | IDs of accessible matches | Anonymous `401`; other-account session `200` |
| `/api/v4/ranked-system/head-to-head/{userId}` | Signed-in player's record against the specified player | Anonymous `401`; authenticated `200` |
| `/api/v4/guess-history/range?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=1` | Signed-in account's own guess history, with pagination | Anonymous `401`; authenticated `200` |
| `/api/v4/game-results/duels/{gameId}` | Detailed completed-duel result for both players | Anonymous and authenticated `200` for the tested match |
| `/static-content/game-results/duels/{gameId}.json` | Static completed-duel result | Anonymous and authenticated `200` for the tested match |

The separate extended-statistics endpoint requires authentication even though
the combined public profile response includes `extendedStats` without it.

Two additional routes found in the client did not yield player data:
`/api/v4/ranked-system/best/{userId}` returned anonymous `404`, and
`/api/v4/ranked-v2/players/{userId}` returned anonymous `401` and authenticated
`404`. Those responses do not establish their behavior for other players.

## Best/worst countries and recent form

[Example ranked-progress request](https://www.geoguessr.com/api/v4/ranked-system/progress/5dc5c0bb7e473f4c34d2c66f):

```http
GET /api/v4/ranked-system/progress/5dc5c0bb7e473f4c34d2c66f
```

Anonymous response:

```json
{
  "divisionNumber": null,
  "divisionName": null,
  "rating": null,
  "tier": null,
  "guessedFirstRate": 0.5926172438672438,
  "winStreak": 4,
  "latestGames": [true, true, true, true, false, true, true, true, false, true],
  "bestCountries": ["mx", "ru", "id"],
  "worstCountries": ["ca", "us", "uy"]
}
```

For this snapshot, the best countries were Mexico, Russia, and Indonesia;
the worst were Canada, the United States, and Uruguay. The guess-first rate
was about 59.3%, and the winning streak was four games. `latestGames` contains
recent win/loss booleans; its ordering and aggregation window were not
independently established.

This response contains country codes only: it does not expose the underlying
country scores, sample sizes, ranking formula, or a full country ranking.
Per-mode country rankings were not verified.

## Aggregate player statistics

The [combined profile response](https://www.geoguessr.com/api/v3/profiles/profile/5dc5c0bb7e473f4c34d2c66f)
is the most useful starting point for player cards. Relevant objects include
`user`, `userBasicStats`, `extendedStats`, `explorerMapStats`, and `peakRating`.

Within `extendedStats`, solo-duel keys include `duels`, `duelsNoMove`,
`duelsNmpz`, and `duelsTotal`. Their fields include `numGamesPlayed`, `numWins`,
`winRatio`, `avgGuessDistance`, `numGuesses`, and `numFlawlessWins`.

| Mode | Games | Wins | Win rate |
| --- | ---: | ---: | ---: |
| Moving (`duels`) | 402 | 228 | 56.7% |
| No Move | 1,073 | 560 | 52.2% |
| NMPZ | 222 | 98 | 44.1% |
| Total | 1,697 | 886 | 52.2% |

The response also separates ranked team-duel modes, unranked solo-duel modes,
Battle Royale statistics, and party activity. These are historical values
from the investigation, not current player statistics.

Rating fields need separate validation: `user.competitive.rating` was `1349`,
while `peakOverallRating` was `1096`, and ranked-progress rating/division fields
were null. The investigation did not establish why they disagree or which
rating system each field represents. Do not combine them into a single rating
series or use them as an authoritative current rating without further checks.

## Own-account analytics

The analytics client requests:

```http
GET /api/v4/guess-history/range?from=2026-10-01&to=2026-10-10&limit=1
```

The response has `items` and `paginationToken`. Each item contains
`finishedAt`, `gameId`, `gameType`, `mapSlug`, `movementRestrictions`, and
`rounds`. Round fields observed were:

```text
guessLat, guessLng, roundLat, roundLng,
guessCountryCode, roundCountryCode, roundScore
```

The browser computes country accuracy, average scores, and country mix-ups
from these records. The request builder accepts `from`, `to`, `limit`, and
`paginationToken`; it does not send a target player ID.

With the `sp4ghet` session, adding
`userId=5dc5c0bb7e473f4c34d2c66f` returned the identical own-account response.
The pagination token still identified the signed-in account. The extra query
parameter did not select siesta. This establishes the observed account scope,
not a proof that no other endpoint exists.

Source: [analytics client chunk from build 1.8279-c9cc17a](https://www.geoguessr.com/_next/static/chunks/677-5914a6a3179d5082.js).

## Other-player match history and derived analytics

Using the other-account session, both history routes returned **40 matches**
for siesta. Their round start dates spanned **2026-08-10 to 2026-09-26**, and
the history response contained `userId` and `entries`, with no pagination
token. This does not establish a universal 40-match cap, a retention policy,
or lifetime coverage.

The history response supplied round locations and country codes, but the
tested match's round-level `guesses` arrays were empty. Fetch the completed
result separately for player guesses:

```http
GET /api/v4/game-results/duels/6ab7f6d5be09b21d4660bcb6
```

The [tested result](https://www.geoguessr.com/api/v4/game-results/duels/6ab7f6d5be09b21d4660bcb6)
returned anonymously and included:

- `options`: map ID/name, mode, rated/team flags, and game settings.
- `rounds`: actual coordinates, panorama, orientation, and multiplier.
- `teams[].players[].guesses`: round number, guess coordinates, distance,
  score, `timeSpentMs`, health before/after, and best-team-guess flag.
- `teams[].roundResults`: damage, multiplier, and health before/after.
- `startedAt` and `finishedAt`.

The older endpoint
`https://game-server.geoguessr.com/api/duels/{gameId}` also returned the completed
match with authentication (`401` anonymously), including guesses, timestamps,
round country codes, and rating progression. Its response contained more
round definitions than played rounds; do not count every definition as a
played observation.

These responses support calculating per-country scores/distances, round-win
rates, damage, and guessing speed over the available matches. Country accuracy
and mix-ups additionally need guessed-country classification: the tested
completed-result response supplied guess coordinates, not `guessCountryCode`.
Such calculations are derived statistics, not GeoGuessr's full analytics feed
or a verified reproduction of its best/worst-country ranking.

## Application to RASHINBAN

Use the public combined profile and ranked-progress endpoints for player-card
identity, aggregate duel performance, recent form, and best/worst countries.
Handle absent/null fields explicitly.

For deeper analysis, use authenticated history lookup to discover match IDs,
then fetch completed results. Display the number of matches and date range
covered; avoid labeling that sample as lifetime performance.

Keep authenticated requests in the server extension, using the existing
[credential loader](../../bundles/rashinban/src/extension/presenter/secrets.ts).
Do not expose the session cookie through dashboard/graphics configuration or
Replicants. See [presenter protocol](presenter-protocol.md) for live-game
integration, which is separate from these profile and completed-match APIs.
