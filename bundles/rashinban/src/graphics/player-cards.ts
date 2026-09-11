// Player cards overlay: two cards for the current match, filled from the
// sheet profiles and the start.gg bracket. Generic placeholder design.
import { resolveCurrentMatch, type CurrentMatchSelection, type MatchPlayer } from "../match/current";
import { findProfile, type PlayerProfile } from "../sheet/players";
import type { PlayerCardsState } from "../sheet/types";
import type { StartggBracket } from "../startgg/types";
import { REPLICANTS } from "../types/replicants";

const bracketRep = nodecg.Replicant<StartggBracket | null>(REPLICANTS.startggBracket);
const playersRep = nodecg.Replicant<PlayerProfile[]>(REPLICANTS.players);
const selectionRep = nodecg.Replicant<CurrentMatchSelection>(REPLICANTS.currentMatch);
const cardsRep = nodecg.Replicant<PlayerCardsState>(REPLICANTS.playerCards);

// Local copies (scripts/fetch-flags.mjs) so the overlay works offline.
const FLAG_URL = (code: string) => `assets/images/flags/${code.toLowerCase()}.png`;

let bracket: StartggBracket | null = null;
let players: PlayerProfile[] = [];
let selection: CurrentMatchSelection | undefined;
let cards: PlayerCardsState = { visible: false, page: "profile" };

const root = document.getElementById("cards")!;
const roundEl = document.getElementById("round")!;

function text(el: Element, sel: string, value: string) {
  const t = el.querySelector(sel);
  if (t) t.textContent = value;
}

function flag(el: Element, sel: string, code: string) {
  const img = el.querySelector<HTMLImageElement>(sel);
  if (!img) return;
  if (code) {
    img.src = FLAG_URL(code);
    img.alt = code.toUpperCase();
    img.hidden = false;
  } else {
    img.removeAttribute("src");
    img.hidden = true;
  }
}

function renderCard(card: HTMLElement, mp: MatchPlayer) {
  const profile = findProfile(players, mp.entrant ?? (mp.tag ? { id: -1, tag: mp.tag, name: mp.tag } : null));
  const name = profile?.name || mp.entrant?.tag || mp.tag || "TBD";
  card.dataset.missing = profile ? "false" : "true";
  card.dataset.empty = name === "TBD" ? "true" : "false";
  text(card, ".name", name);
  text(card, ".twitter", profile?.twitter ? `@${profile.twitter}` : "");
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

function render() {
  const match = resolveCurrentMatch(bracket, selection);
  root.classList.toggle("visible", cards.visible);
  root.dataset.page = cards.page;
  root.dataset.source = match.source;
  const p1 = document.getElementById("card-1")!;
  const p2 = document.getElementById("card-2")!;
  renderCard(p1, match.players[0]);
  renderCard(p2, match.players[1]);
  roundEl.textContent = [match.phaseName, match.roundText].filter(Boolean).join(" / ");
}

bracketRep.on("change", (v) => {
  bracket = v ?? null;
  render();
});
playersRep.on("change", (v) => {
  players = v ?? [];
  render();
});
selectionRep.on("change", (v) => {
  selection = v;
  render();
});
cardsRep.on("change", (v) => {
  cards = v ?? { visible: false, page: "profile" };
  render();
});
