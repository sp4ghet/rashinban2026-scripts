# Map styling handoff

**Updated preference and live verification:** the user explicitly prefers
RASTER, not VECTOR, and changed the in-game rendering setting. During the
new duel on 2026-09-11, all three recovered live maps reported
`renderingType: "RASTER"`, `mapId: "61449c20e7fc278b"`,
`mapTypeId: "roadmap"`, and no local styles array. See
[live-raster-options.json](samples/map-style/live-raster-options.json). Use this as the current reference; the VECTOR
capture below describes the previous setting, not the desired implementation.

For presenter agent `term_205ecdd7-ffe1-4f32-ad37-3e7948c243a9`, in response
to relayed request `msg_149f8cdc59fc`. Orca was unavailable (`orca` command
not recognized), so these files are the authorized file handoff. The original
Orca message could not be read; extraction follows the user-relayed request.

Read-only extraction on 2026-09-11 from the authenticated Chrome party
spectator view, client `web-1.7711-e06e090`. No game-state writes were made
for this extraction. No account credentials or Maps API key are included.

## Actual live configuration

Three recovered Google Maps instances all reported:

- `mapId: "8b406a8de121b3e6"`
- `renderingType: "VECTOR"`
- `mapTypeId: "roadmap"`
- `styles: undefined` (serialized as null with `stylesWasUndefined: true`).
- `isFractionalZoomEnabled: false`
- Strict bounds: south -85, north 85, west -180, east 180.

The shared map factory sets vector map ID `8b406a8de121b3e6`, or raster map
ID `61449c20e7fc278b`, according to the user's rendering preference. It
constructs the map with the map ID and rendering type, then applies common
options via `setOptions`. Instance-specific map ID overrides are supported
by the factory, but the three inspected instances used the default vector ID.

Common options: `disableDefaultUI: true`, `disableDoubleClickZoom: false`,
`draggableCursor: ""`, `draggable: true`, `mapTypeControl: false`,
`gestureHandling: "greedy"`, `clickableIcons: false`, `noClear: true`,
`backgroundColor: "none"`, `mapTypeId: "roadmap"`, `zoom: 1`,
`zoomControl: false`, `scaleControl: false`. Live zoom values were 2, 1, 1;
these are viewport state, not a universal layout requirement.

Map type normalization accepts only `roadmap`, `terrain`, and `hybrid`;
anything else falls back to `roadmap`. Duels callers pass `guessMapType`.

This is evidence for map-ID-based styling, not a local JSON styles array.
The cloud style definition itself was not extracted. Compatibility of these
map IDs with another project's API key has not been tested. Do not substitute
the Street View `poi/labels/off` setting for guess-map styling: that setting
belongs to the panorama options in a separate module.

## Files

- [configuration.json](samples/map-style/configuration.json): normalized live options, exact map factory and map
  type converter source excerpts with chunk URLs, and matching CSS rules.
- [live-map-options.json](samples/map-style/live-map-options.json): initial live instance inspection, including map
  container and ancestor computed CSS. Prefer normalized bounds from
  [configuration.json](samples/map-style/configuration.json) over the Maps-internal bounds representation here.

The expanded results map's container uses a drop shadow, with no color
filter on the inner map. However, both player POV mini-map wrappers
(`player-pov_guessMap__ZIMKc`) reported **`filter: brightness(0.7)`**. This
is relevant when matching the darker mini-map appearance. The full-map
wrapper also applies `backdrop-filter: blur(0.25rem) brightness(0.8)` when
visible; this affects the backdrop, not the map tiles themselves.

Mini-map default CSS: width `15cqw`, margin `1.5cqw`, aspect ratio `4 / 3`,
opacity `0.8`, brightness `0.7`, and child border radius `1.5cqw`. The active
class changes width to `27.5cqw`, brightness to `1`, and opacity to `1`.
The locked-in class sets width and height to `100cqh`, bottom/left to zero,
opacity to 1, and disables transitions. Exact selectors are in the JSON.

The expanded map CSS uses `width: 75svw`, `height: 75svh`,
`border-radius: 5svh`, and a `.75svh` white-40 outline via box shadow.
Layout dimensions and computed radii reflect this browser viewport. Use
the source CSS rules for responsive units rather than copying computed
pixel sizes blindly.

Implementation belongs to `.worktrees/custom-presenter`; this extraction
does not modify that worktree.
