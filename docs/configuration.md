# Configuration and worktree previews

The main checkout supplies shared defaults and media. Each worktree has its own
optional overrides and its own NodeCG runtime database.
See [migration and browser validation](configuration-validation.md) for the
checks performed on the implementation.

| File | Purpose |
| --- | --- |
| Main checkout `cfg/rashinban.json` | Shared presenter preferences, media bindings, connection defaults, Google Maps browser key, Sheets and start.gg settings |
| Worktree `cfg/rashinban.local.json` | Only the settings overridden in that worktree |
| Main checkout `.env` | GeoGuessr cookie and start.gg token; loaded on startup |
| Each checkout `cfg/nodecg.json` | NodeCG server configuration, including its port |
| Each checkout `db/nodecg.sqlite3` | Runtime match state, wins, captured duel rules, client state and caches |

The application finds the main checkout through Git's common directory. Outside
Git, it uses the application directory. Set `RASHINBAN_SHARED_ROOT` before launch
to use another shared installation. These paths do not depend on a particular
worktree directory name.

## Use a preview

After installing dependencies in the worktree:

```sh
npm run preview -- --port 9091
```

The launcher builds the bundle, prints the dashboard and presenter URLs, and
starts NodeCG with a temporary server configuration. It leaves `cfg/nodecg.json`
alone. Without `--port`, it selects an available port starting at 9091. An
explicitly requested port must be available.

Previews default to replay input. For live testing with inherited credentials:

```sh
npm run preview -- --port 9091 --input live
```

Use `--fixture filename.json` to choose a replay fixture. Input and fixture flags
apply only to that launch. They do not overwrite the shared configuration.
You can also select live input and reconnect from the Config workspace.

Ordinary `npm start` and `npm run dev` use the same shared configuration and
credential resolution. `npm start` requires an existing build.

## Save and reset settings

Use the existing Apply buttons in the Config workspace. A main-checkout save
updates shared defaults; a worktree save updates only its local override file.
The panel identifies the current scope and whether its section has overrides.
Reset to shared removes that section's local overrides.

Objects merge by field, arrays replace whole arrays, and null clears nullable
values. For example, this worktree changes the next duel's rule and unbinds an
inherited tie sound:

```json
{
  "presenter": {
    "settings": { "tieRange": { "enabled": true, "mode": "full" } },
    "media": { "sounds": { "tie": null } }
  }
}
```

Removing the `tie` override restores the shared sound binding. The effective
media manifest omits cleared sound cues. Empty music stem arrays intentionally
clear all stems in that scope.

File edits are validated and watched. An invalid edit shows a diagnostic while
the last valid values remain active. A save based on outdated configuration is
rejected so it cannot overwrite another edit. Repair the file or reload the
draft before retrying. A write failure leaves effective settings unchanged.

Connection defaults take effect on startup or reconnect. Editing a default does
not switch a running live/replay session. Secret changes require restarting
NodeCG. Tie-range settings apply to the next duel; the active duel retains its
captured rule.

## Media inheritance

Upload shared music, cue sounds and 5K videos through the main checkout's NodeCG
Assets workspace. Presenter selectors in worktrees also show those files and
identify inherited entries.

A worktree upload with the same category and filename overrides the shared
file. Deleting the local upload reveals the shared file again. Worktree asset
uploads and deletions affect only that worktree. NodeCG's native asset manager
shows local uploads; presenter selectors show the combined library.

Bindings retain their canonical `/assets/rashinban/...` references. Presenter
playback resolves them through `/rashinban/media/...`, which serves the local
file first and the shared file otherwise, including video byte-range requests.
External consumers of shared-only files in a worktree should use that delivery
route too.

## Credentials and migration

Keep `GEOGUESSR_NCFA` and `STARTGG_TOKEN` in the main checkout's ignored `.env`.
Nonempty process-supplied GeoGuessr credentials take precedence over the file.
The Google Maps browser key belongs in `cfg/rashinban.json` because the browser
needs it; the GeoGuessr cookie and start.gg token remain server-side.

On first startup, the new configuration service reads the main checkout's
existing SQLite settings in read-only mode and fills missing fields in the
shared configuration. Existing file values win. It marks the shared file with
`schemaVersion: 1` so subsequent starts do not repeat the database import.
It retains the original database and all media files.

Useful settings in an older worktree database can be imported explicitly from
the corresponding Config section. Import creates local overrides and leaves
runtime match/duel state alone. A fresh worktree database never seeds shared
defaults.

A valid legacy `.secrets/geoguessr.json` cookie is migrated to the shared `.env`
when no effective cookie is available. Existing canonical credentials win. The
legacy file remains as a backup; `cookieFile` is removed from migrated public
configuration. New setup needs only `.env` for secrets.
