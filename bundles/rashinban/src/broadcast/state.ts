// Broadcast buses: what each output (stream, LED) shows on air (program) and
// what its operator is lining up (preview). Pure functions; the extension
// owns the replicant, the dashboard edits preview, TAKE copies it to program.

import { relayName } from "../presenter/relay-protocol.ts";
import { SLIDE_MODES, validSlideIndex, type SlidesLayer } from "./slides.ts";

export type BroadcastOutput = "stream" | "led" | "en";
export const BROADCAST_OUTPUTS: readonly BroadcastOutput[] = ["stream", "led", "en"];

// `stats` remains the persisted/Companion key for Page 2, now tournament results.
export type CardPage = "profile" | "stats" | "compact";
export type PlayerCardsLayer = { visible: boolean; page: CardPage; player: "left" | "right"; position: "left" | "right" };
export type LowerThirdLayer = { visible: boolean; mode: "match" | "scores" | "text"; title: string; subtitle: string; comingUp: boolean };
export type CastersLayer = {
  /** Keep the existing pair for Companion's /casters/1 and /casters/2 routes. */
  slots: [boolean, boolean];
  center: boolean;
  names: { left: string; right: string; center: string };
};
export type ToggleLayer = { visible: boolean };

export type PlayerCamerasLayer = { left: boolean; right: boolean; relay: string };

export type StreamLayers = {
  slides: SlidesLayer;
  playerCameras: PlayerCamerasLayer;
  interval: ToggleLayer;
  bracket: ToggleLayer;
  playerCards: PlayerCardsLayer;
  lowerThird: LowerThirdLayer;
  casters: CastersLayer;
  banpick: ToggleLayer;
};
export type LedLayers = {
  playerCards: PlayerCardsLayer;
  banpick: ToggleLayer;
  presenter: ToggleLayer;
  bracket: ToggleLayer;
};
export type LayersFor<O extends BroadcastOutput> = O extends "led" ? LedLayers : StreamLayers;
export type OutputBus<L> = { program: L; preview: L };
export type BroadcastState = { stream: OutputBus<StreamLayers>; led: OutputBus<LedLayers>; en: OutputBus<StreamLayers> };

/** Recursive patch type: every leaf optional. */
export type Patch<L> = { [K in keyof L]?: L[K] extends object ? (L[K] extends readonly unknown[] ? L[K] : Patch<L[K]>) : L[K] };

export class BroadcastError extends Error {
  override name = "BroadcastError";
}

export const MAX_TEXT = 120;

// ---- Schema -----------------------------------------------------------------
// Each leaf names its validator; objects nest. "boolean" defaults to false and
// "boolean:true" to true. Arrays are described by "booleanPair" because the
// only array in the buses is the caster slot pair. A string list is an enum
// whose first entry is the default.
type Leaf = "boolean" | "boolean:true" | "text" | "relay" | "booleanPair" | "slideIndex" | readonly string[];
type Spec = { [key: string]: Leaf | Spec };

/**
 * The spec shape a layer type demands: every field present, each leaf kind
 * matching the field's TypeScript type. `satisfies SpecOf<...>` below is what
 * makes the `as LayersFor<O>` casts in the public API trustworthy.
 */
type SpecOf<L> = {
  [K in keyof L]-?: L[K] extends boolean
    ? "boolean" | "boolean:true"
    : L[K] extends readonly boolean[]
      ? "booleanPair"
      : L[K] extends string
        ? string extends L[K]
          ? "text" | "relay"
          : readonly L[K][]
        : L[K] extends number ? "slideIndex" : SpecOf<L[K]>;
};

const CARD_SPEC = { visible: "boolean", page: ["profile", "stats", "compact"], player: ["left", "right"], position: ["left", "right"] } as const satisfies SpecOf<PlayerCardsLayer>;
const TOGGLE_SPEC = { visible: "boolean" } as const satisfies SpecOf<ToggleLayer>;
const STREAM_SPEC = {
  slides: { visible: "boolean", mode: SLIDE_MODES, index: "slideIndex" },
  playerCameras: { left: "boolean", right: "boolean", relay: "relay" },
  interval: TOGGLE_SPEC,
  bracket: TOGGLE_SPEC,
  playerCards: CARD_SPEC,
  lowerThird: { visible: "boolean", mode: ["match", "scores", "text"], title: "text", subtitle: "text", comingUp: "boolean" },
  casters: { slots: "booleanPair", center: "boolean", names: { left: "text", right: "text", center: "text" } },
  banpick: TOGGLE_SPEC,
} as const satisfies SpecOf<StreamLayers>;
const LED_SPEC = { playerCards: CARD_SPEC, banpick: TOGGLE_SPEC, presenter: TOGGLE_SPEC, bracket: TOGGLE_SPEC } as const satisfies SpecOf<LedLayers>;
const SPECS: Record<BroadcastOutput, Spec> = { stream: STREAM_SPEC, led: LED_SPEC, en: STREAM_SPEC };

function isLeaf(spec: Leaf | Spec): spec is Leaf {
  return typeof spec === "string" || Array.isArray(spec);
}

function defaultFor(spec: Leaf | Spec): unknown {
  if (spec === "slideIndex") return 0;
  if (spec === "boolean") return false;
  if (spec === "boolean:true") return true;
  if (spec === "text") return "";
  if (spec === "relay") return "main";
  if (spec === "booleanPair") return [false, false];
  if (Array.isArray(spec)) return spec[0];
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(spec as Spec)) out[key] = defaultFor(child);
  return out;
}

