import type NodeCG from '@nodecg/types';
import { REPLICANTS, type PresenterConnection } from '../../types/replicants.ts';
import type { DuelState, SeriesState, Timeline, Views } from '../../types/presenter.ts';
import { DEFAULT_SETTINGS, parseSettings, type PresenterSettings } from '../../presenter/settings.ts';
import { parseSeries } from '../../presenter/series.ts';
import { applySnapshot } from '../../presenter/normalize.ts';
import { applyTelemetry, seedViews } from '../../presenter/telemetry.ts';
import { advanceTimeline, finishEffect, nextTimelineWakeAtMs } from '../../presenter/timeline.ts';
import { createConnection, createDefaultConnectionDeps, type ConnectionDeps } from './connection.ts';
import { loadConnectionConfig } from './secrets.ts';
import { createReplay, loadReplay, REPLAY_FIXTURES, shiftMessageClock } from './replay.ts';
import { mountPresenterRoutes, PRESENTER_ACTIONS, type PresenterAction } from './routes.ts';

type Clock = { now(): number; schedule(fn: () => void, delayMs: number): () => void; connection?: ConnectionDeps };
const clock: Clock = { now: () => Date.now(), schedule(fn, ms) { const id = setTimeout(fn, ms); return () => clearTimeout(id); } };
const DEFAULT_SERIES: SeriesState = {
  id: 'series', source: 'manual',
  left: { id: 'left', playerId: null, name: 'PLAYER 1', handle: '', wins: 0 },
  right: { id: 'right', playerId: null, name: 'PLAYER 2', handle: '', wins: 0 },
};
function record(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('Expected object');
  return input as Record<string, unknown>;
}

