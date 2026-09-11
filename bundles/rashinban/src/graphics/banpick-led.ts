// Ban & Pick overlay (led). Read-only view of the banPick replicant.
import { createInitialState, type BanPickState } from "../banpick/rules";
import { REPLICANTS } from "../types/replicants";
import { playerName, renderBoard, renderGames, stepText } from "./banpick/board";

const rep = nodecg.Replicant<BanPickState>(REPLICANTS.banPick);

const root = document.getElementById("banpick")!;
const board = document.getElementById("board")!;
const games = document.getElementById("games")!;
const nameA = document.getElementById("name-a")!;
const nameB = document.getElementById("name-b")!;
const step = document.getElementById("step")!;

rep.on("change", (raw) => {
  const state = raw ?? createInitialState();
  root.classList.toggle("visible", state.visible);
  nameA.textContent = playerName(state, "A");
  nameB.textContent = playerName(state, "B");
  const view = renderBoard(board, state);
  step.textContent = stepText(state, view);
  root.dataset.turn = view.step?.player ?? "";
  root.classList.toggle("complete", view.complete);
  renderGames(games, view);
});
