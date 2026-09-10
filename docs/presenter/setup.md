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

Restart NodeCG after changing either config. Authentication failures stop discovery without retrying; update the secret and restart or reconnect after the cookie expires. Network and game-server interruptions retry with bounded backoff while the extension continues polling the party for lobby changes.

## Google player views and results map

Set `presenter.googleMapsApiKey` in the public `cfg/rashinban.json`. Enable billing and the **Maps JavaScript API** on its Google Cloud project. This is a browser key: NodeCG publishes it to the graphic and dashboard. Restrict it to the Maps JavaScript API and HTTP referrers for the exact NodeCG origins used by OBS and preview browsers (including the correct hostname and port, with `/*` for paths). Reload the graphic after restarting NodeCG. The GeoGuessr cookie stays in the separate server-only secret file; never put it beside the browser key.

The dashboard reports loading, API availability, missing-key and exact-panorama failures. “API loaded” means the script loaded; it does not certify that current imagery loaded. Without a key, the scoreboard and keyed cameras remain usable and map/view placeholders remain visible. Chroma replaces both complete player views, while its results map still requires the Google key after reveal.

Rendered MOVE and NM follow each explicitly mapped player's normalized panorama ID, heading, pitch, zoom, map bounds and pin. Rendered NMPZ uses the round's initial panorama and POV exclusively, with two independent fixed map slots. Inactive shared maps retain their geometry and use a subdued border; MOVE/NM maps show when active or sticky. The presenter uses fixed map-window sizes rather than translating the captured game's size presets. Missing player mappings remain blank. Local input is disabled and the native Google attribution area is preserved; map windows leave space above the panorama's lower attribution strip.

Round snapshots in the captured fixtures contain hex-encoded ASCII panorama IDs; movement samples contain plain IDs. The adapter decodes the former and requests `StreetViewService.getPanorama({ pano })`. It requires an exact matching returned ID and never substitutes a nearby coordinate lookup. Missing/expired IDs show “View unavailable.” Results use only the revealed answer and each mapped player's actual best guess; a player without a guess gets no marker. Bounds take the shortest longitude arc across the antimeridian.

**Live compatibility remains pending:** no Google browser key or authenticated party cookie was available during implementation. The encoding conversion and API orchestration have fixture/fake-adapter coverage, but a real test party must confirm exact panorama resolution, POV/zoom fidelity in all three modes, map visibility, attribution, and OBS framing. Captured panorama IDs are not guaranteed to remain valid over time. The adapter uses the supported legacy `Marker` API for simple colored pins without requiring an additional Map ID; Google recommends Advanced Markers for future migration.

Official references checked 2026-09-11: [API setup and key restrictions](https://developers.google.com/maps/documentation/javascript/get-api-key), [one-time script loading](https://developers.google.com/maps/documentation/javascript/load-maps-js-api), [Street View and POV](https://developers.google.com/maps/documentation/javascript/streetview), [navigation and zoom options](https://developers.google.com/maps/documentation/javascript/reference/street-view), [exact panorama lookup](https://developers.google.com/maps/documentation/javascript/reference/street-view-service), [map fitBounds](https://developers.google.com/maps/documentation/javascript/reference/map), [attribution requirements](https://developers.google.com/maps/documentation/javascript/policies), and [Marker support status](https://developers.google.com/maps/documentation/javascript/reference/marker).
