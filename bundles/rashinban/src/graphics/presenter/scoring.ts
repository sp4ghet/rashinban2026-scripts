import type { Projection, SeriesState } from '../../types/presenter.ts';

/** Paint the clock-derived choreography; no local timers or animation replay on mount. */
export function paintScoring(root: HTMLElement, projection: Projection, series: SeriesState): void {
  const el = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
  const s = projection.scoring;
  const active = s && s.stage !== 'complete';
  root.dataset.scoring = s?.stage ?? 'none';
  el('scoring-layer').hidden = !active;
  const rootRect = root.getBoundingClientRect();
  const scale = rootRect.width / (root.clientWidth || 1920) || 1;
  const center = (id: string) => {
    const r = el(id).getBoundingClientRect();
    return { x: (r.left + r.width / 2 - rootRect.left) / scale, y: (r.top + r.height / 2 - rootRect.top) / scale };
  };
  const sides = ['left', 'right'] as const;
  for (const side of sides) {
    const player = projection.players.find(p => p.id === series[side].playerId);
    el(`${side}-score`).textContent = player?.score == null ? '—' : String(player.score);
    const ghost = active && !['entry', 'count', 'score-hold'].includes(s.stage);
    el(`${side}-score`).style.opacity = ghost ? '0.25' : '1';
    const panel = el(`${side}-result`);
    panel.style.opacity = String(active ? s.entryProgress : 1);
    panel.style.transform = `translateY(${active ? 30 * (1 - s.entryProgress) : 0}px)`;
    el(`score-token-${side}`).hidden = true;
    el(`${side}-health`).parentElement!.style.setProperty('--score-impact', active && s.stage === 'impact' && s.loserId === player?.id ? String(1 - s.impactProgress) : '0');
  }
  el('score-calculation').hidden = true;
  if (!active) return;
  const show = (side: 'left' | 'right', value: number, point: { x: number; y: number }, opacity = 1, size = 1) => {
    const token = el(`score-token-${side}`); token.hidden = false; token.textContent = String(value);
    token.style.left = `${point.x}px`; token.style.top = `${point.y}px`; token.style.opacity = String(opacity);
    token.style.transform = `translate(-50%, -50%) scale(${size})`;
  };
  const points = { left: center('left-score'), right: center('right-score') };
  const mix = (a: { x: number; y: number }, b: { x: number; y: number }, p: number) => ({ x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p });
  if (s.stage === 'tie') {
    const midpoint = mix(points.left, points.right, 0.5);
    for (const side of sides) {
      const score = projection.players.find(p => p.id === series[side].playerId)?.score;
      if (score != null) show(side, score, mix(points[side], midpoint, s.subtractProgress), 1 - s.tieProgress, 1 + 0.75 * s.tieProgress);
    }
    return;
  }
  const winner = sides.find(side => series[side].playerId === s.winnerId);
  const loser = sides.find(side => series[side].playerId === s.loserId);
  if (!winner || !loser) return;
  if (s.stage === 'subtract') {
    for (const side of sides) {
      const score = projection.players.find(p => p.id === series[side].playerId)?.score;
      if (score != null) show(side, score, side === winner ? mix(points[winner], points[loser], s.subtractProgress) : points[side]);
    }
  } else if (s.stage === 'difference' || s.stage === 'multiplier') {
    const multiplied = s.stage === 'multiplier';
    const wobble = multiplied ? 1 + 0.3 * Math.exp(-5 * s.multiplierProgress) * Math.cos(10 * s.multiplierProgress) : 1;
    show(loser, multiplied ? s.damage : s.difference, points[loser], 1, wobble);
    if (multiplied) {
      const label = el('score-calculation'); label.hidden = false; label.textContent = `×${s.multiplier}`;
      label.style.left = `${points[loser].x}px`; label.style.top = `${points[loser].y - 75}px`;
    }
  } else if (s.stage === 'flight' || s.stage === 'impact') {
    const hit = center(`${loser}-health`);
    const impact = s.stage === 'impact';
    show(loser, s.damage, impact ? hit : mix(points[loser], hit, s.flightProgress), impact ? 1 - s.impactProgress : 1, impact ? 1.75 : 1);
  }
}
