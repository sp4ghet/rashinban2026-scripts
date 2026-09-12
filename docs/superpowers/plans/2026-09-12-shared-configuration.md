# Shared Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New worktrees inherit settings, media and credentials while their edits remain local and runtime state remains isolated.

**Architecture:** A server-owned typed configuration store resolves shared and local JSON layers, migrates legacy SQLite settings, and publishes effective values through nonpersistent Replicants. Credentials resolve from the shared environment file; a media service combines shared files with local overrides at existing asset URLs.

**Tech Stack:** TypeScript, Node 22.17+, NodeCG 2.8, node:test, node:sqlite, existing Express.

**Spec:** docs/superpowers/specs/2026-09-12-shared-configuration-design.md

## Global Constraints

- User approved the design and explicitly chose shared defaults with worktree overrides.
- Continue in the existing isolated tie-range worktree. Do not modify main source or its runtime SQLite database.
- Shared configuration/credential migration is authorized. Read existing files without printing secrets; do not remove the old credential file or database.
- `<shared-root>/cfg/rashinban.json` owns shared settings; `<worktree>/cfg/rashinban.local.json` owns worktree overrides; `<shared-root>/.env` owns credentials.
- Shared root comes from Git common directory, with explicit RASHINBAN_SHARED_ROOT override and a no-Git application-root fallback. No hard-coded .worktrees traversal in production.
- Objects merge, arrays replace, null clears nullable values. Unknown fields and malformed files produce diagnostics; they never silently clear working configuration.
- Existing Config controls and live duel semantics remain. Migrated settings Replicants are nonpersistent projections; match/duel/replay state remains SQLite-owned.
- No new npm dependencies. Use local APIs and tests; Node/npm require approved elevated execution in this Windows environment.
- Each task runs focused red/green tests and typecheck. Root owns full-suite/build/browser acceptance and final review.

## File and interface map

Create `src/config/types.ts` and `src/config/schema.ts` for browser-safe public types, defaults and validation. Create server modules in `src/extension/config/`: `roots.ts`, `credentials.ts`, `migration.ts`, `store.ts`, `register.ts`, `assets.ts`.

The public persisted shape extends existing configuration without nesting its existing connection keys differently:

```ts
type ApplicationConfig = {
  schemaVersion: 1;
  presenter: {
    googleMapsApiKey: string; input: 'live' | 'replay'; replayFixture: string;
    partyId: string | null; clientVersion: string;
    settings: PresenterSettings; media: MediaManifest;
  };
  sheet: SheetConfig; startgg: StartggConfig;
};
type ConfigSection = 'presenterSettings' | 'presenterMedia' | 'sheetConfig' | 'startggConfig';
type ConfigSections = { presenterSettings: PresenterSettings; presenterMedia: MediaManifest; sheetConfig: SheetConfig; startggConfig: StartggConfig };
type ConfigStatus = { scope: 'shared' | 'worktree'; revision: string; overridden: ConfigSection[]; error: string | null };
type InstallationRoots = { appRoot: string; sharedRoot: string; isWorktree: boolean };
type ConfigStore = {
  get(): ApplicationConfig;
  status(): ConfigStatus;
  save<K extends ConfigSection>(section: K, next: ConfigSections[K], expectedRevision?: string): void;
  reset(section: ConfigSection, expectedRevision?: string): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
};
```

`resolveInstallationRoots(appRoot = process.cwd(), env = process.env): InstallationRoots` is shared by startup, credentials and media. `createConfigStore({roots, launchOverrides?, watch?}): ConfigStore` loads/migrates/validates synchronously; store writes are synchronous and atomic before publishing success. Use an optional injected filesystem boundary for meaningful failure/race tests if necessary.

`initializeConfiguration(nodecg): {store: ConfigStore; roots: InstallationRoots}` registers `configurationStatus` and the four nonpersistent settings Replicants before existing extension modules. Existing extension registration functions accept optional store arguments for compatibility with isolated tests, while production always supplies the store.

## Task 1: Shared roots, credentials, schema and file store

**Files:** Create `src/config/types.ts`, `src/config/schema.ts`, `src/extension/config/{roots,credentials,migration,store}.ts`, `src/config/tests/{roots,credentials,migration,store}.test.ts`; update package.json test glob and .gitignore. Existing paths are under bundles/rashinban unless otherwise stated.

