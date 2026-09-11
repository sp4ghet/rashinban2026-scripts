# GeoGuessr Party Broadcast ("Presenter Mode") protocol notes

For implementation of the visual lifecycle, see [Game-master presentation flow](game-master-flow.md): manual versus automatic starts, results holds, local Continue versus server Start round, screenshots, music and final-summary behavior.

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

That six-second behavior describes the standalone broadcast wrapper captured here. The newer interactive party game-master screen has a winner reveal, Game Summary and Continue flow; see [the full game-end loop](game-master-flow.md#complete-end-to-next-game-loop). Do not apply the broadcast-wrapper timeout to the interactive summary.

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

## Game-master snapshot (2026-09-11)

User-supplied Firefox Network capture, client `web-1.7709-ed0ee1b`:

```
GET https://gs2.geoguessr.com/<gameServerNodeId>/<gameId>/game-master
credentials: include
```

The response is a bare duel state (no WebSocket `code` / `duel.state`
envelope). This capture maps:

- Party / broadcast ID: `5bcebcb8-6514-4fff-8dbb-662607ee14e7`, matching
  `context: { type: "Party", id: ... }`.
- Game ID: `6aa3ae644f7b00f361d1668f`.
- Server node ID: `82db719412ba42c8a2d388b968781f0e`.
- Game master ID: `5ec26de5a789c45a9c13cf3c` (state metadata, not an
  authentication credential).

At version 22, `status` is `Ongoing`, `currentRoundNumber` is 3, and
`isPaused` is false. Round 3 has `hasProcessedRoundTimeout: true` and both
teams have round-3 results. With `ManuallyStartAllRounds` and
`masterControlAutoStartRounds: false`, this is consistent with waiting for
the host to start round 4.

Unlike the earlier spectator captures, this snapshot contains **20 rounds,
including future panoramas**, although `maxNumberOfRounds` is 50. Rounds
4-20 have null start/timer/end timestamps. Do not infer the active round,
completed round count, or game length from `rounds.length`. Select the round
by `roundNumber === currentRoundNumber`, then inspect its timestamps,
timeout flag and results. The earlier `rounds.length === currentRoundNumber`
observation applies to those spectator captures, not all state endpoints.
Whether subsequent game-master WebSocket snapshots include future rounds
still needs a capture.

The accompanying OPTIONS request is consistent with a browser CORS
preflight; check `Access-Control-Request-Method` and
`Access-Control-Request-Headers` to confirm. OPTIONS does not establish a
game command or its payload. See [MDN on preflight requests](https://developer.mozilla.org/en-US/docs/Glossary/Preflight_request).

### Lobby settings (request captured 2026-09-11)

Changing Duels settings in the lobby produced
`PUT https://www.geoguessr.com/api/v4/parties/v2/all-settings`, using
`credentials: "include"`, `Content-Type: application/json`,
`X-Client: web-1.7709-ed0ee1b`, `X-Locale: en`, and referrer
`https://www.geoguessr.com/party/lobby`. The captured JSON body was:

```json
{
  "gameType": "Duels",
  "gameSettings": {
    "forbidMoving": false,
    "forbidZooming": false,
    "forbidRotating": false,
    "guessMapType": "roadmap",
    "mapSlug": "696fe47c5b07bed052077a95",
    "timeAfterGuess": 15,
    "initialHealth": 6000,
    "maxRoundTime": 60,
    "maxNumberOfRounds": 50,
    "multiplierIncrement": 0,
    "roundWinMultiplierIncrement": 5,
    "roundsWithoutDamageMultiplier": 1,
    "disableHealing": true,
    "countAllGuesses": false,
    "powerUpSkipRound": false,
    "powerUpRoadLabels": false,
    "powerUpUpgradeMovement": false,
    "powerUpScoreMarker": false,
    "blinkMode": false,
    "blinkTimeTeamOne": 1000,
    "blinkTimeTeamTwo": 1000,
    "roundTime": 10,
    "roundCount": 5,
    "individualInitialHealth": false,
    "initialHealthTeamOne": 0,
    "initialHealthTeamTwo": 0
  },
  "settings": {
    "allowedCommunication": "TextMessages",
    "isolateInGameChat": false,
    "allowGuests": true,
    "allowSwitchingTeams": true,
    "maxPartySize": 100,
    "masterControl": true,
    "masterControlAutoStartRounds": false,
    "hideJoinInfo": true
  }
}
```

This sends game type, game settings, and party settings together; no party ID
appears in the URL or body. Partial-update semantics and required fields are
unknown. A future controller should preserve unrelated current settings when
editing a value rather than assuming a sparse body works or replaying this
entire historical configuration.

`masterControl` and `masterControlAutoStartRounds` belong to party `settings`
in this request, not `gameSettings`. The user believes auto-start cannot be
changed mid-game. Treat this as pre-game configuration; neither live mutation
of an ongoing duel nor server rejection of such a mutation has been observed.

The payload contains both `timeAfterGuess: 15` and `roundTime: 10`, plus both
`maxNumberOfRounds: 50` and `roundCount: 5`. Do not conflate these fields. Earlier
Duels captures associate the after-guess timer with duel `options.roundTime`
(15 seconds); a resulting game snapshot is needed to verify the mapping for
this write and determine which shared settings affect Duels. The presence of
`powerUpSkipRound` is not evidence of a game-master skip command.

The user confirmed **200 OK** with JSON body `{"message":"OK"}`. The
resulting party state was not supplied, so persistence details remain unverified.

### Party settings / auto-start toggle (request captured 2026-09-11)

Toggling auto-start rounds in the lobby produced
`PUT https://www.geoguessr.com/api/v4/parties/v2/settings`, using
`credentials: "include"`, `Content-Type: application/json`,
`X-Client: web-1.7709-ed0ee1b`, `X-Locale: en`, and referrer
`https://www.geoguessr.com/party/lobby`.

```json
{
  "allowedCommunication": "TextMessages",
  "isolateInGameChat": false,
  "allowGuests": true,
  "allowSwitchingTeams": true,
  "maxPartySize": 100,
  "masterControl": true,
  "masterControlAutoStartRounds": true,
  "hideJoinInfo": true
}
```

Unlike `/all-settings`, this endpoint takes the party settings object
directly, with no outer `settings` wrapper, `gameType`, or `gameSettings`.
The captured toggle-on request sends all eight party-setting fields, not
just `masterControlAutoStartRounds`. Partial-update semantics remain unknown;
preserve unrelated current party settings when constructing future writes.

This confirms the UI's request for enabling auto-start in the lobby. It
does not establish an effect on an ongoing game. The user confirmed
**200 OK** with JSON body `{"message":"OK"}`. The toggle-off request and
resulting party state were not supplied for this endpoint. Earlier captures
show `masterControlAutoStartRounds: false` for manual starts.

### Game settings / movement and map (requests captured 2026-09-11)

Toggling NM/Move in the lobby produced
`PUT https://www.geoguessr.com/api/v4/parties/v2/game-settings`, using
`credentials: "include"`, `Content-Type: application/json`,
`X-Client: web-1.7709-ed0ee1b`, `X-Locale: en`, and referrer
`https://www.geoguessr.com/party/lobby`.

The body is the complete `gameSettings` object shown in the `/all-settings`
capture above, with exactly one value changed: `forbidMoving` is `true`.
It has no outer `gameSettings` wrapper and contains neither `gameType` nor
party `settings`. The movement fields in this request are:

```json
{
  "forbidMoving": true,
  "forbidZooming": false,
  "forbidRotating": false
}
```

This excerpt is not the full captured request body. It represents NM:
movement forbidden, zooming and rotation allowed. The earlier `/all-settings`
body represents Move with all three flags false. The reverse toggle request
to this endpoint and the NMPZ toggle have not been captured.

The three observed settings writes therefore differ in body shape:

| PUT endpoint under `/api/v4/parties/v2` | Captured body shape |
|---|---|
| `/all-settings` | `{ gameType, gameSettings, settings }` |
| `/settings` | Party settings object directly |
| `/game-settings` | Game settings object directly |

This request sends the other game settings along with movement flags;
sparse-update semantics remain unknown. Preserve unrelated current values
when constructing future writes. The user confirmed **200 OK** with JSON
body `{"message":"OK"}`. The resulting party state was not supplied, and no
mid-game effect has been established.

A subsequent user capture of changing the map uses the same
`PUT /api/v4/parties/v2/game-settings` endpoint, headers, credentials and
unwrapped full game-settings body. Relative to the NM capture, it changes:

| Field | NM capture | Map-change capture |
|---|---|---|
| `mapSlug` | `696fe47c5b07bed052077a95` | `62a44b22040f04bd36e8a914` |
| `forbidMoving` | `true` | `false` |

All other body fields match. This identifies `mapSlug` as the map selection
field sent by the UI; no map name, bounds or panorama list is supplied.
The selected map's name was not provided. The map-change capture is in Move
configuration (all three movement restrictions false), but the captures do
not establish whether changing the map changed movement or whether the user
had separately switched back to Move. Do not infer an automatic reset.
The user also confirmed **200 OK** with JSON body `{"message":"OK"}` for
the map write. All three settings endpoints therefore share this observed
success response; none returns the updated settings in that response.

### Start game (request and response captured 2026-09-11)

The user captured the party lobby's start-game action with client
`web-1.7709-ed0ee1b`:

```http
POST https://www.geoguessr.com/api/v4/parties/v2/start-game
Content-Type: application/json
X-Client: web-1.7709-ed0ee1b
X-Locale: en

{}
```

The fetch uses `credentials: "include"`, `mode: "cors"`, and referrer
`https://www.geoguessr.com/party/lobby`. This is a same-origin website API
request, rather than a node-specific game-server request. No party ID, game
ID, server node ID, or game settings are supplied in its URL or body. This
suggests that the server resolves the caller's party from the authenticated
session; the capture alone does not establish the server's selection rules.

The confirmed response is **200 OK** with JSON body `{"message":"OK"}`.
It contains no game/server identifiers or duel state. After success, the
existing party polling and phonebook lookup described above provide the
route to the game server; do not reuse a previous game's identifiers.

The user confirmed the manual-start UI sequence: this start-game action
shows the first round preview in the game-master screen, then the client
calls `/game-master/start-next-round` to begin round 1. The same next-round
endpoint therefore starts both the first round and subsequent rounds.
This matches the earlier manual-round state captures (`Created` before
round 1, then `Ongoing` when it starts). Specific WebSocket frames have not
been supplied alongside these HTTP captures; the earlier captures show
`DuelStarted` for round 1 and `DuelNewRound` for later rounds.

### Start next round (request captured 2026-09-11)

The user captured this request when clicking start next round in the same
party/game, using client `web-1.7709-ed0ee1b`:

```http
POST https://gs2.geoguessr.com/82db719412ba42c8a2d388b968781f0e/6aa3ae644f7b00f361d1668f/game-master/start-next-round
Content-Type: application/json
X-Client: web-1.7709-ed0ee1b
X-Locale: en

{}
```

The browser fetch uses `credentials: "include"`, `mode: "cors"`, and the
GeoGuessr website as referrer. The general route is
`POST https://gs2.geoguessr.com/<nodeId>/<gameId>/game-master/start-next-round`.
The body is the string `"{}"`, not an omitted body; no round number, party ID,
player ID or state version is supplied in it.

This identifies an **HTTP control request** for starting the next round.
Earlier captures show `DuelNewRound` state updates after manual round
starts, consistent with HTTP commands followed by WebSocket state updates.
The user confirmed that this POST returned **204 No Content**, with no
response body. Treat that as HTTP success; do not call `response.json()` on
it or expect a duel state in the response. The corresponding WebSocket frames
for this specific POST were not supplied, so exact event correlation remains
unverified. The user separately confirmed that this same endpoint starts
round 1 from the initial game-master preview, as well as subsequent rounds.
Do not infer that other controls use the same transport or that this command
is idempotent; do not automatically retry it on an ambiguous network failure.

### Abort (request and response captured 2026-09-11)

The user captured abort in the same party/game, using client
`web-1.7709-ed0ee1b`:

```http
POST https://gs2.geoguessr.com/82db719412ba42c8a2d388b968781f0e/6aa3ae644f7b00f361d1668f/abort
Content-Type: application/json
X-Client: web-1.7709-ed0ee1b
X-Locale: en

{}
```

The general route is `POST https://gs2.geoguessr.com/<nodeId>/<gameId>/abort`:
there is **no `/game-master` prefix** for this command. The fetch uses
`credentials: "include"`, `mode: "cors"`, and the GeoGuessr website as
referrer. The body is the string `"{}"`. The user confirmed the response is
**204 No Content**, with no response body; do not call `response.json()`.

Earlier abort captures show `DuelAborted`, a finished duel state, the party
returning to `NoGame`, and spectator sockets closing with code 1000 and
reason `"Spectator session ended"` (see the WebSocket table above). Those
provide the expected state flow, but the WebSocket frames accompanying this
specific POST have not been supplied. The route alone does not establish
which roles the server permits to abort, or whether repeated calls are safe.

### Pause, resume and rollback (live-tested 2026-09-11)

Inspected the authenticated Chrome party/spectator client, build
`web-1.7711-e06e090`, then called its game-master routes against the user's
ongoing test duel. Evidence: [`samples/gs2-game-master-control-probe.json`](samples/gs2-game-master-control-probe.json)
contains request/response records, before/after REST states, selected raw
WebSocket messages, and client-source excerpts. No guessed route was needed.

Source: module `227035` in
`/_next/static/chunks/26721-1023828851e88f1b.js`; the controls appear in
`/_next/static/chunks/86824-7ef24f299a82c14c.js`. The inspected controls are
rendered only for `context.type === "WorldLeague"`, explaining their absence
in the party UI, but the routes below worked in this `Party` game.

All requests use session cookies (`credentials: "include"`), JSON content
type, `X-Client: web-1.7711-e06e090`, and `X-Locale: en`:

| POST path after `https://gs2.geoguessr.com/<nodeId>/<gameId>` | Body | Observed response |
|---|---|---|
| `/game-master/pause` | `{"roundNumber": <current round>}` | 204, empty |
| `/game-master/resume-paused-round` | `{"roundNumber": <paused round>}` | 204, empty |
| `/game-master/rollback` | `{"roundNumber": <target round>}` | 204, empty, including an observed no-op |

Test game: `6aa3b7339e4091f7a0872365`, node
`8572118768954f1b877ded5bd7c29b1e`, same party as the user captures above.
It used auto-start rounds, a 60-second max round time, no placed pins or
guesses during the tested rounds, and both teams at 6000 HP.

**Pause holds round resolution, not the running countdown in this test.**
Posting round 7 at 08:17:30.965 UTC emitted `DuelPauseRequested` (version 88)
with `isPaused: false`. The original deadline remained 08:17:45.963 UTC.
At 08:17:46.543 UTC, `DuelRoundPaused` (version 104) had `isPaused: true`,
`hasProcessedRoundTimeout: false`, and results only through round 6. A
second pause on round 8 reproduced this sequence. The client labels this
control "Pause after round" and shows "Game will be paused when round is
over" after requesting it. Do not present it as an immediate timer freeze.

**Resume releases the held result.** Posting `resume-paused-round` for
round 7 emitted `DuelRoundTimedOut` (version 117), cleared `isPaused`, set
`hasProcessedRoundTimeout: true`, and appended round-7 results. The old
round timestamps were unchanged; it did not grant more guessing time.
Auto-start then emitted `DuelNewRound` for round 8 about eight seconds later.
No distinct resume event was observed on the probe spectator socket.

**Rollback worked from a paused state.** The first rollback to round 6,
after resuming round 7 and before auto-starting round 8, returned 204 but
did not roll back: the game proceeded to round 8. After pausing round 8,
the same rollback body returned 204 and:

- Changed `currentRoundNumber` from 8 to 6 and cleared `isPaused`.
- Removed round results from round 6 onward (seven results became five).
- Restored both team multipliers from 4.5 to 3.5. HP stayed 6000, so HP
  restoration after actual damage and guess removal remain untested.
- Reused round 6's panorama and restarted it with a fresh 60-second timer,
  with `startTime` about four seconds after the event.
- Kept the game/node IDs and emitted **`DuelNewRound`**, version 198.
  No `DuelRollbackToRound` event was observed on this socket.

Thus a 204 alone is not evidence that a rollback occurred. Confirm the
target round and reset state in subsequent snapshots. Accept a decreasing
round number when a newer version arrives. The client enables rollback for
paused games, finished games, or resolved rounds with a non-default round
starting behavior; only the paused case was demonstrated to work here.
Finished-game and manual-round rollback behavior remain untested.

The probe opened an additional spectator socket with `SubscribeToLobby` and
15-second heartbeats. Many unrelated `DuelStarted` snapshots arrived during
the experiment; the evidence records their count but omits those repeated
frames. Their cause was not established. The probe socket was closed after
testing; the game was left unpaused, replaying round 6 with auto-start enabled.

### Finding remaining control commands

Capture one host UI action at a time (pause / resume if offered), keeping
both Fetch/XHR requests and WebSocket sent and
received frames. Record the outbound URL/method/body or socket/frame, the
HTTP response or acknowledgement, and the resulting state version/event.
The request's Initiator stack can locate the command builder in the client
bundle; searching loaded sources for `/game-master` can locate its reader.

The existing capture userscript records fetches and both WebSocket
directions. Reload with it enabled before recording, retain the initial
`ws-connect` events to identify sockets, perform one action, then Download.
It does not capture XMLHttpRequest, request headers, or browser-generated
OPTIONS, and only records request bodies supplied as string `init.body`
(not bodies embedded in Request objects). Use Network details to fill those
gaps. Do not infer outbound command names from inbound event names such as
`DuelNewRound` or `DuelRollbackToRound`.

## Open questions

- `DuelRollbackToRound` / `GameAborted` / `LobbyClosed` shapes (not reachable
  from the Presenter Mode UI as of this build).
- Any binary frames (none seen across four duels; everything is JSON text).
