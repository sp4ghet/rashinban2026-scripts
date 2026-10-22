# English output

Build with `npm run build`, restart NodeCG, then refresh the dashboard. Add a 1920x1080 OBS browser source:

`http://localhost:9090/bundles/rashinban/graphics/info-en.html`

The **English** dashboard has its own Preview/Program, TAKE, SWAP, Clear preview and Revert preview. It includes player cameras/cards, lower thirds (matchup, scores, free text), English casters, Ban & Pick, Interval and Bracket. Preview monitors use camera placeholders; the OBS source receives live camera video. Append `?channel=preview` for a live English preview source.

## Player cameras and cards

English and Stream share **Shared > Current Match** and its scores. Each operator chooses P1 or P2 independently. The English camera buttons and card Player/Visible controls use the same linkage as Stream: changing player switches the camera and card together; hiding the card hides its camera. Page, position overrides and relay selection are staged until TAKE. Switching players restores the matching card position, including the existing Page 2/Compact rules.

The relay defaults to `main`. Keep the existing presenter capture page running with Left player camera and Right player camera assigned. A separate English output adds one camera receiver; its dashboard monitors do not subscribe to the relay.

## English sheet data

**Config > Google Sheets** now has English player/caster gid fields. The defaults use the existing Tech data workbook:

- `players_en`: `1767411728`
- `casters_en`: `2083370771`

Polling or Refresh now updates all four tabs. Blank an English gid to disable that tab. English fetch errors appear in sheet status, retain that tab's last good data and do not prevent the other tabs from refreshing.

English profiles are joined to the shared players by UID, then the existing entrant/tag identity rules. English names appear in cards, score/match lower thirds, upcoming matches, results opponents and bracket. Missing or ambiguous translations fall back to shared match names/profiles or the source bracket label. Tournament identity and scores remain shared. Caster selection comes from `casters_en` and is independent of Stream. Sheet text is displayed as authored, including any untranslated cells.

## Interval timer

Use **English > Interval > Minutes / Start / Pause / Resume / Clear**. These controls change the English timer immediately and never alter the main Stream/LED timer. Scene visibility still uses Preview/TAKE. Both countdowns persist separately and use the same server clock.

Interval title, upcoming heading, manual match list and Next Match selection remain shared through **Shared > Interval**. Upcoming player names resolve through the English profiles. Sponsors, KV background and bracket source also reuse the existing shared content.

## Verification

Run `npm run typecheck`, `npm test`, `npm run build`, then:

```powershell
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/validate-english.mjs --adobe-fonts
```

Set `RASHINBAN_SHARED_ROOT` to the installation root when validating in a worktree so the harness can find the local KV video. The browser harness uses isolated NodeCG message/Replicant fixtures and the real extension handlers. It uses deterministic profiles, or the optional ignored `artifacts/en-validation/players-en.json` snapshot if present. Reports and screenshots go under `artifacts/en-validation/`. Production OBS/capture-device acceptance remains a separate on-site check.
