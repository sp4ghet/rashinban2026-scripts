// Broadcast buses: what each output (stream, LED) shows on air (program) and
// what its operator is lining up (preview). Pure functions; the extension
// owns the replicant, the dashboard edits preview, TAKE copies it to program.

export type BroadcastOutput = "stream" | "led";
export const BROADCAST_OUTPUTS: readonly BroadcastOutput[] = ["stream", "led"];

export type CardPage = "profile" | "stats";
export type PlayerCardsLayer = { visible: boolean; page: CardPage };
export type LowerThirdLayer = { visible: boolean; mode: "match" | "text"; title: string; subtitle: string };
export type CastersLayer = { titleBar: boolean; slots: [boolean, boolean] };
export type ToggleLayer = { visible: boolean };

export type StreamLayers = {
  playerCards: PlayerCardsLayer;
  lowerThird: LowerThirdLayer;
  casters: CastersLayer;
  banpick: ToggleLayer;
};
export type LedLayers = {
  playerCards: PlayerCardsLayer;
  banpick: ToggleLayer;
  presenter: ToggleLayer;
};
export type LayersFor<O extends BroadcastOutput> = O extends "stream" ? StreamLayers : LedLayers;
export type OutputBus<L> = { program: L; preview: L };
export type BroadcastState = { stream: OutputBus<StreamLayers>; led: OutputBus<LedLayers> };

/** Recursive patch type: every leaf optional. */
export type Patch<L> = { [K in keyof L]?: L[K] extends object ? (L[K] extends readonly unknown[] ? L[K] : Patch<L[K]>) : L[K] };

export class BroadcastError extends Error {}

export const MAX_TEXT = 120;

// ---- Schema -----------------------------------------------------------------
// Each leaf names its validator; objects nest. "boolean" defaults to false and
// "boolean:true" to true. Arrays are described by "booleanPair" because the
// only array in the buses is the caster slot pair. A string list is an enum
// whose first entry is the default.
type Leaf = "boolean" | "boolean:true" | "text" | "booleanPair" | readonly string[];
type Spec = { [key: string]: Leaf | Spec };
const CARD_SPEC = { visible: "boolean", page: ["profile", "stats"] } as const satisfies Spec;
const TOGGLE_SPEC = { visible: "boolean" } as const satisfies Spec;
const STREAM_SPEC = {
  playerCards: CARD_SPEC,
  lowerThird: { visible: "boolean", mode: ["match", "text"], title: "text", subtitle: "text" },
  casters: { titleBar: "boolean:true", slots: "booleanPair" },
  banpick: TOGGLE_SPEC,
} as const satisfies Spec;
const LED_SPEC = { playerCards: CARD_SPEC, banpick: TOGGLE_SPEC, presenter: TOGGLE_SPEC } as const satisfies Spec;
const SPECS: Record<BroadcastOutput, Spec> = { stream: STREAM_SPEC, led: LED_SPEC };

function isLeaf(spec: Leaf | Spec): spec is Leaf {
  return typeof spec === "string" || Array.isArray(spec);
}

function defaultFor(spec: Leaf | Spec): unknown {
  if (spec === "boolean") return false;
  if (spec === "boolean:true") return true;
  if (spec === "text") return "";
  if (spec === "booleanPair") return [false, false];
  if (Array.isArray(spec)) return spec[0];
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(spec as Spec)) out[key] = defaultFor(child);
  return out;
}

function validLeaf(spec: Leaf, value: unknown): boolean {
  if (spec === "boolean" || spec === "boolean:true") return typeof value === "boolean";
  if (spec === "text") return typeof value === "string" && value.length <= MAX_TEXT;
  if (spec === "booleanPair") return Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === "boolean");
  return typeof value === "string" && (spec as readonly string[]).includes(value);
}

/** Leaves are immutable values except the slot pair, which must not be shared with the caller. */
function copyLeaf(value: unknown): unknown {
  return Array.isArray(value) ? [...value] : value;
}

