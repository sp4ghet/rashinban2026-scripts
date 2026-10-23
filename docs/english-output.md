# English output

Build with `npm run build`, restart NodeCG, then refresh the dashboard and OBS browser sources. Use separate OBS scenes with these 1920x1080 sources:

| Scene | URL |
| --- | --- |
| Interval | `http://localhost:9090/bundles/rashinban/graphics/interval-en.html` |
| Player cameras/cards | `http://localhost:9090/bundles/rashinban/graphics/player-cards-en.html` |
| Bracket | `http://localhost:9090/bundles/rashinban/graphics/bracket-en.html` |
| Casters | `http://localhost:9090/bundles/rashinban/graphics/casters-en.html` |

`player-cards-en.html` replaces `info-en.html` and contains only player cameras and cards. Interval and bracket are always on, with no embedded video. Place the original KV video underneath in OBS. For **each Interval EN and Bracket EN browser source**, right-click the source and set **Blending Method > SRGB Off**, with **Blending Mode > Normal**. These are two separate settings: the Default blending method uses linear blending and makes translucent content composite differently from the browser preview. See [OBS's explanation of the blending methods](https://github.com/obsproject/obs-studio/pull/6257).

Interval retains the Stream layout's 25% black dimming. Bracket EN has a fully transparent background with no black dimming or red/blue tint. For the tinted bracket background, place `assets/images/bracket-multiply.png` in an OBS Image source at 100% opacity with **Blending Mode > Multiply**, below Bracket EN and above the KV loop. The PNG supplies both tint and darkening; no Custom CSS override is needed on Bracket EN. OBS controls which scene is on air.

The **English** dashboard retains Preview/Program, TAKE, SWAP, Clear preview and Revert preview for player cameras/cards and caster selections. Lower-third, Ban & Pick, bracket visibility and interval visibility controls are removed. The interval timer controls remain live and independent of TAKE. **Monitor scene** selects which of the four URLs appears in both dashboard monitors; it does not switch OBS. Camera monitors use placeholders; the OBS player source receives live camera video. Append `?channel=preview` to the player or caster source to inspect staged selections.

## Caster placement

The caster source uses the English caster sheet and the existing left/right selection and reveal controls. Its nameplates use the following top-left coordinates:

| Source size | Left | Right | Nameplate size |
| --- | --- | --- | --- |
| 1920x1080 | x: 330, y: 60 | x: 1200, y: 60 | 390x170 |
| 3840x2160 | x: 660, y: 120 | x: 2400, y: 120 | 780x340 |

The caster source scales automatically when its OBS browser dimensions are 3840x2160. English text shrinks to fit long names or fallback fonts. The optional center card retains its existing placement. Other sources use a 1920x1080 browser canvas; scale them in OBS for a 4K composition.

## Player cameras and cards

English and Stream share **Shared > Current Match** and its scores. Each operator chooses P1 or P2 independently. The English camera buttons and card Player/Visible controls use the same linkage as Stream: changing player switches the camera and card together; hiding the card hides its camera. Page, position overrides and relay selection are staged until TAKE. Switching players defaults the card position to **Right for P1** and **Left for P2**, including the existing Page 2/Compact rules.

The relay defaults to `main`. Keep the existing presenter capture page running with Left player camera and Right player camera assigned. A separate English output adds one camera receiver; its dashboard monitors do not subscribe to the relay.

## English sheet data

**Config > Google Sheets** now has English player/caster gid fields. The defaults use the existing Tech data workbook:

- `players_en`: `1767411728`
- `casters_en`: `2083370771`

Polling or Refresh now updates all four tabs. Blank an English gid to disable that tab. English fetch errors appear in sheet status, retain that tab's last good data and do not prevent the other tabs from refreshing.

English profiles are joined to the shared players by UID, then the existing entrant/tag identity rules. English names appear in cards, upcoming matches, results opponents and bracket. Missing or ambiguous translations fall back to shared match names/profiles or the source bracket label. Tournament identity and scores remain shared. Caster selection comes from `casters_en` and is independent of Stream. Sheet text is displayed as authored, including any untranslated cells.

## Interval timer

Use **English > Interval > Minutes / Start / Pause / Resume / Clear**. These controls change the English timer immediately and never alter the main Stream/LED timer. Scene visibility is controlled in OBS; there is no interval enable/disable toggle. Both countdowns persist separately and use the same server clock.

Interval title, upcoming heading, manual match list and Next Match selection remain shared through **Shared > Interval**. Upcoming player names resolve through the English profiles. Sponsors and bracket data also reuse the existing shared content. OBS supplies the interval and bracket backgrounds.

## Verification

Run `npm run typecheck`, `npm test`, `npm run build`, then:

```powershell
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/validate-english.mjs --adobe-fonts
```

The browser harness uses isolated NodeCG message/Replicant fixtures and the real extension handlers. It uses deterministic profiles, or the optional ignored `artifacts/en-validation/players-en.json` snapshot if present. The checks cover independent source rendering, transparent backgrounds without video, the timer controls, and caster bounds/text fitting at both resolutions. Reports and screenshots go under `artifacts/en-validation/`. Production OBS/capture-device acceptance remains a separate on-site check.