function validLeaf(spec: Leaf, value: unknown): boolean {
  if (spec === "slideIndex") return typeof value === "number" && Number.isInteger(value) && value >= 0;
  if (spec === "relay") {
    if (typeof value !== "string") return false;
    try { relayName(value); return true; } catch { return false; }
  }
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
    // Own-property lookup only: "constructor", "__proto__", "toString" etc.
    // must not resolve through Object.prototype into the spec.
    const child = Object.hasOwn(spec, key) ? spec[key] : undefined;
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

/** Narrow an untrusted value to an output name; throws BroadcastError otherwise. */
export function parseOutput(output: unknown): BroadcastOutput {
  if (output !== "stream" && output !== "led" && output !== "en") throw new BroadcastError("output must be stream, led or en");
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
    en: { program: defaultLayers("en"), preview: defaultLayers("en") },
  };
}

/** Coerce anything (e.g. a persisted replicant value) into a valid state. Never throws. */
export function withDefaults(value: unknown, legacyCasters?: unknown): BroadcastState {
  const source = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const bus = <O extends BroadcastOutput>(output: O): OutputBus<LayersFor<O>> => {
    const raw = typeof source[output] === "object" && source[output] !== null ? (source[output] as Record<string, unknown>) : {};
    const restore = (value: unknown): LayersFor<O> => {
      const layers = repair(SPECS[output], value) as LayersFor<O>;
      if (output !== "led") {
        const slides = (layers as StreamLayers).slides;
        const rawSlides = (value as Partial<StreamLayers> | null)?.slides;
        if (rawSlides && (!SLIDE_MODES.includes(rawSlides.mode) || !validSlideIndex(slides.mode, rawSlides.index))) {
          slides.index = 0;
          slides.visible = false;
        }
      }
      if (output === "stream" && typeof value === "object" && value !== null) {
        const cards = (value as Record<string, unknown>).playerCards;
        // Older cards were positioned by player. Preserve that side on migration.
        if (typeof cards === "object" && cards !== null && !Object.hasOwn(cards, "position")) {
          layers.playerCards.position = layers.playerCards.player;
        }
        const casters = (value as Record<string, unknown>).casters;
        // Only migrate buses that predate name selection in the switcher.
        // An intentionally cleared name must never be filled back in on restart.
        if (typeof casters === "object" && casters !== null && !Object.hasOwn(casters, "names")) {
          const legacy = legacyCasters as { slots?: { name?: unknown }[] } | null | undefined;
          const slots = Array.isArray(legacy?.slots) ? legacy.slots : [];
          for (const [index, side] of ["left", "right"].entries()) {
            const name = slots[index]?.name;
            if (validLeaf("text", name)) (layers as StreamLayers).casters.names[side as "left" | "right"] = name as string;
          }
        }
      }
      return layers;
    };
    return {
      program: restore(raw.program),
      preview: restore(raw.preview),
    };
  };
  return { stream: bus("stream"), led: bus("led"), en: bus("en") };
}

/** Deep-merge a validated partial onto a layer set; throws BroadcastError on invalid input. */
export function mergeLayers<O extends BroadcastOutput>(output: O, base: LayersFor<O>, patch: Patch<LayersFor<O>>): LayersFor<O> {
  const layers = merge(SPECS[parseOutput(output)], base, patch) as LayersFor<O>;
  if (output !== "led") {
    const slides = (layers as StreamLayers).slides;
    if (!validSlideIndex(slides.mode, slides.index)) throw new BroadcastError("invalid value for slides.index");
  }
  return layers;
}

export function setPreview<O extends BroadcastOutput>(state: BroadcastState, output: O, patch: Patch<LayersFor<O>>): BroadcastState {
  const o = parseOutput(output);
  return replaceBus(state, o, { preview: mergeLayers(o, state[o].preview, patch) });
}

export function cutProgram<O extends BroadcastOutput>(state: BroadcastState, output: O, patch: Patch<LayersFor<O>>): BroadcastState {
  const o = parseOutput(output);
  return replaceBus(state, o, { program: mergeLayers(o, state[o].program, patch) });
}

export function take(state: BroadcastState, output: BroadcastOutput): BroadcastState {
  const o = parseOutput(output);
  return replaceBus(state, o, { program: copy(state[o].preview) });
}

export function revertPreview(state: BroadcastState, output: BroadcastOutput): BroadcastState {
  const o = parseOutput(output);
  return replaceBus(state, o, { preview: copy(state[o].program) });
}

/** Exchange the two buses together, retaining the old program in preview. */
export function swap(state: BroadcastState, output: BroadcastOutput): BroadcastState {
  const o = parseOutput(output);
  return replaceBus(state, o, { program: copy(state[o].preview), preview: copy(state[o].program) });
}

/** Hide all preview layers while keeping their content and configuration. */
export function clearPreview(state: BroadcastState, output: BroadcastOutput): BroadcastState {
  const o = parseOutput(output);
  if (o !== "led") return setPreview(state, o, {
    slides: { visible: false },
    playerCameras: { left: false, right: false },
    playerCards: { visible: false },
    lowerThird: { visible: false },
    casters: { slots: [false, false], center: false },
    interval: { visible: false }, bracket: { visible: false }, banpick: { visible: false },
  });
  return setPreview(state, o, {
    presenter: { visible: false }, playerCards: { visible: false },
    banpick: { visible: false }, bracket: { visible: false },
  });
}

export function layersEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
