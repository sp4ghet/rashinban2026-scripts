// Declarative description of the switcher's layer strip, shared by both
// outputs. The panel renders rows from this; tests check the data logic.
import type { BroadcastOutput } from "./state.ts";

export type Control =
  | { kind: "toggle"; path: string[]; label: string }
  | { kind: "select"; path: string[]; label: string; options: [string, string][] }
  | { kind: "text"; path: string[]; label: string };
export type Row = { id: string; title: string; controls: Control[] };

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

const STREAM_ROWS: Row[] = [
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
const LED_ROWS: Row[] = [
  { id: "presenter", title: "Presenter", controls: [{ kind: "toggle", path: ["presenter", "visible"], label: "Visible" }] },
  CARDS,
  BANPICK,
];

export function controlRows(output: BroadcastOutput): Row[] {
  return output === "stream" ? STREAM_ROWS : LED_ROWS;
}

/** Read the value at `path`; own properties only, so "constructor" etc. do not resolve via the prototype. */
export function valueAt(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (typeof cur !== "object" || cur === null || !Object.hasOwn(cur, key)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/**
 * Nested patch for one control. Array leaves (caster slots) cannot be patched
 * by index, so the caller passes the current pair and gets a full pair back.
 */
export function patchAt(path: string[], value: unknown, currentPair?: readonly unknown[]): Record<string, unknown> {
  const keys = [...path];
  let leaf: unknown = value;
  const last = keys[keys.length - 1]!;
  if (currentPair && /^\d+$/.test(last)) {
    const pair = [...currentPair];
    pair[Number(last)] = value;
    leaf = pair;
    keys.pop();
  }
  return keys.reduceRight<unknown>((acc, key) => ({ [key]: acc }), leaf) as Record<string, unknown>;
}

/** True when any control in the row differs between the two layer sets. */
export function rowDirty(row: Row, preview: unknown, program: unknown): boolean {
  return row.controls.some((c) => JSON.stringify(valueAt(preview, c.path)) !== JSON.stringify(valueAt(program, c.path)));
}
