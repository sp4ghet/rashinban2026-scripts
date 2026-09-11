// Current-match selection and player-card presentation state, plus
// Companion endpoints. The match itself is resolved client-side from the
// startggBracket replicant (see src/match/current.ts).
import type NodeCG from "@nodecg/types";

import { DEFAULT_SELECTION, type CurrentMatchSelection } from "../match/current";
import type { PlayerCardsState } from "../sheet/types";
import { MATCH_MESSAGES, PLAYERCARDS_MESSAGES, REPLICANTS } from "../types/replicants";

export function registerPlayerCards(nodecg: NodeCG.ServerAPI, router: ReturnType<NodeCG.ServerAPI["Router"]>) {
  const selection = nodecg.Replicant<CurrentMatchSelection>(REPLICANTS.currentMatch, { defaultValue: DEFAULT_SELECTION });
  const cards = nodecg.Replicant<PlayerCardsState>(REPLICANTS.playerCards, { defaultValue: { visible: false, page: "profile" } });

  nodecg.listenFor(MATCH_MESSAGES.setSelection, (data: Partial<CurrentMatchSelection>, ack) => {
    const cur = selection.value ?? DEFAULT_SELECTION;
    const mode = data?.mode === "auto" || data?.mode === "set" || data?.mode === "tags" ? data.mode : cur.mode;
    const setId = data?.setId === null ? null : Number.isInteger(data?.setId) ? (data!.setId as number) : cur.setId;
    const tags: [string, string] = Array.isArray(data?.tags)
      ? [String(data!.tags[0] ?? ""), String(data!.tags[1] ?? "")]
      : cur.tags;
    selection.value = { mode, setId, tags };
    if (ack && !ack.handled) ack(null, selection.value);
  });

  const setCards = (patch: Partial<PlayerCardsState>) => {
    const cur = cards.value ?? { visible: false, page: "profile" as const };
    cards.value = {
      visible: typeof patch.visible === "boolean" ? patch.visible : cur.visible,
      page: patch.page === "profile" || patch.page === "stats" ? patch.page : cur.page,
    };
    return cards.value;
  };

  nodecg.listenFor(PLAYERCARDS_MESSAGES.set, (data: Partial<PlayerCardsState>, ack) => {
    const v = setCards(data ?? {});
    if (ack && !ack.handled) ack(null, v);
  });

  router.post("/playercards/show", (_req, res) => res.json(setCards({ visible: true })));
  router.post("/playercards/hide", (_req, res) => res.json(setCards({ visible: false })));
  router.post("/playercards/toggle", (_req, res) => res.json(setCards({ visible: !cards.value?.visible })));
  router.post("/playercards/profile", (_req, res) => res.json(setCards({ page: "profile" })));
  router.post("/playercards/stats", (_req, res) => res.json(setCards({ page: "stats" })));
  router.post("/playercards/flip", (_req, res) => res.json(setCards({ page: cards.value?.page === "stats" ? "profile" : "stats" })));
  router.post("/match/auto", (_req, res) => {
    selection.value = { ...(selection.value ?? DEFAULT_SELECTION), mode: "auto" };
    res.json(selection.value);
  });
}
