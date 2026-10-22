// Shared cards: stream shows the selected player; LED shows both.
import { bindMatch } from "../broadcast/match.ts";
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

  // Measure the full profile even in Compact, so its shared fields never jump
  // when the lower section switches to results. Only surplus spacing shrinks.
  function fitProfileSpacing() {
    const kanedaLoaded = Array.from(document.fonts).some(font => font.family.includes("kaneda-gothic") && font.weight === "700" && font.status === "loaded");
    root.dataset.headingFont = kanedaLoaded ? "kaneda" : "fallback";
    const page = root.dataset.page;
    root.dataset.page = "profile";
    for (const card of cards) {
      if (card.hidden) continue;
      card.style.removeProperty("--profile-gap");
      card.style.removeProperty("--profile-head-h");
      const style = getComputedStyle(card);
      const scale = parseFloat(style.getPropertyValue("--card-scale"));
      const gap = parseFloat(getComputedStyle(mustQuery(card, ".page-profile")).rowGap);
      const head = mustQuery(card, ".head");
      let headBounds = head.getBoundingClientRect();
      const contentBottom = Math.max(...Array.from(head.children, child => child.getBoundingClientRect().bottom));
      // Keep names inside the solid band even when LED leaves a larger gap
      // between that band and the profile fields.
      const bandGap = parseFloat(getComputedStyle(head, "::before").bottom);
      const clearance = Math.max(28 * scale, bandGap + 8 * scale);
      const requiredHeadHeight = contentBottom - headBounds.top + clearance;
      if (requiredHeadHeight > headBounds.height) {
        card.style.setProperty("--profile-head-h", `${requiredHeadHeight}px`);
        headBounds = head.getBoundingClientRect();
      }
      const bottom = card.getBoundingClientRect().bottom - parseFloat(style.paddingBottom);
      let overflow = mustQuery(card, ".page-details").getBoundingClientRect().bottom - bottom;
      if (overflow <= 0) continue;
      const spare = Math.max(0, headBounds.bottom - contentBottom - clearance);
      const reduction = Math.min(spare, overflow);
      card.style.setProperty("--profile-head-h", `${headBounds.height - reduction}px`);
      overflow -= reduction;
      // Two upper gaps, the details margin, and the gap between food/message.
      if (overflow > 0) card.style.setProperty("--profile-gap", `${Math.max(0, gap - Math.ceil(overflow / 4))}px`);
    }
    root.dataset.page = page;
  }

  function render() {
    root.classList.toggle("visible", layer.visible && match !== null);
    root.dataset.page = layer.page;
    root.dataset.position = layer.position;
    root.dataset.source = match?.source ?? "";
    const now = Date.now();
    for (const [index, sideName] of (["left", "right"] as const).entries()) {
      const card = cards[index]!;
      const side = match?.[sideName] ?? null;
      card.hidden = output !== "led" && layer.player !== sideName;
      renderCard(card, side);
      const results: PlayerCardResults = side && layer.visible && !card.hidden && layer.page !== "profile"
        ? playerCardResults(bracket, side, profiles, match?.setId ?? null, layer.page === "compact" ? 3 : 5, now)
        : { rows: [], status: "empty" };
      renderResults(card, results);
    }
    fitProfileSpacing();
  }

  bindMatch(value => { match = value; render(); }, output === "en");
  nodecg.Replicant<StartggBracket | null>(REPLICANTS.startggBracket).on("change", value => { bracket = value ?? null; render(); });
  nodecg.Replicant<PlayerProfile[]>(output === "en" ? REPLICANTS.playersEn : REPLICANTS.players).on("change", value => { profiles = value ?? []; render(); });
  // Adobe and the Japanese fallback may finish loading after the first render.
  document.fonts.ready.then(fitProfileSpacing);
  document.fonts.addEventListener("loadingdone", fitProfileSpacing);
  render();
  return { apply(next) { layer = next; render(); } };
}
