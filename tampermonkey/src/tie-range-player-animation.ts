import type { PlayerTieRangeView } from './tie-range-player-controller.ts';
import { renderPointPips } from './tie-range-player-pips.ts';
import type { PlayerTieRangeDisplay } from './tie-range-player-view-model.ts';

import { fraction, healthProgress, scoreProjection, scoreSequence } from '../../bundles/rashinban/src/presenter/scoring.ts';
import { DEFAULT_TIMING } from '../../bundles/rashinban/src/presenter/timeline.ts';
import { scoreMotion } from '../../bundles/rashinban/src/graphics/presenter/scoring-motion.ts';
import type { ScoreCalculation } from '../../bundles/rashinban/src/types/presenter.ts';

function frameAt(elapsed: number, calculation: ScoreCalculation) {
  // The native score opacity marks COUNT_DAMAGE, not result mount or REST arrival.
  const initial = scoreSequence(calculation, 0, DEFAULT_TIMING);
  const reveal = -initial.countAtMs;
  const sequence = scoreSequence(calculation, reveal, DEFAULT_TIMING);
  const scoring = scoreProjection(sequence, reveal, elapsed);
  return { scoring, motion: scoreMotion(scoring),
    count: fraction(elapsed, sequence.countAtMs, sequence.countEndAtMs),
    health: healthProgress(elapsed, sequence.impactAtMs, sequence.healthEndAtMs),
    bar: healthProgress(elapsed, sequence.impactAtMs, sequence.healthEndAtMs, true),
    done: scoring.stage === 'complete' };
}

/** The presenter's sequence and curves, relative to the player's native count. */
export function scoringPhase(elapsed: number, multiplied: boolean, tie: boolean, hasDamage = !tie) {
  const frame = frameAt(elapsed, { tied: tie, hasDamage, winnerId: null, loserId: null,
    difference: 0, damage: 0, multiplier: multiplied ? 1.5 : 1 });
  return { ...frame, collision: frame.scoring.subtractProgress,
    difference: !tie && ['difference', 'multiplier', 'flight', 'impact', 'complete'].includes(frame.scoring.stage),
    multiplied: !tie && multiplied && ['multiplier', 'flight', 'impact', 'complete'].includes(frame.scoring.stage),
    flight: frame.scoring.flightProgress };
}

export function pinpointingPhase(elapsed: number) {
  const frame = frameAt(elapsed, { tied: false, hasDamage: false, winnerId: null, loserId: null,
    difference: 0, damage: 0, multiplier: 1,
    pinpointing: { points: [0, 0], reason: 'closest', totalsBefore: [0, 0], totalsAfter: [0, 0], matchPoint: [false, false] } });
  return { ...frame, verdict: frame.scoring.stage === 'verdict' || frame.done };
}

function verdictText(result: NonNullable<PlayerTieRangeDisplay['result']>, teams: NonNullable<PlayerTieRangeDisplay['teams']>): string {
  const points = result.points ?? [0, 0];
  const gained = Math.max(...points);
  const who = gained > 0 ? `${teams[points[0] > points[1] ? 0 : 1].label} +${gained} \u00b7 ` : '';
  if (result.reason === 'solo-5k') return `${who}Solo 5K`;
  if (result.reason === 'fastest-5k') return gained > 0 ? `${who}Fastest 5K` : 'Double 5K \u00b7 no point';
  if (result.reason === 'closest') return `${who}Closest`;
  return 'Tie \u00b7 no point';
}

