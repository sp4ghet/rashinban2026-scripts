# Party manager

The NodeCG **Party** tab controls the GeoGuessr party associated with the existing server account. Rebuild and restart NodeCG after installing this change so the new fullbleed dashboard tab is registered.

## Broadcast workflow

1. Open or create the party in GeoGuessr using the account configured by `GEOGUESSR_NCFA`. In **Party**, choose **Connect live party**; a blank ID discovers that account's active party. This shares the presenter's party selection. Replay disables remote commands.
2. Check host identity and the roster. Bench/activate players, swap positions, or assign Blue/Red teams. For 1v1, roster order determines the two player slots; swapping an active player with a benched player replaces the slot. **In lobby** means present and no longer in a game/results screen. **In game / results**, **In current duel**, and **Away** distinguish the other states. Starting waits for every selected player to return to the lobby; benched members and the game master do not block it.
3. Edit and apply **Next duel settings**. Map IDs and exact `https://www.geoguessr.com/maps/<id>` URLs are accepted. Multiplier increments are displayed in units of ×; the server stores tenths. Fields unrelated to the edits are preserved. Concurrent settings changes require reloading the draft.
4. **Start duel** creates the game. With automatic rounds disabled, **Start round 1** begins play; **Start round N** advances after the preceding result. Starting is disabled while a settings draft is unsaved.
5. **Pause after round** requests a hold at the round deadline. It does not freeze the current countdown. **Release held result** lets the result resolve without adding guess time. **Roll back** is available while paused, reuses the target round's location, and requires confirmation.
6. **Abort duel** returns the party to the lobby. This is useful when Pinpointing/custom scoring finishes before the native GeoGuessr game. The tab shows a warning when the presenter's finished state and the server's ongoing state differ.

Roster and settings changes are restricted to between games. Moderation includes kick, ban/unban, mute/unmute, and eligible host transfer. Transfer removes this account's ability to manage the party. Team Duels can be controlled here, but the existing broadcast presenter supports two single-player teams only.

Join codes are under **Join info**. The manager does not manage public/community discovery, account login, chat composition, or party deletion; those remain in the native GeoGuessr lobby.

**Party chat** sits beside Live duel (below it on narrow screens). It shows live text and emotes with sender names and timestamps, retaining the latest 200 messages while NodeCG is running. It follows new messages when scrolled to the bottom; scrolling up keeps your place. Chat is read only; send messages from GeoGuessr. Players & bench is below Next duel settings, immediately above Recent commands.

Chat starts when the selected live party connects. GeoGuessr does not supply older messages through this subscription, and messages sent during a disconnection may be missed. Connection, disabled-chat, and access-denied states appear in the card. Changing parties or entering replay clears the feed. In-game messages arrive here when GeoGuessr routes them to party chat; isolated in-game chat is separate. The chat token and account cookie stay on the server, and the feed is not persisted to disk.

## Match Score

**Match Score** edits the saved Current Match scores (formerly Series wins). **Shared > Current Match** shows the score in its summary; score editing lives here in Party. Enter whole numbers from 0 to 2 and choose **Apply Match Score**, or press **+1** beside a player to save an increment immediately. **Reset to 0–0** saves both scores together. These controls do not change GeoGuessr's in-game points or health.

Remote score changes appear automatically when there are no unsaved edits. If another operator changes Current Match while a score draft is open, use **Discard score edits** before continuing.

## Between-game stream view

The **Live duel** card includes **Before-Game** and **End-of-Last-Game** controls for the stream presenter. Before-Game shows both cameras; End-of-Last-Game restores the last result for the current matchup and is unavailable until a game has completed. Gameplay takes priority over the selected between-game view. Input source and Pinpointing Duels configuration are in **Config > Duel Setup**.

## Tournament presets

In **Next duel settings**, choose a preset from **Day 1** or **Day 2**. Selecting it immediately replaces the editable draft with that preset's settings. Review it and choose **Apply settings & rules** before starting the duel. Every preset selects 1v1 Duels, enables game master, resets per-team HP overrides, and enables **Half tie range**. Automatic round starts, party access, and unrelated presenter settings are preserved. BO3 series wins remain manual. To discard a draft and select the same preset again, use **Reload current settings**, then reselect the preset.

| Day | Mode | Maps |
| --- | --- | --- |
| 1 | Move (health duel) | A Moving World |
| 1 | NoMove | A Pro World |
| 1 | NMPZ | An Arbitrary Rural World |
| 2 | Move (Pinpointing Duels) | A 5kable World; A Moving World; An Arbitrary Rural Intersectionguessr |
| 2 | NoMove | An Official World; A Pro World; GeoGuessr Saturday |
| 2 | NMPZ | An Arbitrary Rural World; Rainbolt World; A Rural World |

| Setting | Day 1, and Day 2 NoMove/NMPZ | Day 2 Move |
| --- | --- | --- |
| Timer after guess | 15 seconds | 90 seconds |
| Max round time | 60 seconds | 90 seconds |
| Max rounds | 50 | 50 |
| Initial health | 5,000 | 1,000,000 |
| Mutual multiplier increment | +0.0× | +0.0× |
| Individual multiplier increment | +0.5× | +0.0× |
| Rounds without multipliers | 1 | 0 |
| Presenter scoring | Health, Half tie range | Pinpointing, Half tie range |

