# Ban & Pick design

Date: 2026-09-11

Status: Generic first version. Overlay designs are placeholders to be
restyled per output (stream vs. venue LED).

## Purpose

DAY 2 matches decide mode and map by a Ban & Pick over nine
organiser-defined options (rulebook 4.4.1). Players perform the procedure on
a tablet; NodeCG holds the authoritative state; two overlays (stream, LED)
render it.

## Procedure (rulebook 4.4.1)

| Step | Player | Action |
| --- | --- | --- |
| 1 | A | Ban |
| 2 | B | Ban |
| 3 | A | Pick (Game 1) |
| 4 | B | Pick (Game 2) |
| 5 | B | Ban |
| 6 | A | Ban |
| 7 | A | Ban |
| 8 | B | Ban |
| - | - | Remaining option is Game 3 |

An option that is already banned or picked cannot be chosen again.

## Decisions

- **Pure rules module** (`src/banpick/rules.ts`): the step table, the
  default nine options, `applyAction`, `undo`, and `deriveView`. No NodeCG
  imports, unit-tested with `node:test`.
- **One Replicant** `banPick` holding `{ players, options, actions,
  visible }`. `actions` is the ordered history; everything else on screen is
  derived from it, so undo is `actions.pop()` and reset is `actions = []`.
- **Extension owns mutations.** Clients send messages (`banpick:act`,
  `banpick:undo`, `banpick:reset`, `banpick:setPlayers`,
  `banpick:swapPlayers`, `banpick:setVisible`); the extension validates
  against the rules and rejects invalid moves via the acknowledgement. This
  keeps a mis-tapped tablet from corrupting state and gives a single place to
  add logging later.
- **Player panel is a registered graphic** (`banpick-player.html`, 1280x800)
  so tablets on the venue LAN can open it without dashboard login and get the
  NodeCG client API injected. `?player=A` or `?player=B` locks a tablet to one
  player; without it the shared tablet shows whose turn it is. Selecting an
  option requires a second confirmation tap.
- **Two overlays, one shared renderer.** `banpick-stream.html` and
  `banpick-led.html` each have their own HTML/CSS (duplicated on purpose so
  they can diverge) and their own entry TS that calls the shared
  `src/graphics/banpick/board.ts` renderer. Fork the renderer per overlay if
  the layouts ever need different structure.
- **Dashboard panel** `banpick-control` for the operator: player names,
  swap A/B, undo, reset, overlay visibility, and the same board so the
  operator can act on a player's behalf.
- **Companion endpoints**: `POST /rashinban/banpick/{show,hide,toggle,undo,reset}`.

## Out of scope for now

- Editing the option list from the dashboard (edit the Replicant default or
  the `options` array directly).
- Feeding the picked mode/map into the presenter's series state.
- Final visual design for either overlay.
