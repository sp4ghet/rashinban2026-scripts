# Current and next match selection

In **Shared > Current Match**, select the left and right competitors and choose **Apply current match**. Current Match remains directly editable; staging a next match is optional. The player dropdowns use Google Sheets profiles and start.gg entrants. Names and personal profile identities are carried by those selections, so there are no manual name, personal UID, or in-game account inputs.

**Next Match** is a separate persisted slot in the same panel. Select players and choose **Save next match** to prepare it without changing the presenter, current score, or Ban & Pick. **Make current** moves the saved next match into Current Match and clears the staging slot. Apply or discard local edits first. An active Ban & Pick must be reset before changing the current participants, including through Make current; staging remains available during Ban & Pick.

Each upcoming start.gg row has **Load current** and **Load next**. Both copy the selected matchup, match label, and imported score into the chosen slot. Refreshing start.gg never replaces either saved selection. Matchups with unknown entrants cannot be loaded. Loading Current Match leaves any Next Match draft alone, and vice versa.

Edit Match Score in **Party**. Current Match displays it in its summary. Tournament game accounts remain separate from personal profile accounts: by default Left/A follows the red team and Right/B follows blue. **Swap sides** moves the competitor and their team mapping together.

Stale saves are rejected when another operator changes the same slot. Use **Discard edits** to reload that slot before retrying. Promotion checks both slots and leaves Next Match intact if the current-match change is rejected.

Rebuild and restart NodeCG when installing this change so the next-match handlers are available.

## Validation

- `npm run typecheck`
- `npm test`
- `npm run build`
- `node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/validate-match-selection.mjs`

The browser validation uses fixture players and start.gg data with the real match extension. It covers direct edits, both load targets, reload persistence, promotion, swapped tournament-account mapping, stale edits, duplicates, and mobile layout, without accessing a live party.

The presenter uses red on the left and blue on the right. Saved version-1 blue-left/red-right defaults are corrected once at startup for Current and Next Match; explicit account mappings are preserved. Player-card placement is independent of this game-team mapping.
