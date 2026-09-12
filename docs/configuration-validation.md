# Shared configuration validation

Verified on 2026-09-12 in the `feat/presenter-tie-range` worktree.

## Automated checks

- `npm test`: 356/356 passed after the final fix (`3a1e794`).
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Final independent review and the scoped fix review: approved, no open findings.

Regression coverage includes real temporary Git worktrees and SQLite fixtures,
shared/local precedence, sparse writes, cue-binding clears, file races and
failed writes, invalid-edit recovery, credential migration, detached NodeCG
projections, draft revisions and acknowledgment ordering, retained duel rules,
asset containment/authentication/ranges, and bound-media cache refresh.

## Actual migration and browser acceptance

- The shared configuration migrated to schema version 1, retaining the Maps
  browser key, five music stems, twelve cue bindings and both 5K bindings.
- GeoGuessr and start.gg credentials resolve from the shared environment. The
  legacy GeoGuessr file remains unchanged as a backup.
- The worktree has no copied `.env`, `.secrets/geoguessr.json`, or temporary
  `cfg/rashinban.json`. Its local settings live in `cfg/rashinban.local.json`.
- Chrome loaded the real Config workspace and displayed nine shared music
  files, fifteen cue files and four video files, with inherited selections.
- All nineteen bound media references returned successful byte-range responses.
  The selected 5K video loaded metadata with a duration of 5.005 seconds.
- A real Apply action changed only the worktree override file. Restoring the
  temporary gain restored the original local JSON; shared file bytes remained
  unchanged throughout the check.
- Unsaved Add/Remove stem edits survived locally simulated incoming media
  projections without writing the media configuration.
- The presenter graphic reported Maps `api-ready`, audio `ready` after decoding,
  and no audio ownership in preview mode. No JavaScript exceptions occurred.
- Spectator authentication succeeded. At final inspection the selected party
  had no active game (`waiting-game`, no authentication error).
- The preview retained the operator's latest Half tie-range selection, rendered
  views and audio preferences. Main and preview runtime databases are distinct.

The main listener remained on port 9090 with its original process; the new
preview runs on port 9091. The branch remains available for preview and has not
been merged. The already-running main instance still uses its previous code;
file-backed Config saves there require integrating this branch and restarting it.

Local screenshots, sanitized result JSON, test output and review records are
under `artifacts/presenter-validation/shared-configuration/` (ignored by Git).
The original shared public configuration was backed up there before migration.

See [configuration and worktree previews](configuration.md) for file locations,
reset/import behavior and launch commands.
