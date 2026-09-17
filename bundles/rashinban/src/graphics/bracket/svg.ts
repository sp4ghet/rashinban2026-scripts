// SVG generation for the bracket graphic, ported from rashinban2026's
// assets/js/bracket-svg.js. A layout supplies { colX, dividerY, matches,
// connectors } and this module derives the boxes and the lines joining them.
//
// Drawn at 1:1 on the 1920x1080 canvas (no viewBox zoom), so the box is twice
// the 2025 geometry; font sizes to match live in assets/brackets.css.

const SVG_NS = "http://www.w3.org/2000/svg";

export interface LayoutMatch {
  /** Match number, as in the `match_number` column / BracketRow.match. */
  id: number;
  /** Index into the layout's colX. */
  col: number;
  y: number;
  band: "upper" | "lower";
  round: string;
  /** Hidden until it has players (the grand final reset). */
  optional?: boolean;
}

export interface LayoutConnector {
  from: number[];
  to: number;
  /** Explicit polyline for lines that double back; `turns` alternates x, y, x, y... */
  route?: "elbow";
  turns?: number[];
  optional?: boolean;
}

export interface BracketLayout {
  colX: number[];
  dividerY: number;
  matches: LayoutMatch[];
  connectors: LayoutConnector[];
}

/** Geometry of a single match box, relative to its group's translate(). */
export const BOX = {
  left: 0,
  right: 246,
  scoreWidth: 48,
  rowHeight: 44,
  /** y of the bottom player row; the 2px gap above it is the divider */
  bottomRowY: 46,
  /** vertical centre — also where the divider between the two players sits */
  midY: 45,
  /** bottom edge of the lower player row */
  bottom: 90,
} as const;

/** How far right of a feeder's edge two siblings meet before dropping into their next match. */
export const JOIN_OFFSET = 48;

export function anchors(match: LayoutMatch, colX: number[]) {
  const x = colX[match.col]!;
  return {
    left: x + BOX.left,
    right: x + BOX.right,
    midY: match.y + BOX.midY,
    bottom: match.y + BOX.bottom,
    centerX: x + (BOX.left + BOX.right) / 2,
  };
}

function el(name: string, attrs: Record<string, string | number | undefined> = {}): SVGElement {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined) node.setAttribute(key, String(value));
  }
  return node;
}

/** One player row: grey name plate + darker score box on the right. */
function playerRow(matchId: number, position: "top" | "bottom", y: number) {
  const { right: w, scoreWidth: sw, rowHeight: h } = BOX;
  const row = el("svg", { x: 0, y, class: "match--player" });
  row.appendChild(el("title"));
  row.appendChild(el("path", { d: `M 0 0 h ${w} v ${h} h -${w} Z`, class: "match--player-background" }));
  row.appendChild(el("path", { d: `M ${w - sw} 0 h ${sw} v ${h} h -${sw} Z`, class: "match--seed-background" }));
  row.appendChild(
    el("text", {
      id: `match${matchId}-score-${position}`,
      x: w - sw / 2,
      y: position === "top" ? 36 : 37,
      "text-anchor": "middle",
      class: "match--seed",
    }),
  );
  row.appendChild(
    el("text", { id: `match${matchId}-${position}`, x: 10, y: 30, "text-anchor": "start", class: "match--player-name" }),
  );
  if (position === "bottom") {
    row.appendChild(el("line", { x1: 0, y1: -1, x2: w, y2: -1, class: "match--player-divider" }));
  }
  return row;
}

/** A full match group: red "active" border + the two player rows. */
export function buildMatch(match: LayoutMatch, colX: number[]) {
  const group = el("g", {
    id: `match${match.id}`,
    class: "match",
    transform: `translate(${colX[match.col]} ${match.y})`,
    "data-identifier": `match${match.id}`,
    "data-round": match.round,
  });
  if (match.optional) group.setAttribute("style", "display: none");
  group.appendChild(
    el("rect", {
      id: `match${match.id}-border`,
      class: "match-border",
      fill: "none",
      stroke: "red",
      "stroke-width": 6,
      x: -2,
      y: -2,
      width: BOX.right + 4,
      height: BOX.bottom + 4,
    }),
  );
  const rows = el("g");
  rows.appendChild(playerRow(match.id, "top", 0));
  rows.appendChild(playerRow(match.id, "bottom", BOX.bottomRowY));
  group.appendChild(rows);
  return group;
}

/**
 * The `d` for one connector: one source runs straight into the next column,
 * two sources meet on a shared vertical, and `route: 'elbow'` follows `turns`.
 */
export function connectorPath(connector: LayoutConnector, layout: BracketLayout): string {
  const find = (id: number) => {
    const match = layout.matches.find((m) => m.id === id);
    if (!match) throw new Error(`Unknown match id: ${id}`);
    return anchors(match, layout.colX);
  };
  const to = find(connector.to);
  const sources = connector.from.map(find);

  if (connector.route === "elbow") {
    const from = sources[0]!;
    let [x, y] = [from.right, from.midY];
    let d = `M ${x} ${y}`;
    (connector.turns ?? []).forEach((value, i) => {
      if (i % 2 === 0) x = value;
      else y = value;
      d += ` L ${x} ${y}`;
    });
    return d;
  }

  if (sources.length === 1) {
    const from = sources[0]!;
    return `M ${from.right} ${from.midY} L ${to.left} ${from.midY}`;
  }

  const joinX = Math.max(...sources.map((s) => s.right)) + JOIN_OFFSET;
  const top = Math.min(...sources.map((s) => s.midY));
  const bottom = Math.max(...sources.map((s) => s.midY));
  const legs = sources.map((s) => `M ${s.right} ${s.midY} L ${joinX} ${s.midY}`).join(" ");
  return `${legs} M ${joinX} ${top} L ${joinX} ${bottom} M ${joinX} ${to.midY} L ${to.left} ${to.midY}`;
}

export function buildConnector(connector: LayoutConnector, layout: BracketLayout) {
  const group = el("g", { class: "bracket-line-container", id: `match${connector.to}-bracket-line` });
  if (connector.optional) group.setAttribute("style", "display: none");
  group.appendChild(el("path", { d: connectorPath(connector, layout), class: "bracket-line" }));
  return group;
}

/** Lines go in first so the match boxes paint over the ends of them. */
export function renderBracket(layout: BracketLayout, hosts: { linesHost: Element; matchesHost: Element }) {
  const divider = el("g", { class: "bracket-line-container" });
  divider.appendChild(el("path", { d: `M -300 ${layout.dividerY} L 2000 ${layout.dividerY}`, class: "bracket-line" }));
  hosts.linesHost.appendChild(divider);
  for (const connector of layout.connectors) hosts.linesHost.appendChild(buildConnector(connector, layout));
  for (const match of layout.matches) hosts.matchesHost.appendChild(buildMatch(match, layout.colX));
}
