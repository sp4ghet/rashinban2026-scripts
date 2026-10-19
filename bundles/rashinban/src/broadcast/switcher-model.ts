// Declarative description of the switcher's layer strip, shared by both
// outputs. The panel renders rows from this; tests check the data logic.
import { layersEqual, type BroadcastOutput, type PlayerCardsLayer } from "./state.ts";

export type Control =
  | { kind: "toggle"; path: readonly string[]; label: string }
  | { kind: "select"; path: readonly string[]; label: string; options: readonly (readonly [string, string])[] }
  | { kind: "text"; path: readonly string[]; label: string };
export type Row = { id: string; title: string; controls: readonly Control[] };

const PAGE: Control = {
  kind: "select",
  path: ["playerCards", "page"],
  label: "Mode",
  options: [
    ["profile", "Page 1 · Profile"],
    ["stats", "Page 2 · Results"],
    ["compact", "Compact"],
  ],
};
const CARDS: Row = {
  id: "playerCards",
  title: "Player cards",
  controls: [
    { kind: "toggle", path: ["playerCards", "visible"], label: "Visible" }, PAGE,
  ],
};
const BANPICK: Row = {
  id: "banpick",
  title: "Ban & Pick",
  controls: [{ kind: "toggle", path: ["banpick", "visible"], label: "Visible" }],
};
const INTERVAL: Row = {
  id: "interval", title: "Interval",
  controls: [{ kind: "toggle", path: ["interval", "visible"], label: "Visible" }],
};
const BRACKET: Row = {
  id: "bracket", title: "Bracket",
  controls: [{ kind: "toggle", path: ["bracket", "visible"], label: "Visible" }],
};

const STREAM_ROWS: readonly Row[] = [
  {
    id: "playerCameras", title: "Player cameras",
    controls: [
      { kind: "toggle", path: ["playerCameras", "left"], label: "Player Camera 1" },
      { kind: "toggle", path: ["playerCameras", "right"], label: "Player Camera 2" },
      { kind: "text", path: ["playerCameras", "relay"], label: "Relay" },
    ],
  },
  { ...CARDS, controls: [CARDS.controls[0]!,
    { kind: "select", path: ["playerCards", "player"], label: "Player", options: [["left", "P1 TBD"], ["right", "P2 TBD"]] },
    { kind: "select", path: ["playerCards", "position"], label: "Position", options: [["left", "Left"], ["right", "Right"]] },
    ...CARDS.controls.slice(1)] },
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
          ["match", "Between matches · Matchup"],
          ["scores", "Between games · Scores"],
          ["text", "Free text"],
        ],
      },
      { kind: "toggle", path: ["lowerThird", "comingUp"], label: "Coming up" },
      { kind: "text", path: ["lowerThird", "title"], label: "Title" },
      { kind: "text", path: ["lowerThird", "subtitle"], label: "Subtitle" },
    ],
  },
  {
    id: "casters",
    title: "Casters",
    controls: [
      { kind: "toggle", path: ["casters", "slots"], label: "L/R Caster" },
      { kind: "select", path: ["casters", "names", "left"], label: "Left", options: [["", "— none —"]] },
      { kind: "select", path: ["casters", "names", "right"], label: "Right", options: [["", "— none —"]] },
      { kind: "toggle", path: ["casters", "center"], label: "Center Card" },
      { kind: "select", path: ["casters", "names", "center"], label: "Center", options: [["", "— none —"]] },
    ],
  },
  BANPICK,
  INTERVAL,
  BRACKET,
];
const LED_ROWS: readonly Row[] = [
  { id: "presenter", title: "Presenter", controls: [{ kind: "toggle", path: ["presenter", "visible"], label: "Visible" }] },
  CARDS,
  BANPICK,
  BRACKET,
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

/** Player swaps restore the matching side; same-player edits keep emergency overrides. */
function selectCard(player: "left" | "right", layers: unknown): Partial<PlayerCardsLayer> {
  const current = valueAt(layers, ["playerCards", "player"]);
  const position = valueAt(layers, ["playerCards", "position"]);
  const page = valueAt(layers, ["playerCards", "page"]);
  if (current === "left" && player === "right" && position === "left") {
    if (page === "stats") return { player, position: "right", page: "profile" };
    if (page === "compact") return { player, position: "right", page: "compact" };
  }
  return current === player ? { player } : { player, position: player };
}

/**
 * Patch a switcher control, including linked stream camera/card selections.
 * Array leaves (caster slots) carry the current pair with one index replaced.
 */
export function patchAt(path: readonly string[], value: unknown, layers: unknown): Record<string, unknown> {
  if (path.length === 0) throw new Error("patchAt: path must not be empty");
  if (path.length === 2 && path[0] === "casters" && path[1] === "slots" && typeof value === "boolean") {
    return { casters: { slots: [value, value] } };
  }
  // Stream cameras and their matching cards are one staged selection.
  if (path.length === 2 && valueAt(layers, ["playerCameras"]) !== undefined) {
    const field = path[1];
    if (path[0] === "playerCameras" && (field === "left" || field === "right") && typeof value === "boolean") {
      return {
        playerCameras: { left: value && field === "left", right: value && field === "right" },
        playerCards: value ? { ...selectCard(field, layers), visible: true } : { visible: false },
      };
    }
    if (path[0] === "playerCards" && field === "player" && (value === "left" || value === "right")) {
      const visible = valueAt(layers, ["playerCards", "visible"]) === true;
      return {
        playerCameras: { left: visible && value === "left", right: visible && value === "right" },
        playerCards: selectCard(value, layers),
      };
    }
    if (path[0] === "playerCards" && field === "visible" && typeof value === "boolean") {
      const player = valueAt(layers, ["playerCards", "player"]);
      return {
        playerCameras: { left: value && player === "left", right: value && player === "right" },
        playerCards: { visible: value },
      };
    }
  }
  // Fullscreen stream scenes replace each other in preview; TAKE remains explicit.
  if (path.length === 2 && path[1] === "visible" && value === true && valueAt(layers, ["interval"]) !== undefined) {
    if (path[0] === "interval") return { interval: { visible: true }, bracket: { visible: false } };
    if (path[0] === "bracket") return { bracket: { visible: true }, interval: { visible: false } };
  }
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

/**
 * Graphics pages a switcher monitor opens for one channel. The stream
 * presenter is opened as a silent preview client so it never takes the
 * program lease; presenter-led.html implies the led role by itself and
 * shows exactly what the wall shows.
 */
export function monitorUrls(output: BroadcastOutput, channel: "preview" | "program"): { info: string; presenter: string } {
  const base = "/bundles/rashinban/graphics";
  return {
    info: `${base}/info-${output}.html?channel=${channel}${output === "stream" ? "&cameraMode=placeholder" : ""}`,
    presenter:
      output === "led"
        ? `${base}/presenter-led.html?channel=${channel}`
        : `${base}/presenter.html?role=preview&channel=${channel}`,
  };
}

/** True when any control in the row differs between the two layer sets. */
export function rowDirty(row: Row, preview: unknown, program: unknown): boolean {
  return row.controls.some((c) => !layersEqual(valueAt(preview, c.path), valueAt(program, c.path)));
}
