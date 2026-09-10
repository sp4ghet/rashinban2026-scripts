# GeoGuessr Party Broadcast ("Presenter Mode") protocol notes

Captured 2026-09-10 against web client `1.7695-a61479c`. Everything here was
read from the broadcast page's Next.js chunks and confirmed with live traffic
from a real party (see `samples/`). GeoGuessr ships new client builds often, so
re-verify with the capture userscript (`tampermonkey/geoguessr-capture.user.js`)
before relying on any of this at the event.

## How the broadcast page works

`https://www.geoguessr.com/party/broadcast/<partyId>` (needs a logged-in account)

1. **Polls the party** every 5 s: `GET /api/v4/parties/v2/<partyId>`
   (`samples/party.json`). Relevant fields: `lobbyId`, `gameState`
   (`NoGame | Ongoing | Finished`), `gameType`, `gameSettings`, `owner`.
2. When `gameState !== "NoGame"` **and** `gameType` is `Duels` or `TeamDuels`,
   it resolves the game server node:
   `GET /api/v4/game-server/phonebook/<lobbyId>` →
   `{ gameId, gameServerNodeId, status: "Active" }`
   (`samples/game-server-phonebook.json`).
3. Fetches the initial state as a spectator:
   `GET https://gs2.geoguessr.com/<nodeId>/<lobbyId>/spectator`
   (`samples/gs2-spectator-snapshot.json`). Cookies are sent cross-origin.
4. Opens the **game-server WebSocket** (below) and renders the duel from the
   state pushed over it. Round panorama coordinates are included, so the
   spectator view knows the answer location.
5. When `status === "Finished"` the page keeps showing the result for 6 s,
   then returns to the idle screen and waits for the next `lobbyId`.

Only **Duels / TeamDuels** are rendered. Battle Royale, Live Challenge, Bullseye
and quiz modes fall through to the idle screen ("waiting for host"). Verify this
with a capture if those modes matter for the event.

The page also keeps the **site WebSocket** open for chat and account updates,
and plays its own music/effects (quiz music, `newRound`, `confetti`,
`effectPointsCountUp`, ...) from `/_next/static/audio/`.

## Game-server WebSocket (the one that matters)

```
wss://gs2.geoguessr.com/<nodeId>/<lobbyId>/spectate/ws
    ?c=web-<clientVersion>&tabId=<uuid>&attempt=<n>&visibility=visible[&reconnect=true]
```

Auth is the normal geoguessr cookie (`_ncfa`). Players use the same URL without
`/spectate`. Client shows `X-Client: web-<version>` on REST calls.

Outbound (JSON text frames):

| code | when | body |
|---|---|---|
| `SubscribeToLobby` | on open | `{ code, gameId, playerId }` |
| `SubscribeToLiveStream` | on open, spectators only | `{ code, gameId, playerId }` |
| `HeartBeat` | every 15 s | `{ code }` |

Inbound (JSON text frames, always `{ code, gameId?, ... }`):

| code | payload | notes |
|---|---|---|
| `SpectatorCount` | `spectatorCount` | sent on subscribe |
| `DuelStarted` | `duel.state`, `timestamp` | full state snapshot. Sent on game start **and whenever any client (re)connects**, e.g. a player refreshing mid-round (`samples/gs2-ws-DuelStarted-on-reconnect.json`). Treat it as "replace state", detect a new game by `gameId` change |
| `DuelPinPlaced` | `duel.state`, `timestamp` | a player moved their pin (`players[].pin`) |
| `DuelPlayerGuessed` | `duel.state`, `timestamp` | guess appended to `players[].guesses` **with `score` and `distance` already computed**; first guess of a round sets `timerStartTime`/`endTime` (the 15 s countdown) |
| `DuelRoundTimedOut` | `duel.state`, `timestamp` | round resolved: `teams[].roundResults[]` appended, `health` updated, pins cleared |
| `DuelNewRound` | `duel.state`, `timestamp` | ~8 s after `DuelRoundTimedOut`: `currentRoundNumber`++, new entry in `rounds[]` with its panorama and `startTime`, pins `null` |
| `DuelFinished` | `duel.state`, `timestamp` | `status: "Finished"`, `result: { isDraw, winningTeamId, winnerStyle }`, `players[].progressChange` filled with XP awards |
| `DuelAborted` | `duel.state`, `timestamp` | host aborted from Presenter Mode. **Also** `status: "Finished"` with a `result` (winner picked by health, `winnerStyle: "FlawlessVictory"` here) but no `progressChange`. Key off the `code`, not `status`, to tell abort from a real finish. Party goes to `gameState: "NoGame"` and the server closes spectator sockets with `1000 "Spectator session ended"` (`samples/gs2-ws-DuelAborted.json`) |
| `LiveStreamSamples` | `playerId`, `payload[]` | per-player UI telemetry, see below |
| `ConnectionOpened` | `playerId`, `lobby?` | seen in client code, not observed on the spectator socket (a reconnect shows up as `DuelStarted` instead) |
| `LobbyClosed`, `GameAborted`, `DuelRollbackToRound` | | seen in client code, not captured. Rollback is not offered in the Presenter Mode UI |

