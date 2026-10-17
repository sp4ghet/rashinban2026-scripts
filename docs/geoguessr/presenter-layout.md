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

Only the top 1920 × 576 is shown. Names, HP and match status remain in the
top band. All live modes, including rendered NMPZ, use two equal views:

| Frame | Left, top | Width × height |
| --- | --- | --- |
| Left player, including locked map | 16, 109 | 800 × 450 |
| Right player, including locked map | 1104, 109 | 800 × 450 |
| Timer | 848, 222 | 224 × 224 |
| Round preview | 560, 109 | 800 × 450 |

Locking replaces the player's view with a map inside the same frame. The
timer stays in the center gap. Both NMPZ panoramas use the round's fixed
spawn camera, ignoring per-player POV telemetry. The preview is centered
in the available stage below the top band.

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
