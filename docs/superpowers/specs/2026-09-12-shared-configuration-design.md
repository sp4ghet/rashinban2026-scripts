# Shared configuration with worktree overrides

Date: 2026-09-12

Status: Approved. The user selected shared defaults with worktree overrides and authorized implementation, including shared credential access for previews.

## Problem

Presenter settings and media bindings currently persist as NodeCG Replicants
in each checkout's SQLite database. A new worktree starts with empty media
bindings. Uploaded files also belong to that checkout's NodeCG assets directory.
Copying only the bindings therefore cannot make a new worktree usable.

Configuration is additionally split between public NodeCG bundle configuration,
an environment file, and an optional GeoGuessr credential file. The last two
overlap: GEOGUESSR_NCFA already takes precedence over the credential file.

## Ownership and files

Use the main checkout as the shared installation root. Resolve it using Git's
common directory, not a hard-coded `.worktrees` layout. In a regular checkout
or a packaged installation without Git, the application root is the shared root.
Support an explicit shared-root setting for installations that need one.

The effective configuration is built in this order:

1. Versioned application defaults.
2. `<shared-root>/cfg/rashinban.json`: shared machine/event configuration.
3. `<worktree>/cfg/rashinban.local.json`: optional worktree overrides.
4. Explicit launch overrides for this process, such as preview/replay input.

Objects merge by key; arrays replace as a whole. Explicit nulls clear nullable
values. Unknown or invalid fields fail validation with a useful diagnostic.
An invalid file must not silently erase bindings or reset the setup.

The existing cfg/nodecg.json remains NodeCG's server configuration, covering
its listening address and port. A preview can continue using a separate port.

Secrets have one canonical file: `<shared-root>/.env`. Existing process
environment variables take precedence. NodeCG's browser-visible bundleConfig
receives only public fields; credentials never enter its config or Replicants.
The public Maps browser key remains in rashinban.json.

## Settings that move

The shared file holds these existing settings, with a schema version:

- Presenter preferences: view source, key color, audio output/mute/gains,
  timing and next-duel tie-range selection.
- Presenter media: music stems, loop points, per-phase gains/fades, sound cues,
  single/double 5K video bindings and soundtrack/watchdog settings.
- Presenter connection defaults: input mode, replay fixture, default party
  selector and client version.
- Spreadsheet connection settings and polling preferences.
- start.gg event/tournament selection and polling preferences.

SQLite continues to own runtime state: active match and wins, bans/picks,
current duel and frozen rule context, replay progress, playback state, client
leases, fetched data caches and other live control state. Moving settings must
not reset a running duel or change its captured tie-range rule.

## Dashboard and persistence

Keep the existing Config workspace controls. Their Replicants become runtime
projections of effective file configuration, with SQLite persistence disabled
for the migrated settings. All existing settings actions, including mute/view
shortcuts, use the same configuration service.

Saving from the main checkout changes the shared file. Saving from a worktree
changes only that worktree's override file. Save the fields changed by the
operator, preserving unrelated keys and avoiding a complete copied config that
would mask future shared changes. An explicit reset-to-shared action removes
the corresponding overrides.

Show the active config scope and whether a section overrides shared defaults.
Existing Apply buttons remain the save action. A failed disk write must report
failure and leave the previously effective state intact.

Validate before atomic file replacement. Detect concurrent edits rather than
silently overwriting them. Watch configuration files and publish validated
changes to Replicants; retain the last valid configuration after a bad external
edit. A successful update clears the diagnostic. Startup-only settings are
identified as such, and secret changes require a process restart.

## Media files across worktrees

Treat `<shared-root>/assets/rashinban` as the shared media library. Preserve the
existing browser URLs under `/assets/rashinban/{music,effects,video}/...`.

In a worktree, serve its local uploaded file when one exists, otherwise the
shared file. Expose the merged inventory to the presenter and Config selectors,
deduplicated by category and filename with local files taking precedence.
Inventory changes must update both media validation and selectors.

Preview uploads and deletions affect the worktree's local assets. Manage shared
uploads from the main checkout. Deleting a local override exposes the shared
file again. This avoids copying large videos or creating filesystem links that
would make preview deletions modify the shared library. Native asset-management
screens can continue showing their own local uploads; presenter selectors show
the effective library and identify inherited files.

## Migration

Bootstrap the shared settings from the main checkout's existing database using
a read-only database snapshot, filling only sections absent from the config
file. Existing file values win. Never seed shared defaults from a fresh
worktree's empty database. Retain the original database unchanged for recovery.

Provide an explicit import path for useful settings in an existing worktree's
database; do not automatically freeze old copied values as worktree overrides.
Do not overwrite existing assets during migration.

If GEOGUESSR_NCFA is absent from the shared .env, migrate a valid legacy
.secrets/geoguessr.json cookie there without logging its value. Existing .env
credentials win. Retain the old file as a migration backup and stop using it
after migration. Remove cookieFile from the active configuration surface and
document the single credential source. Existing externally supplied environment
variables remain supported.

Update local startup and preview tooling to find the shared root automatically
and resolve both public configuration and credentials consistently. An isolated
preview explicitly selects replay input rather than inheriting live input.

## Alternatives considered

- Copy config and media into every worktree: simple startup, but copies drift
  and media duplication grows. This does not provide inherited defaults.
- Share the whole SQLite database: preserves bindings, but also shares live
  match/duel state between running instances. This conflicts with isolation.
- Shared files plus worktree overrides: selected by the user; keeps portable
  setup separate from live state while allowing local experimentation.

## Verification

- Fresh worktree inherits existing media bindings and resolves actual files.
- Local settings changes survive restart and leave shared config untouched.
- Shared edits reach worktrees except for fields explicitly overridden there.
- Resetting an override restores the current shared value.
- Arrays, nulls, invalid edits, write failures and concurrent edits are tested.
- SQLite migration preserves existing file values and reads the correct main
  database; a new database cannot erase shared settings.
- Credential migration preserves precedence and never exposes secret values
  through browser configuration, diagnostics or responses.
- Media inventory and HTTP serving agree on local/shared precedence; local
  uploads/deletions never modify shared files.
- A running duel retains its captured rule and runtime history during saves.
- Run repository tests, typecheck and build, then inspect main/preview Config
  controls and actual media playback in the browser.