Every `Duel*` message carries the **entire** duel state with a monotonically
increasing `version`; the client keeps the highest version it has seen. So a
consumer never needs to diff messages, it just replaces state. Spectators see
gaps in `version` (player-only messages are not forwarded); that is normal.

A complete 1v1 duel, every non-telemetry message in order, is in
`samples/gs2-ws-full-duel-sequence.json`. Per round the sequence is:
`DuelNewRound` → (`DuelPinPlaced`)* → `DuelPlayerGuessed` (player A) →
(`DuelPinPlaced`)* → `DuelPlayerGuessed` (player B) → `DuelRoundTimedOut`.
When both players have guessed, `DuelRoundTimedOut` follows the second
`DuelPlayerGuessed` within ~50 ms.

### Round timers (`startTime`, `timerStartTime`, `endTime`)

Confirmed with a duel using `maxRoundTime: 60`
(`samples/gs2-ws-full-duel-sequence-maxroundtime.json`):

- `DuelStarted` / `DuelNewRound` announce a round whose `startTime` is
  **2 to 4 s in the future** relative to the message `timestamp` (the "round
  starts in..." countdown). Start the overlay's round clock at `startTime`,
  not on receipt.
- With a max round time, the round starts with `timerStartTime = startTime`
  and `endTime = startTime + maxRoundTime`. Without one (`maxRoundTime: 0`)
  both are `null` until the first guess.
- The first `DuelPlayerGuessed` of a round sets `timerStartTime = now` and
  `endTime = now + roundTime` (15 s), replacing the longer deadline.
- So **`rounds[].endTime` is always the deadline to display**; nothing needs
  to be computed from `maxRoundTime`. `DuelRoundTimedOut` arrives ~0.5 to 1 s
  after `endTime`.
- When the deadline passes, the server **auto-submits each player's current
  pin as a guess** (`guesses[]` grows, `created` = timeout instant, score
  computed as normal), so `DuelRoundTimedOut` never has a player without a
  guess if a pin was placed (`samples/gs2-ws-DuelRoundTimedOut-autosubmitted.json`).
- A timeout with **no pin at all** appends nothing to `guesses[]`; the team's
  `roundResults[]` entry is `{ score: 0, bestGuess: null, damageDealt: 0, ... }`
  (`samples/gs2-ws-DuelRoundTimedOut-nopin.json`). That is the "N/A" case to
  render. A pin that scores 0 still produces a real guess entry with
  `score: 0`, so check `bestGuess === null` rather than the score.

`result.winnerStyle` values seen: `"Victory"`, `"ExpressVictory"` (health
reached 0 within 4 rounds), `"FlawlessVictory"` (on an aborted game where the
"winner" had taken no damage).

### Manual round start (party setting "auto-start rounds" off)

Captured in `samples/gs2-ws-full-duel-sequence-manual-rounds.json`. With the
setting off the state has `options.roundStartingBehavior:
"ManuallyStartAllRounds"` and `masterControlAutoStartRounds: false`
(with it on: `"Default"` / `true`).

- The game is created before the host starts round 1: both the REST
  spectator snapshot and the first `DuelStarted` have **`status: "Created"`**,
  `rounds[0]` present but with `startTime`, `timerStartTime`, `endTime` all
  `null` (`samples/gs2-ws-DuelStarted-created-not-started.json`). An overlay
  should show a "waiting for host" state here, not a running round.
- The host starting round 1 arrives as a second `DuelStarted` with
  `status: "Ongoing"` and the round's `startTime` ~4 s ahead. So `status`
  moving `Created → Ongoing` is the "game started" signal.
- Between rounds nothing is sent while the host waits; the previous
  `DuelRoundTimedOut` state (`rounds.length === currentRoundNumber`, all
  results in) is the "round over, waiting for host" state. The host's start
  arrives as the usual `DuelNewRound` with `startTime` ~2.6 s ahead.
- `status` values seen: `Created`, `Ongoing`, `Finished`.

### Detecting a 5K

There is **no dedicated message**. A 5K is a `DuelPlayerGuessed` whose new
guess has `score: 5000` (`samples/gs2-ws-DuelPlayerGuessed-5k.json`, distance
24.8 m). Because the score is computed server-side at guess time, an overlay
can fire the 5K effect the moment the guess arrives, before the round result
is revealed. Detect it by diffing `players[].guesses` length between
consecutive states and checking the appended guess.

### Multipliers and damage (confirmed against all four captured duels)

Party settings → state fields (names from the party UI, per the user):

| Party setting | `options` field | In captures | Effect |
|---|---|---|---|
| Individual Multiplier Increment | `roundWinMultiplierIncrement` | `5` = 0.5x | the round winner's multiplier grows by this after the round (both on a tie) |
| Mutual Multiplier Increment | `multiplierIncrement` | `0` = 0x | both players' multipliers grow by this after **every** round, regardless of the winner |
| Rounds without multipliers | `roundsWithoutDamageMultiplier` | `1` | rounds before increments apply; with 1, round 2 is the first that can carry a multiplier |

Values are stored in tenths (`5` = 0.5x). Confirmed on 2026-09-10 with a
fifth duel using Individual 0.5x, **Mutual 0.5x**, Rounds without multipliers
**2** (`samples/gs2-ws-full-duel-sequence-mutual-multiplier.json`):

```
after round n, if n >= roundsWithoutDamageMultiplier:
    every team's multiplier += mutual
    the round winner's multiplier += individual   (both teams on an exact tie)
damage to the loser = roundHalfEven((winner score - loser score) × winner's multiplier)
```

- `teams[].currentMultiplier` is the multiplier the team will use in the
  **next** round; `roundResults[].multiplier` is the one it used that round.
  The server does not apply the increment after the round that finishes the
  game (final `currentMultiplier` equals the last round's).
- `rounds[].multiplier` and `rounds[].damageMultiplier` (always equal) are the
  **mutual component only**: `1 + max(0, n − exempt) × mutual`
  (`1, 1, 1.5, 2, 2.5, 3` in the Mutual capture, all `1` with Mutual off). A
  team's multiplier is that plus `individual × (its counted wins and ties)`.
- "Rounds without multipliers" exempts the *increments after* rounds
  `1..N-1`: with 2, red won round 1 and got nothing, blue won round 2 and went
  `1 → 2` (mutual + individual) while red went `1 → 1.5`. So round `N+1` is
  the first played with a multiplier; with the default 1 that is round 2.
- **Damage = (winner score − loser score) × winner's multiplier**, rounded
  half-to-even (`187 × 1.5 = 280.5 → 280`, `3865 × 1.5 = 5797.5 → 5798`,
  `213 × 2.5 = 532.5 → 532`; the server is evidently .NET).
  `roundResults[].damageDealt` is that value on the winner's entry and 0 on
  the loser's.
- On an **exact tie both multipliers get the individual increment** and no
  damage is dealt (`samples/gs2-ws-full-duel-sequence.json` round 4,
  `251/251`).
- Multipliers never decrease.

A replica of this rule reproduces every `roundResults[].multiplier`,
`rounds[].multiplier`, `damageDealt` and `healthAfter` in all four completed
captures (see `pinpointing-duels-userscripts.md`, "Presenter-managed HP").

Duel state shape (`samples/gs2-ws-DuelStarted.json`):

```
gameId, gameServerNodeId, status ("Ongoing" | "Finished"), version,
currentRoundNumber, isPaused, gameMasterId, result (null until finished)
teams[]: { id, name ("blue"|"red"), health, currentMultiplier,
           players[]: { playerId, pin {lat,lng}|null, guesses[] { roundNumber, lat, lng, distance, score, created, isTeamsBestGuessOnRound },
                        countryCode, progressChange, helpRequested, isSteam },
           roundResults[]: { roundNumber, score, healthBefore, healthAfter, bestGuess, damageDealt, multiplier } }
rounds[]: { roundNumber, panorama { panoId, lat, lng, countryCode, heading, pitch, zoom },
            startTime, timerStartTime, endTime, multiplier, damageMultiplier, isHealingRound, skippedByPlayerId }
options: { roundTime, maxRoundTime, initialHealth, healingRounds[], movementOptions {...}, map { name, slug, bounds }, isTeamDuels, ... }
context: { type: "Party", id: <partyId> }
```

Timestamps are ISO strings from the server clock; the client corrects them by
the drift measured from the `X-ServerTime` response headers.

### `LiveStreamSamples`

Batched telemetry from each player's client, keyed by `playerId`, for drawing
what the player is doing. Types seen (`samples/gs2-ws-LiveStreamSamples.json`):

`MapDisplay {isActive,isSticky,size}`, `MapBoundingBox {north,east,south,west}`,
`PinPosition {lat,lng}`, `GuessWithLatLng {lat,lng}`, `PanoPosition {lat,lng,panoId}`,
`PanoPov {heading,pitch}`, `PanoZoom {zoom}`, `Timer {time}`. `MapBoundingBox`
and `PanoPov` are by far the most frequent.

**Movement** (captured in a Moving duel, `samples/gs2-ws-LiveStreamSamples-movement-trace.json`):
each street-view step emits a `PanoPosition {lat,lng,panoId}` sample with the
new pano id, so a player's path within a round is the sequence of
`PanoPosition` samples (one round of one player produced 579 samples over 346
distinct panos). Each sample carries its own client `time` (ms epoch); samples
are batched into `LiveStreamSamples` messages roughly every 250 ms with a
median of 2 samples per batch, and gaps of ~1 s happen. In NMPZ and No Move
duels `PanoPosition` appears once per round (the spawn) and only `PanoPov` /
`PanoZoom` change. Player identity is the top-level `playerId`; team comes
from the duel state.

Close codes: `4000` client-initiated, `4100` do-not-reconnect (marks failed),
`4200` client reloads the page, `1012` server restart (client reconnects with
`reconnect=true`).

## Site WebSocket (chat, notifications)

```
wss://api.geoguessr.com/ws?c=web-<clientVersion>&tabId=<uuid>&attempt=<n>&visibility=...
```

Topic pub/sub. Outbound `{ code, topic, payload?, accessToken?, client: "web" }`
with codes `Subscribe`, `Unsubscribe`, `SubscribeToMatchmaking`, `HeartBeat`
(15 s), `ChatMessage`, `ChatEmote`, `ChatDisconnect`. Inbound
`{ code, topic, payload (JSON string), level?, timestamp? }` with codes
`Subscribed`, `SubscribeDenied`, `ChatMessage`, `AccountUpdate`,
`NotificationUpdate`, `TournamentUpdate`, `FriendsUpdated`,
`FriendCameOnline`, `FriendWentOffline`, `StatusActivityChanged`, ....
Not needed for game state, but it is the only way to read chat and emotes.

### Party chat and emotes (confirmed)

Topic format: `chat:<context>:<level>:<roomId>` where context is
`Party | InGame | Friend | Club | PostGame` and level is
`None | EmotesOnly | TextMessages | TeamTextMessages`.

- **Party chat works for a spectator**: subscribe to
  `chat:Party:TextMessages:<partyId>` with `accessToken` = the party's
  `chatAccessToken` (from `GET /api/v4/parties/v2/<partyId>`). The server
  answers `Subscribed { topic, level }`. Subscribing with level `None` is
  denied.
- **In-game chat topics are denied** for a spectator
  (`chat:InGame:*:<gameId>`, with or without a token). For party duels the
  page builds the lobby without a token, and with the party setting
  `isolateInGameChat: false` messages and emotes sent from inside the game
  arrive on the **party topic** anyway. So one subscription covers both.
- Inbound envelope: `{ code: "ChatMessage", topic, payload, timestamp }`
  where `payload` is a JSON **string**:
  `{ id, payloadType: "Text" | "Emote", textPayload, sourceType: "User",
  sourceId: <userId>, sentAt, roomId, context: "Party", recipientType,
  recipientId, channel, invitePayload, clubPayload, reactionPayload,
  blocksPayload }`. Emotes carry the shortcode in `textPayload`
  (`:wave:`, `:gg:`, `:happy:`, `:mindblown:`, `:confused:`, `:cry:`,
  `:cool:`, `:goat:`, `:luckyguess:`, `:beenthere:`, `:goodguess:`,
  `:thankyou:`). Samples: `samples/site-ws-chat.json`.
- Map `sourceId` to a nick with `GET /api/v4/player-identities/<id>` or the
  party member list.

## Other useful REST endpoints

- `GET /api/v4/parties/v2/active` — the caller's current party.
- `GET /api/v3/users/<id>` and `?ids=` — nick, pin, level for player ids.
- `GET /api/v4/player-identities/<id>` — nick/flair/mugshot for a player id.
- `GET https://gs2.geoguessr.com/<node>/<game>/reconnect` — player-side snapshot.

## Scope for RASHINBAN 2026

Only **1v1 Duels** matter; healing rounds will never be enabled. TeamDuels,
Battle Royale and other modes are out of scope, so their shapes were not
captured.

## Reconnect behaviour

The spectator socket can drop with close code `1006` for no visible reason
(seen once mid-round). Reconnect with the same URL (`attempt` incremented,
`reconnect=true`), resubscribe, and the server replies with a fresh
`DuelStarted` snapshot, so no state is lost. On abort or finish the server
closes with `1000 "Spectator session ended"`; poll the party for the next
`lobbyId` instead of reconnecting.

## Open questions

- `DuelRollbackToRound` / `GameAborted` / `LobbyClosed` shapes (not reachable
  from the Presenter Mode UI as of this build).
- Any binary frames (none seen across four duels; everything is JSON text).
