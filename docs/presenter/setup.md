# Presenter connection setup

The presenter extension reads GeoGuessr spectator state with the signed-in account's `_ncfa` cookie. It only observes the party and duel; start rounds and perform all game-control actions in GeoGuessr.

## Public NodeCG config

Copy `cfg/rashinban.example.json` to `cfg/rashinban.json`, then set:

- `partyId` to the broadcast party ID, or leave it `null` to use the signed-in account's active party.
- `clientVersion` to the current GeoGuessr web client version. The checked-in value matches the protocol capture and may need updating when GeoGuessr changes its client.
- `cookieFile` to the secret file path, resolved from the NodeCG working directory.

`cfg/rashinban.json` is injected into dashboard and graphic pages by NodeCG. It is ignored by Git and must contain only these public settings. Never add the cookie to this file.

## Server-only credential

Create `.secrets/geoguessr.json` in the repository root with this shape:

```json
{
  "cookie": ""
}
```

Paste only the `_ncfa` cookie value between the quotes. The `.secrets/` directory is ignored by Git, and the extension process reads this file directly. Keep the file local to the NodeCG host and restrict access to the account running NodeCG.

As an alternative, set the `GEOGUESSR_NCFA` environment variable for the NodeCG process. That variable takes precedence over `cookieFile`.

Restart NodeCG after changing public config. Reconnect reloads the server-only secret file, so a replacement cookie does not require a process restart. If `GEOGUESSR_NCFA` is set, update that process environment and restart because it takes precedence over the file. Authentication failures stop discovery without retrying. Network and game-server interruptions retry with bounded backoff while the extension continues polling the party for lobby changes.

## Operator startup and recovery

Run `npm run build` and `npm start`, then open `http://localhost:9090/` and the
**Duels Presenter** panel. Add the program and audio URLs from [OBS setup](obs.md).
Use [media selection](media.md) to load assets, then verify readiness and the
program/audio owner before showing the output.

Choose **Input mode** in the dashboard, then apply the source. No restart is
needed to switch between Replay and Live. Replay uses Full duel, Manual rounds,
Maximum round time, or Aborted game fixtures and never opens a live connection.
The live broadcast field remains visible and is enabled when Live is selected.
Public `presenter.input` sets the startup default, restored on NodeCG restart.
Commands without an explicit `input` use the running mode; party requests in
replay and fixture requests in live remain rejected. An explicit mode change
validates the complete request (and reads a requested replay fixture) before
stopping the running source.

Choose Live, enter a **Live broadcast URL or party ID**, then click
**Apply live / reconnect spectator**. Broadcast URLs must have the exact form
`https://www.geoguessr.com/party/broadcast/<partyId>` with no query or fragment.
Only the party ID is extracted; the extension never fetches the supplied URL.
Blank or whitespace selects automatic active-party discovery. IDs accept
letters, digits, underscores and hyphens, up to 128 characters. Invalid values
are rejected before stopping the current connection. The panel shows selected,
configured-default and connected party identities separately; status updates
do not overwrite an unsaved draft. Selection is a session override. A reconnect
request without a selector retains it; a NodeCG restart restores the public
config default. Mode switches also clear the previous source's connection
identity and error state.

If the signed-in account has no active party, discovery returns HTTP 204.
The presenter shows disconnected with no game and no error, then polls every
five seconds so joining a party later connects automatically. This is a normal
waiting state, distinct from an interrupted request or expired authentication.

Enter competitor names/handles and wins, map the GeoGuessr player IDs to left
and right, then **Apply series**. **Swap sides** swaps the draft; apply it to
publish. Wins are integers 0–2 and never increment from duel results. To reset
a series, enter new identities/mappings and set both wins to zero, then apply.
New lobbies and NodeCG restarts preserve the saved series; remap player IDs
when needed. Unequal damage multipliers are labeled L/R in the center and
follow this mapping, including the multiplier of the displayed result round.

Choose **Chroma** or **Rendered** and green or magenta, then **Apply
presentation**. Change the corresponding OBS regional filters/composition too.
Rendered view failures preserve the scoreboard and cameras; chroma provides
the fallback for both complete player views. The rendered results map still
requires a valid Google key.

Keep game control in GeoGuessr: start the next round manually there. During
data loss, the last accepted state remains visible and connection status
reports stale/reconnecting. A timer reaching zero does not invent a result.
Reconnection replaces state without replaying historical celebrations; a new
round cancels an unfinished old effect. Host abort shows **GAME ABORTED** and
does not increment series wins. A new lobby preserves wins while replacing
duel state. For audio failures, use the local activation and ownership checks
in [OBS setup](obs.md).

