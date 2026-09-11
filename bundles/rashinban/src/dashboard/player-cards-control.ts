import { PLAYERCARDS_MESSAGES, REPLICANTS } from "../types/replicants";
import type { PlayerCardsState } from "../sheet/types";
import type { ResolvedMatch } from "../match/state";
const cards = nodecg.Replicant<PlayerCardsState>(REPLICANTS.playerCards);
const match = nodecg.Replicant<ResolvedMatch>(REPLICANTS.matchResolved);
const el = (id: string) => document.getElementById(id)!;
async function send(value: Partial<PlayerCardsState>) {
  try {
    await nodecg.sendMessage(PLAYERCARDS_MESSAGES.set, value);
    el("error").textContent = "";
  } catch (error) {
    el("error").textContent = (error as Error).message;
  }
}
el("cards-visible").onclick = () => send({ visible: !cards.value?.visible });
el("cards-page").onclick = () =>
  send({ page: cards.value?.page === "stats" ? "profile" : "stats" });
cards.on("change", (value) => {
  el("cards-visible").textContent = value?.visible
    ? "Cards visible"
    : "Cards hidden";
  el("cards-page").textContent =
    `Page: ${value?.page === "stats" ? "STATS" : "PROFILE"}`;
});
match.on("change", (value) => {
  el("preview").textContent = value
    ? `${value.left.name} vs ${value.right.name}`
    : "No current match";
});
