// Shared cards: stream shows the selected player; LED shows both.
import { bindMatch } from "../broadcast/match.ts";
import type { ResolvedMatch, ResolvedSide } from "../../match/state.ts";
import { matchProfile } from "../../match/identity.ts";
import { defaultLayers, type BroadcastOutput, type PlayerCardsLayer } from "../../broadcast/state.ts";
import { playerCardResults, playerCardDay1Results, type PlayerCardResults } from "../../broadcast/player-card-results.ts";
import type { InfoRecord, InfoResults } from "../../broadcast/player-info.ts";
import type { StartggBracket } from "../../startgg/types.ts";
import type { PlayerProfile } from "../../sheet/players.ts";
import { REPLICANTS } from "../../types/replicants.ts";
import { mustQuery, type Layer } from "./layer.ts";

function cardMarkup(id: string): string {
  return `<div class="pcard" id="${id}">
  <div class="head"><span class="name">TBD</span><span class="twitter"></span></div>
  <div class="card-body">
    <div class="pair">
      <div class="field"><span class="label">Age</span><span class="value age"></span></div>
      <div class="field"><span class="label">Rating</span><span class="value rating"></span></div>
    </div>
    <div class="page page-profile">
      <div class="field"><span><span class="label">Favorite game mode</span></span><span class="value favorite-mode"></span></div>
      <div class="field"><span><span class="label">Strengths</span></span><span class="value strengths"></span></div>
    </div>
    <div class="page page-details profile-only">
      <div class="field"><span><span class="label">Favorite food</span></span><span class="value favorite-food"></span></div>
      <div class="field"><span><span class="label">Message</span></span><span class="value message"></span></div>
    </div>
    <div class="page page-highlights" hidden>
      <div><span class="label">Career highlights</span></div>
      <div class="highlights-text"></div>
    </div>
    <div class="page page-results">
      <div class="results-heading"><span class="label">Recent matches</span></div>
      <ol class="result-list"></ol>
      <div class="results-empty"></div>
    </div>
    <div class="page page-day1">
      <div><span class="label">Day 1 results</span></div>
      <div class="records">
        <div class="record"><span class="record-label">Matches</span><div class="record-value match-record"></div></div>
        <div class="record"><span class="record-label">Games</span><div class="record-value game-record"></div></div>
      </div>
      <div class="day1-empty"></div>
    </div>
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

function renderDay1(card: HTMLElement, results: InfoResults) {
  const renderRecord = (selector: string, record: InfoRecord | null) => {
    const value = mustQuery(card, selector);
    const count = document.createElement("span"), percent = document.createElement("small");
    count.textContent = record ? `${record.wins}-${record.losses}` : "—";
    percent.textContent = record ? ` (${record.percent})` : "";
    value.replaceChildren(count, percent);
  };
  renderRecord(".match-record", results.setRecord);
  renderRecord(".game-record", results.gameRecord);
  mustQuery(card, ".records").hidden = results.status !== "ready";
  text(card, ".day1-empty", { ready: "", unavailable: "Day 1 results unavailable", unlinked: "No tournament results linked", empty: "No recorded Day 1 results" }[results.status]);
}

function renderCard(card: HTMLElement, side: ResolvedSide | null, profiles: PlayerProfile[]) {
  const profile = side?.profile;
  const source = side ? matchProfile(profiles, { uid: side.uid, entrantId: side.entrantId, tag: side.tag || profile?.startggTag, name: side.name }).profile : null;
  const highlights = profile?.extra?.major_tournament?.trim() || source?.extra?.major_tournament?.trim() || "";
  card.dataset.highlights = String(Boolean(highlights));
  mustQuery(card, ".page-highlights").hidden = !highlights;
  text(card, ".highlights-text", highlights);
  card.dataset.missing = side && !profile ? "true" : "false";
  card.dataset.empty = !side || side.name === "TBD" ? "true" : "false";
  text(card, ".name", side?.name || "TBD");
  text(card, ".twitter", side?.handle ? `@${side.handle.replace(/^@/, "")}` : "");
  for (const [selector, value] of [["age", profile?.age], ["rating", profile?.rating],
    ["favorite-mode", profile?.favoriteMode], ["strengths", profile?.strengths],
    ["favorite-food", profile?.favoriteFood], ["message", profile?.message]]) {
    const el = mustQuery(card, `.${selector}`);
    el.textContent = value?.trim() ?? "";
    el.closest<HTMLElement>(".field")!.hidden = !value?.trim();
  }
  for (const selector of [".pair", ".page-profile", ".page-details"]) {
    const group = mustQuery(card, selector);
    group.hidden = !group.querySelector(".field:not([hidden])");
  }
}

export function mountPlayerCards(host: HTMLElement, output: BroadcastOutput): Layer<PlayerCardsLayer> {
  host.innerHTML = TEMPLATE;
  const root = mustQuery(host, "#cards");
  const cards = [mustQuery(host, "#card-1"), mustQuery(host, "#card-2")];
  let match: ResolvedMatch | null = null;
  let bracket: StartggBracket | null = null;
  let profiles: PlayerProfile[] = [], sharedProfiles: PlayerProfile[] = [];
  let layer = defaultLayers(output).playerCards;

  // Natural height handles sparse profiles; tighten spacing before reducing type
  // only when a long card would extend beyond the Stream or mapped LED frame.
  function fitCards() {
    root.dataset.headingFont = Array.from(document.fonts).some(font => font.family.includes("kaneda-gothic") && font.weight === "700" && font.status === "loaded") ? "kaneda" : "fallback";
    for (const card of cards) {
      if (card.hidden || !card.getClientRects().length) continue;
      for (const prop of ["--section-gap", "--head-height", "--text-scale"]) card.style.removeProperty(prop);
      const scale = parseFloat(getComputedStyle(card).getPropertyValue("--card-scale"));
      const maxHeight = 900 * scale;
      const head = mustQuery(card, ".head");
      const bandGap = parseFloat(getComputedStyle(head, "::before").bottom);
      const clearance = Math.max(24 * scale, bandGap + 8 * scale);
      const headerContent = Math.max(...Array.from(head.children, child => child.getBoundingClientRect().bottom)) - head.getBoundingClientRect().top;
      card.style.setProperty("--head-height", `${Math.max(169 * scale, headerContent + Math.max(32 * scale, clearance))}px`);
      if (card.getBoundingClientRect().height <= maxHeight + 1) continue;
      card.style.setProperty("--head-height", `${headerContent + clearance}px`);
      for (let gap = 32; gap >= 12 && card.getBoundingClientRect().height > maxHeight + 1; gap -= 4) {
        card.style.setProperty("--section-gap", `${gap * scale}px`);
      }
      for (let size = 95; size >= 60 && card.getBoundingClientRect().height > maxHeight + 1; size -= 5) {
        card.style.setProperty("--text-scale", (size / 100).toFixed(2));
      }
    }
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
      renderCard(card, side, sharedProfiles);
      const showResults = side && layer.visible && !card.hidden && layer.page !== "profile";
      renderResults(card, showResults && layer.page === "stats"
        ? playerCardResults(bracket, side, profiles, match?.setId ?? null, 5, now)
        : { rows: [], status: "empty" });
      renderDay1(card, showResults ? playerCardDay1Results(bracket, side, profiles, match?.setId ?? null, now)
        : { rows: [], status: "empty", placement: "", setRecord: null, gameRecord: null });
    }
    fitCards();
  }

  bindMatch(value => { match = value; render(); }, output === "en");
  nodecg.Replicant<StartggBracket | null>(REPLICANTS.startggBracket).on("change", value => { bracket = value ?? null; render(); });
  nodecg.Replicant<PlayerProfile[]>(REPLICANTS.players).on("change", value => {
    sharedProfiles = value ?? [];
    if (output !== "en") profiles = sharedProfiles;
    render();
  });
  if (output === "en") nodecg.Replicant<PlayerProfile[]>(REPLICANTS.playersEn).on("change", value => { profiles = value ?? []; render(); });
  document.fonts.ready.then(fitCards);
  document.fonts.addEventListener("loadingdone", fitCards);
  render();
  return { apply(next) { layer = next; render(); } };
}
