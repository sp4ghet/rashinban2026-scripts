# Presenter broadcast layout

The presenter uses a fixed 1920 × 1080 canvas. Round, game, series score,
and mode sit at the top; each player's multiplier appears on their side.
Names and HP sit beside the bottom-corner cameras. RASHINBAN artwork is
dimmed behind the feeds to keep the game and status text legible.

Positions below describe the outer frames, including borders, in pixels.

| Frame | Left, top | Width × height |
| --- | --- | --- |
| Left camera | 28, 886 | 288 × 162 |
| Right camera | 1604, 886 | 288 × 162 |
| Left feed, dual | 28, 180 | 922 × 519 |
| Right feed, dual | 970, 180 | 922 × 519 |
| Shared panorama / round preview | 28, 116 | 1864 × 828 |
| Results map | 160, 218 | 1600 × 650 |
| Active left feed after right locks | 28, 144 | 1270 × 714 |
| Locked right map | 1318, 218 | 574 × 574 |
| Locked left map | 28, 218 | 574 × 574 |
| Active right feed after left locks | 622, 144 | 1270 × 714 |

Camera and player feed borders are 4 px. Reposition external camera and
chroma capture sources to match these frames when updating the OBS scene.
Rendered game views continue to resize automatically. The asymmetric
locked layout applies to rendered views; chroma mode keeps equal feeds.

The game number is derived from the manually maintained series wins:
left wins + right wins + 1. Keep wins at the completed-game total while
the current game's results are on screen. Draws and replayed games are
not represented separately by the existing series model.

Layout validation used headless Chrome at 1920 × 1080 with synthetic
panorama, map, and camera placeholders for dual, shared, locked, results,
and preview scenes. Live Google imagery and OBS capture alignment were
not part of this visual check.