/** Deep-merge `patch` onto `base` following `spec`; throws on anything the spec does not describe. */
function merge(spec: Spec, base: Record<string, unknown>, patch: unknown, path = ""): Record<string, unknown> {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    throw new BroadcastError(`${path || "patch"} must be an object`);
  }
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const child = spec[key];
    const here = path ? `${path}.${key}` : key;
    if (!child) throw new BroadcastError(`unknown field ${here}`);
    if (isLeaf(child)) {
      if (!validLeaf(child, value)) throw new BroadcastError(`invalid value for ${here}`);
      out[key] = copyLeaf(value);
    } else {
      out[key] = merge(child, base[key] as Record<string, unknown>, value, here);
    }
  }
  return out;
}

/** Lenient repair for persisted data: keeps valid leaves, replaces the rest with defaults. */
function repair(spec: Spec, value: unknown): Record<string, unknown> {
  const source = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(spec)) {
    if (!isLeaf(child)) out[key] = repair(child, source[key]);
    else out[key] = validLeaf(child, source[key]) ? copyLeaf(source[key]) : defaultFor(child);
  }
  return out;
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function parseOutput(output: unknown): BroadcastOutput {
  if (output !== "stream" && output !== "led") throw new BroadcastError("output must be stream or led");
  return output;
}

/** Return a deep copy of `state` with the given bus fields of `output` replaced. */
function replaceBus(
  state: BroadcastState,
  output: BroadcastOutput,
  fields: Partial<OutputBus<Record<string, unknown>>>,
): BroadcastState {
  const next = copy(state);
  Object.assign(next[output], fields);
  return next;
}

// ---- Public API -------------------------------------------------------------

export function defaultLayers<O extends BroadcastOutput>(output: O): LayersFor<O> {
  return defaultFor(SPECS[output]) as LayersFor<O>;
}

export function createInitialState(): BroadcastState {
  return {
    stream: { program: defaultLayers("stream"), preview: defaultLayers("stream") },
    led: { program: defaultLayers("led"), preview: defaultLayers("led") },
  };
}

/** Coerce anything (e.g. a persisted replicant value) into a valid state. Never throws. */
export function withDefaults(value: unknown): BroadcastState {
  const source = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const bus = <O extends BroadcastOutput>(output: O): OutputBus<LayersFor<O>> => {
    const raw = typeof source[output] === "object" && source[output] !== null ? (source[output] as Record<string, unknown>) : {};
    return {
      program: repair(SPECS[output], raw.program) as LayersFor<O>,
      preview: repair(SPECS[output], raw.preview) as LayersFor<O>,
    };
  };
  return { stream: bus("stream"), led: bus("led") };
}

/** Deep-merge a validated partial onto a layer set; throws BroadcastError on invalid input. */
export function mergeLayers<O extends BroadcastOutput>(output: O, base: LayersFor<O>, patch: Patch<LayersFor<O>>): LayersFor<O> {
  return merge(SPECS[parseOutput(output)], base, patch) as LayersFor<O>;
}

export function setPreview<O extends BroadcastOutput>(state: BroadcastState, output: O, patch: Patch<LayersFor<O>>): BroadcastState {
  const o = parseOutput(output);
  return replaceBus(state, o, { preview: merge(SPECS[o], state[o].preview, patch) });
}

export function cutProgram<O extends BroadcastOutput>(state: BroadcastState, output: O, patch: Patch<LayersFor<O>>): BroadcastState {
  const o = parseOutput(output);
  return replaceBus(state, o, { program: merge(SPECS[o], state[o].program, patch) });
}

export function take(state: BroadcastState, output: BroadcastOutput): BroadcastState {
  const o = parseOutput(output);
  return replaceBus(state, o, { program: copy(state[o].preview) });
}

export function revertPreview(state: BroadcastState, output: BroadcastOutput): BroadcastState {
  const o = parseOutput(output);
  return replaceBus(state, o, { preview: copy(state[o].program) });
}

export function layersEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
