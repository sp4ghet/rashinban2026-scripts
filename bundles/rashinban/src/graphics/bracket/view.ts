// Shared live data binding for the standalone and LED bracket layouts.
import { matchProfile } from "../../match/identity.ts";
import type { PlayerProfile } from "../../sheet/players.ts";
import { emptyRow, type BracketFinals } from "../../bracket/finals.ts";
import { REPLICANTS } from "../../types/replicants.ts";
import { anchors, BOX, renderBracket, type BracketLayout } from "./svg.ts";

export function mountBracketView(root: SVGSVGElement, layout: BracketLayout, english = false): { fitNames(): void } {
  renderBracket(layout, {
    linesHost: root.querySelector("#bracket-lines")!,
    matchesHost: root.querySelector("#bracket-matches")!,
  });
  // Keep references scoped to this view, and update the existing SVG nodes.
  const parts = layout.matches.map(match => {
    const part = (suffix = "") => root.querySelector<SVGElement>(`#match${match.id}${suffix}`);
    return {
      match,
      group: part()!,
      line: part("-bracket-line"),
      border: part("-border")!,
      names: [part("-top")!, part("-bottom")!],
      scores: [part("-score-top")!, part("-score-bottom")!],
    };
  });
  let value: BracketFinals | undefined;
  let profiles: PlayerProfile[] = [];
  let sharedProfiles: PlayerProfile[] = [];
  const champion = root.querySelector<SVGTextElement>(".bracket-champion");
  const box = layout.box ?? BOX;
  function fitNames() {
    for (const { names } of parts) for (const name of names) {
      const text = name as SVGTextElement;
      text.removeAttribute("textLength");
      text.removeAttribute("lengthAdjust");
      const available = box.right - box.scoreWidth - box.nameX * 2;
      if (text.getComputedTextLength() > available) {
        text.setAttribute("textLength", String(available));
        text.setAttribute("lengthAdjust", "spacingAndGlyphs");
      }
    }
  }
  function render() {
    const rows = new Map((value?.rows ?? []).map(row => [row.match, row]));
    let championshipMatch = layout.matches.find(match => match.round === "Grand Final");
    for (const { match, group, line, border, names, scores } of parts) {
      const row = rows.get(match.id) ?? emptyRow(match.id);
      if (match.optional) {
        const display = row.top || row.bottom ? "" : "none";
        group.style.display = display;
        if (line) line.style.display = display;
        if (display !== "none") championshipMatch = match;
      }
      border.classList.toggle("active", row.active);
      for (const [index, side] of (["top", "bottom"] as const).entries()) {
        const identity = { entrantId: row[`${side}EntrantId`], tag: row[side] };
        const shared = english ? matchProfile(sharedProfiles, identity).profile : null;
        const translated = english ? matchProfile(profiles, { ...identity, uid: shared?.geoguessrPlayerUid }).profile : null;
        names[index]!.textContent = translated?.name || row[side];
        names[index]!.parentElement?.classList.toggle("winner", row.winner === side);
        scores[index]!.textContent = row[`${side}Score`];
      }
    }
    if (champion && championshipMatch) {
      const position = anchors(championshipMatch, layout.colX, box);
      champion.setAttribute("x", String(position.centerX));
      champion.setAttribute("y", String(championshipMatch.y - (layout.championGap ?? 24)));
    }
    fitNames();
  }
  // Refit after Adobe's display face and Japanese fallback finish loading.
  void document.fonts.ready.then(fitNames);
  document.fonts.addEventListener("loadingdone", fitNames);
  render();
  nodecg.Replicant<BracketFinals>(REPLICANTS.bracketFinals).on("change", next => { value = next; render(); });
  if (english) {
    nodecg.Replicant<PlayerProfile[]>(REPLICANTS.playersEn).on("change", next => { profiles = next ?? []; render(); });
    nodecg.Replicant<PlayerProfile[]>(REPLICANTS.players).on("change", next => { sharedProfiles = next ?? []; render(); });
  }
  return { fitNames };
}
