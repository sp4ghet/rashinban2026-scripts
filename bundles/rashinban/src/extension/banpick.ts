import type NodeCG from "@nodecg/types";

import {
  BanPickError,
  applyAction,
  createInitialState,
  reset,
  undo,
  type BanPickState,
  type Player,
} from "../banpick/rules";
import { BANPICK_MESSAGES, REPLICANTS } from "../types/replicants";

type Ack = NodeCG.Acknowledgement | undefined;

export function registerBanPick(nodecg: NodeCG.ServerAPI, router: ReturnType<NodeCG.ServerAPI["Router"]>) {
  const rep = nodecg.Replicant<BanPickState>(REPLICANTS.banPick, {
    defaultValue: createInitialState(),
  });
  // Older builds persisted an on-air flag here; visibility now lives in the broadcast bus.
  if (rep.value && "visible" in rep.value) {
    const { visible: _visible, ...rest } = rep.value as BanPickState & { visible?: unknown };
    rep.value = rest;
  }
  const state = () => rep.value ?? createInitialState();

  /** Runs a state transition, reporting BanPickError via the ack instead of throwing. */
  const mutate = (ack: Ack, fn: (s: BanPickState) => BanPickState) => {
    try {
      rep.value = fn(state());
      if (ack && !ack.handled) ack(null, rep.value);
      return true;
    } catch (err) {
      if (!(err instanceof BanPickError)) throw err;
      nodecg.log.warn(`banpick: rejected: ${err.message}`);
      if (ack && !ack.handled) ack(err);
      return false;
    }
  };

  nodecg.listenFor(BANPICK_MESSAGES.act, (data: { optionId?: unknown; player?: unknown }, ack) => {
    const optionId = Number(data?.optionId);
    const player = data?.player === "A" || data?.player === "B" ? (data.player as Player) : undefined;
    mutate(ack, (s) => {
      if (!Number.isInteger(optionId)) throw new BanPickError("optionId must be an integer");
      return applyAction(s, optionId, player);
    });
  });

  nodecg.listenFor(BANPICK_MESSAGES.undo, (_data, ack) => mutate(ack, undo));
  nodecg.listenFor(BANPICK_MESSAGES.reset, (_data, ack) => mutate(ack, reset));

  // Companion (Generic HTTP) endpoints, mounted under /rashinban/banpick.
  // Show/hide/toggle live on the broadcast bus (see ./broadcast.ts).
  const respond = (res: { json: (body: unknown) => void }) => {
    const s = state();
    res.json({ step: s.actions.length, complete: s.actions.length >= 8 });
  };
  router.post("/banpick/undo", (_req, res) => { mutate(undefined, undo); respond(res); });
  router.post("/banpick/reset", (_req, res) => { mutate(undefined, reset); respond(res); });
}
