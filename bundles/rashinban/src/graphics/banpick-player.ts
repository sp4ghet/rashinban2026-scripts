// Player-facing Ban & Pick panel (tablet). Open with ?player=A or ?player=B
// to lock the tablet to one player; without it, the shared tablet shows
// whose turn it is and accepts input for either player.
import { createInitialState, type BanPickState, type OptionView, type Player } from "../banpick/rules";
import { BANPICK_MESSAGES, REPLICANTS } from "../types/replicants";
import { playerName, renderBoard, shortMode, stepText } from "./banpick/board";

const params = new URLSearchParams(location.search);
const lockedPlayer: Player | undefined =
  params.get("player") === "A" ? "A" : params.get("player") === "B" ? "B" : undefined;

const rep = nodecg.Replicant<BanPickState>(REPLICANTS.banPick);

const root = document.getElementById("panel")!;
const board = document.getElementById("board")!;
const nameA = document.getElementById("name-a")!;
const nameB = document.getElementById("name-b")!;
const stepEl = document.getElementById("step")!;
const toast = document.getElementById("toast")!;

let state: BanPickState = createInitialState();
let selected: OptionView | null = null;
let submitting = false;
let toastTimer: number | undefined;

function fitHeadings() {
  for (const label of [nameA, nameB, stepEl]) {
    label.style.fontSize = "";
    const parent = label.parentElement!;
    const padding = getComputedStyle(parent);
    const available = parent.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight);
    if (available > 0 && label.scrollWidth > available) {
      const size = parseFloat(getComputedStyle(label).fontSize);
      label.style.fontSize = `${Math.floor(size * available / label.scrollWidth * 10) / 10}px`;
    }
  }
}

function showToast(message: string) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2500);
}

function render() {
  const view = renderBoard(board, state, {
    modeLabel: mode => mode === "NM" ? "NO MOVE" : shortMode(mode),
    selectedId: selected?.option.id ?? null,
    onSelect: (v) => {
      if (submitting) return;
      if (selected?.option.id === v.option.id) {
        void submitSelection();
        return;
      }
      selected = v;
      render();
    },
  });
  nameA.textContent = playerName(state, "A");
  nameB.textContent = playerName(state, "B");
  stepEl.textContent = view.step
    ? `${playerName(state, view.step.player)} : ${view.step.kind === "ban" ? "BAN" : `PICK GAME ${view.step.game}`}`
    : stepText(state, view);
  root.dataset.turn = view.step?.player ?? "";
  root.dataset.kind = view.step?.kind ?? "";
  root.classList.toggle("complete", view.complete);
  fitHeadings();

  const myTurn = !lockedPlayer || view.step?.player === lockedPlayer;
  root.classList.toggle("locked-out", !myTurn && !!view.step);
  if (!myTurn || submitting) {
    board.querySelectorAll<HTMLButtonElement>("button.bp-card").forEach((b) => {
      b.disabled = true;
    });
  }
}

async function submitSelection() {
  if (!selected || submitting) return;
  const optionId = selected.option.id;
  submitting = true;
  render();
  try {
    await nodecg.sendMessage(BANPICK_MESSAGES.act, { optionId, player: lockedPlayer });
  } catch (err) {
    showToast((err as Error)?.message ?? "Rejected");
  } finally {
    selected = null;
    submitting = false;
    render();
  }
}

rep.on("change", (raw) => {
  if (raw?.game !== state.game || raw?.actions.length !== state.actions.length) selected = null;
  state = raw ?? createInitialState();
  // Drop a pending selection if that option is no longer open.
  const pending = selected?.option.id;
  if (pending !== undefined && state.actions.some((a) => a.optionId === pending)) selected = null;
  render();
});

if (lockedPlayer) root.dataset.locked = lockedPlayer;
void document.fonts.ready.then(fitHeadings);
document.fonts.addEventListener("loadingdone", fitHeadings);
window.addEventListener("resize", fitHeadings);
