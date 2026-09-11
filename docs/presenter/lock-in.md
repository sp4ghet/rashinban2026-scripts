# Lock-in presentation

Rendered live play uses `lockLayout(frame)` to set `body[data-lock]` to `none`, `left`, `right`, or `both`. A lock requires a mapped player, a submitted guess for the current snapshot round, and the projected lock flag. Non-live phases, a mismatched displayed round, and chroma mode return `none`.

In MOVE and NM, submitting a guess hides that player's Street View and fills their window with the map. The opponent's Street View window grows while they continue playing. In NMPZ, the existing single shared panorama occupies the active opponent's area; no extra Street View instance is created. After both guesses, both windows show maps until the results transition. Chroma mode keeps its two player-feed windows unchanged. Camera windows remain visible throughout.

A locked map shows both available player pins, with blue/red side colors. A submitted current-round guess takes precedence over live pin telemetry. Opponent pins continue updating while they play. Missing or stale telemetry may fall back to the current snapshot's pin; an explicit null in current telemetry is preserved as a cleared pin. No answer marker or answer-to-guess line appears before the results reveal. Missing pins are omitted, never synthesized.

The map fits the available pins using the shortest longitude arc, with 45 pixels of padding. Google map and panorama surfaces detect changes to their measured width and height; map bounds are refitted after resizing. Window geometry remains defined by `bundles/rashinban/graphics/presenter.css` on the 1920 × 1080 stage.

Street View objects are retained during lock-in. Their pose and panorama are frozen, and pending exact-panorama lookups are invalidated, so a telemetry reset to spawn cannot replace the retained scene. Unlocking resumes the same object. A new game, round, or mapped player resets its identity normally, preventing an old scene from leaking into a new round.

Renderer tests cover single and double locks, side mapping, stale telemetry, missing pins, NMPZ, chroma, unlock/new-round handling, pending panorama requests, retained objects, and resize/refit behavior.
