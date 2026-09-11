# GeoGuessr map color provenance

Read-only inspection of the GeoGuessr party spectator view on 2026-09-11
at 08:25:39 UTC, client `web-1.7711-e06e090`, recovered three live Google Maps
instances with the same public configuration:

| Property | Observed value |
| --- | --- |
| Map ID | `8b406a8de121b3e6` |
| Rendering type | `VECTOR` |
| Map type | `roadmap` |
| Fractional zoom enabled | `false` |
| Inline `styles` | `undefined` |

The public client map factory also selected this ID for vector maps. These
settings are now the presenter's default for both player minimaps and the
results map, matching the observed GeoGuessr tile colors. The cloud style JSON
was not extracted: the public map ID resolves to an externally managed Google
cloud style, whose appearance can change upstream.

The inspection handoff was `docs/geoguessr/samples/map-style/README.md` and
`configuration.json` in the main checkout. This document preserves the compact
sanitized findings; source bundle excerpts and browser dumps are not copied.
No GeoGuessr API key, cookie, or account credentials are included or reused.
The presenter continues loading Google Maps with the operator's own configured
browser API key. That key successfully rendered this vector map ID in local
browser QA using the presenter's quarterly Maps JavaScript API loader.

Only map rendering/style options are adopted. The presenter retains its own
inert controls, attribution, map rectangles, camera behavior and result overlays.
