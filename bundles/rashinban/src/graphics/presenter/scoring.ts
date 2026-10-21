import type { Projection, SeriesState } from '../../types/presenter.ts';
import { pointAwardMotion, scoreMotion } from './scoring-motion.ts';

/** Paint the clock-derived choreography; no local timers or animation replay on mount. */
export function paintScoring(root: HTMLElement, projection: Projection, series: SeriesState): void {
  const el = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
  const s = projection.scoring;
  const active = s && s.stage !== 'complete';
  const motion = s ? scoreMotion(s) : null;
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
    const ghost = active && !['entry', 'count', 'score-hold', 'verdict'].includes(s.stage);
    el(`${side}-score`).style.opacity = ghost ? '0.25' : String(active ? motion!.rise : 1);
    el(`${side}-score`).style.transform = `translateY(${active && !ghost ? 50 * (1 - motion!.rise) : 0}px)`;
    const panel = el(`${side}-result`);
    panel.style.opacity = String(active ? motion!.entry : 1);
    panel.style.transform = `scale(${active ? 0.9 + 0.1 * motion!.entry : 1})`;
    el(`score-token-${side}`).hidden = true;
    el(`${side}-health`).parentElement!.style.setProperty('--score-impact', active && s.stage === 'impact' && s.loserId === player?.id ? String(motion!.impactOpacity) : '0');
  }
  el('score-calculation').hidden = true;
  el('verdict').hidden = true;
  if (!active || !motion) return;
  const show = (side: 'left' | 'right', value: number | string, point: { x: number; y: number }, opacity = 1, size = 1) => {
    const token = el(`score-token-${side}`); token.hidden = false; token.textContent = String(value);
    token.style.left = `${point.x}px`; token.style.top = `${point.y}px`; token.style.opacity = String(opacity);
    token.style.transform = `translate(-50%, -50%) scale(${size})`;
  };
  if (s.pinpointing) {
    const winner = sides.find(side => series[side].playerId === s.winnerId);
    const gained = Math.max(...s.pinpointing.points);
    const award = pointAwardMotion(s);
    if (s.stage === 'verdict' && winner && gained > 0 && award.opacity > 0) {
      // Reuse the damage token beside the inward-facing edge of the pip bar.
      const bar = el(`${winner}-health`).parentElement!.getBoundingClientRect();
      show(winner, `+${gained}`, {
        x: ((winner === 'left' ? bar.right : bar.left) - rootRect.left) / scale + (winner === 'left' ? 42 : -42),
        y: (bar.top + bar.height / 2 - rootRect.top) / scale,
      }, award.opacity, award.scale);
    }
    return;
  }
  const points = { left: center('left-score'), right: center('right-score') };
  const mix = (a: { x: number; y: number }, b: { x: number; y: number }, p: number) => ({ x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p });
  if (s.stage === 'tie') {
    const midpoint = mix(points.left, points.right, 0.5);
    for (const side of sides) {
      const score = projection.players.find(p => p.id === series[side].playerId)?.score;
      if (score != null) show(side, score, mix(points[side], midpoint, motion.travel), motion.tieOpacity, motion.tieScale);
    }
    return;
  }
  const winner = sides.find(side => series[side].playerId === s.winnerId);
  const loser = sides.find(side => series[side].playerId === s.loserId);
  if (!winner || !loser) return;
  if (s.stage === 'subtract') {
    for (const side of sides) {
      const score = projection.players.find(p => p.id === series[side].playerId)?.score;
      if (score != null) show(side, score, side === winner ? mix(points[winner], points[loser], motion.travel) : points[side]);
    }
  } else if (s.stage === 'difference' || s.stage === 'multiplier') {
    const multiplied = s.stage === 'multiplier';
    const winnerScore = projection.players.find(p => p.id === series[winner].playerId)?.score;
    if (winnerScore != null && motion.collisionOpacity > 0.001) {
      show(winner, winnerScore, mix(points[winner], points[loser], motion.travel), motion.collisionOpacity, motion.collisionScale);
    }
    show(loser, multiplied ? s.damage : s.difference,
      { x: points[loser].x + (winner === 'left' ? 1 : -1) * motion.wobble, y: points[loser].y }, 1, motion.damageScale);
  } else if (s.stage === 'flight' || s.stage === 'impact') {
    const hit = center(`${loser}-health`);
    const impact = s.stage === 'impact';
    show(loser, s.damage, mix(points[loser], hit, motion.flight), impact ? motion.impactOpacity : 1, impact ? motion.impactScale : motion.damageScale);
  }
  if (s.multiplier !== 1 && ['multiplier', 'flight'].includes(s.stage) && motion.multiplierOpacity > 0) {
    const label = el('score-calculation'); label.hidden = false; label.textContent = `×${s.multiplier}`;
    label.style.opacity = String(motion.multiplierOpacity);
    label.style.transform = `translateY(-50%) rotate(20deg) scale(${motion.multiplierScale})`;
    const token = el(`score-token-${loser}`);
    const panel = el(`${loser}-result`).getBoundingClientRect();
    // The label stays beside the original score as damage departs. Its 1200ms
    // lifetime overlaps flight by 200ms, independent of the moving token.
    const right = points[loser].x + token.offsetWidth * motion.damageScale / 2;
    label.style.left = `${Math.min(right + 6, (panel.right - rootRect.left) / scale - label.offsetWidth)}px`;
    label.style.top = `${points[loser].y - token.offsetHeight * motion.damageScale / 2 + 18}px`;
  }
}
