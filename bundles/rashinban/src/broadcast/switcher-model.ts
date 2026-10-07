// Declarative description of the switcher's layer strip, shared by both
// outputs. The panel renders rows from this; tests check the data logic.
import { layersEqual, type BroadcastOutput } from "./state.ts";

export type Control =
  | { kind: "toggle"; path: readonly string[]; label: string }
  | { kind: "select"; path: readonly string[]; label: string; options: readonly (readonly [string, string])[] }
  | { kind: "text"; path: readonly string[]; label: string };
export type Row = { id: string; title: string; controls: readonly Control[] };

const PAGE: Control = {
  kind: "select",
  path: ["playerCards", "page"],
  label: "Page",
  options: [
    ["profile", "Profile"],
    ["stats", "Stats"],
  ],
};
const CARDS: Row = {
  id: "playerCards",
  title: "Player cards",
  controls: [{ kind: "toggle", path: ["playerCards", "visible"], label: "Visible" }, PAGE],
};
const BANPICK: Row = {
  id: "banpick",
  title: "Ban & Pick",
  controls: [{ kind: "toggle", path: ["banpick", "visible"], label: "Visible" }],
};

const STREAM_ROWS: readonly Row[] = [
  CARDS,
  {
    id: "lowerThird",
    title: "Lower third",
    controls: [
      { kind: "toggle", path: ["lowerThird", "visible"], label: "Visible" },
      {
        kind: "select",
        path: ["lowerThird", "mode"],
        label: "Mode",
        options: [
          ["match", "Current match"],
          ["text", "Free text"],
        ],
      },
      { kind: "text", path: ["lowerThird", "title"], label: "Title" },
      { kind: "text", path: ["lowerThird", "subtitle"], label: "Subtitle" },
    ],
  },
  {
    id: "casters",
    title: "Casters",
    controls: [
      { kind: "toggle", path: ["casters", "titleBar"], label: "Title bar + banner" },
      { kind: "toggle", path: ["casters", "slots", "0"], label: "Left card" },
      { kind: "toggle", path: ["casters", "slots", "1"], label: "Right card" },
    ],
  },
  BANPICK,
];
const LED_ROWS: readonly Row[] = [
  { id: "presenter", title: "Presenter", controls: [{ kind: "toggle", path: ["presenter", "visible"], label: "Visible" }] },
  CARDS,
  BANPICK,
];

export function controlRows(output: BroadcastOutput): readonly Row[] {
  return output === "stream" ? STREAM_ROWS : LED_ROWS;
}

/** Read the value at `path`; own properties only, so "constructor" etc. do not resolve via the prototype. */
export function valueAt(obj: unknown, path: readonly string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (typeof cur !== "object" || cur === null || !Object.hasOwn(cur, key)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/**
 * Nested patch setting one control to `value`. Array leaves (caster slots)
 * cannot be patched by index, so a numeric last segment reads the current
 * pair from `layers` and the patch carries the full pair with that index
 * replaced. Calls without an index segment ignore `layers`.
 */
export function patchAt(path: readonly string[], value: unknown, layers: unknown): Record<string, unknown> {
  if (path.length === 0) throw new Error("patchAt: path must not be empty");
  const keys = [...path];
  let leaf: unknown = value;
  const last = keys[keys.length - 1]!;
  if (/^\d+$/.test(last)) {
    keys.pop();
    const current = valueAt(layers, keys);
    if (!Array.isArray(current)) throw new Error(`patchAt: ${keys.join(".")} is not an array`);
    const pair: unknown[] = [...current];
    pair[Number(last)] = value;
    leaf = pair;
  }
  return keys.reduceRight<unknown>((acc, key) => ({ [key]: acc }), leaf) as Record<string, unknown>;
}

/** True when any control in the row differs between the two layer sets. */
export function rowDirty(row: Row, preview: unknown, program: unknown): boolean {
  return row.controls.some((c) => !layersEqual(valueAt(preview, c.path), valueAt(program, c.path)));
}