## Google player views and results map

The dashboard's **Google Maps & Street View setup** notice checks whether a
browser key is configured and shows the current origin's referrer pattern.
A missing key prevents rendered Street View and maps even when replay data is
arriving correctly. This is independent of loading a fixture or mapping players.

Set `presenter.googleMapsApiKey` in the public `cfg/rashinban.json`. Enable billing and the **Maps JavaScript API** on its Google Cloud project. This is a browser key: NodeCG publishes it to the graphic and dashboard. Restrict it to the Maps JavaScript API and HTTP referrers for the exact NodeCG origins used by OBS and preview browsers (including the correct hostname and port, with `/*` for paths). Reload the graphic after restarting NodeCG. The GeoGuessr cookie stays in the separate server-only secret file; never put it beside the browser key.

The dashboard reports loading, API availability, missing-key and exact-panorama failures. “API loaded” means the script loaded; it does not certify that current imagery loaded. Without a key, the scoreboard and keyed cameras remain usable and map/view placeholders remain visible. Chroma replaces both complete player views, while its results map still requires the Google key after reveal.

Rendered MOVE and NM follow each explicitly mapped player's normalized panorama ID, heading, pitch, zoom, map bounds and pin. Rendered NMPZ uses the round's initial panorama and POV exclusively, with two independent map slots. Every mapped player's minimap remains visible during live play: inactive maps are 265 by 170 pixels and active or sticky maps expand to 420 by 280 pixels within the player window. Google receives resize and bounds updates when a map expands or collapses. Missing player mappings remain blank. Local input is disabled and the native Google attribution area is preserved; map windows leave space above the panorama's lower attribution strip.

Google map and panorama objects persist per slot across rounds and phases. Known current-round panorama IDs prepare while the corresponding views are hidden during pre-round, result and host-wait phases; they become visible only when that round is live. The captured protocol does not supply unknown future-round IDs, so preparation starts only when the new snapshot arrives. Panorama changes within the same player's round keep the last exact scene while the next exact lookup resolves, without applying the pending view's POV to the old scene. New game, round or side mapping identities hide old imagery. Loading and lookup-failure text stays off the program graphic; errors remain in the dashboard.

Incoming heading, pitch and zoom changes within the same live panorama interpolate over 200 ms using monotonic frame time. Heading follows the shortest arc across north. A newer target continues from the currently interpolated pose; repeated unchanged telemetry does not restart the motion. First load, panorama/identity changes, hidden preparation/reentry and frame gaps over 500 ms snap to the current pose. Settled views stop writing redundant Google POV/zoom updates. This adds no telemetry buffer or game-timeline delay, does not animate map movement, and preserves NMPZ's fixed round POV.

Round snapshots in the captured fixtures contain hex-encoded ASCII panorama IDs; movement samples contain plain IDs. The adapter decodes the former and requests `StreetViewService.getPanorama({ pano })`. It requires an exact matching returned ID and never substitutes a nearby coordinate lookup. Missing/expired IDs report panorama errors to the dashboard. Results use only the revealed answer and each mapped player's actual best guess; a player without a guess gets no marker. Bounds take the shortest longitude arc across the antimeridian.

**Live compatibility remains pending:** no Google browser key or authenticated party cookie was available during implementation. The encoding conversion and API orchestration have fixture/fake-adapter coverage, but a real test party must confirm exact panorama resolution, POV/zoom fidelity in all three modes, map visibility, attribution, and OBS framing. Captured panorama IDs are not guaranteed to remain valid over time. The adapter uses the supported legacy `Marker` API for simple colored pins without requiring an additional Map ID; Google recommends Advanced Markers for future migration.

Official references checked 2026-09-11: [API setup and key restrictions](https://developers.google.com/maps/documentation/javascript/get-api-key), [one-time script loading](https://developers.google.com/maps/documentation/javascript/load-maps-js-api), [Street View and POV](https://developers.google.com/maps/documentation/javascript/streetview), [navigation and zoom options](https://developers.google.com/maps/documentation/javascript/reference/street-view), [exact panorama lookup](https://developers.google.com/maps/documentation/javascript/reference/street-view-service), [map fitBounds](https://developers.google.com/maps/documentation/javascript/reference/map), [attribution requirements](https://developers.google.com/maps/documentation/javascript/policies), and [Marker support status](https://developers.google.com/maps/documentation/javascript/reference/marker).
