import { clockOffset, eligibleCompletion, type ClockSample, type ClientRole } from '../../presenter/clock.ts';
import type { PresenterClients, RendererStatus } from '../../types/replicants.ts';
import type { Cue, Timeline } from '../../types/presenter.ts';
export function clientRole(search: string): ClientRole { return new URLSearchParams(search).get('role') === 'program' ? 'program' : 'preview'; }
export type ClientDeps = { clientId: string; role: ClientRole; wallNow(): number; monotonicNow(): number;
  send(name: string, body?: unknown): Promise<unknown>; schedule(fn: () => void, ms: number): () => void };
export function createPresenterClient(deps: ClientDeps) {
  const epoch = deps.wallNow(); const startedAt = deps.monotonicNow();
  const elapsed = () => epoch + deps.monotonicNow() - startedAt;
  let offset = 0; let lastNow = -Infinity; let lastSync = -Infinity;
  let disposed = false; let started = false; let ready = false; let renderer: RendererStatus = 'unreported';
  let clients: PresenterClients = { clients: [], program: null }; let timeline: Timeline | null = null;
  let active = false; let ownership = 0; let adopt = true; const seen = new Set<string>();
  const cancels = new Set<() => void>();
  function schedule(fn: () => void, ms: number) {
    const cancel = deps.schedule(() => { cancels.delete(stop); if (!disposed) fn(); }, ms);
    function stop() { cancel(); cancels.delete(stop); }
    cancels.add(stop); return stop;
  }
  function now() {
    // The first sync establishes the server epoch, even when the local wall
    // clock starts ahead. Only synchronized time must never move backwards.
    if (!Number.isFinite(lastSync)) return elapsed();
    lastNow = Math.max(lastNow, elapsed() + offset); return lastNow;
  }
  function ownsProgram() {
    const next = !disposed && deps.role === 'program' && deps.monotonicNow() - lastSync < 30000
      && eligibleCompletion(clients.program, deps.clientId, now());
    if (next !== active) { active = next; ownership++; adopt = true; }
    return active;
  }
  async function sync() {
    const samples: ClockSample[] = [];
    for (let i = 0; i < 5 && !disposed; i++) {
      const sentMs = elapsed(); let stop = () => {};
      try {
        const server = await Promise.race([deps.send('presenter:clock'), new Promise<undefined>(resolve => { stop = schedule(() => resolve(undefined), 1000); })]);
        const receivedMs = elapsed();
        if (typeof server === 'number' && Number.isFinite(server) && receivedMs - sentMs < 1000) samples.push({ sentMs, receivedMs, serverMs: server });
      } catch { /* Keep the last usable offset through a brief disconnect. */ }
      finally { stop(); }
    }
    if (disposed) return;
    if (samples.length) { offset = clockOffset(samples); lastSync = deps.monotonicNow(); }
    schedule(() => { void sync(); }, 10000);
  }
  function heartbeat() {
    void deps.send('presenter:client', { clientId: deps.clientId, role: deps.role,
      ready: ready && deps.monotonicNow() - lastSync < 30000, renderer }).catch(() => {});
    schedule(heartbeat, 2000);
  }
  return {
    async start() { if (started || disposed) return; started = true; heartbeat(); await sync(); },
    now, ownsProgram,
    setReady(value: boolean) { ready = value; },
    setRendererStatus(value: RendererStatus) {
      renderer = value;
      if (!disposed) void deps.send('presenter:renderer', { clientId: deps.clientId, status: value }).catch(() => {});
    },
    updateClients(value: PresenterClients) { ownsProgram(); clients = value; ownsProgram(); },
    updateTimeline(value: Timeline) {
      if (timeline?.generation !== value.generation) seen.clear();
      timeline = value;
    },
    pollCues(): Cue[] {
      const owns = ownsProgram(); if (!timeline || !Number.isFinite(lastSync)) return [];
      const at = now(); const due: Cue[] = [];
      for (const cue of timeline.cues) {
        if (seen.has(cue.id)) continue;
        if (cue.untilMs <= at || ((!owns || adopt) && cue.atMs <= at)) { seen.add(cue.id); continue; }
        if (owns && cue.atMs <= at) { seen.add(cue.id); due.push(cue); }
      }
      adopt = false; return due;
    },
    effectCompletion(value: Timeline): (failed?: boolean) => Promise<boolean> {
      ownsProgram(); const token = ownership;
      const generation = value.generation; const effect = value.effect;
      const cueId = value.cues.find(cue => cue.kind === 'five-k')?.id;
      return async (failed = false) => {
        const at = now(); const cue = timeline?.cues.find(item => item.id === cueId && item.kind === 'five-k');
        if (!ownsProgram() || ownership !== token || !timeline || timeline.generation !== generation
          || effect === 'none' || timeline.effect !== effect || !cue || at < cue.atMs || at >= cue.untilMs) return false;
        try { return await deps.send('presenter:effect-ended', { clientId: deps.clientId, generation, effect, cueId, ...(failed ? { failed: true } : {}) }) === true; }
        catch { return false; }
      };
    },
    dispose() { disposed = true; for (const cancel of [...cancels]) cancel(); },
  };
}
