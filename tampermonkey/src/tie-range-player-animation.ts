import type { PlayerTieRangeView } from './tie-range-player-controller.ts';
import type { PlayerTieRangeDisplay } from './tie-range-player-view-model.ts';

const progress = (elapsed: number, start: number, duration: number) => Math.max(0, Math.min(1, (elapsed - start) / duration));
/** Offsets from COUNT_DAMAGE; see docs/geoguessr/sfx-timing.md. */
export function scoringPhase(elapsed: number, nativeMultiplier: boolean, tie: boolean) {
  const impact = nativeMultiplier ? 4100 : 3600;
  return {
    count: progress(elapsed, 0, 750), collision: progress(elapsed, 1750, 400),
    difference: !tie && elapsed >= 2100, multiplied: !tie && nativeMultiplier && elapsed >= 2750,
    flight: tie ? 0 : progress(elapsed, impact - 350, 400),
    health: tie ? 0 : progress(elapsed, impact, 800),
    done: elapsed >= (tie ? 2450 : impact + 800),
  };
}

type Session = { key: string; root: HTMLElement; start: number | null; multiplier: boolean; settled: boolean; scores: [string, string] };
export function createPlayerScoringAnimation(document: Document, shadow: ShadowRoot) {
  const page = document.defaultView!;
  const node = (name: string) => shadow.querySelector<HTMLElement>(`[data-rb="${name}"]`)!;
  const moving = [0, 1].map(index => {
    const element = document.createElement('span');
    element.dataset.rb = `moving-score-${index}`;
    element.style.cssText = 'position:fixed;font-size:40px;font-weight:700;color:white;text-shadow:0 2px 6px #000;pointer-events:none;z-index:2';
    element.hidden = true; shadow.append(element); return element;
  });
  let session: Session | null = null;
  let view: PlayerTieRangeView | null = null;
  let display: PlayerTieRangeDisplay | null = null;
  let frame = 0;
  const completed = new Set<string>();
  function hideMoving() { moving.forEach(element => { element.hidden = true; }); }
  function draw(): void {
    if (!session || !view || !display?.teams || !session.root.isConnected) { hideMoving(); return; }
    const natives = [...session.root.querySelectorAll<HTMLElement>('[class*="damage-animation_score__"]')];
    const now = page.performance.now();
    // Visibility is suppressed by our UI; opacity belongs to GeoGuessr's spring.
    if (session.start === null && natives.some(element => Number.parseFloat(page.getComputedStyle(element).opacity) > 0)) session.start = now;
    session.multiplier ||= !!session.root.querySelector('[class*="damage-animation_multiplier__"]');
    const elapsed = session.settled ? Infinity : session.start === null ? -1 : now - session.start;
    if (elapsed >= 0 && elapsed < 1750) natives.slice(0, 2).forEach((element, i) => {
      if (/^\d+$/.test(element.textContent?.trim() ?? '')) session!.scores[i] = element.textContent!.trim();
    });
    const result = display.result;
    node('result').hidden = elapsed < 0 || (!result && (session.settled || view.localTeamId === null
      || Number(JSON.parse(session.key)[1]) < (view.context?.currentRoundNumber ?? 0)));
    if (elapsed < 0) hideMoving();
    const tie = !!result && result.scores[0] === result.scores[1];
    const phase = scoringPhase(elapsed, session.multiplier, tie);
    node('result').dataset.phase = elapsed < 0 ? 'entry' : phase.done ? 'complete' : phase.health > 0 ? 'health' : phase.flight > 0 ? 'flight' : phase.multiplied ? 'multiplier' : phase.difference ? 'difference' : phase.collision > 0 ? 'collision' : phase.count < 1 ? 'count' : 'hold';
    const reduced = page.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const scores = [node('result-team-0'), node('result-team-1')];
    scores.forEach((element, i) => {
      element.textContent = result ? String(Math.round(result.scores[i] * phase.count)) : session!.scores[i];
      element.style.opacity = phase.collision > 0 && !phase.done ? '.65' : '1';
      moving[i].hidden = true;
    });
    display.teams.forEach((team, i) => {
      const root = node(`team-${i}`);
      const damage = root.querySelector<HTMLElement>('[data-rb="damage"]')!;
      damage.hidden = true; damage.style.transform = ''; damage.style.opacity = ''; damage.dataset.factor = '';
      const canonicalIndex = view!.output?.teamIds.indexOf(team.teamId) ?? -1;
      const settled = result ? view!.output?.rounds.find(round => round.round === result.round) : null;
      if (!settled || canonicalIndex < 0) return;
      const health = Math.round(settled.healthBefore[canonicalIndex] + (team.health - settled.healthBefore[canonicalIndex]) * (tie ? 1 : phase.health));
      root.querySelector<HTMLElement>('[data-rb="health"]')!.textContent = String(health);
      const fill = root.querySelector<HTMLElement>('[data-rb="bar-fill"]')!;
      fill.style.transition = 'none'; fill.style.width = `${team.maximumHealth > 0 ? health / team.maximumHealth * 100 : 0}%`;
      const used = result!.usedMultiplierTenths[i];
      const mult = phase.done || phase.health > 0 ? team.multiplierTenths : used;
      root.querySelector<HTMLElement>('[data-rb="multiplier"]')!.textContent = `${mult / 10}×`;
      const amount = result!.damageDealt[i === 0 ? 1 : 0];
      if (!amount || !phase.difference) return;
      damage.hidden = false;
      const multiplied = elapsed >= 2750;
      const factor = result!.usedMultiplierTenths[i === 0 ? 1 : 0] / 10;
      damage.dataset.factor = multiplied && !phase.done && factor !== 1 ? `\u00d7${factor}` : '';
      damage.textContent = multiplied ? `−${amount}` : String(Math.abs(result!.scores[0] - result!.scores[1]));
      damage.title = `${Math.abs(result!.scores[0] - result!.scores[1])} × ${result!.usedMultiplierTenths[i === 0 ? 1 : 0] / 10} = ${amount}`;
      if (!reduced && !phase.done) {
        const target = damage.getBoundingClientRect(), origin = scores[i].getBoundingClientRect();
        const flight = phase.flight;
        damage.style.transform = `translate(${(origin.left + origin.width / 2 - target.left - target.width / 2) * (1 - flight)}px, ${(origin.top - target.top) * (1 - flight)}px) scale(${multiplied && flight === 0 ? 1.3 : 1})`;
        if (phase.health > 0 && phase.health < 1) damage.style.opacity = String(Math.max(.2, 1 - phase.health));
      }
    });
    if (result && elapsed >= 1750 && elapsed < 2100 && !reduced) {
      const winner = result.scores[0] >= result.scores[1] ? 0 : 1;
      const boxes = scores.map(element => element.getBoundingClientRect());
      for (const i of tie ? [0, 1] : [winner]) {
        const element = moving[i], origin = boxes[i], other = boxes[i === 0 ? 1 : 0];
        element.hidden = false; element.textContent = String(result.scores[i]);
        element.style.left = `${origin.left + (other.left - origin.left) * phase.collision * (tie ? .5 : 1)}px`;
        element.style.top = `${origin.top}px`;
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
      if (session?.key !== key) session = { key, root, start: null, multiplier: false, settled: skip || completed.has(key), scores: ['0', '0'] };
      else session.root = root;
      draw(); if (!frame) frame = page.requestAnimationFrame(tick);
    },
    stop(): void { if (session) completed.add(session.key); if (frame) page.cancelAnimationFrame(frame); frame = 0; session = null; hideMoving(); },
    reset(): void { this.stop(); completed.clear(); },
    dispose(): void { this.reset(); moving.forEach(element => element.remove()); },
  };
}
