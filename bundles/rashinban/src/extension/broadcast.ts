// Broadcast buses: preview/program per output, TAKE and revert, plus the
// Companion routes that used to live on the content replicants. Companion
// has no preview, so its routes cut program directly.
import type NodeCG from "@nodecg/types";
import type { Request, Response } from "express";

import {
  BROADCAST_OUTPUTS,
  BroadcastError,
  createInitialState,
  cutProgram,
  revertPreview,
  setPreview,
  take,
  withDefaults,
  type BroadcastOutput,
  type BroadcastState,
  type Patch,
  type StreamLayers,
} from "../broadcast/state.ts";
import { BROADCAST_MESSAGES, REPLICANTS } from "../types/replicants.ts";

type Ack = NodeCG.Acknowledgement | undefined;

export function registerBroadcast(nodecg: NodeCG.ServerAPI, router: ReturnType<NodeCG.ServerAPI["Router"]>) {
  const rep = nodecg.Replicant<BroadcastState>(REPLICANTS.broadcast, { defaultValue: createInitialState() });
  rep.value = withDefaults(rep.value);
  const current = () => withDefaults(rep.value);

  /** Runs a state transition, reporting BroadcastError via the ack instead of throwing. */
  function mutate(ack: Ack, fn: (state: BroadcastState) => BroadcastState): BroadcastState | null {
    try {
      rep.value = fn(current());
      if (ack && !ack.handled) ack(null, rep.value);
      return rep.value;
    } catch (error) {
      if (!(error instanceof BroadcastError)) throw error;
      nodecg.log.warn(`broadcast: rejected: ${error.message}`);
      if (ack && !ack.handled) ack(error);
      return null;
    }
  }
  const record = (data: unknown): Record<string, unknown> => {
    if (typeof data !== "object" || data === null) throw new BroadcastError("payload must be an object");
    return data as Record<string, unknown>;
  };
  const output = (value: unknown): BroadcastOutput => {
    if (!BROADCAST_OUTPUTS.includes(value as BroadcastOutput)) throw new BroadcastError("output must be stream or led");
    return value as BroadcastOutput;
  };

  nodecg.listenFor(BROADCAST_MESSAGES.setPreview, (data: unknown, ack) =>
    mutate(ack, (s) => {
      const body = record(data);
      return setPreview(s, output(body.output), body.patch as never);
    }));
  nodecg.listenFor(BROADCAST_MESSAGES.take, (data: unknown, ack) =>
    mutate(ack, (s) => take(s, output(record(data).output))));
  nodecg.listenFor(BROADCAST_MESSAGES.revertPreview, (data: unknown, ack) =>
    mutate(ack, (s) => revertPreview(s, output(record(data).output))));

  // ---- Companion (Generic HTTP) ---------------------------------------------
  // Each route answers with the output's program layers after the change.
  function respond(res: Response, out: BroadcastOutput, fn: (state: BroadcastState) => BroadcastState) {
    try {
      rep.value = fn(current());
      res.json(rep.value[out].program);
    } catch (error) {
      if (!(error instanceof BroadcastError)) throw error;
      res.status(400).json({ error: error.message });
    }
  }
  const outputParam = (req: Request, res: Response): BroadcastOutput | null => {
    const value = String(req.params.output);
    if (BROADCAST_OUTPUTS.includes(value as BroadcastOutput)) return value as BroadcastOutput;
    res.status(400).json({ error: "output must be stream or led" });
    return null;
  };
  router.post("/broadcast/:output/take", (req, res) => {
    const out = outputParam(req, res);
    if (out) respond(res, out, (s) => take(s, out));
  });
  router.post("/broadcast/:output/revert", (req, res) => {
    const out = outputParam(req, res);
    if (out) respond(res, out, (s) => revertPreview(s, out));
  });

  const stream = () => current().stream.program;
  const cut = (res: Response, patch: Patch<StreamLayers>) => respond(res, "stream", (s) => cutProgram(s, "stream", patch));
  router.post("/banpick/show", (_req, res) => cut(res, { banpick: { visible: true } }));
  router.post("/banpick/hide", (_req, res) => cut(res, { banpick: { visible: false } }));
  router.post("/banpick/toggle", (_req, res) => cut(res, { banpick: { visible: !stream().banpick.visible } }));
  router.post("/playercards/show", (_req, res) => cut(res, { playerCards: { visible: true } }));
  router.post("/playercards/hide", (_req, res) => cut(res, { playerCards: { visible: false } }));
  router.post("/playercards/toggle", (_req, res) => cut(res, { playerCards: { visible: !stream().playerCards.visible } }));
  router.post("/playercards/profile", (_req, res) => cut(res, { playerCards: { page: "profile" } }));
  router.post("/playercards/stats", (_req, res) => cut(res, { playerCards: { page: "stats" } }));
  router.post("/playercards/flip", (_req, res) =>
    cut(res, { playerCards: { page: stream().playerCards.page === "stats" ? "profile" : "stats" } }));
  for (const index of [0, 1] as const) {
    const slots = (value: boolean): [boolean, boolean] => {
      const next = [...stream().casters.slots] as [boolean, boolean];
      next[index] = value;
      return next;
    };
    router.post(`/casters/${index + 1}/show`, (_req, res) => cut(res, { casters: { slots: slots(true) } }));
    router.post(`/casters/${index + 1}/hide`, (_req, res) => cut(res, { casters: { slots: slots(false) } }));
    router.post(`/casters/${index + 1}/toggle`, (_req, res) => cut(res, { casters: { slots: slots(!stream().casters.slots[index]) } }));
  }
}
