// Casters (解説 / 実況) authored in the Google Sheet "casters" tab.
// The sheet is the directory of who *could* be on air; which two are actually
// shown is operator state held in the castersState replicant.
// See docs/sheet/README.md for the column list.

export interface Caster {
  /** Free text, shown in the card's header strip ("解説", "実況"). */
  role: string;
  /** Display name, and the key a slot refers to. */
  name: string;
  /** Handle without the leading "@". */
  twitter: string;
}

/** One on-screen card: which caster it shows, and whether it is on air. */
export interface CasterSlot {
  /** Caster.name, or "" for an unassigned slot. */
  name: string;
  enabled: boolean;
}

/** Left card, right card. Always exactly two. */
export interface CastersState {
  slots: [CasterSlot, CasterSlot];
}

export const CASTER_SLOT_COUNT = 2;

export const EMPTY_SLOT: CasterSlot = { name: "", enabled: false };

export const DEFAULT_CASTERS_STATE: CastersState = {
  slots: [{ ...EMPTY_SLOT }, { ...EMPTY_SLOT }],
};

/** Sheet column -> caster field. Keys are lower-case header names. */
export const CASTER_COLUMNS = {
  role: "role",
  name: "name",
  twitter: "twitter",
} as const;

/**
 * Rows from the casters tab. Rows without a name are dropped: the name is the
 * key a slot refers to, so a nameless row could never be selected.
 */
export function parseCasters(rows: Record<string, string>[]): Caster[] {
  const casters: Caster[] = [];
  for (const row of rows) {
    const name = (row.name ?? "").trim();
    if (!name) continue;
    casters.push({
      role: (row.role ?? "").trim(),
      name,
      twitter: (row.twitter ?? "").trim().replace(/^@/, ""),
    });
  }
  return casters;
}

export function findCaster(casters: Caster[], name: string): Caster | null {
  if (!name) return null;
  const wanted = name.trim().toLowerCase();
  return casters.find((c) => c.name.trim().toLowerCase() === wanted) ?? null;
}

/** Repairs stored/partial state so the graphic always gets two slots. */
export function withDefaults(value: Partial<CastersState> | undefined): CastersState {
  const slots = Array.isArray(value?.slots) ? value.slots : [];
  const slot = (index: number): CasterSlot => {
    const raw = slots[index] as Partial<CasterSlot> | undefined;
    return {
      name: typeof raw?.name === "string" ? raw.name : "",
      enabled: typeof raw?.enabled === "boolean" ? raw.enabled : false,
    };
  };
  return { slots: [slot(0), slot(1)] };
}

/**
 * Fills empty slots from the sheet order (first row left, second right) without
 * disturbing slots the operator has already set. Newly filled slots stay off
 * air until enabled.
 */
export function withSheetDefaults(state: CastersState, casters: Caster[]): CastersState {
  const slots = state.slots.map((slot, index) => {
    if (slot.name) return { ...slot };
    const fallback = casters[index];
    return fallback ? { name: fallback.name, enabled: slot.enabled } : { ...slot };
  }) as [CasterSlot, CasterSlot];
  return { slots };
}