**Interfaces:** Produce the exact interface map above. Export `loadSharedCredentials(roots, env = process.env): void`. Store owns startup migration before configuration loading. `readLegacyConfiguration(databasePath): Partial<ConfigSections>` supports startup migration and Task 2's explicit import control.

- [ ] Write failing fixture-backed tests using temporary main/worktree directories. Assert precedence and sparse saving:

```ts
store.save('presenterSettings', {...store.get().presenter.settings, muted: true});
assert.equal(JSON.parse(readFileSync(localFile, 'utf8')).presenter.settings.muted, true);
assert.equal(readFileSync(sharedFile, 'utf8'), originalSharedText);
assert.equal(JSON.parse(readFileSync(localFile, 'utf8')).presenter.settings.musicGain, undefined);
```

Cover arrays/nulls, reset, stale revision, invalid startup/externally edited files, missing directories, atomic-write failure, unrelated keys preserved and file-watch recovery. Test linked worktrees using real temporary Git repositories and no-Git fallback.
- [ ] Implement strict public schema using existing parseSettings/parseMedia and current sheet/startgg defaults. Keep validators browser-safe. Accept old public connection config during migration, but exclude cookieFile after migration and reject credentials in public config. Validate fixture names and finite polling intervals (sheet minimum5000, startgg minimum10000).
- [ ] Implement shared-root resolution, inherited environment loading with process variables winning, and legacy cookie migration to shared .env only when no existing nonempty GEOGUESSR_NCFA exists. Preserve other env contents and legacy file. Never log values or include them in diagnostics. Test empty env assignments, existing process variables, malformed legacy JSON and an existing valid env cookie.
- [ ] Read only the four settings rows from `replicant(namespace TEXT,name TEXT,value TEXT)` in shared `db/nodecg.sqlite3`, namespace `rashinban`, using DatabaseSync readOnly. Use a single SELECT for a consistent snapshot. Missing database means no migration; an existing unreadable database is a diagnostic. Missing config fields inherit corresponding legacy values, file fields win, and a schemaVersion marker prevents repeating import. Do not import worktree databases automatically. Test with actual temp SQLite fixtures.
- [ ] Implement serialized atomic replacement with compare-before-write and an exclusive writer lock for cooperative processes; reject concurrent edits. Watch both layers, retain last good config on invalid edits, and notify status/error recovery. Launch overrides remain process-local and are never written back. Do not mask first-start configuration errors with defaults as if valid.
- [ ] Run `node --experimental-strip-types --disable-warning=ExperimentalWarning --test "bundles/rashinban/src/config/tests/*.test.ts"`, typecheck, and commit `feat: store shared configuration with worktree overrides`.

## Task 2: Integrate file ownership with Config controls and public consumers

**Files:** Create `src/extension/config/register.ts` and `src/dashboard/configuration-status.ts`; modify `src/extension/{index,env,sheet,startgg}.ts`, `src/extension/presenter/{register,secrets,routes}.ts`, `src/dashboard/{presenter-control,sheet-control,startgg-control}.ts`, matching dashboard HTML, `src/types/replicants.ts`, presenter graphics/audio public-key consumer as needed, relevant integration tests.

**Interfaces:** Consume ConfigStore and InstallationRoots from Task 1. `initializeConfiguration` creates the four settings Replicants with persistent:false and publishes detached JSON values. Expose nonpersistent `configurationStatus` and browser-safe `presenterPublicConfig` containing only public connection fields needed by clients. `configuration:reset` accepts `{section, revision}`. `configuration:importLocal` explicitly imports selected settings from the current worktree DB into local overrides; never touches runtime state.

