// Player-facing Ban & Pick panel (tablet). Open with ?player=A or ?player=B
// to lock the tablet to one player; without it, the shared tablet shows
// whose turn it is and accepts input for either player.
import { createInitialState, type BanPickState, type OptionView, type Player } from "../banpick/rules";
import { BANPICK_MESSAGES, REPLICANTS } from "../types/replicants";
import { playerName, renderBoard, renderGames, shortMode, stepText } from "./banpick/board";

const params = new URLSearchParams(location.search);
const lockedPlayer: Player | undefined =
  params.get("player") === "A" ? "A" : params.get("player") === "B" ? "B" : undefined;

const rep = nodecg.Replicant<BanPickState>(REPLICANTS.banPick);

const root = document.getElementById("panel")!;
const board = document.getElementById("board")!;
const games = document.getElementById("games")!;
const nameA = document.getElementById("name-a")!;
const nameB = document.getElementById("name-b")!;
const stepEl = document.getElementById("step")!;
const confirmBar = document.getElementById("confirm")!;
const confirmText = document.getElementById("confirm-text")!;
const confirmBtn = document.getElementById("confirm-yes") as HTMLButtonElement;
const cancelBtn = document.getElementById("confirm-no") as HTMLButtonElement;
const toast = document.getElementById("toast")!;

let state: BanPickState = createInitialState();
let selected: OptionView | null = null;
let toastTimer: number | undefined;

function showToast(message: string) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2500);
}

function render() {
  const view = renderBoard(board, state, {
    selectedId: selected?.option.id ?? null,
    onSelect: (v) => {
      selected = v;
      render();
    },
  });
  nameA.textContent = playerName(state, "A");
  nameB.textContent = playerName(state, "B");
  stepEl.textContent = stepText(state, view);
  root.dataset.turn = view.step?.player ?? "";
  root.dataset.kind = view.step?.kind ?? "";
  root.classList.toggle("complete", view.complete);
  renderGames(games, view);

  const myTurn = !lockedPlayer || view.step?.player === lockedPlayer;
  root.classList.toggle("locked-out", !myTurn && !view.complete);
  if (!myTurn) {
    board.querySelectorAll<HTMLButtonElement>("button.bp-card").forEach((b) => {
      b.disabled = true;
    });
  }

  if (selected && view.step && myTurn) {
    const verb = view.step.kind === "pick" ? `PICK for Game ${view.step.game}` : "BAN";
    confirmText.textContent =
      `${playerName(state, view.step.player)} / ${verb}: ` +
      `${shortMode(selected.option.mode)} ${selected.option.map}`;
    confirmBar.classList.add("visible");
  } else {
    confirmBar.classList.remove("visible");
  }
}

confirmBtn.addEventListener("click", async () => {
  if (!selected) return;
  const optionId = selected.option.id;
  confirmBtn.disabled = true;
  try {
    await nodecg.sendMessage(BANPICK_MESSAGES.act, { optionId, player: lockedPlayer });
  } catch (err) {
    showToast((err as Error)?.message ?? "Rejected");
  } finally {
    selected = null;
    confirmBtn.disabled = false;
    render();
  }
});

cancelBtn.addEventListener("click", () => {
  selected = null;
  render();
});

rep.on("change", (raw) => {
  state = raw ?? createInitialState();
  // Drop a pending selection if that option is no longer open.
  const pending = selected?.option.id;
  if (pending !== undefined && state.actions.some((a) => a.optionId === pending)) selected = null;
  render();
});

if (lockedPlayer) root.dataset.locked = lockedPlayer;