export function registerPresenter(nodecg: NodeCG.ServerAPI, deps: Clock = clock): void {
  const config = (nodecg.bundleConfig as { presenter?: Record<string, unknown> }).presenter ?? {};
  const input = config.input === 'replay' ? 'replay' : 'live';
  let fixture: unknown = config.replayFixture ?? REPLAY_FIXTURES[0];
  const settings = nodecg.Replicant<PresenterSettings>(REPLICANTS.presenterSettings, { defaultValue: structuredClone(DEFAULT_SETTINGS), persistent: true });
  const series = nodecg.Replicant<SeriesState>(REPLICANTS.presenterSeries, { defaultValue: structuredClone(DEFAULT_SERIES), persistent: true });
  try { settings.value = parseSettings(settings.value); } catch { settings.value = structuredClone(DEFAULT_SETTINGS); }
  try { series.value = parseSeries(series.value); } catch { series.value = structuredClone(DEFAULT_SERIES); }
  const connection = nodecg.Replicant<PresenterConnection>(REPLICANTS.presenterConnection, { persistent: false, defaultValue: {
    state: 'disconnected', partyId: null, gameId: null, lastUpdateMs: null, error: null, serverOffsetMs: 0,
    input, replayFixture: input === 'replay' && typeof fixture === 'string' ? fixture : null, warnings: [],
  } });
  const duel = nodecg.Replicant<DuelState | null>(REPLICANTS.presenterDuel, { persistent: false, defaultValue: null });
  const views = nodecg.Replicant<Views | null>(REPLICANTS.presenterViews, { persistent: false, defaultValue: null });
  const timeline = nodecg.Replicant<Timeline>(REPLICANTS.presenterTimeline, { persistent: false, defaultValue: advanceTimeline(null, null, deps.now(), false, settings.value.timing) });
  let cancelWake: (() => void) | null = null;
  let source: { start(): void; stop(): void; reconnect(): void } | null = null;

  function tick(bootstrap = false): void {
    cancelWake?.(); cancelWake = null;
    const now = deps.now();
    let next = advanceTimeline(timeline.value, duel.value, now, bootstrap, settings.value.timing);
    // No playable video exists at this milestone. Complete at the first eligible
    // effect boundary; do not hold results for the ten-second media watchdog.
    const effectStart = next.cues.find(cue => cue.kind === 'five-k')?.atMs;
    if (next.effect !== 'none' && effectStart !== undefined && now >= effectStart) {
      next = finishEffect(next, next.generation, now, settings.value.timing);
      next = advanceTimeline(next, duel.value, now, false, settings.value.timing);
    }
    // NodeCG proxies have a single Replicant owner. Detach observations (pins)
    // and prior timeline objects before publishing across that boundary.
    timeline.value = JSON.parse(JSON.stringify(next)) as Timeline;
    const wake = nextTimelineWakeAtMs(next, duel.value, now);
    const skipAt = next.effect !== 'none' && effectStart !== undefined && effectStart > now ? effectStart : null;
    const at = wake === null ? skipAt : skipAt === null ? wake : Math.min(wake, skipAt);
    if (at !== null) cancelWake = deps.schedule(() => tick(), at - now);
  }
  function reset(): void { duel.value = null; views.value = null; tick(true); }
  function ingest(message: unknown, at: number, bootstrap: boolean, offset = 0): void {
    const adjusted = offset === 0 ? message : shiftMessageClock(message, -offset);
    const accepted = applySnapshot(duel.value, adjusted);
    if (accepted.accepted && accepted.state) {
      duel.value = accepted.state;
      const state = accepted.state;
      if (bootstrap || !views.value || views.value.gameId !== state.gameId || views.value.round !== state.round) views.value = seedViews(state);
      tick(bootstrap);
    } else if (bootstrap && accepted.state && accepted.warnings.length === 0) {
      // Reconnect can return the same version. Restore its current presentation
      // without replaying an in-flight historical result or retaining old POV.
      views.value = seedViews(accepted.state);
      tick(true);
    } else if (duel.value && views.value) {
      views.value = applyTelemetry(views.value, duel.value, adjusted);
    }
    connection.value = { ...connection.value, lastUpdateMs: at,
      gameId: duel.value?.gameId ?? connection.value.gameId, warnings: accepted.warnings };
  }
  function startReplay(name: unknown): void {
    // Validate and read before canceling an active replay.
    const rows = loadReplay(name);
    source?.stop(); reset(); fixture = name;
    connection.value = { ...connection.value, state: 'live', input: 'replay', error: null, replayFixture: String(name), serverOffsetMs: 0 };
    source = createReplay(rows, (message, at) => ingest(message, at, false), deps);
    source.start();
  }
  function reconnect(body: unknown): void {
    const value = body === undefined ? {} : record(body);
    if (Object.keys(value).some(key => key !== 'fixture')) throw new Error('Invalid reconnect');
    if (input === 'replay') { startReplay(value.fixture ?? fixture); return; }
    if ('fixture' in value) throw new Error('Replay is disabled in live mode');
    source?.stop(); reset();
    try {
      const credentials = loadConnectionConfig({
        ...config,
        partyId: typeof config.partyId === 'string' ? config.partyId : null,
        clientVersion: typeof config.clientVersion === 'string' ? config.clientVersion : '',
        cookieFile: typeof config.cookieFile === 'string' ? config.cookieFile : '.secrets/geoguessr.json',
      });
      source = createConnection(credentials, {
        onMessage: ingest,
        onStatus(status) {
          connection.value = { ...connection.value, ...status };
          const terminal = duel.value?.status === 'Finished' || duel.value?.aborted;
          if ((status.state === 'disconnected' && status.gameId === null && !terminal) || status.state === 'unsupported'
            || (status.state === 'connecting' && status.gameId !== duel.value?.gameId)) reset();
        },
      }, deps.connection ?? createDefaultConnectionDeps());
      source.start();
    } catch {
      connection.value = { ...connection.value, state: 'auth-error', error: 'Check server-side GeoGuessr connection configuration' };
    }
  }
  function current() { return { settings: settings.value, series: series.value, connection: connection.value, timeline: timeline.value }; }
  function control(action: PresenterAction, body: unknown): unknown {
    if (action === 'series') series.value = parseSeries(body);
    else if (action === 'settings') { settings.value = parseSettings(body); tick(); }
    else if (action === 'reconnect') reconnect(body);
    else {
      if (body !== undefined && Object.keys(record(body)).length) throw new Error('Unexpected body');
      const patch = action === 'mute' ? { muted: true } : action === 'unmute' ? { muted: false }
        : { viewSource: action === 'view/chroma' ? 'chroma' : 'rendered' };
      settings.value = parseSettings({ ...settings.value, ...patch });
    }
    return current();
  }
  mountPresenterRoutes(nodecg, control);
  nodecg.listenFor('presenter:control', (request: unknown, ack) => {
    try {
      const value = record(request);
      if (!PRESENTER_ACTIONS.includes(value.action as PresenterAction)) throw new Error('Invalid action');
      const result = control(value.action as PresenterAction, value.body);
      if (ack && !ack.handled) ack(null, result);
    } catch { if (ack && !ack.handled) ack(new Error('Invalid presenter request')); }
  });
  // Browser clocks only measure NodeCG; no GeoGuessr offset is applied there.
  nodecg.listenFor('presenter:clock', (_request, ack) => { if (ack && !ack.handled) ack(null, deps.now()); });
  try {
    if (config.input !== undefined && config.input !== 'live' && config.input !== 'replay') throw new Error('Invalid input mode');
    reconnect(undefined);
  } catch { connection.value = { ...connection.value, state: 'disconnected', error: 'Invalid presenter input or replay fixture' }; }
}