- [ ] Add integration tests that demonstrate dashboard saves persist to a temp local file, Replicant options are nonpersistent, failed writes reject requests without changing public settings, and shared changes publish detached objects under NodeCG proxy ownership. Assert an already-started duel retains its tie-range mode.
- [ ] Initialize the config service before existing extension registration, use shared credentials automatically, and switch production settings reads/writes to the store. Preserve isolated test injection without allowing production SQLite to become settings authority again. Keep runtime state persistent. Adapt sheet/startgg setters to retain their existing input normalization, then store validated results.
- [ ] Wire Apply, mute/view shortcuts and HTTP control routes to the same save operation. Include optional expected revision in dashboard messages (outside validated settings), reject stale drafts with useful errors, and preserve legacy HTTP callers while still checking on-disk races. Do not make unrelated sections into worktree overrides when saving one field.
- [ ] Add scope/status and per-section reset controls to Config panels. Reset is meaningful only for worktree overrides. External file errors appear in the Config UI and clear on repair. Add explicit import-local-settings control scoped to the selected section. Keep secrets out of UI and public config. Existing errors should explain the shared .env path concept without echoing credentials.
- [ ] Publish effective public Maps configuration so worktrees do not depend on a copied NodeCG bundleConfig. Make graphics/dashboard read it reliably on startup; preserve map rendering when existing consumers connect before the Replicant update. Document public connection defaults as reconnect/startup applied; changing defaults must not unexpectedly switch a running live/replay session.
- [ ] Run focused integration and affected presenter/sheet/startgg tests plus typecheck. Commit `feat: save dashboard configuration to shared and local files`.

## Task 3: Shared media library and reliable preview startup

**Files:** Create `src/extension/config/assets.ts`, `src/config/tests/assets.test.ts`, `scripts/preview.mjs`; modify extension config/index startup, presenter register inventory use, presenter/dashboard/audio inventory consumers and types, package scripts, docs/configuration.md, README, config examples, .env.example.

**Interfaces:** `registerSharedAssets(nodecg, roots): void` publishes nonpersistent `presenterAssets` with `{music: AssetInventory,effects: AssetInventory,video: AssetInventory}`. Extend inventory entries with optional `source: 'shared'|'local'` for selector labels. Existing `/assets/rashinban/<category>/<file>` URLs remain unchanged. Export pure listing/path helpers for isolated tests.

- [ ] Write failing media tests with real temp shared/local files. Assert local filename override wins, shared-only file appears in inventory and serves bytes, invalid paths/symlink escape are rejected, deletion exposes shared fallback, and byte-range requests needed for media playback work. Test only audio/video categories declared by this bundle.
- [ ] Mount the fallback media route before NodeCG's final404 boundary while respecting local-file priority. Use Express sendFile with range support; match the merged inventory to actual readable files and category extensions. Watch asset directories and publish detached merged inventory. Do not modify NodeCG-owned assets Replicants or shared files from preview upload/delete actions.
- [ ] Switch presenter celebration eligibility and media selectors to effective inventory. Keep compatibility fallback only for test harnesses/older callers where needed; do not let an empty local inventory mask shared assets. Label inherited files in selectors.
- [ ] Implement `npm run preview -- --port 9091` using the current worktree, automatically resolved shared configuration/credentials, isolated runtime DB and a free/explicit port. Do not overwrite tracked cfg/nodecg.json. Default preview input to replay through explicit process override; user can switch live in Config with inherited credentials. Start ordinary npm start/dev with shared config resolution as well. Use a graceful child process and clear dashboard/graphic URLs.
- [ ] Document the two config layers, single secret file, main versus worktree saves, inherited media, migration/import/reset, runtime-state distinction, launch overrides and restart requirements. Provide valid example config and preserve existing operator setup in migration.
- [ ] Run focused media tests and typecheck, then commit `feat: share media assets and configure worktree previews`.

## Task 4: Whole-system migration and acceptance

**Files:** Focused corrections to Tasks1–3; docs/configuration.md, validation notes and this plan.

- [ ] Run full tests, typecheck and build. Review the full branch change against the approved spec with independent whole-branch review; address concrete findings with regression tests.
- [ ] Record checksums of the main database and existing credential/config assets before migration; migrate only the approved static config/credential files and preserve legacy backups. Do not use or expose unrelated tables/session secrets.
- [ ] Restart only the owned port9091 preview with the new startup. Verify shared settings/media restored, secret source available without disclosure, Config edits write worktree overrides, reset restores shared values, and live reconnect can use inherited authentication. Keep server-side auth failures distinct from missing config.
- [ ] Inspect built Config controls and real media URLs/playback in hidden Chrome. Check main public config is unchanged by preview edits and runtime databases remain separate. Restore temporary QA overrides, preserving the user's requested Full tie-range preview.
- [ ] Update documentation with actual tests/results and limitations, commit completion notes, and deliver running preview plus configuration locations. Do not merge or push without authorization.
