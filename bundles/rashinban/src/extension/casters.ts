// Caster slot selection. The caster list itself is published by the sheet
// poller (see ./sheet.ts); this owns which two are on air.
import type NodeCG from "@nodecg/types";

import {
  DEFAULT_CASTERS_STATE,
  withDefaults,
  withSheetDefaults,
  type Caster,
  type CasterSlot,
  type CastersState,
} from "../casters/casters.ts";
import { CASTERS_MESSAGES, REPLICANTS } from "../types/replicants.ts";

/** One slot's edit: { slot: 0 | 1, name?: string, enabled?: boolean }. */
export interface CasterSlotEdit extends Partial<CasterSlot> {
  slot: number;
}

export function registerCasters(nodecg: NodeCG.ServerAPI, router: ReturnType<NodeCG.ServerAPI["Router"]>) {
  const state = nodecg.Replicant<CastersState>(REPLICANTS.castersState, {
    defaultValue: structuredClone(DEFAULT_CASTERS_STATE),
  });
  const casters = nodecg.Replicant<Caster[]>(REPLICANTS.casters, { defaultValue: [] });

  // Repair anything persisted by an older build before the graphic reads it.
  state.value = withDefaults(state.value ?? undefined);

  // Pre-fill empty slots from sheet order so a fresh install has something to
  // enable; never overwrites a slot the operator has chosen.
  casters.on("change", (value) => {
    if (!value?.length) return;
    state.value = withSheetDefaults(withDefaults(state.value ?? undefined), value);
  });

  function setSlot(edit: CasterSlotEdit): CastersState {
    const current = withDefaults(state.value ?? undefined);
    const index = edit.slot;
    if (index !== 0 && index !== 1) throw new Error("slot must be 0 or 1");
    const slot = current.slots[index]!;
    current.slots[index] = {
      name: typeof edit.name === "string" ? edit.name.trim() : slot.name,
      enabled: typeof edit.enabled === "boolean" ? edit.enabled : slot.enabled,
    };
    state.value = current;
    return current;
  }

  nodecg.listenFor(CASTERS_MESSAGES.setSlot, (data: CasterSlotEdit, ack) => {
    try {
      const next = setSlot(data ?? ({} as CasterSlotEdit));
      if (ack && !ack.handled) ack(null, next);
    } catch (error) {
      if (ack && !ack.handled) ack(error instanceof Error ? error : new Error("Unable to set caster slot"));
    }
  });

  // Companion: toggle either card without opening the dashboard.
  for (const index of [0, 1] as const) {
    router.post(`/casters/${index + 1}/show`, (_req, res) => res.json(setSlot({ slot: index, enabled: true })));
    router.post(`/casters/${index + 1}/hide`, (_req, res) => res.json(setSlot({ slot: index, enabled: false })));
    router.post(`/casters/${index + 1}/toggle`, (_req, res) =>
      res.json(setSlot({ slot: index, enabled: !withDefaults(state.value ?? undefined).slots[index]!.enabled })),
    );
  }
}