type Session = { key: string; root: HTMLElement; start: number | null; settled: boolean; scores: [string, string] };
export function createPlayerScoringAnimation(document: Document, shadow: ShadowRoot) {
  const page = document.defaultView!;
  const node = (name: string) => shadow.querySelector<HTMLElement>(`[data-rb="${name}"]`)!;
  const moving = [0, 1].map(index => {
    const element = document.createElement('span');
    element.dataset.rb = `moving-score-${index}`;
    element.className = 'score-token';
    element.hidden = true; shadow.append(element); return element;
  });
  const calculation = document.createElement('span');
  calculation.className = 'score-calculation'; calculation.dataset.rb = 'score-calculation';
  calculation.hidden = true; shadow.append(calculation);
  let session: Session | null = null;
  let view: PlayerTieRangeView | null = null;
  let display: PlayerTieRangeDisplay | null = null;
  let frame = 0;
  const completed = new Set<string>();
  function hideMoving() { moving.forEach(element => { element.hidden = true; }); calculation.hidden = true; }
  function draw(): void {
    if (!session || !view || !display?.teams || !session.root.isConnected) { hideMoving(); return; }
    const natives = [...session.root.querySelectorAll<HTMLElement>('[class*="damage-animation_score__"]')];
    const now = page.performance.now();
    // Visibility is suppressed by our UI; opacity belongs to GeoGuessr's spring.
    if (session.start === null && natives.some(element => Number.parseFloat(page.getComputedStyle(element).opacity) > 0)) session.start = now;
    const elapsed = session.settled ? Infinity : session.start === null ? -1 : now - session.start;
    if (elapsed >= 0 && elapsed < 1750) natives.slice(0, 2).forEach((element, i) => {
      if (/^\d+$/.test(element.textContent?.trim() ?? '')) session!.scores[i] = element.textContent!.trim();
    });
    const result = display.result;
    node('result').hidden = elapsed < 0 || (!result && (session.settled || view.localTeamId === null
      || Number(JSON.parse(session.key)[1]) < (view.context?.currentRoundNumber ?? 0)));
    hideMoving();
    const reduced = page.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (display.pinpointing) {
      const points = pinpointingPhase(elapsed);
      node('result').dataset.phase = elapsed < 0 ? 'entry' : points.done ? 'complete' : points.verdict ? 'verdict' : points.count < 1 ? 'count' : 'hold';
      [node('result-team-0'), node('result-team-1')].forEach((element, i) => {
        element.textContent = result ? String(Math.round(result.scores[i] * points.count)) : session!.scores[i];
        element.style.opacity = String(points.done || reduced ? 1 : points.motion.rise);
        element.style.transform = reduced ? '' : `translateY(${50 * (1 - points.motion.rise)}px)`;
        moving[i].hidden = true;
      });
      const verdict = node('result-verdict');
      verdict.hidden = !result || !points.verdict;
      if (result && points.verdict) verdict.textContent = verdictText(result, display.teams);
      verdict.style.transform = reduced ? '' : `scale(${.6 + .4 * points.scoring.verdictProgress})`;
      verdict.style.opacity = String(reduced ? 1 : Math.min(1, points.scoring.verdictProgress * 2));
      const settled = result ? view.pinpointing?.rounds.find(round => round.round === result.round) : null;
      display.teams.forEach((team, i) => {
        const root = node(`team-${i}`);
        root.querySelector<HTMLElement>('[data-rb="damage"]')!.hidden = true;
        root.style.setProperty('--score-impact', '0');
        const canonicalIndex = view!.pinpointing?.teamIds.indexOf(team.teamId) ?? -1;
        if (!settled || canonicalIndex < 0 || team.firstTo === undefined) return;
        const total = points.verdict ? settled.totalsAfter[canonicalIndex] : settled.totalsBefore[canonicalIndex];
        root.querySelector<HTMLElement>('[data-rb="health"]')!.textContent = `${total} / ${team.firstTo}`;
        renderPointPips(root.querySelector<HTMLElement>('[data-rb="pips"]')!, total, team.firstTo);
        root.querySelector<HTMLElement>('[data-rb="multiplier"]')!.textContent = total >= team.firstTo - 2 && total < team.firstTo ? 'MATCH POINT' : '';
      });
      if (display.terminal && result) node('terminal').hidden = !points.done;
      if (points.done) completed.add(session.key);
      return;
    }
    node('result-verdict').hidden = true;
    const tie = !!result && result.scores[0] === result.scores[1];
    const winner = result && result.scores[1] > result.scores[0] ? 1 : 0;
    const loser = winner === 0 ? 1 : 0;
    const hasDamage = !!result?.damageDealt.some(amount => amount > 0);
    const factor = result ? result.usedMultiplierTenths[winner] / 10 : 1;
    const phase = scoringPhase(elapsed, factor !== 1, tie, hasDamage);
    const { scoring, motion } = phase;
    const stage = scoring.stage;
    node('result').dataset.phase = elapsed < 0 ? 'entry' : stage === 'score-hold' ? 'hold'
      : stage === 'subtract' || stage === 'tie' ? 'collision' : stage === 'impact' ? 'health' : stage;
    const scores = [node('result-team-0'), node('result-team-1')];
    const ghost = !phase.done && !['entry', 'count', 'score-hold'].includes(stage);
    scores.forEach((element, i) => {
      element.textContent = result ? String(Math.round(result.scores[i] * phase.count)) : session!.scores[i];
      element.style.opacity = String(reduced || phase.done ? 1 : ghost ? .25 : motion.rise);
      element.style.transform = reduced || ghost || phase.done ? '' : `translateY(${50 * (1 - motion.rise)}px)`;
    });
    const center = (element: HTMLElement) => {
      const box = element.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    };
    const mix = (a: { x: number; y: number }, b: { x: number; y: number }, p: number) =>
      ({ x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p });
    const points = scores.map(center);
    const show = (element: HTMLElement, value: number, point: { x: number; y: number }, opacity = 1, scale = 1) => {
      element.hidden = false; element.textContent = String(value);
      element.style.left = `${point.x}px`; element.style.top = `${point.y}px`;
      element.style.opacity = String(Math.max(0, opacity));
      element.style.transform = `translate(-50%, -50%) scale(${scale})`;
    };
    display.teams.forEach((team, i) => {
      const root = node(`team-${i}`);
      const damage = root.querySelector<HTMLElement>('[data-rb="damage"]')!;
      damage.hidden = true; damage.removeAttribute('style'); damage.dataset.factor = '';
      delete damage.dataset.animating;
      root.style.setProperty('--score-impact', !reduced && stage === 'impact' && i === loser ? String(motion.impactOpacity) : '0');
      const canonicalIndex = view!.output?.teamIds.indexOf(team.teamId) ?? -1;
      const settled = result ? view!.output?.rounds.find(round => round.round === result.round) : null;
      if (!settled || canonicalIndex < 0) return;
      const before = settled.healthBefore[canonicalIndex], after = settled.healthAfter[canonicalIndex];
      const health = Math.round(before + (after - before) * phase.health);
      root.querySelector<HTMLElement>('[data-rb="health"]')!.textContent = String(health);
      const fill = root.querySelector<HTMLElement>('[data-rb="bar-fill"]')!;
      const bar = before + (after - before) * phase.bar;
      fill.style.transition = 'none'; fill.style.width = `${team.maximumHealth > 0 ? Math.max(0, Math.min(100, bar / team.maximumHealth * 100)) : 0}%`;
      const used = result!.usedMultiplierTenths[i];
      const mult = phase.done || stage === 'impact' ? team.multiplierTenths : used;
      root.querySelector<HTMLElement>('[data-rb="multiplier"]')!.textContent = `${mult / 10}\u00d7`;
      if (i !== loser || tie || !phase.difference) return;
      const amount = result!.damageDealt[winner];
      const difference = Math.abs(result!.scores[0] - result!.scores[1]);
      const multiplied = phase.multiplied;
      damage.dataset.factor = multiplied && !phase.done && factor !== 1 ? `\u00d7${factor}` : '';
      damage.title = `${difference} \u00d7 ${factor} = ${amount}`;
      if (phase.done || reduced) {
        damage.hidden = amount === 0;
        damage.textContent = `\u2212${amount}`;
        return;
      }
      damage.dataset.animating = 'true';
      const impact = stage === 'impact';
      const inFlight = stage === 'flight' || impact;
      const point = inFlight ? mix(points[loser], center(root.querySelector<HTMLElement>('[data-rb="health"]')!), motion.flight)
        : { x: points[loser].x + (winner === 0 ? 1 : -1) * motion.wobble, y: points[loser].y };
      show(damage, inFlight || multiplied ? amount : difference, point,
        impact ? motion.impactOpacity : 1, impact ? motion.impactScale : motion.damageScale);
      if (factor !== 1 && ['multiplier', 'flight'].includes(stage) && motion.multiplierOpacity > 0) {
        calculation.hidden = false; calculation.textContent = `\u00d7${factor}`;
        calculation.style.opacity = String(motion.multiplierOpacity);
        calculation.style.transform = `translateY(-50%) rotate(20deg) scale(${motion.multiplierScale})`;
        calculation.style.left = `${Math.min(points[loser].x + damage.offsetWidth * motion.damageScale / 2 + 6, page.innerWidth - calculation.offsetWidth - 12)}px`;
        calculation.style.top = `${points[loser].y - damage.offsetHeight * motion.damageScale / 2 + 18}px`;
      }
    });
    if (result && !reduced && !phase.done) {
      if (stage === 'tie') {
        const midpoint = mix(points[0], points[1], .5);
        moving.forEach((element, i) => show(element, result.scores[i], mix(points[i], midpoint, motion.travel), motion.tieOpacity, motion.tieScale));
      } else if (stage === 'subtract') {
        moving.forEach((element, i) => show(element, result.scores[i], i === winner ? mix(points[winner], points[loser], motion.travel) : points[i]));
      } else if (['difference', 'multiplier'].includes(stage) && motion.collisionOpacity > .001) {
        show(moving[winner], result.scores[winner], mix(points[winner], points[loser], motion.travel), motion.collisionOpacity, motion.collisionScale);
      }
    }
    if (display.terminal && result) node('terminal').hidden = !phase.done;
    if (phase.done) completed.add(session.key);
  }
  function tick() { frame = 0; draw(); if (session && node('result').dataset.phase !== 'complete') frame = page.requestAnimationFrame(tick); }
  return {
    update(nextView: PlayerTieRangeView, nextDisplay: PlayerTieRangeDisplay, root: HTMLElement | null, key: string | null, skip: boolean): void {
      view = nextView; display = nextDisplay;
      if (!root || !key || !nextDisplay.teams || !nextDisplay.suppressNative) { this.stop(); return; }
      if (session && session.key !== key && session.root === root) {
        const previous = JSON.parse(session.key), next = JSON.parse(key);
        // A round can reveal before REST supplies its start identity. Upgrade
        // that provisional identity without restarting the native count clock.
        if (previous.length === 2 && previous[0] === next[0] && previous[1] === next[1]) session.key = key;
      }
      if (session?.key !== key) session = { key, root, start: null, settled: skip || completed.has(key), scores: ['0', '0'] };
      else session.root = root;
      draw(); if (!frame) frame = page.requestAnimationFrame(tick);
    },
    stop(): void {
      if (session) completed.add(session.key);
      if (frame) page.cancelAnimationFrame(frame);
      frame = 0; session = null; hideMoving();
      for (const i of [0, 1]) {
        const root = node(`team-${i}`);
        root.style.setProperty('--score-impact', '0');
        const damage = root.querySelector<HTMLElement>('[data-rb="damage"]')!;
        damage.removeAttribute('style'); delete damage.dataset.animating; damage.dataset.factor = '';
        const score = node(`result-team-${i}`);
        score.style.opacity = ''; score.style.transform = '';
      }
    },
    reset(): void { this.stop(); completed.clear(); },
    dispose(): void { this.reset(); moving.forEach(element => element.remove()); calculation.remove(); },
  };
}
