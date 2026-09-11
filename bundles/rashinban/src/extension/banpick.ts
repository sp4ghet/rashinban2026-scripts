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

  nodecg.listenFor(BANPICK_MESSAGES.setPlayers, (data: { A?: unknown; B?: unknown }, ack) => {
    mutate(ack, (s) => ({
      ...s,
      players: {
        A: typeof data?.A === "string" ? data.A : s.players.A,
        B: typeof data?.B === "string" ? data.B : s.players.B,
      },
    }));
  });

  nodecg.listenFor(BANPICK_MESSAGES.swapPlayers, (_data, ack) => {
    mutate(ack, (s) => ({ ...s, players: { A: s.players.B, B: s.players.A } }));
  });

  nodecg.listenFor(BANPICK_MESSAGES.setVisible, (data: { visible?: unknown }, ack) => {
    mutate(ack, (s) => ({ ...s, visible: Boolean(data?.visible) }));
  });

  // Companion (Generic HTTP) endpoints, mounted under /rashinban/banpick.
  const respond = (res: { json: (body: unknown) => void }) => {
    const s = state();
    res.json({ visible: s.visible, step: s.actions.length, complete: s.actions.length >= 8 });
  };
  router.post("/banpick/show", (_req, res) => { mutate(undefined, (s) => ({ ...s, visible: true })); respond(res); });
  router.post("/banpick/hide", (_req, res) => { mutate(undefined, (s) => ({ ...s, visible: false })); respond(res); });
  router.post("/banpick/toggle", (_req, res) => { mutate(undefined, (s) => ({ ...s, visible: !s.visible })); respond(res); });
  router.post("/banpick/undo", (_req, res) => { mutate(undefined, undo); respond(res); });
  router.post("/banpick/reset", (_req, res) => { mutate(undefined, reset); respond(res); });
}
