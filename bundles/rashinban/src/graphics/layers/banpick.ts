// Ban & Pick layer: read-only view of the banPick replicant. Visibility comes
// from the broadcast bus via apply().
import { createInitialState, type BanPickState } from "../../banpick/rules.ts";
import type { ToggleLayer } from "../../broadcast/state.ts";
import { REPLICANTS } from "../../types/replicants.ts";
import { playerName, renderBoard, renderGames, stepText } from "../banpick/board.ts";
import { mustQuery, type Layer } from "./layer.ts";

const TEMPLATE = `<div id="banpick">
  <header>
    <div class="player a" id="name-a">Player A</div>
    <div id="step"></div>
    <div class="player b" id="name-b">Player B</div>
  </header>
  <div id="board"></div>
  <footer id="games">
    <div class="bp-game" data-game="1"><span class="bp-game-label">GAME 1</span><span class="bp-game-mode"></span><span class="bp-game-map">TBD</span></div>
    <div class="bp-game" data-game="2"><span class="bp-game-label">GAME 2</span><span class="bp-game-mode"></span><span class="bp-game-map">TBD</span></div>
    <div class="bp-game" data-game="3"><span class="bp-game-label">GAME 3</span><span class="bp-game-mode"></span><span class="bp-game-map">TBD</span></div>
  </footer>
</div>`;

export function mountBanpick(host: HTMLElement): Layer<ToggleLayer> {
  host.innerHTML = TEMPLATE;
  const root = mustQuery(host, "#banpick");
  const board = mustQuery(host, "#board");
  const games = mustQuery(host, "#games");
  const nameA = mustQuery(host, "#name-a");
  const nameB = mustQuery(host, "#name-b");
  const step = mustQuery(host, "#step");

  nodecg.Replicant<BanPickState>(REPLICANTS.banPick).on("change", (raw) => {
    const state = raw ?? createInitialState();
    nameA.textContent = playerName(state, "A");
    nameB.textContent = playerName(state, "B");
    const view = renderBoard(board, state);
    step.textContent = stepText(state, view);
    root.dataset.turn = view.step?.player ?? "";
    renderGames(games, view);
  });

  return {
    apply(layer) {
      root.classList.toggle("visible", layer.visible);
    },
  };
}
