# GeoGuessr map color provenance

The user selected raster rendering in GeoGuessr. Read-only inspection of the
party spectator view on 2026-09-11 at 08:34:46 UTC recovered three live Google
Maps instances with the same public configuration:

| Property | Observed value |
| --- | --- |
| Map ID | `61449c20e7fc278b` |
| Rendering type | `RASTER` |
| Map type | `roadmap` |
| Inline `styles` | No local styles array |

The public client map factory also selected this ID for raster maps. These
settings are now the presenter's default for both player minimaps and the
results map, matching the observed GeoGuessr tile colors. The cloud style JSON
was not extracted: the public map ID resolves to an externally managed Google
cloud style, whose appearance can change upstream.

The current inspection handoff is `docs/geoguessr/samples/map-style/README.md`
and `live-raster-options.json` in the main checkout. The earlier factory
capture was client `web-1.7711-e06e090`. This document preserves the compact
sanitized findings; source bundle excerpts and browser dumps are not copied.
No GeoGuessr API key, cookie, or account credentials are included or reused.
The presenter continues loading Google Maps with the operator's own configured
browser API key and the quarterly Maps JavaScript API loader.

Only map rendering/style options are adopted. The presenter retains its own
inert controls, integer zoom, attribution, map rectangles, camera behavior and
result overlays.
