// ==UserScript==
// @name         RASHINBAN Player Tie-Range
// @namespace    rashinban2026
// @version      0.1.0
// @description  Player HP and multipliers for RASHINBAN's Full / Half tie-range rules. Set the same mode as the presenter before joining a duel.
// @match        https://www.geoguessr.com/*
// @run-at       document-start
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

import type { TieRangeBandMode } from '../../bundles/rashinban/src/presenter/tie-range-core.ts';
import { createPlayerTieRangeController } from './tie-range-player-controller.ts';
import { parsePlayerPageRoute } from './tie-range-player-state.ts';
import { createPlayerTieRangeUi } from './tie-range-player-ui.ts';

declare function GM_getValue(key: string, defaultValue?: unknown): unknown;
declare function GM_setValue(key: string, value: unknown): void | Promise<void>;
declare function GM_deleteValue(key: string): void | Promise<void>;
declare function GM_registerMenuCommand(name: string, callback: () => void): unknown;

const MODE_KEY = 'rb-tie-range:mode';

function mode(value: unknown): TieRangeBandMode {
  return value === 'full' || value === 'half' ? value : 'off';
}

function accountId(): string | null {
  try {
    const text = document.getElementById('__NEXT_DATA__')?.textContent;
    const id: unknown = text ? JSON.parse(text).props?.accountProps?.account?.user?.userId : null;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

async function start(): Promise<void> {
  let configuredMode = mode(await GM_getValue(MODE_KEY, 'off'));
  let guestId: string | null = null;
  let identityRequest: AbortController | null = null;
  let lastIdentityAttempt = -Infinity;
  let disposed = false;
  const ui = createPlayerTieRangeUi({
    document,
    getConfiguredMode: () => configuredMode,
    onModeChange: (nextMode) => {
      void (async () => {
        try {
          await GM_setValue(MODE_KEY, nextMode);
          configuredMode = nextMode;
          controller.refresh();
        } catch {
          window.alert('Tie-range settings could not be saved. Please try again from the Tampermonkey menu.');
        }
      })();
    },
  });
  const controller = createPlayerTieRangeController({
    fetch: (url, init) => fetch(url, init),
    storage: {
      withLock: (operation) => navigator.locks.request('rashinban.tie-range.storage', operation),
      get: (key) => GM_getValue(key),
      set: async (key, value) => { await GM_setValue(key, value); },
      remove: async (key) => { await GM_deleteValue(key); },
    },
    now: () => Date.now(),
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
    getPath: () => location.pathname,
    getUserId: () => accountId() ?? guestId,
    getConfiguredMode: () => configuredMode,
    onView: (view) => ui.update(view),
  });

  async function refreshIdentity(): Promise<void> {
    if (disposed || !parsePlayerPageRoute(location.pathname)) return;
    if (accountId()) { guestId = null; return; }
    if (identityRequest || Date.now() - lastIdentityAttempt < 10000) return;
    lastIdentityAttempt = Date.now();
    const abort = new AbortController();
    identityRequest = abort;
    const timeout = window.setTimeout(() => abort.abort(), 8000);
    try {
      const response = await fetch('/api/v4/guest-users/id', { credentials: 'include', signal: abort.signal });
      if (!response.ok) return;
      const value: unknown = await response.json();
      const id = typeof value === 'object' && value !== null ? (value as { id?: unknown }).id : null;
      guestId = typeof id === 'string' && id.length > 0 ? id : null;
      if (!disposed) controller.refresh();
    } catch {
      // The HUD can use explicit Blue / Red labels until identity is available.
    } finally {
      window.clearTimeout(timeout);
      if (identityRequest === abort) identityRequest = null;
    }
  }

  GM_registerMenuCommand('RASHINBAN: Player tie-range settings', () => ui.openSettings());
  controller.start();
  void refreshIdentity();
  let previousPath = location.pathname;
  const routeTimer = window.setInterval(() => {
    if (location.pathname !== previousPath) {
      previousPath = location.pathname;
      controller.routeChanged();
    }
    void refreshIdentity();
  }, 500);
  const refresh = () => {
    if (document.visibilityState === 'hidden') return;
    void refreshIdentity();
    void (async () => {
      try { configuredMode = mode(await GM_getValue(MODE_KEY, configuredMode)); } catch { /* Keep the last saved preference. */ }
      if (!disposed) controller.refresh();
    })();
  };
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('popstate', refresh);
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    disposed = true;
    window.clearInterval(routeTimer);
    identityRequest?.abort();
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', refresh);
    window.removeEventListener('popstate', refresh);
    controller.dispose();
    ui.dispose();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { void start().catch(console.error); }, { once: true });
} else {
  void start().catch(console.error);
}
