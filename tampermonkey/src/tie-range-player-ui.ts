import { createPlayerMapOverlay } from './tie-range-player-map.ts';
import type { TieRangeBandMode, TieRangeRoundOutput } from '../../bundles/rashinban/src/presenter/tie-range-core.ts';
import type { PlayerTieRangeView } from './tie-range-player-controller.ts';
import {
  derivePlayerTieRangeDisplay,
  playerDisclosureMustReset,
  playerRoundIdentity,
  type PlayerTieRangeDisplay,
} from './tie-range-player-view-model.ts';

export type PlayerTieRangeUiDependencies = {
  document: Document;
  getPageWindow?(): Window;
  onModeChange(mode: TieRangeBandMode): void;
  getConfiguredMode(): TieRangeBandMode;
};

export type PlayerTieRangeUi = {
  update(view: PlayerTieRangeView): void;
  openSettings(): void;
  dispose(): void;
};

type StyleProperty = 'display' | 'visibility' | 'position';

const CLASS_SELECTORS = {
  duelRoot: '[class*="duels_root__"]',
  healthBars: '[class*="hud_healthBars__"]',
  resultRoot: '[class*="round-score_root__"]',
  resultRound: '[class*="round-score_roundNumber__"]',
  damage: '[class*="round-score_damageAnimation__"]',
  summary: '[class*="game-summary-2_root__"]',
  summaryHeader: '[class*="game-summary-2_playedRoundsHeader__"]',
  summaryRow: '[class*="game-summary-2_playedRound__"]',
  roundNumber: '[class*="game-summary-2_roundNumber__"]',
  terminal: '[class*="summon-glow-text_root__"]',
} as const;

function multiplier(value: number): string {
  return `${(value / 10).toFixed(value % 10 === 0 ? 0 : 1)}×`;
}

function classStartsWith(element: Element, prefix: string): boolean {
  return Array.from(element.classList).some(value => value.startsWith(prefix));
}

function visible(element: Element, document: Document): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if ((current as HTMLElement).hidden) return false;
    const style = document.defaultView?.getComputedStyle(current);
    if (style?.display === 'none' || (current === element && (style?.visibility === 'hidden' || style?.visibility === 'collapse'))
      || Number.parseFloat(style?.opacity ?? '1') === 0) return false;
  }
  return typeof element.getClientRects !== 'function' || element.getClientRects().length > 0;
}

function rootElements(document: Document): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(CLASS_SELECTORS.duelRoot))
    .filter(element => classStartsWith(element, 'duels_root__'));
}

function scopedElements(roots: HTMLElement[], selector: string): HTMLElement[] {
  return roots.flatMap(root => [
    ...(root.matches(selector) ? [root] : []),
    ...Array.from(root.querySelectorAll<HTMLElement>(selector)),
  ]);
}

function visibleResultRoots(document: Document, roots: HTMLElement[], expectedRound: number | null): HTMLElement[] {
  if (expectedRound === null) return [];
  return scopedElements(roots, CLASS_SELECTORS.resultRoot)
    .filter(element => {
      if (!classStartsWith(element, 'round-score_root__')) return false;
      const heading = element.querySelector(CLASS_SELECTORS.resultRound);
      if (!heading || !visible(heading, document)) return false;
      const text = heading.textContent ?? '';
      const displayedRound = [...text.matchAll(/\d+/g)].at(-1)?.[0];
      return displayedRound !== undefined && Number.parseInt(displayedRound, 10) === expectedRound;
    });
}

function summaryDisclosesTerminal(
  document: Document,
  roots: HTMLElement[],
  view: PlayerTieRangeView,
): boolean {
  const terminalRound = view.output?.terminal?.round;
  if (terminalRound === undefined) return false;
  return scopedElements(roots, CLASS_SELECTORS.summary).some(summary => {
    if (!classStartsWith(summary, 'game-summary-2_root__') || !visible(summary, document)) return false;
    return Array.from(summary.querySelectorAll<HTMLElement>(CLASS_SELECTORS.summaryRow)).some(row => {
      const round = Number.parseInt(row.querySelector(CLASS_SELECTORS.roundNumber)?.textContent ?? '', 10);
      return round === terminalRound && visible(row, document);
    });
  });
}

