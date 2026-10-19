# Stream presenter design implementation plan

> Execute inline using superpowers:executing-plans. The supplied four images and the user's chroma/timer correction authorize this implementation.

**Goal:** Reproduce the designer's live, locked, results and Pinpointing stream layouts with functioning live data and cameras.

**Architecture:** Add a stream-specific stylesheet so the LED and existing intermission layouts retain their geometry. Reuse the current renderer, scoring choreography, relay cameras and authoritative timeline. Add a deadline-derived SVG pill timer and current-match title binding.

**Tech Stack:** TypeScript, NodeCG Replicants, CSS, SVG, existing isolated Chrome validation.

**Spec:** User-supplied `Downloads/インゲーム(1).png` through `(4).png`, 1920x1080, and instruction that chroma windows never resize on lock; timer outline fades clockwise and turns red at 15 seconds.

## Constraints

- Stream camera feeds remain relayed; magenta in the references denotes camera content.
- Image 1 is one-player lock in rendered/video mode; image 2 is results/scoring; image 3 is Pinpointing live; image 4 is ordinary live.
- Chroma keeps equal player windows and a fixed timer through all lock states. Rendered/video mode expands the active player and moves the timer to the header.
- LED retains its existing geometry and 16:9 locked viewports.
- Use Kaneda Gothic for display text and preserve font fallback for other scripts. No added shadows on the new stream graphics.
- Keep pre/post-game layouts, preview gating, score motion, authoritative HP and camera connections working. Do not change game state to preview the design.
- No commit or push is part of this request.

## Review focus

- Chroma alpha holes and timer stay fixed on either player's lock.
- Results geometry and colors follow player mappings, with no early answer reveal.
- Pinpointing uses authoritative points and first-to count, with no HP/damage panels.
- Timer uses synchronized deadlines, including shortened timers, reconnects and the 15-second threshold.
- Long/Japanese names and handles remain inside their panels; absent match labels are empty.

## Tasks

- [x] Add stream scene geometry, scoreboard, health/point counters, results cards and sponsor footer; check against image measurements.
- [x] Add stream timer formatting and SVG perimeter progress; verify shortened countdowns and threshold behavior.
- [x] Bind match title and mode labels; align stream map colors and rendered NMPZ dual viewports with the design.
- [x] Update existing browser validations for the new geometry, keeping LED, alpha, animation and intermission checks.
- [x] Run tests, typecheck, build, visual checks and diff checks; review the resulting changes and refresh OBS.

## Execution notes

- The supplied references replace the old stream layout; LED geometry and pre/post-game layout are outside the redesign.
- The shared NMPZ source will render the same initial panorama into both stream viewports to preserve the two-panel design.
- Screenshots determine geometry/font sizes; small rasterization differences are assessed separately from layout differences.

## Verification results

- `npm test`: 700 tests passed; `npm run typecheck` and `npm run build` passed.
- Motion/layout browser validation: 9 check groups, 48 stream/LED mode/source/lock combinations, zero errors. Screenshot review confirmed timer centering, sponsor, Pinpointing counters, results and lock layouts.
- Compositing browser validation: 17 checks, zero errors, including transparent gameplay windows, full-opacity lock text, and preserved pre/post-game camera layouts.
- Review corrected stream verdict colors and left-anchored depletion for both HP bars. Adjusted score numeral/mode placement and point spacing to reference measurements.
- Refreshed the existing OBS stream and LED browser sources. The stream retained the current right-winner post-game layout and both camera feeds recovered to ready/live, with advancing video frames. The hidden LED source loaded its existing geometry without the stream stylesheet.
- Isolated layout screenshots use synthetic camera content and no Google Maps key; they verify layout and animation, not live map imagery. No Replicant/game state was changed for validation.
- `git diff --check` passed. No commit or push performed.
