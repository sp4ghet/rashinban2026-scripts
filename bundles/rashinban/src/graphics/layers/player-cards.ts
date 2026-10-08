// Player cards layer: two cards for the current match, filled from the
// sheet profiles and the start.gg bracket. Visibility and the profile/stats
// page come from the broadcast bus via apply().
import type { ResolvedMatch, ResolvedSide } from "../../match/state.ts";
import type { PlayerCardsLayer } from "../../broadcast/state.ts";
import { REPLICANTS } from "../../types/replicants.ts";
import { mustQuery, type Layer } from "./layer.ts";

// Local copies (scripts/fetch-flags.mjs) so the overlay works offline.
// Only ISO 3166 alpha-2 codes have a file; anything else shows no flag.
const FLAG_URL = (code: string) => (/^[a-z]{2}$/i.test(code) ? `assets/images/flags/${code.toLowerCase()}.png` : "");

/**
 * One card (class "pcard"): header with name + handle, a profile page of
 * labelled fields, and a stats page with the win-rate table, rounds played
 * and best/worst country flags. Both cards share this markup; only the id
 * differs (#card-1 red, #card-2 blue via the stylesheet).
 */
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
    <div class="field"><span><span class="label">Favorite food</span></span><span class="value favorite-food"></span></div>
    <div class="field"><span><span class="label">Message</span></span><span class="value message"></span></div>
  </div>
  <div class="page page-stats">
    <table>
      <colgroup><col class="c-rate" /><col class="c-played" /><col class="c-place" /></colgroup>
      <thead><tr><th>Match win rate</th><th>Played</th><th>Placement</th></tr></thead>
      <tbody>
        <tr><td><span><i class="k">ALL</i><b class="winrate-all"></b></span></td><td><span><i class="k">ALL</i><b class="played-all"></b></span></td><td><span><i class="k">ALL</i><b class="placement-all"></b></span></td></tr>
        <tr><td><span><i class="k">MOVE</i><b class="winrate-move"></b></span></td><td><span><i class="k">MOVE</i><b class="played-move"></b></span></td><td><span><i class="k">MOVE</i><b class="placement-move"></b></span></td></tr>
        <tr><td><span><i class="k">NO MOVE</i><b class="winrate-nm"></b></span></td><td><span><i class="k">NO MOVE</i><b class="played-nm"></b></span></td><td><span><i class="k">NO MOVE</i><b class="placement-nm"></b></span></td></tr>
        <tr><td><span><i class="k">NMPZ</i><b class="winrate-nmpz"></b></span></td><td><span><i class="k">NMPZ</i><b class="played-nmpz"></b></span></td><td><span><i class="k">NMPZ</i><b class="placement-nmpz"></b></span></td></tr>
      </tbody>
    </table>
    <div class="rounds"><span class="label">Rounds played</span><span class="rounds-played"></span></div>
    <div class="countries">
      <span class="label">Major country diff</span>
      <div class="flags">
        <div><span>[BEST]</span><img class="flag-best" hidden alt="" /></div>
        <div><span>[WORST]</span><img class="flag-worst" hidden alt="" /></div>
      </div>
    </div>
  </div>
</div>`;
}

const TEMPLATE = `<div id="cards" data-page="profile">${cardMarkup("card-1")}<div id="round"></div>${cardMarkup("card-2")}</div>`;

function text(el: Element, sel: string, value: string) {
  const t = el.querySelector(sel);
  if (t) t.textContent = value;
}

function flag(el: Element, sel: string, code: string) {
  const img = el.querySelector<HTMLImageElement>(sel);
  if (!img) return;
  const url = FLAG_URL(code);
  if (url) {
    img.src = url;
    img.alt = code.toUpperCase();
    img.hidden = false;
  } else {
    img.removeAttribute("src");
    img.hidden = true;
  }
}

function renderCard(card: HTMLElement, mp: ResolvedSide) {
  const profile = mp.profile;
  const name = mp.name;
  card.dataset.missing = profile ? "false" : "true";
  card.dataset.empty = name === "TBD" ? "true" : "false";
  text(card, ".name", name);
  text(card, ".twitter", mp.handle ? `@${mp.handle.replace(/^@/, "")}` : "");
  text(card, ".age", profile?.age ?? "");
  text(card, ".rating", profile?.rating ?? "");
  text(card, ".favorite-mode", profile?.favoriteMode ?? "");
  text(card, ".strengths", profile?.strengths ?? "");
  text(card, ".favorite-food", profile?.favoriteFood ?? "");
  text(card, ".message", profile?.message ?? "");
  for (const key of ["all", "move", "nm", "nmpz"] as const) {
    text(card, `.winrate-${key}`, profile?.winRate[key] ?? "");
    text(card, `.played-${key}`, profile?.played[key] ?? "");
    text(card, `.placement-${key}`, profile?.placement[key] ?? "");
  }
  text(card, ".rounds-played", profile?.roundsPlayed ?? "");
  flag(card, ".flag-best", profile?.bestCountry ?? "");
  flag(card, ".flag-worst", profile?.worstCountry ?? "");
}

export function mountPlayerCards(host: HTMLElement): Layer<PlayerCardsLayer> {
  host.innerHTML = TEMPLATE;
  const root = mustQuery(host, "#cards");
  const roundEl = mustQuery(host, "#round");
  const card1 = mustQuery(host, "#card-1");
  const card2 = mustQuery(host, "#card-2");

  let match: ResolvedMatch | null = null;
  let layer: PlayerCardsLayer = { visible: false, page: "profile" };

  function render() {
    root.classList.toggle("visible", layer.visible);
    root.dataset.page = layer.page;
    if (!match) return;
    root.dataset.source = match.source;
    renderCard(card1, match.left);
    renderCard(card2, match.right);
    roundEl.textContent = match.label;
  }

  nodecg.Replicant<ResolvedMatch | null>(REPLICANTS.matchResolved).on("change", (v) => {
    match = v ?? null;
    render();
  });

  return {
    apply(next) {
      layer = next;
      render();
    },
  };
}