Half tie range is `(5000 − higher round score) / 2`. A score difference at or below that threshold increments both players' individual multipliers in health duels. In Pinpointing it awards neither player a point, except that double-5000 rounds use the existing fastest-5K rule. The rules captured for an existing duel remain unchanged.

Preset application confirms GeoGuessr's settings before saving and verifying the effective presenter rules. A concurrent configuration edit invalidates the draft. If GeoGuessr applies the settings but the presenter save fails, becomes stale, or is masked by a launch configuration override, the command stays **uncertain** and starting remains blocked. Inspect presenter configuration and both settings, clear the pending command, then reload and apply the preset again. Loading or applying a preset never starts a game.

Map IDs are maintained in [`src/party/presets.ts`](../../bundles/rashinban/src/party/presets.ts), including the supplied A Moving World ID `696fe47c5b07bed052077a95`.

After updating the party manager, restart NodeCG and reload the dashboard. `npm run dev` rebuilds extension files but does not reload the running extension. An older server can reject a newer preset command with **Unexpected command field**. The dashboard displays NodeCG's specific rejection message and retains the draft for review.

## Dashboard scoring

The Party tab follows the presenter's rules captured for the current duel. With **Tie range** enabled it shows the presenter's custom HP and multipliers. With **Pinpointing Duels** enabled it shows points out of seven, match point, the latest settled round's verdict, and the winner. Both rules can be enabled together. Settled totals come directly from the presenter, independent of the graphic's animation timing; the dashboard does not recalculate them or change series wins.

The rule label separates **Active duel** from different settings saved for the **Next duel**. Change the rules through a tournament preset or the existing presenter controls. Native GeoGuessr HP remains available under **Game details**. Team Duels continues to show explicitly labeled native HP because presenter custom scoring supports 1v1 only.

Custom totals stay visible after the native duel is aborted, provided the retained result belongs to the same party. Aborting before a custom outcome shows **Duel aborted**, without treating GeoGuessr's abort winner as a custom winner. Starting another game or switching parties clears that retained result. Missing calculations, mismatched game data, or a rollback that the presenter has not yet processed display unavailable scores instead of substituting native HP. An early native finish warns when neither player reached seven points.

### Live round prediction

During a live 1v1 round, **Round prediction** shows each player's round score and projected HP or Pinpointing total. Both players must have a current pin or locked guess before the cards show **Predicted win/loss** or **Duel continues**. Moving a pin updates the forecast. An approximate score (`≈`) comes from the pin position, answer coordinates and map scoring scale; **Guess locked** uses GeoGuessr's supplied score.

Health forecasts use the active presenter's HP and the higher-scoring player's current multiplier, with the same half-even damage rounding as settled scoring. Half/Full tie range affects subsequent multiplier increments; it does not cancel current damage. Pinpointing forecasts reuse the seven-point scoring rules and captured tie range. Double-5000 rounds wait for both guesses to lock before predicting the fastest-5K point. The native health round limit is also considered; a Pinpointing round limit without a seven-point winner is explicitly unresolved.

Predictions are conditional on the pins holding. They do not change settled totals, series wins, broadcast graphics or game controls. Stale/disconnected data, different game/round identities, rollback lag and settled rounds suppress the forecast. Missing map scale cannot produce an unsubmitted pin estimate. Native health duels with healing enabled do not show a forecast; tournament presets disable healing.

## Command outcomes and recovery

The server serializes commands and checks the selected party against the authenticated account's active party immediately before a write. Commands include the expected party, game and round. Settings also carry a revision. Unexpected state changes reject the operation before sending it.

An HTTP success means **accepted**. Only subsequent authoritative state can make a command **confirmed**. A pause may remain accepted until its round deadline; **Abort duel** can explicitly supersede that pause request. After an unconfirmed timeout, or an ambiguous transport failure, the command remains **uncertain** and blocks other writes. Inspect the live state, refresh, then use **State checked — clear pending** to acknowledge that uncertainty. This never retries or undoes the operation. Definite HTTP rejections are reported as failed. Neither automatic polling nor reconnect resubmits a write. Reconnecting changes the control token, invalidating commands from the previous connection even when reconnecting to the same party.

State is polled every 2.5 seconds, with a fresh read before each command. Timers interpolate the server deadline using the GeoGuessr server-clock offset. Unavailable/stale state disables controls. The manager publishes the roster, selected settings, current duel summary and command outcomes; a separate nonpersistent `partyChat` Replicant receives sanitized chat messages over the site WebSocket. Cookies, chat access tokens, guesses' coordinates and future panoramas are not published.

The activity list and pending-command lock are in memory. After restarting NodeCG, inspect the party before sending a new command. HTTP requests cannot atomically bind the website's session-scoped mutation to the preceding read; avoid simultaneously operating the same party from multiple controllers.

