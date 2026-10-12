// Shared live data binding for the standalone and LED bracket layouts.
import { emptyRow, type BracketFinals } from "../../bracket/finals.ts";
import { REPLICANTS } from "../../types/replicants.ts";
import { renderBracket, type BracketLayout } from "./svg.ts";

export function mountBracketView(root: SVGSVGElement, layout: BracketLayout): void {
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
  nodecg.Replicant<BracketFinals>(REPLICANTS.bracketFinals).on("change", value => {
    const rows = new Map((value?.rows ?? []).map(row => [row.match, row]));
    for (const { match, group, line, border, names, scores } of parts) {
      const row = rows.get(match.id) ?? emptyRow(match.id);
      if (match.optional) {
        const display = row.top || row.bottom ? "" : "none";
        group.style.display = display;
        if (line) line.style.display = display;
      }
      border.classList.toggle("active", row.active);
      for (const [index, side] of (["top", "bottom"] as const).entries()) {
        names[index]!.textContent = row[side];
        names[index]!.parentElement?.classList.toggle("winner", row.winner === side);
        scores[index]!.textContent = row[`${side}Score`];
      }
    }
  });
}
