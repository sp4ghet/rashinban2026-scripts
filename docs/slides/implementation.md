# Stream slides and interval image loop

## Design

The Stream switcher gains a Slides row with Visible, Mode, slide selection,
Previous and Next. Modes use the six labels requested by the operator.
All edits stage in Preview; TAKE publishes the image and bracket state together.
Selecting a mode returns to its first cue. Sequences include a final clear cue.
Bracket cues hide the image and enable the existing live bracket; the following
cue disables the bracket. Previous and direct selection follow the same rules.
Interval, Bracket and Slides remain mutually exclusive fullscreen selections.
The EN and LED switcher controls retain their current behavior.

Use local copies of the supplied images with a checked-in source manifest.
The Google Slides script determines ordering. The Day 1 ending's tomorrow
announcement uses the Day 2 schedule despite its inconsistent heading.
Sponsor A means Tamura Builds then Voicemod; Sponsor B means Tamura Builds only.
Visual inspection distinguishes Voicemod's overview, product/trial promotion,
and annual-license prize image despite the ambiguous source filenames.
Prize-money artwork is supplied in the additional prize folder.

Both interval outputs replace the placeholder with all 107 supplied images,
shuffled once per source load and looped in that order. Match the 2025 implementation: 10,000 ms hold,
160 ms preparation, 500 ms ease-out crossfade. Decode before showing; retain the
current image on failure. Pause hidden loops and dispose timers on page exit.

Approach: extend the existing broadcast bus and renderer. A separate live slide
replicant would bypass the requested Preview/TAKE isolation; remote Drive image
URLs would add network/authentication requirements during the broadcast.

## Implementation plan

1. Acquire images and inspect contact sheets; record source IDs, sizes and hashes.
2. Test script sequences, mode/step validation, bracket entry/exit, boundaries,
   persistence repair, output isolation, Clear/Revert/TAKE/SWAP.
3. Add the typed cue catalog and broadcast schema; integrate a Stream-only
   control row and image layer with bounded preloading and safe async updates.
4. Replace interval placeholders with the decoded two-image loop.
5. Run typecheck, full tests, build and isolated browser checks of actual
   dashboard actions, image loading, bracket transitions and interval timing.

## Progress

- Baseline: 799 tests passed before implementation.
- Operator confirmed Preview then TAKE for slide navigation.
- Supplied folders and script inspected; 2025 timing read from source.
- Complete: 107 interval images and 33 stream images downloaded unchanged;
  all 140 files match source sizes and decode successfully (113,082,083 bytes).
- Complete: all six script sequences, Stream controls, full-screen image layer,
  atomic bracket cue staging and two-buffer interval rotation.
- Verified: 808 unit tests, TypeScript compiler, build, all-cue browser checks
  including delayed decoding, and the existing full interval/bracket suite.
- Review correction: retained artwork stays hidden until the requested cue
  is decoded; bracket/clear cues preload neighbors; errored selections may retry.
- The shared dependency installation lacks npm's tsc shim; equivalent compiler
  verification used `node node_modules/typescript/bin/tsc --noEmit`.
- After integration, rebuild and refresh the deployed browser sources for
  actual OBS/venue acceptance.
