// Shared cards: stream shows the selected player; LED shows both.
import type { ResolvedMatch, ResolvedSide } from "../../match/state.ts";
import { defaultLayers, type BroadcastOutput, type PlayerCardsLayer } from "../../broadcast/state.ts";
import { playerCardResults, type PlayerCardResults } from "../../broadcast/player-card-results.ts";
import type { StartggBracket } from "../../startgg/types.ts";
import type { PlayerProfile } from "../../sheet/players.ts";
import { REPLICANTS } from "../../types/replicants.ts";
import { mustQuery, type Layer } from "./layer.ts";

function cardMarkup(id: string): string {
  return `<div class="pcard" id="${id}">
  <div class="head"><span class="name">TBD</span><span class="twitter"></span></div>
  <div class="page page-profile">
    <div class="pair">
      <div class="field"><span class="label">Age</span><span class="value age"></span></div>
      <div class="field"><span class="label">Rating</span><span class="value rating"></span></div>
    </div>
    <div class="field"><span><span class="label">Favorite game mode</span></span><span class="value favorite-mode"></span></div>
    <div class="field"><span><span class="label">Strengths</span></span><span class="value strengths"></span></div>
  </div>
  <div class="page page-details profile-only">
    <div class="field"><span><span class="label">Favorite food</span></span><span class="value favorite-food"></span></div>
    <div class="field"><span><span class="label">Message</span></span><span class="value message"></span></div>
  </div>
  <div class="page page-results">
    <div class="results-heading"><span class="label">Recent games</span></div>
    <ol class="result-list"></ol>
    <div class="results-empty"></div>
  </div>
</div>`;
}

const TEMPLATE = `<div id="cards" data-page="profile">${cardMarkup("card-1")}${cardMarkup("card-2")}</div>`;
function text(el: Element, sel: string, value: string) {
  const target = el.querySelector(sel);
  if (target) target.textContent = value;
}

function renderResults(card: HTMLElement, results: PlayerCardResults) {
  const list = mustQuery(card, ".result-list");
  list.replaceChildren(...results.rows.map(result => {
    const row = document.createElement("li");
    row.className = "result-row";
    row.dataset.outcome = result.outcome;
    for (const [className, value] of [["result-round", result.round], ["result-opponent", `vs. ${result.opponent}`], ["result-score", result.score]]) {
      const span = document.createElement("span");
      span.className = className!;
      span.textContent = value!;
      row.append(span);
    }
    return row;
  }));
  const empty = { ready: "", unavailable: "Results unavailable", unlinked: "No tournament results linked", empty: "No recorded results" };
  text(card, ".results-empty", empty[results.status]);
}

function renderCard(card: HTMLElement, side: ResolvedSide | null) {
  const profile = side?.profile;
  card.dataset.missing = side && !profile ? "true" : "false";
  card.dataset.empty = !side || side.name === "TBD" ? "true" : "false";
  text(card, ".name", side?.name || "TBD");
  text(card, ".twitter", side?.handle ? `@${side.handle.replace(/^@/, "")}` : "");
  text(card, ".age", profile?.age ?? "");
  text(card, ".rating", profile?.rating ?? "");
  text(card, ".favorite-mode", profile?.favoriteMode ?? "");
  text(card, ".strengths", profile?.strengths ?? "");
  text(card, ".favorite-food", profile?.favoriteFood ?? "");
  text(card, ".message", profile?.message ?? "");
}

export function mountPlayerCards(host: HTMLElement, output: BroadcastOutput): Layer<PlayerCardsLayer> {
  host.innerHTML = TEMPLATE;
  const root = mustQuery(host, "#cards");
  const cards = [mustQuery(host, "#card-1"), mustQuery(host, "#card-2")];
  let match: ResolvedMatch | null = null;
  let bracket: StartggBracket | null = null;
  let profiles: PlayerProfile[] = [];
  let layer = defaultLayers(output).playerCards;

  function render() {
    root.classList.toggle("visible", layer.visible && match !== null);
    root.dataset.page = layer.page;
    root.dataset.position = layer.position;
    root.dataset.source = match?.source ?? "";
    const now = Date.now();
    for (const [index, sideName] of (["left", "right"] as const).entries()) {
      const card = cards[index]!;
      const side = match?.[sideName] ?? null;
      card.hidden = output === "stream" && layer.player !== sideName;
      renderCard(card, side);
      const results: PlayerCardResults = side && layer.visible && !card.hidden && layer.page !== "profile"
        ? playerCardResults(bracket, side, profiles, match?.setId ?? null, layer.page === "compact" ? 3 : 5, now)
        : { rows: [], status: "empty" };
      renderResults(card, results);
    }
  }

  nodecg.Replicant<ResolvedMatch | null>(REPLICANTS.matchResolved).on("change", value => { match = value ?? null; render(); });
  nodecg.Replicant<StartggBracket | null>(REPLICANTS.startggBracket).on("change", value => { bracket = value ?? null; render(); });
  nodecg.Replicant<PlayerProfile[]>(REPLICANTS.players).on("change", value => { profiles = value ?? []; render(); });
  render();
  return { apply(next) { layer = next; render(); } };
}