## Protocol refresh: 2026-10-13

Existing live-capture evidence for settings, start, next round, pause, resume, abort and rollback is in [presenter-protocol.md](presenter-protocol.md). The current public client, build `1.8333-9f74695`, was also inspected:

- [Party client and roster helpers](https://www.geoguessr.com/_next/static/chunks/83037-13bafb3db2125ba8.js)
- [Game-master controls](https://www.geoguessr.com/_next/static/chunks/53143-bb196420d2aaaf02.js)
- [Lobby rendering and presence](https://www.geoguessr.com/_next/static/chunks/pages/party/%5B%5B...slug%5D%5D-b215b52ea4913262.js)

These are **source-confirmed routes**, not a record of live mutation tests on that build. All party paths below are relative to `https://www.geoguessr.com/api/v4/parties/v2`.

| Operation | Method and path | Body |
| --- | --- | --- |
| Active party | GET `/active` | none; 204 means no active party |
| Selected party | GET `/<partyId>` | none |
| Roster | GET `/members?page=0&count=100` | none; response `members`, `totalCount`, paginate as needed |
| Swap member positions | PUT `/member/<userId>/move` | `{ secondMemberId }` |
| Bench | PUT `/member/<userId>/bench` | none |
| Unbench | DELETE `/member/<userId>/bench` | none |
| Assign team | PUT `/team` | `{ userId, teamName }` |
| Kick | DELETE `/member/<userId>/kick` | none |
| Ban | DELETE `/member/<userId>/ban` | none |
| Unban | PUT `/unban/<userId>` | none |
| Mute | PUT `/member/<userId>/mute` | none |
| Unmute | DELETE `/member/<userId>/mute` | none |
| Transfer host | PUT `/change-owner/<userId>` | none |
| Save combined settings | PUT `/all-settings` | `{ gameType, gameSettings, settings }` |
| Start duel | POST `/start-game` | `{}` as in the prior captured request |

Party settings are returned as `partySettings`, but written as `settings` in the combined request. Roster operations are account-session scoped; they do not contain a party ID. Member fields include `isBenched`, `benchReason`, `team`, `isPresent`, `isInCurrentGame`, and `isEligibleAsOwner`. The current client's roster helpers distinguish explicit benching, a full roster, and the game master's non-playing slot.

Lobby presence also depends on `isPlaying`. GeoGuessr's lobby renders absent/translucent avatars when `!isPresent || isPlaying`. A read-only follow-up capture on 2026-10-13 reproduced the reported translucent player with party `gameState: Finished`, `isPresent: true`, `isPlaying: true`, and `isInCurrentGame: false`; the other player already in the lobby had `isPlaying: false`. Therefore `isPresent` alone does not indicate lobby readiness, and `isInCurrentGame` alone cannot identify someone still viewing results. The API does not distinguish the precise game/results screen, so the dashboard uses a combined label.

The current game-master source still uses `pause`, `resume-paused-round`, `rollback`, and `start-next-round` under the node/game-specific `/game-master/` path. The manager uses the captured `/abort` route. HTTP 204 has no JSON body. Rollback confirmation checks a newer state version, the target round, cleared pause, and an unresolved round with a start timestamp. Restoring HP after actual damage remains a live validation item inherited from the protocol research.

## Validation

- `npm test` includes `src/party/tests/*.test.ts`: identity/permission/replay guards, preserved settings, stale drafts, duplicate writes, ambiguous outcomes, 204 responses, rollback, roster confirmation, presenter scoring, next-duel settings, retained-result identity, all twelve tournament presets, and partial preset-save failures.
- `npm run typecheck` and `npm run build` check registration and browser/server compilation.
- `npm run validate:party` launches isolated headless Chrome against the real manager and a fixture GeoGuessr API. It exercises preset loading/application, Half tie range, Pinpointing switching, concurrent configuration edits, dashboard settings, duel and round starts, pause/resume, rollback, abort, benching, external draft conflicts, uncertainty acknowledgement, replay and mobile layout. It also publishes real presenter derivations to check custom HP/points, active versus next rules, unavailable scores, and retaining the winner after abort. Screenshots are written to `artifacts/party-manager/`.
- Read-only live check on 2026-10-13: configured account's `/active` returned 204 (no party). No live party was created or modified during validation. Perform a private-party rehearsal before broadcast to validate current roster semantics, settings persistence, team mode and host permissions against the live service.
- Round-prediction tests cover missing/current/locked pins, recorded coordinate-to-score calculations, lethal damage rounding, active rules, HP round limits, Pinpointing finishes, stale feeds and settled/rollback suppression. Browser validation checks pin-driven knockout/continue transitions, Pinpointing projections, stale-feed expiry, settled-round clearing, and desktop/mobile layouts without changing settled totals or sending game commands.
- After the operator created a test party, a read-only roster check confirmed the presence mismatch above. Regression tests cover next-game blocking and returning to the lobby for Duels and Team Duels; browser validation checks the labels and Start duel control. No live mutation was sent.