function userIdFromLink(element: Element, document: Document): string | null {
  const href = element.querySelector('a[href*="/user/"]')?.getAttribute('href');
  if (!href) return null;
  try {
    const path = new URL(href, document.baseURI).pathname.replace(/\/$/, '');
    const match = path.match(/\/user\/([^/]+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

export function createPlayerTieRangeUi(dependencies: PlayerTieRangeUiDependencies): PlayerTieRangeUi {
  const { document } = dependencies;
  const mapOverlay = createPlayerMapOverlay(() => dependencies.getPageWindow?.() ?? document.defaultView!);
  document.getElementById('rb-tie-range-player')?.remove();
  const host = document.createElement('div');
  host.id = 'rb-tie-range-player';
  host.setAttribute('data-rb', 'player-root');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; position: fixed; inset: 0; z-index: 2147483000; pointer-events: none;
        color: #fff; font: 600 14px/1.2 Inter, system-ui, sans-serif; }
      *, *::before, *::after { box-sizing: border-box; }
      [hidden] { display: none !important; }
      .hud { position: fixed; top: max(12px, env(safe-area-inset-top)); left: 50%; width: calc(100vw - 48px);
        transform: translateX(-50%); filter: drop-shadow(0 3px 9px #000b); }
      .mode { margin: 0 auto 6px; width: max-content; padding: 3px 9px; border-radius: 999px;
        background: #111d; color: #f4f4f4; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
      .teams { display: flex; justify-content: space-between; gap: 180px; }
      .team { position: relative; width: min(420px, calc((100% - 180px) / 2)); min-width: 0; padding: 7px 9px 9px; border: 1px solid #ffffff3b; border-radius: 8px; background: #0d111ae8; }
      .damage { position: absolute; top: calc(100% + 5px); right: 9px; padding: 4px 8px; border-radius: 5px;
        background: #35131ff2; color: #ff8492; font-size: 32px; font-variant-numeric: tabular-nums; }
      @media (prefers-reduced-motion: reduce) { .fill { transition: none; } }
      .team[data-side="blue"] { --team: #38a8ff; }
      .team[data-side="red"] { --team: #ff5365; }
      .team-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
      .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--team); font-size: 13px; }
      .numbers { display: flex; align-items: baseline; gap: 7px; }
      .health { font-size: 20px; font-variant-numeric: tabular-nums; }
      .multiplier { color: #ffe169; font-size: 16px; font-variant-numeric: tabular-nums; }
      .track { height: 8px; margin-top: 5px; overflow: hidden; border-radius: 999px; background: #ffffff25; }
      .fill { height: 100%; width: 0; border-radius: inherit; background: var(--team); transition: width 220ms ease; }
      .result { margin: 22px auto 0; width: 76%; text-align: center; font-size: 40px; text-shadow: 0 2px 6px #000; }
      .result-title { display: none; }
      .result-grid { display: flex; justify-content: space-between; gap: 100px; font-variant-numeric: tabular-nums; }
      .result-meta { display: none; }
      .terminal { position: fixed; top: 22%; left: 50%; transform: translateX(-50%); min-width: min(420px, calc(100vw - 32px));
        padding: 13px 22px; border: 1px solid #ffe16999; border-radius: 10px; background: #111e; text-align: center;
        filter: drop-shadow(0 3px 12px #000c); }
      .terminal strong { display: block; color: #ffe169; font-size: 30px; letter-spacing: .04em; text-transform: uppercase; }
      .terminal span { display: block; margin-top: 3px; color: #ddd; font-size: 12px; }
      .diagnostic { margin: 6px auto 0; width: max-content; max-width: 100%; padding: 4px 8px; border-radius: 5px;
        background: #5c2b12ed; color: #ffd8bd; text-align: center; font-size: 11px; }
      .settings-open { position: fixed; top: max(10px, env(safe-area-inset-top)); right: 12px; pointer-events: auto;
        border: 1px solid #ffffff45; border-radius: 999px; padding: 6px 9px; background: #111d; color: #fff; cursor: pointer;
        font: 600 11px/1.2 Inter, system-ui, sans-serif; }
      .settings { position: fixed; inset: 0; display: grid; place-items: center; padding: 20px; background: #0008; pointer-events: auto; }
      .settings-card { width: min(390px, 100%); padding: 18px; border: 1px solid #ffffff45; border-radius: 12px; background: #161a22;
        box-shadow: 0 18px 60px #000a; }
      .settings h2 { margin: 0 0 13px; font-size: 18px; }
      .settings label { display: grid; gap: 6px; }
      .settings select { width: 100%; padding: 8px; border: 1px solid #ffffff45; border-radius: 6px; background: #252b36; color: #fff; }
      .settings p { margin: 11px 0 15px; color: #cbd0da; font-size: 12px; font-weight: 450; line-height: 1.45; }
      .settings button { float: right; padding: 7px 12px; border: 0; border-radius: 6px; background: #e9edf5; color: #111; cursor: pointer; }
      @media (max-width: 620px) { .hud { width: calc(100vw - 18px); top: 52px; } .teams { gap: 100px; }
        .team { width: calc((100% - 100px) / 2); padding-inline: 7px; } .health { font-size: 17px; }
        .numbers { flex-wrap: wrap; gap: 3px; } .team-head { flex-wrap: wrap; } }
    </style>
    <section class="hud" data-rb="hud" aria-live="polite" hidden>
      <div class="mode" data-rb="mode" data-rb-mode-note></div>
      <div class="teams" data-rb="teams">
        <article class="team" data-rb="team-0"><div class="team-head"><span class="label" data-rb="label"></span><span class="numbers"><strong class="health" data-rb="health"></strong><span class="multiplier" data-rb="multiplier"></span></span></div><div class="track"><div class="fill" data-rb="bar-fill"></div></div></article>
        <article class="team" data-rb="team-1"><div class="team-head"><span class="label" data-rb="label"></span><span class="numbers"><strong class="health" data-rb="health"></strong><span class="multiplier" data-rb="multiplier"></span></span></div><div class="track"><div class="fill" data-rb="bar-fill"></div></div></article>
      </div>
      <div class="result" data-rb="result" hidden><div class="result-title" data-rb="result-title"></div><div class="result-grid"><span data-rb="result-team-0"></span><span data-rb="result-team-1"></span></div><div class="result-meta" data-rb="result-meta"></div></div>
      <div class="diagnostic" data-rb="diagnostic" hidden></div>
    </section>
    <div class="terminal" data-rb="terminal" aria-live="assertive" hidden><strong data-rb="terminal-headline"></strong><span data-rb="terminal-detail"></span></div>
    <button type="button" class="settings-open" data-rb="settings-open"></button>
    <div class="settings" data-rb="settings-panel" role="dialog" aria-modal="true" aria-labelledby="rb-settings-title" hidden>
      <div class="settings-card"><h2 id="rb-settings-title">Player tie-range</h2><label>Mode<select data-rb="mode-select"><option value="off">Off</option><option value="full">Full</option><option value="half">Half</option></select></label><p>The selected mode is captured when a duel begins. Changes apply to the next duel.</p><button type="button" data-rb="settings-close">Close</button></div>
    </div>`;
  (document.body ?? document.documentElement).append(host);

  const byRb = <T extends Element>(name: string): T => {
    const element = shadow.querySelector<T>(`[data-rb="${name}"]`);
    if (!element) throw new Error(`Missing player UI element: ${name}`);
    return element;
  };
  const hud = byRb<HTMLElement>('hud');
  const terminal = byRb<HTMLElement>('terminal');
  const diagnostic = byRb<HTMLElement>('diagnostic');
  const settingsOpen = byRb<HTMLButtonElement>('settings-open');
  const settingsPanel = byRb<HTMLElement>('settings-panel');
  const modeSelect = byRb<HTMLSelectElement>('mode-select');
  for (const index of [0, 1]) {
    const damage = document.createElement('span');
    damage.className = 'damage';
    damage.dataset.rb = 'damage';
    damage.hidden = true;
    byRb<HTMLElement>(`team-${index}`).append(damage);
  }
  const originalStyles = new Map<HTMLElement, Partial<Record<StyleProperty, string>>>();
  const originallyMissingStyleAttribute = new Set<HTMLElement>();
  const summaryReplacements = new Map<HTMLElement, HTMLElement>();
  let desiredStyles: Map<HTMLElement, Set<StyleProperty>> | null = null;
  let lastView: PlayerTieRangeView | null = null;
  let revealedRoundIdentity: string | null = null;
  let focusBeforeSettings: HTMLElement | null = null;
  let disposed = false;
  let reconcileQueued = false;
  let lastDamageIdentity: string | null = null;
  let initialResultIdentity: string | null = null;
  let activeDamage: { identity: string; teamId: string; cancel(): void } | null = null;

  function animateDamage(root: HTMLElement, damage: HTMLElement, identity: string, teamId: string, after: number, maximum: number): void {
    activeDamage?.cancel();
    const page = document.defaultView!;
    if (page.matchMedia?.('(prefers-reduced-motion: reduce)').matches || typeof damage.animate !== 'function') return;
    const canonicalIndex = lastView!.output!.teamIds.indexOf(teamId);
    const before = lastView!.output!.rounds.at(-1)!.healthBefore[canonicalIndex];
    const health = root.querySelector<HTMLElement>('[data-rb="health"]')!;
    const fill = root.querySelector<HTMLElement>('[data-rb="bar-fill"]')!;
    const write = (value: number) => { health.textContent = String(value); fill.style.width = `${maximum > 0 ? value / maximum * 100 : 0}%`; };
    const box = damage.getBoundingClientRect();
    const x = page.innerWidth * (root.getBoundingClientRect().left < page.innerWidth / 2 ? .24 : .76) - (box.left + box.width / 2);
    const y = Math.max(150, root.getBoundingClientRect().bottom + 65) - box.top;
    const animation = damage.animate([
      { transform: `translate(${x}px, ${y}px) scale(1.5)`, offset: 0 },
      { transform: `translate(${x}px, ${y}px) scale(1.5)`, offset: .35 },
      { transform: 'translate(0, 0) scale(1)', offset: 1 },
    ], { duration: 1200, easing: 'ease-in-out' });
    let frame = 0;
    const started = page.performance.now();
    const cancel = () => { page.cancelAnimationFrame(frame); animation.cancel(); write(after); };
    activeDamage = { identity, teamId, cancel };
    write(before);
    const tick = () => {
      if (activeDamage?.identity !== identity) return;
      const progress = Math.max(0, Math.min(1, (page.performance.now() - started - 750) / 450));
      write(Math.round(before + (after - before) * progress));
      if (progress < 1) frame = page.requestAnimationFrame(tick);
      else activeDamage = null;
    };
    frame = page.requestAnimationFrame(tick);
  }

  function hideNativeTree(element: HTMLElement, except?: HTMLElement): void {
    // Preserve the boxes used as targets by GeoGuessr's animation calculations.
    for (const child of [element, ...element.querySelectorAll<HTMLElement>('*')]) {
      if (child === except || except?.contains(child)) continue;
      setNativeStyle(child, 'visibility', 'hidden');
    }
  }

  function setNativeStyle(element: HTMLElement, property: StyleProperty, value: string): void {
    let desired = desiredStyles?.get(element);
    if (!desired && desiredStyles) {
      desired = new Set();
      desiredStyles.set(element, desired);
    }
    desired?.add(property);
    let snapshot = originalStyles.get(element);
    if (!snapshot) {
      snapshot = {};
      originalStyles.set(element, snapshot);
      if (!element.hasAttribute('style')) originallyMissingStyleAttribute.add(element);
    }
    if (!(property in snapshot)) snapshot[property] = element.style[property];
    if (element.style[property] !== value) element.style[property] = value;
  }

  function restoreUnusedNativeStyles(): void {
    for (const [element, snapshot] of originalStyles) {
      const desired = desiredStyles?.get(element);
      for (const [property, value] of Object.entries(snapshot)) {
        if (desired?.has(property as StyleProperty)) continue;
        element.style[property as StyleProperty] = value ?? '';
        delete snapshot[property as StyleProperty];
      }
      if (Object.keys(snapshot).length === 0) {
        originalStyles.delete(element);
        if (originallyMissingStyleAttribute.delete(element) && element.style.length === 0) {
          element.removeAttribute('style');
        }
      }
    }
    desiredStyles = null;
  }

  function restoreNative(): void {
    for (const [element, snapshot] of originalStyles) {
      for (const [property, value] of Object.entries(snapshot)) {
        element.style[property as StyleProperty] = value ?? '';
      }
    }
    originalStyles.clear();
    for (const element of originallyMissingStyleAttribute) {
      if (element.style.length === 0) element.removeAttribute('style');
    }
    originallyMissingStyleAttribute.clear();
    desiredStyles = null;
    for (const replacement of summaryReplacements.values()) replacement.remove();
    summaryReplacements.clear();
  }

  function renderDisplay(display: PlayerTieRangeDisplay, layoutDiagnostic: string | null): void {
    if (!display.teams && activeDamage) { activeDamage.cancel(); activeDamage = null; }
    hud.hidden = !display.showHud && !display.showDiagnostic && layoutDiagnostic === null;
    byRb<HTMLElement>('mode').hidden = !display.showHud;
    byRb<HTMLElement>('teams').hidden = !display.showHud;
    byRb<HTMLElement>('mode').textContent = display.appliesToNextDuel
      ? `${display.modeLabel} · setting applies next duel`
      : display.modeLabel;
    const configured = lastView?.configuredMode ?? dependencies.getConfiguredMode();
    settingsOpen.textContent = `Tie range settings: ${configured === 'off' ? 'Off' : configured === 'full' ? 'Full' : 'Half'}`;
    settingsOpen.hidden = lastView?.status === 'inactive';
    if (display.teams) {
      const damageIdentity = display.result && lastView?.context
        ? JSON.stringify([playerRoundIdentity(lastView.context, display.result.round), display.result.damageDealt, display.teams.map(team => team.health)]) : null;
      if (activeDamage && activeDamage.identity !== damageIdentity) { activeDamage.cancel(); activeDamage = null; }
      display.teams.forEach((team, index) => {
        const root = byRb<HTMLElement>(`team-${index}`);
        root.dataset.side = team.side;
        root.querySelector<HTMLElement>('[data-rb="label"]')!.textContent = team.label;
        if (activeDamage?.teamId !== team.teamId) root.querySelector<HTMLElement>('[data-rb="health"]')!.textContent = String(team.health);
        root.querySelector<HTMLElement>('[data-rb="multiplier"]')!.textContent = multiplier(team.multiplierTenths);
        const percent = team.maximumHealth <= 0 ? 0 : Math.max(0, Math.min(100, team.health / team.maximumHealth * 100));
        if (activeDamage?.teamId !== team.teamId) root.querySelector<HTMLElement>('[data-rb="bar-fill"]')!.style.width = `${percent}%`;
        const damage = root.querySelector<HTMLElement>('[data-rb="damage"]')!;
        const amount = display.result?.damageDealt[index === 0 ? 1 : 0] ?? 0;
        damage.hidden = amount === 0;
        damage.textContent = amount > 0 ? `−${amount}` : '';
        if (amount > 0 && damageIdentity !== lastDamageIdentity
          && playerRoundIdentity(lastView!.context!, display.result!.round) !== initialResultIdentity) {
          animateDamage(root, damage, damageIdentity!, team.teamId, team.health, team.maximumHealth);
        }
      });
      if (damageIdentity !== null) lastDamageIdentity = damageIdentity;
    }
    const result = byRb<HTMLElement>('result');
    result.hidden = display.result === null;
    if (display.result && display.teams) {
      byRb<HTMLElement>('result-title').textContent = `Round ${display.result.round} result`;
      for (const index of [0, 1] as const) {
        byRb<HTMLElement>(`result-team-${index}`).textContent = String(display.result.scores[index]);
      }
      byRb<HTMLElement>('result-meta').textContent = `Tie band ${display.result.band} · ${display.result.withinBand ? 'inside range' : 'outside range'}`;
    }
    terminal.hidden = display.terminal === null;
    if (display.terminal) {
      byRb<HTMLElement>('terminal-headline').textContent = display.terminal.headline;
      byRb<HTMLElement>('terminal-detail').textContent = display.terminal.detail;
    }
    const message = [display.diagnostic, layoutDiagnostic].filter(Boolean).join(' · ');
    diagnostic.hidden = message.length === 0 || (!display.showDiagnostic && layoutDiagnostic === null);
    diagnostic.textContent = message;
  }

  function applySummaryReplacements(view: PlayerTieRangeView, roots: HTMLElement[]): string | null {
    if (!view.context || !view.output) return null;
    let unsupported = false;
    const desired = new Set<HTMLElement>();
    for (const summary of scopedElements(roots, CLASS_SELECTORS.summary)) {
      if (!classStartsWith(summary, 'game-summary-2_root__')) continue;
      const header = summary.querySelector<HTMLElement>(CLASS_SELECTORS.summaryHeader);
      const headerCells = header ? Array.from(header.children) : [];
      if (headerCells.length !== 5) { unsupported = true; continue; }
      const healthColumns = [3, 4] as const;
      let columnByTeam = view.context.playerIds.map(playerId => healthColumns.find(column => (
        (userIdFromLink(headerCells[column], document) ?? userIdFromLink(headerCells[column - 2], document)) === playerId
      )) ?? -1) as [number, number];
      if (columnByTeam[0] >= 0 && columnByTeam[1] < 0) columnByTeam[1] = columnByTeam[0] === 3 ? 4 : 3;
      if (columnByTeam[1] >= 0 && columnByTeam[0] < 0) columnByTeam[0] = columnByTeam[1] === 3 ? 4 : 3;
      if (columnByTeam.some(column => column < 0)) {
        // Ordinary player summaries may have YOUR HEALTH and avatar labels,
        // without profile links. Match their score columns to verified history.
        const observations = Array.from(summary.querySelectorAll<HTMLElement>(CLASS_SELECTORS.summaryRow)).flatMap(row => {
          const number = Number.parseInt(row.querySelector(CLASS_SELECTORS.roundNumber)?.textContent ?? '', 10);
          const folded = view.output!.rounds.find(round => round.round === number);
          if (!folded || row.children.length !== 5) return [];
          const scores = [1, 2].map(column => {
            const digits = row.children[column].textContent?.trim().match(/^\d[\d,\u00a0 ]*/)?.[0];
            return digits === undefined ? NaN : Number(digits.replace(/\D/g, ''));
          });
          return [{ folded, scores }];
        });
        const orders: [number, number][] = [[0, 1], [1, 0]];
        const matching = orders.filter(order => observations.length > 0 && observations.every(({ folded, scores }) => (
          scores[0] === folded.scores[order[0]] && scores[1] === folded.scores[order[1]]
        )));
        if (matching.length === 1) {
          columnByTeam = matching[0][0] === 0 ? [3, 4] : [4, 3];
        } else if (matching.length === 2 && view.output.rounds.every(round => round.scores[0] === round.scores[1])) {
          // Both histories and HP values are identical, so either mapping is equivalent.
          columnByTeam = [3, 4];
        }
      }
      if (columnByTeam[0] < 0 || columnByTeam[1] < 0 || columnByTeam[0] === columnByTeam[1]) {
        unsupported = true;
        continue;
      }
      for (const row of summary.querySelectorAll<HTMLElement>(CLASS_SELECTORS.summaryRow)) {
        if (!classStartsWith(row, 'game-summary-2_playedRound__')) continue;
        const cells = Array.from(row.children) as HTMLElement[];
        const roundNumber = Number.parseInt(row.querySelector(CLASS_SELECTORS.roundNumber)?.textContent ?? '', 10);
        const folded = view.output.rounds.find(round => round.round === roundNumber);
        const afterTerminal = view.output.terminal !== null && roundNumber > view.output.terminal.round;
        if (cells.length !== 5 || (!folded && !afterTerminal)) { unsupported = true; continue; }
        const roundLabel = cells[0].querySelector<HTMLElement>(CLASS_SELECTORS.roundNumber);
        if (roundLabel) {
          hideNativeTree(cells[0], roundLabel);
          setNativeStyle(roundLabel, 'visibility', 'visible');
        }
        for (const teamIndex of [0, 1] as const) {
          const cell = cells[columnByTeam[teamIndex]];
          if (!cell) { unsupported = true; continue; }
          desired.add(cell);
          setNativeStyle(cell, 'position', 'relative');
          let replacement = summaryReplacements.get(cell);
          if (!replacement) {
            replacement = document.createElement('span');
            replacement.setAttribute('data-rb', 'summary-health');
            Object.assign(replacement.style, {
              position: 'absolute', inset: '0', zIndex: '2', display: 'grid', placeItems: 'center',
              background: '#10141c', color: teamIndex === 0 ? '#59b7ff' : '#ff6978',
              font: '600 14px/1.2 Inter, system-ui, sans-serif', pointerEvents: 'auto',
            });
            cell.append(replacement);
            summaryReplacements.set(cell, replacement);
          }
          const health = String(folded?.healthAfter[teamIndex] ?? view.output.currentHealth[teamIndex]);
          const damage = folded?.damageDealt[teamIndex === 0 ? 1 : 0] ?? 0;
          const text = `${health}${damage > 0 ? ` (−${damage})` : ''}`;
          if (replacement.textContent !== text) replacement.textContent = text;
          const used = folded ? multiplier(folded.multiplierTenths[teamIndex]) : 'Duel already finished';
          const label = `Custom health ${health}; damage received ${damage}; used multiplier ${used}`;
          if (replacement.title !== label) replacement.title = label;
          if (replacement.getAttribute('aria-label') !== label) replacement.setAttribute('aria-label', label);
        }
      }
    }
    for (const [cell, replacement] of summaryReplacements) {
      if (desired.has(cell)) continue;
      replacement.remove();
      summaryReplacements.delete(cell);
    }
    return unsupported ? 'Native summary layout is unsupported; its HP values were left unchanged' : null;
  }

  function reconcile(): void {
    if (disposed || !lastView) return;
    desiredStyles = new Map();
    const roots = rootElements(document);
    const expectedRound = lastView.output?.rounds.at(-1)?.round ?? null;
    const matchingResultRoots = visibleResultRoots(document, roots, expectedRound);
    const disclosed = matchingResultRoots.length > 0;
    if (disclosed && expectedRound !== null && lastView.context) {
      revealedRoundIdentity = playerRoundIdentity(lastView.context, expectedRound);
    }
    const terminalSummaryVisible = summaryDisclosesTerminal(document, roots, lastView);
    terminal.style.top = terminalSummaryVisible ? '100px' : '22%';
    if (terminalSummaryVisible && lastView.output?.terminal) {
      revealedRoundIdentity = lastView.context
        ? playerRoundIdentity(lastView.context, lastView.output.terminal.round)
        : null;
    }
    const display = derivePlayerTieRangeDisplay(lastView, disclosed, revealedRoundIdentity);
    let layoutDiagnostic: string | null = null;
    if (display.suppressNative) {
      let healthBarsFound = false;
      for (const root of roots) {
        for (const healthBars of root.querySelectorAll<HTMLElement>(CLASS_SELECTORS.healthBars)) {
          hideNativeTree(healthBars);
          healthBarsFound = true;
        }
        if (display.terminal) {
          for (const banner of root.querySelectorAll<HTMLElement>(CLASS_SELECTORS.terminal)) {
            setNativeStyle(banner, 'visibility', 'hidden');
          }
        }
      }
      if (roots.length > 0 && !healthBarsFound && !display.terminal) {
        layoutDiagnostic = 'Native duel HUD layout is unsupported; native values were left visible';
      } else if (roots.length === 0 && !display.terminal && lastView.status !== 'ended') {
        layoutDiagnostic = 'Waiting for a supported duel HUD';
      }
      // Suppress native arithmetic immediately, even while the settled player
      // snapshot is still in flight. Only our result reveal gate shows damage.
      for (const damage of scopedElements(roots, `${CLASS_SELECTORS.damage}, [class*="damage-animation_root__"]`)) {
        hideNativeTree(damage);
      }
      const summaryDiagnostic = applySummaryReplacements(lastView, roots);
      if (summaryDiagnostic) layoutDiagnostic = summaryDiagnostic;
    } else {
      for (const replacement of summaryReplacements.values()) replacement.remove();
      summaryReplacements.clear();
    }
    restoreUnusedNativeStyles();
    renderDisplay(display, layoutDiagnostic);
    mapOverlay.update(lastView, display.result?.round ?? null);
  }

  function queueReconcile(): void {
    if (reconcileQueued || disposed) return;
    reconcileQueued = true;
    queueMicrotask(() => {
      reconcileQueued = false;
      reconcile();
    });
  }

  function showSettings(): void {
    focusBeforeSettings = shadow.activeElement instanceof HTMLElement
      ? shadow.activeElement
      : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modeSelect.value = dependencies.getConfiguredMode();
    settingsPanel.hidden = false;
    modeSelect.focus();
  }

  function closeSettings(): void {
    settingsPanel.hidden = true;
    focusBeforeSettings?.focus();
    focusBeforeSettings = null;
  }

  settingsOpen.addEventListener('click', showSettings);
  byRb<HTMLButtonElement>('settings-close').addEventListener('click', closeSettings);
  settingsPanel.addEventListener('click', event => {
    if (event.target === settingsPanel) closeSettings();
  });
  shadow.addEventListener('keydown', event => {
    if ((event as KeyboardEvent).key === 'Escape' && !settingsPanel.hidden) closeSettings();
  });
  modeSelect.addEventListener('change', () => {
    const value = modeSelect.value;
    if (value !== 'off' && value !== 'full' && value !== 'half') return;
    settingsOpen.textContent = `Tie range settings: ${value === 'off' ? 'Off' : value === 'full' ? 'Full' : 'Half'}`;
    closeSettings();
    dependencies.onModeChange(value);
  });

  const MutationObserverConstructor = document.defaultView?.MutationObserver;
  const observer = MutationObserverConstructor ? new MutationObserverConstructor(queueReconcile) : null;
  observer?.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'style', 'aria-hidden'] });
  settingsOpen.textContent = `Tie range settings: ${dependencies.getConfiguredMode() === 'off' ? 'Off' : dependencies.getConfiguredMode() === 'full' ? 'Full' : 'Half'}`;

  return {
    update(view): void {
      if (disposed) return;
      if (lastView === null || playerDisclosureMustReset(lastView, view)) {
        revealedRoundIdentity = null;
        lastDamageIdentity = null;
      }
      if (lastView?.gameId !== view.gameId || view.status === 'inactive' || view.status === 'off') {
        activeDamage?.cancel();
        activeDamage = null;
        restoreNative();
      }
      if (view.context && view.context.gameId !== lastView?.context?.gameId) {
        const latest = view.output?.rounds.at(-1);
        initialResultIdentity = latest ? playerRoundIdentity(view.context, latest.round) : null;
      }
      lastView = view;
      reconcile();
    },
    openSettings(): void {
      if (disposed) return;
      showSettings();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      activeDamage?.cancel();
      activeDamage = null;
      observer?.disconnect();
      mapOverlay.dispose();
      restoreNative();
      host.remove();
      lastView = null;
    },
  };
}
