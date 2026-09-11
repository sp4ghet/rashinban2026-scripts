import type { TieRangeBandMode, TieRangeRoundOutput } from '../../bundles/rashinban/src/presenter/tie-range-core.ts';
import type { PlayerTieRangeView } from './tie-range-player-controller.ts';
import {
  derivePlayerTieRangeDisplay,
  type PlayerTieRangeDisplay,
} from './tie-range-player-view-model.ts';

export type PlayerTieRangeUiDependencies = {
  document: Document;
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
  resultRoot: '[class*="round-score_root__"][class*="round-score_isMounted__"]',
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
    if ((current as HTMLElement).hidden || current.getAttribute('aria-hidden') === 'true') return false;
    const style = document.defaultView?.getComputedStyle(current);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse'
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
      if (!classStartsWith(element, 'round-score_root__')
        || !classStartsWith(element, 'round-score_isMounted__') || !visible(element, document)) return false;
      const text = element.querySelector(CLASS_SELECTORS.resultRound)?.textContent ?? '';
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
      .hud { position: fixed; top: max(12px, env(safe-area-inset-top)); left: 50%; width: min(700px, calc(100vw - 144px));
        transform: translateX(-50%); filter: drop-shadow(0 3px 9px #000b); }
      .mode { margin: 0 auto 6px; width: max-content; padding: 3px 9px; border-radius: 999px;
        background: #111d; color: #f4f4f4; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
      .teams { display: grid; grid-template-columns: 1fr 1fr; gap: 42px; }
      .team { min-width: 0; padding: 7px 9px 9px; border: 1px solid #ffffff3b; border-radius: 8px; background: #0d111ae8; }
      .team[data-side="blue"] { --team: #38a8ff; }
      .team[data-side="red"] { --team: #ff5365; }
      .team-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
      .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--team); font-size: 13px; }
      .numbers { display: flex; align-items: baseline; gap: 7px; }
      .health { font-size: 20px; font-variant-numeric: tabular-nums; }
      .multiplier { color: #ffe169; font-size: 16px; font-variant-numeric: tabular-nums; }
      .track { height: 8px; margin-top: 5px; overflow: hidden; border-radius: 999px; background: #ffffff25; }
      .fill { height: 100%; width: 0; border-radius: inherit; background: var(--team); transition: width 220ms ease; }
      .result { margin: 7px auto 0; width: min(560px, 100%); padding: 6px 10px; border: 1px solid #ffffff2b;
        border-radius: 7px; background: #111e; text-align: center; font-size: 12px; }
      .result-title { color: #ffe169; margin-bottom: 3px; }
      .result-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-variant-numeric: tabular-nums; }
      .result-meta { margin-top: 3px; color: #d5d8df; font-size: 11px; }
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
      @media (max-width: 620px) { .hud { width: calc(100vw - 18px); top: 52px; } .teams { gap: 8px; }
        .team { padding-inline: 7px; } .health { font-size: 17px; } }
    </style>
    <section class="hud" data-rb="hud" aria-live="polite" hidden>
      <div class="mode" data-rb="mode" data-rb-mode-note></div>
      <div class="teams">
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
  const originalStyles = new Map<HTMLElement, Partial<Record<StyleProperty, string>>>();
  const originallyMissingStyleAttribute = new Set<HTMLElement>();
  const summaryReplacements = new Map<HTMLElement, HTMLElement>();
  let desiredStyles: Map<HTMLElement, Set<StyleProperty>> | null = null;
  let lastView: PlayerTieRangeView | null = null;
  let disclosureGameId: string | null = null;
  let revealedThroughRound = 0;
  let focusBeforeSettings: HTMLElement | null = null;
  let disposed = false;
  let reconcileQueued = false;

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
    hud.hidden = !display.showHud;
    byRb<HTMLElement>('mode').textContent = display.appliesToNextDuel
      ? `${display.modeLabel} · setting applies next duel`
      : display.modeLabel;
    const configured = lastView?.configuredMode ?? dependencies.getConfiguredMode();
    settingsOpen.textContent = `Tie range settings: ${configured === 'off' ? 'Off' : configured === 'full' ? 'Full' : 'Half'}`;
    settingsOpen.hidden = lastView?.status === 'inactive';
    if (display.teams) {
      display.teams.forEach((team, index) => {
        const root = byRb<HTMLElement>(`team-${index}`);
        root.dataset.side = team.side;
        root.querySelector<HTMLElement>('[data-rb="label"]')!.textContent = team.label;
        root.querySelector<HTMLElement>('[data-rb="health"]')!.textContent = String(team.health);
        root.querySelector<HTMLElement>('[data-rb="multiplier"]')!.textContent = multiplier(team.multiplierTenths);
        const percent = team.maximumHealth <= 0 ? 0 : Math.max(0, Math.min(100, team.health / team.maximumHealth * 100));
        root.querySelector<HTMLElement>('[data-rb="bar-fill"]')!.style.width = `${percent}%`;
      });
    }
    const result = byRb<HTMLElement>('result');
    result.hidden = display.result === null;
    if (display.result && display.teams) {
      byRb<HTMLElement>('result-title').textContent = `Round ${display.result.round} result`;
      for (const index of [0, 1] as const) {
        byRb<HTMLElement>(`result-team-${index}`).textContent = `${display.teams[index].label}: score ${display.result.scores[index]} · damage ${display.result.damageDealt[index]} · used ${multiplier(display.result.usedMultiplierTenths[index])} · next ${multiplier(display.result.nextMultiplierTenths[index])}`;
      }
      byRb<HTMLElement>('result-meta').textContent = `Tie band ${display.result.band} · ${display.result.withinBand ? 'inside range' : 'outside range'}`;
    }
    terminal.hidden = display.terminal === null;
    if (display.terminal) {
      byRb<HTMLElement>('terminal-headline').textContent = display.terminal.headline;
      byRb<HTMLElement>('terminal-detail').textContent = display.terminal.detail;
    }
    const message = [display.diagnostic, layoutDiagnostic].filter(Boolean).join(' · ');
    diagnostic.hidden = message.length === 0;
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
      const columnByTeam = view.context.playerIds.map(playerId => healthColumns.find(column => (
        userIdFromLink(headerCells[column], document) === playerId
      )) ?? -1) as [number, number];
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
              background: 'rgba(16, 20, 28, .98)', color: teamIndex === 0 ? '#59b7ff' : '#ff6978',
              font: '600 14px/1.2 Inter, system-ui, sans-serif', pointerEvents: 'none',
            });
            cell.append(replacement);
            summaryReplacements.set(cell, replacement);
          }
          const health = String(folded?.healthAfter[teamIndex] ?? view.output.currentHealth[teamIndex]);
          if (replacement.textContent !== health) replacement.textContent = health;
          const label = `Custom health ${health}`;
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
    if (disclosed && expectedRound !== null) revealedThroughRound = Math.max(revealedThroughRound, expectedRound);
    if (summaryDisclosesTerminal(document, roots, lastView) && lastView.output?.terminal) {
      revealedThroughRound = Math.max(revealedThroughRound, lastView.output.terminal.round);
    }
    const display = derivePlayerTieRangeDisplay(lastView, disclosed, revealedThroughRound);
    let layoutDiagnostic: string | null = null;
    if (display.suppressNative) {
      let healthBarsFound = false;
      for (const root of roots) {
        for (const healthBars of root.querySelectorAll<HTMLElement>(CLASS_SELECTORS.healthBars)) {
          setNativeStyle(healthBars, 'display', 'none');
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
      if (display.result) {
        for (const resultRoot of matchingResultRoots) {
          for (const damage of resultRoot.querySelectorAll<HTMLElement>(CLASS_SELECTORS.damage)) {
            setNativeStyle(damage, 'visibility', 'hidden');
          }
        }
      }
      const summaryDiagnostic = applySummaryReplacements(lastView, roots);
      if (summaryDiagnostic) layoutDiagnostic = summaryDiagnostic;
    } else {
      for (const replacement of summaryReplacements.values()) replacement.remove();
      summaryReplacements.clear();
    }
    restoreUnusedNativeStyles();
    renderDisplay(display, layoutDiagnostic);
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
      if (lastView?.gameId !== view.gameId) {
        disclosureGameId = view.gameId;
        revealedThroughRound = 0;
        restoreNative();
      }
      if (disclosureGameId !== view.gameId || view.status === 'inactive' || view.status === 'off') {
        disclosureGameId = view.gameId;
        revealedThroughRound = 0;
        restoreNative();
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
      observer?.disconnect();
      restoreNative();
      host.remove();
      lastView = null;
    },
  };
}
