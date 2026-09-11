// Operator panel for Ban & Pick: player names, undo/reset, overlay
// visibility, and a clickable board to act on a player's behalf.
import { createInitialState, type BanPickState, type OptionView } from "../banpick/rules";
import { BANPICK_MESSAGES, REPLICANTS } from "../types/replicants";
import { renderBoard, renderGames, shortMode, stepText } from "../graphics/banpick/board";

const rep = nodecg.Replicant<BanPickState>(REPLICANTS.banPick);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const nameA = $<HTMLInputElement>("name-a");
const nameB = $<HTMLInputElement>("name-b");
const visibleBtn = $<HTMLButtonElement>("visible");
const undoBtn = $<HTMLButtonElement>("undo");
const resetBtn = $<HTMLButtonElement>("reset");
const stepEl = $<HTMLElement>("step");
const board = $<HTMLElement>("board");
const games = $<HTMLElement>("games");
const status = $<HTMLElement>("status");
const playerLink = $<HTMLAnchorElement>("player-link");

let state: BanPickState = createInitialState();
let selected: OptionView | null = null;

playerLink.href = `${location.origin}/bundles/rashinban/graphics/banpick-player.html`;
playerLink.textContent = playerLink.href;

function flash(message: string, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

async function send(name: string, data?: unknown) {
  try {
    await nodecg.sendMessage(name, data);
    flash("");
  } catch (err) {
    flash((err as Error)?.message ?? "Rejected", true);
  }
}

function render() {
  const view = renderBoard(board, state, {
    selectedId: selected?.option.id ?? null,
    onSelect: async (v) => {
      if (selected?.option.id === v.option.id) {
        // Second click on the same card confirms.
        selected = null;
        await send(BANPICK_MESSAGES.act, { optionId: v.option.id });
      } else {
        selected = v;
        flash(`Click again to confirm ${shortMode(v.option.mode)} ${v.option.map}`);
      }
      render();
    },
  });
  stepEl.textContent = stepText(state, view);
  stepEl.dataset.turn = view.step?.player ?? "";
  renderGames(games, view);
  visibleBtn.textContent = state.visible ? "Hide overlay" : "Show overlay";
  visibleBtn.classList.toggle("active", state.visible);
  undoBtn.disabled = state.actions.length === 0;
  if (document.activeElement !== nameA) nameA.value = state.players.A;
  if (document.activeElement !== nameB) nameB.value = state.players.B;
}

visibleBtn.addEventListener("click", () => send(BANPICK_MESSAGES.setVisible, { visible: !state.visible }));
undoBtn.addEventListener("click", () => send(BANPICK_MESSAGES.undo));
resetBtn.addEventListener("click", () => {
  if (state.actions.length === 0 || confirm("Reset the Ban & Pick? All bans and picks will be cleared.")) {
    void send(BANPICK_MESSAGES.reset);
  }
});

rep.on("change", (raw) => {
  state = raw ?? createInitialState();
  const pending = selected?.option.id;
  if (pending !== undefined && state.actions.some((a) => a.optionId === pending)) selected = null;
  render();
});
