import type { LowerThirdLayer } from "./state.ts";

export type LowerThirdMatch = {
  label: string;
  left: { name: string; handle: string };
  right: { name: string; handle: string };
} | null;

const name = (side: { name: string } | undefined): string => side?.name?.trim() || "TBD";

/** Resolve what the lower third shows: operator text, or the current match. */
export function lowerThirdText(layer: LowerThirdLayer, match: LowerThirdMatch): { title: string; subtitle: string } {
  if (layer.mode === "text") return { title: layer.title, subtitle: layer.subtitle };
  return { title: `${name(match?.left)} vs ${name(match?.right)}`, subtitle: match?.label ?? "" };
}
