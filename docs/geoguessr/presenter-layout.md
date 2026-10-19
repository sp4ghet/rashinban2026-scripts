# Presenter broadcast layout

The presenter uses a fixed 1920 × 1080 canvas. Round, game, series score,
and mode sit at the top; each player's multiplier appears on their side.
Names and HP sit beside the bottom-corner cameras. RASHINBAN artwork is
dimmed behind the feeds to keep the game and status text legible.

Positions below describe the outer frames in pixels. Player and preview
borders are drawn over the viewport, so their image content also stays 16:9.

| Frame | Left, top | Width × height |
| --- | --- | --- |
| Left camera | 60, 756 | 360 × 260 |
| Right camera | 1500, 756 | 360 × 260 |
| Left feed, dual | 28, 180 | 922 × 518.625 |
| Right feed, dual | 970, 180 | 922 × 518.625 |
| Shared panorama | 28, 116 | 1864 × 666 |
| Round preview | 256, 144 | 1408 × 792 |
| Results map | 160, 218 | 1600 × 650 |
| Active left feed after right locks | 28, 116 | 1184 × 666 |
| Locked right map | 1232, 263.375 | 660 × 371.25 |
| Locked left map | 28, 263.375 | 660 × 371.25 |
| Active right feed after left locks | 708, 116 | 1184 × 666 |
| Timer | 876, 790 | 168 × 168 |

Camera and player feed borders are 4 px. Reposition external camera and
chroma capture sources to match these frames when updating the OBS scene.
Rendered game views continue to resize automatically. The asymmetric
locked layout applies to rendered and video views; chroma mode keeps equal
feeds. Video frames preserve 16:9 throughout their width transition. The
timer has one fixed anchor for dual, shared, and locked layouts.

The timer uses plain, centered Kaneda Gothic numerals from the shared Adobe
Fonts kit, with local Oswald as the offline fallback. It shows seconds through
the final minute, with a radial tick dial that clears clockwise from the top,
derived from the authoritative deadline and timer start. It switches to
larger gold numerals for the final ten seconds. First-guess shortening and
late attachment use the same deadline as the digits. Review/pause and
non-live scenes hide it.

## LED output

Only the top 1920 × 576 is shown. The designer's 75px header remains in
every phase: red left player, blue right player, outer HP bars, series wins
beside the central white game-mode panel. HP retains its rounded, skewed
component and fill direction. Round/game counters remain bound in the DOM
but are hidden in this header. Damage badges sit at the outer edges at y=133.

All live modes, including rendered NMPZ, use two equal edge-to-edge views:

| Frame | Left, top | Width × height |
| --- | --- | --- |
| Left player, including locked map | 0, 75 | 960 × 501 |
| Right player, including locked map | 960, 75 | 960 × 501 |
| Timer | 862.5, 286.5 | 195 × 78 |
| Round preview | 514.667, 75 | 890.667 × 501 |
| Results map | 460, 104 | 1000 × 460 |

Locking replaces the player's view with a map inside the same frame. Video
fills each viewport with a centered crop. External chroma sources need to
be aligned to these bounds in OBS. Both NMPZ panoramas use the round's fixed
spawn camera, ignoring per-player POV telemetry.

The LED reuses the stream's 195 × 78 pill timer, centered over the gameplay
seam. Both outputs share `presenter-timer.css` and deadline-derived `mm:ss`
formatting, clockwise progress, and the red final fifteen seconds. Pauses
and non-live scenes hide the timer. The retained gameplay stays in this
layout until results reveal. Round preview fills the entire 501px height
below the header, centered at 16:9. Scoring keeps its existing main-section
geometry beneath the new header.

Before-game and after-game views show the relayed player cameras in an equal
50/50 split. Each camera is 960 × 540 at y=36, retaining 16:9 and ending at
y=576; the persistent 75px header covers the upper 39px. The seam reuses the
stream's 10px red divider and centered compass. Player identities remain in
the header, with no names in the lower corners, winner-size changes, or damage
badges over the cameras. The same video elements remain connected through
phase changes, and cameras are hidden during gameplay, preview and scoring.

`?videoRelay=main` receives gameplay and cameras over one connection. A plain
LED URL receives only the two cameras from relay room `main`, while keeping
its existing local gameplay inputs. LED cameras are silent, do not take the
stream program lease, and remain inactive in preview URLs. Assign cameras
once on the capture page, as described in [video inputs](../presenter/video-inputs.md#player-cameras-through-the-same-relay).

The game number is derived from the manually maintained series wins:
left wins + right wins + 1. Keep wins at the completed-game total while
the current game's results are on screen. Draws and replayed games are
not represented separately by the existing series model.

Layout validation uses `scripts/validate-presenter-motion.mjs`: the actual
built pages with isolated NodeCG state and a controlled monotonic clock.
It checks 48 combinations of output, NM/NMPZ, source, and lock state,
plus preview dimensions and scoring impact continuity. Screenshots and
reports are saved under `artifacts/presenter-validation/motion/`.
`scripts/validate-presenter-video.mjs` also verifies the new bounds with
two simulated video inputs. Live Google imagery, OBS capture alignment,
and physical LED hardware are outside these checks.
