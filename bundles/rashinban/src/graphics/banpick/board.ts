// Shared DOM renderer for the Ban & Pick board. Emits stable class names /
// data attributes; each page styles them with its own CSS.
//
//   .bp-board > .bp-group[data-mode] > (.bp-group-title, .bp-card*)
//   .bp-card[data-status=open|banned|picked|remaining][data-by=A|B][data-game=1|2|3]
//     > .bp-card-num, .bp-card-map, .bp-card-tag

import type { BanPickState, BoardView, OptionView, Player } from "../../banpick/rules";
import { deriveView } from "../../banpick/rules";

export interface BoardOptions {
  /** Called when a card is tapped; omit for read-only overlays. */
  onSelect?: (view: OptionView) => void;
  /** Card with this option id gets .bp-selected (pending confirmation). */
  selectedId?: number | null;
  /** Short labels for the mode group headers. */
  modeLabel?: (mode: string) => string;
}

export const shortMode = (mode: string) => (mode.startsWith("Move") ? "MOVE" : mode);

export function playerName(state: BanPickState, player: Player): string {
  return state.players[player]?.trim() || `Player ${player}`;
}

/** Human-readable label for a card's state, e.g. "BAN · A", "GAME 1". */
export function cardTag(v: OptionView): string {
  switch (v.status) {
    case "banned":
      return `BAN · ${v.by}`;
    case "picked":
      return `GAME ${v.game} · PICK ${v.by}`;
    case "remaining":
      return "GAME 3";
    default:
      return "";
  }
}

/** Sentence describing the pending step, e.g. "sp4ghet: BAN". */
export function stepText(state: BanPickState, view: BoardView): string {
  if (!view.step) return "BAN & PICK COMPLETE";
  const who = playerName(state, view.step.player);
  const what = view.step.kind === "pick" ? `PICK GAME ${view.step.game}` : "BAN";
  return `${who}: ${what}`;
}

export function renderBoard(container: HTMLElement, state: BanPickState, opts: BoardOptions = {}): BoardView {
  const view = deriveView(state);
  const label = opts.modeLabel ?? shortMode;
  container.replaceChildren();
  container.classList.add("bp-board");

  const groups = new Map<string, OptionView[]>();
  for (const v of view.options) {
    const list = groups.get(v.option.mode) ?? [];
    list.push(v);
    groups.set(v.option.mode, list);
  }

  for (const [mode, cards] of groups) {
    const group = document.createElement("div");
    group.className = "bp-group";
    group.dataset.mode = mode;
    const title = document.createElement("div");
    title.className = "bp-group-title";
    title.textContent = label(mode);
    group.append(title);

    for (const v of cards) {
      const card = document.createElement(opts.onSelect ? "button" : "div");
      card.className = "bp-card";
      card.dataset.status = v.status;
      card.dataset.id = String(v.option.id);
      if (v.by) card.dataset.by = v.by;
      if (v.game) card.dataset.game = String(v.game);
      if (opts.selectedId === v.option.id) card.classList.add("bp-selected");

      const num = document.createElement("span");
      num.className = "bp-card-num";
      num.textContent = String(v.option.id);
      const map = document.createElement("span");
      map.className = "bp-card-map";
      map.textContent = v.option.map;
      const tag = document.createElement("span");
      tag.className = "bp-card-tag";
      tag.textContent = cardTag(v);
      card.append(num, map, tag);

      if (opts.onSelect) {
        const btn = card as HTMLButtonElement;
        btn.type = "button";
        btn.disabled = v.status !== "open" || view.complete;
        btn.addEventListener("click", () => opts.onSelect?.(v));
      }
      group.append(card);
    }
    container.append(group);
  }
  return view;
}

/** Fills the three game slots: elements must have data-game="1|2|3". */
export function renderGames(container: HTMLElement, view: BoardView): void {
  view.games.forEach((g, i) => {
    const slot = container.querySelector<HTMLElement>(`[data-game="${i + 1}"]`);
    if (!slot) return;
    slot.dataset.filled = g ? "true" : "false";
    const mode = slot.querySelector(".bp-game-mode");
    const map = slot.querySelector(".bp-game-map");
    if (mode) mode.textContent = g ? shortMode(g.option.mode) : "";
    if (map) map.textContent = g ? g.option.map : "TBD";
  });
}
