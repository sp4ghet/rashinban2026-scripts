# OBS composition and audio

Create the browser sources at **1920 × 1080, 60 fps**. The local validation
uses OBS 32.2.2; repeat acceptance on the broadcast machine with its real
feeds and media. See [validation](validation.md) for measured results and
remaining external checks.

| Source | URL |
| --- | --- |
| Program | `http://localhost:9090/bundles/rashinban/graphics/presenter.html?role=program` |
| Separate audio | `http://localhost:9090/bundles/rashinban/graphics/presenter-audio.html?role=audio` |
| Silent browser preview | `http://localhost:9090/bundles/rashinban/graphics/presenter.html?role=preview` |

Disable **Shutdown source when not visible** and **Refresh browser when scene
becomes active**. Reuse one program Browser Source through nested scenes;
creating another Browser Source creates another program candidate. The dashboard
shows the current owner and supports explicit transfer. A disconnected owner
expires after six seconds.

## Fixed rectangles

Coordinates are canvas pixels, measured from the final `presenter.css` and
verified in a 1920 × 1080 browser. Bounds include the colored border.

| Region | x | y | width | height |
| --- | ---: | ---: | ---: | ---: |
| Left whole player feed | 40 | 270 | 910 | 512 |
| Right whole player feed | 970 | 270 | 910 | 512 |
| Left camera | 60 | 848 | 340 | 192 |
| Right camera | 1520 | 848 | 340 | 192 |
| Shared rendered NMPZ panorama | 40 | 270 | 1840 | 512 |
| Results map | 460 | 278 | 1000 | 520 |

Fit and crop each external feed below its assigned rectangle, including its
panorama and guess map. Feed content must not extend into another region.
The four-pixel presenter border and rounded corners cover the crop edge.
Do not reserve avatar space. Cameras stay in the same rectangles during
live gameplay and results.

## Regional keying and phase changes

A chroma key on the entire presenter removes matching pixels from maps,
graphics and celebration videos. Use the following OBS scene graph instead:

1. Place cropped external player feeds and cameras at the bottom.
2. Add an unfiltered safe-area scene made from transform-cropped instances of
   the shared presenter. Its pieces cover everything outside the active key
   rectangles. A static alpha mask is also suitable for this safe-area layer.
3. For each active rectangle, put another cropped instance of the same
   presenter in its own nested scene. Apply the Chroma Key filter to that
   nested scene, not to the shared Browser Source. This preserves the lock
   badge and timer portions inside a feed window.
4. Place those keyed regional scenes above the external feeds and safe areas.

For a rectangle `(x, y, width, height)`, set the source transform crop to
left `x`, top `y`, right `1920-x-width`, bottom `1080-y-height`, and position
the cropped item at `(x, y)`. Keep scale at 1. Use green or custom magenta
consistently with the dashboard's global key color. Final presenter QA used:

| Key color | Similarity | Smoothness | Spill |
| --- | ---: | ---: | ---: |
| Green | 400 | 80 | 100 |
| Custom magenta (`#ff00ff`) | 250 | 80 | 100 |

Exact-color-only thresholds left colored halos where CSS shadows darken the
slot. Similarity 400 on magenta removed red borders and part of the purple
timer edge; 250 preserved those edges in the final OBS capture. Tune against
the intended feeds while keeping these filters confined to their regions.

| Presenter content | Active composition |
| --- | --- |
| Live chroma, any movement mode | Key both whole player rectangles and both cameras; show the matching external inputs. |
| Rendered gameplay or round results | Keep player/map areas unfiltered; hide external player feeds; key cameras only. |
| Full-screen single/double 5K | Show one full unfiltered presenter above everything; hide keyed regional layers and external inputs. |

The same phase choices are required when changing scenes or groups. The
presenter does **not** operate OBS visibility automatically. Prepare operator
scene actions or your own external phase automation before use. A static
four-hole mask alone removes in-slot locks/timers and cannot safely display
5K over the cameras. The local acceptance switches these compositions using
test-only obs-websocket commands; those commands are not a production bridge.

## Audio ownership and recovery

Keep the same separate audio source active in every broadcast scene. Enable
OBS browser audio routing, use one recording/output track, and disable audio
monitoring unless deliberately routed. Mute GeoGuessr, captured player feeds,
and any duplicate browser audio paths. Start with zero OBS sync offset and
measure the resulting recording before applying compensation.

**Local audio limitation:** this OBS/CEF setup lost 50 ms cues after silence
even though the real audio clock advanced and all cue nodes were scheduled.
Embedded output did not cure that silent-source behavior. Continuous nonzero
authored music restored all tested clicks. Cue-only operation, muting/unmuting
from prolonged silence, and the final assets require further acceptance;
do not treat them as validated by the continuous-music run. The product does
not inject a hidden tone or alter supplied stems.

The local continuous-music test required a **90 ms Render Delay** (`gpu_delay`)
on the shared program Browser Source, with both audio sync offsets at zero.
This added video latency aligned recorded flashes/clicks in the short samples;
negative audio sync offset did not advance this late capture. Apply any measured
video delay consistently to the relevant composition, including external feeds
and cameras as needed, and remeasure on the event machine. This value is not
a universal preset. The full recording results are in [validation](validation.md).

Select **Separate** in the dashboard for the persistent audio source. Select
**Embedded** to move music and cue ownership into the active program source.
The old owner stops and acknowledges silence before the new owner activates;
an unavailable old owner falls back to lease expiry. Brief silence during a
handoff is expected. Reloading rejoins music phase and skips expired cues.

Video soundtrack ownership is separate: **Embedded in video** plays on the
active program even in separate audio mode; **Separate five-k cue** mutes the
video and uses the audio owner; **Silent** uses neither. Configure exactly one
soundtrack owner. See [media](media.md).

If audio reports suspended, append `&audioUnlock=1` to its active URL and use
OBS's browser **Interact** window to click **Enable audio in this browser**.
Verify the owner reports ready or partial and check the OBS meter. A click in
the dashboard cannot activate a different browser. Missing assets report
their IDs and leave valid assets usable; the default empty manifest is silent.

If separate-source alignment fails the ±50 ms/no-drift acceptance, choose
embedded output and repeat the full measurement, refresh and scene tests.
Do not infer synchronization from a moving meter or a short successful clip.
