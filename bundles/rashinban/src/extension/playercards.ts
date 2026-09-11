// Player-card presentation controls. Identity comes from the Current Match service.
import type NodeCG from "@nodecg/types";

import type { PlayerCardsState } from "../sheet/types";
import { PLAYERCARDS_MESSAGES, REPLICANTS } from "../types/replicants";

export function registerPlayerCards(nodecg: NodeCG.ServerAPI, router: ReturnType<NodeCG.ServerAPI["Router"]>) {
  const cards = nodecg.Replicant<PlayerCardsState>(REPLICANTS.playerCards, { defaultValue: { visible: false, page: "profile" } });


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
}
