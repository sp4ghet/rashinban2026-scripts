import { applyPinCues, samePin } from '../../presenter/cues.ts';
import type NodeCG from '@nodecg/types';
import { REPLICANTS, RENDERER_STATUSES, type PresenterConnection, type PresenterRenderer, type RendererStatus, type PresenterClients } from '../../types/replicants.ts';
import { eligibleCompletion, type ClientRole } from '../../presenter/clock.ts';
import type { DuelState, SeriesState, Timeline, Views } from '../../types/presenter.ts';
import { DEFAULT_SETTINGS, parseSettings, type PresenterSettings } from '../../presenter/settings.ts';
import { parseSeries } from '../../presenter/series.ts';
import { applySnapshot, rollbackRound } from '../../presenter/normalize.ts';
import { updateRuleContext, type RuleContexts } from '../../presenter/tie-range-context.ts';
import { deriveTieRange } from '../../presenter/tie-range.ts';
import { applyTelemetry, seedViews } from '../../presenter/telemetry.ts';
import { advanceTimeline, finishEffect, nextTimelineWakeAtMs } from '../../presenter/timeline.ts';
import { createConnection, createDefaultConnectionDeps, type ConnectionDeps } from './connection.ts';
import { loadConnectionConfig } from './secrets.ts';
import { createReplay, loadReplay, REPLAY_FIXTURES, shiftMessageClock } from './replay.ts';
import { mountPresenterRoutes, PRESENTER_ACTIONS, type PresenterAction } from './routes.ts';
import { AUDIO_STATES, CUE_KINDS, celebrationAsset, EMPTY_MEDIA, parseMedia, type AssetInventory, type MediaManifest, type AudioStatus } from '../../presenter/media.ts';
import type { PresenterMediaStatus } from '../../types/replicants.ts';

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
function parsePartySelection(input: unknown): string | null {
  if (typeof input !== 'string') throw new Error('Invalid party selection');
  const value = input.trim();
  if (!value) return null;
  if (/^[\w-]{1,128}$/.test(value)) return value;
  // Accept only the documented broadcast URL; never fetch operator-provided URLs.
  const broadcast = /^https:\/\/www\.geoguessr\.com\/party\/broadcast\/([\w-]{1,128})$/.exec(value);
  if (!broadcast) throw new Error('Invalid broadcast URL or party ID');
  return broadcast[1];
}

export function registerPresenter(nodecg: NodeCG.ServerAPI, deps: Clock = clock): void {
  const config = (nodecg.bundleConfig as { presenter?: Record<string, unknown> }).presenter ?? {};
  let input: 'replay' | 'live' = config.input === 'replay' ? 'replay' : 'live';
  const configuredPartyId = typeof config.partyId === 'string' ? config.partyId.trim() || null : null;
  let selectedPartyId = configuredPartyId;
  let fixture: unknown = config.replayFixture ?? REPLAY_FIXTURES[0];
  const settings = nodecg.Replicant<PresenterSettings>(REPLICANTS.presenterSettings, { defaultValue: structuredClone(DEFAULT_SETTINGS), persistent: true });
  const ruleContexts = nodecg.Replicant<RuleContexts>(REPLICANTS.presenterRuleContexts, { defaultValue: { live: null, replay: null }, persistent: true });
  let rawDuel: DuelState | null = null;
  let ruleWarnings: string[] = [];
  const media = nodecg.Replicant<MediaManifest>(REPLICANTS.presenterMedia, { defaultValue: structuredClone(EMPTY_MEDIA), persistent: true });
  try { media.value = parseMedia(media.value); } catch { media.value = structuredClone(EMPTY_MEDIA); }
  const videoAssets = nodecg.Replicant<AssetInventory>('assets:video', { defaultValue: [], persistent: false });
  const mediaStatus = nodecg.Replicant<PresenterMediaStatus>(REPLICANTS.presenterMediaStatus, { defaultValue: { generation: null, effect: 'none', status: 'idle' }, persistent: false });
  const series = nodecg.Replicant<SeriesState>(REPLICANTS.presenterSeries, { defaultValue: structuredClone(DEFAULT_SERIES), persistent: true });
  try { settings.value = parseSettings(settings.value); } catch { settings.value = structuredClone(DEFAULT_SETTINGS); }
  try { series.value = parseSeries(series.value); } catch { series.value = structuredClone(DEFAULT_SERIES); }
  const connection = nodecg.Replicant<PresenterConnection>(REPLICANTS.presenterConnection, { persistent: false, defaultValue: {
    state: 'disconnected', partyId: null, gameId: null, lastUpdateMs: null, error: null, serverOffsetMs: 0,
    input, replayFixture: input === 'replay' && typeof fixture === 'string' ? fixture : null, warnings: [],
    configuredPartyId, selectedPartyId,
  } });
  const duel = nodecg.Replicant<DuelState | null>(REPLICANTS.presenterDuel, { persistent: false, defaultValue: null });
  const renderer = nodecg.Replicant<PresenterRenderer>(REPLICANTS.presenterRenderer, { persistent: false, defaultValue: { status: 'unreported', updatedAtMs: null } });
  const clients = nodecg.Replicant<PresenterClients>(REPLICANTS.presenterClients, { persistent: false, defaultValue: { clients: [], program: null } });
  let cancelExpiry: (() => void) | null = null; let audioToken = 0;
  function publishClients(value: PresenterClients): void {
    cancelExpiry?.(); cancelExpiry = null;
    const now = deps.now();
    value.clients = value.clients.filter(client => client.lastSeenMs + 6000 > now);
    if (value.program && (value.program.expiresAtMs <= now || !value.clients.some(client => client.clientId === value.program!.clientId))) value.program = null;
    const mode = settings.value.audioOutput;
    const eligible = (client: PresenterClients['clients'][number]) => client.clockFresh && client.audio
      && ['ready', 'silent', 'partial', 'error'].includes(client.audio.state)
      && (mode === 'separate' ? client.role === 'audio' : client.role === 'program' && client.clientId === value.program?.clientId);
    if (value.audio && value.audio.expiresAtMs <= now) value.audio = null;
    if (value.audio && (value.audio.mode !== mode || !value.clients.some(c => c.clientId === value.audio!.clientId && eligible(c)))) value.audio.releasing = true;
    if (!value.audio) {
      const candidate = value.clients.find(eligible);
      if (candidate) value.audio = { clientId: candidate.clientId, mode, token: ++audioToken, releasing: false, expiresAtMs: candidate.lastSeenMs + 6000 };
    }
    clients.value = value;
    const owner = value.clients.find(client => client.clientId === value.program?.clientId);
    // Detach the nested object before publishing to another Replicant.
    renderer.value = owner ? { ...owner.renderer } : { status: 'unreported', updatedAtMs: null };
    const expiry = Math.min(...value.clients.map(client => client.lastSeenMs + 6000), value.program?.expiresAtMs ?? Infinity, value.audio?.expiresAtMs ?? Infinity);
    if (Number.isFinite(expiry)) cancelExpiry = deps.schedule(() => publishClients(copyClients()), expiry - now);
  }
  function copyClients(): PresenterClients { return JSON.parse(JSON.stringify(clients.value)) as PresenterClients; }
  function validStatus(status: unknown): status is RendererStatus { return typeof status === 'string' && RENDERER_STATUSES.includes(status as RendererStatus); }
  nodecg.listenFor('presenter:client', (request: unknown, ack) => {
    try {
      const value = record(request);
      if (Object.keys(value).some(key => !['clientId', 'role', 'ready', 'renderer', 'audio', 'clockFresh'].includes(key))
        || typeof value.clientId !== 'string' || !/^[\w-]{1,80}$/.test(value.clientId)
        || !['program', 'preview', 'audio'].includes(value.role as string) || typeof value.ready !== 'boolean' || !validStatus(value.renderer)) throw new Error();
      let audio: AudioStatus = { state: 'unreported', missing: [] };
      if (value.audio !== undefined) {
        const status = record(value.audio);
        if (Object.keys(status).some(k => !['state', 'missing'].includes(k)) || !AUDIO_STATES.includes(status.state as AudioStatus['state'])
          || !Array.isArray(status.missing) || status.missing.length > 32 + CUE_KINDS.length || status.missing.some(id => typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id))) throw Error();
        audio = { state: status.state as AudioStatus['state'], missing: [...status.missing] as string[] };
      }
      if (value.clockFresh !== undefined && typeof value.clockFresh !== 'boolean') throw Error();
      const now = deps.now(); const next = copyClients();
      next.clients = next.clients.filter(client => client.lastSeenMs + 6000 > now);
      const existing = next.clients.find(client => client.clientId === value.clientId);
      if (existing && existing.role !== value.role) throw new Error();
      const report = { clientId: value.clientId, role: value.role as ClientRole, ready: value.ready,
        lastSeenMs: now, renderer: { status: value.renderer, updatedAtMs: now }, audio, clockFresh: value.clockFresh === true };
      if (existing) Object.assign(existing, report); else next.clients.push(report);
      if (next.program && next.program.expiresAtMs <= now) next.program = null;
      if (value.role === 'program' && (!next.program || next.program.clientId === value.clientId)) next.program = { clientId: value.clientId, expiresAtMs: now + 6000 };
      if (next.audio?.clientId === value.clientId && !next.audio.releasing && next.audio.expiresAtMs > now) next.audio.expiresAtMs = now + 6000;
      publishClients(next);
      if (ack && !ack.handled) ack(null, true);
    } catch { if (ack && !ack.handled) ack(new Error('Invalid presenter client')); }
  });
  nodecg.listenFor('presenter:audio-muted', (request: unknown, ack) => {
    let accepted = false;
    try {
      const value = record(request); const next = copyClients();
      if (Object.keys(value).every(k => ['clientId', 'token'].includes(k)) && next.audio?.releasing
        && next.audio.clientId === value.clientId && next.audio.token === value.token) {
        next.audio = null; publishClients(next); accepted = true;
      }
    } catch { /* Ignore malformed or obsolete acknowledgements. */ }
    if (ack && !ack.handled) ack(null, accepted);
  });
  nodecg.listenFor('presenter:renderer', (request: unknown) => {
    try {
      const value = record(request);
      if (Object.keys(value).some(key => !['clientId', 'status'].includes(key)) || !validStatus(value.status)) return;
      const next = copyClients(); const client = next.clients.find(client => client.clientId === value.clientId);
      if (!client || client.lastSeenMs + 6000 <= deps.now()) return;
      client.renderer = { status: value.status, updatedAtMs: deps.now() };
      publishClients(next);
    } catch { /* Ignore malformed reports; never publish raw error text. */ }
  });
  const views = nodecg.Replicant<Views | null>(REPLICANTS.presenterViews, { persistent: false, defaultValue: null });
  const timeline = nodecg.Replicant<Timeline>(REPLICANTS.presenterTimeline, { persistent: false, defaultValue: advanceTimeline(null, null, deps.now(), false, settings.value.timing) });
  let cancelWake: (() => void) | null = null;
  let source: { start(): void; stop(): void; reconnect(): void } | null = null;

  function tick(bootstrap = false): void {
    cancelWake?.(); cancelWake = null;
    const now = deps.now();
    let next = advanceTimeline(timeline.value, duel.value, now, bootstrap, settings.value.timing, {
      'single-5k': media.value.fiveK.single?.watchdogMs, 'double-5k': media.value.fiveK.double?.watchdogMs,
    });
    if (timeline.value.effect !== 'none' && next.effect === 'none' && timeline.value.effectDeadlineMs !== null && now >= timeline.value.effectDeadlineMs) {
      mediaStatus.value = { generation: next.generation, effect: timeline.value.effect, status: 'watchdog' };
    }
    const effectStart = next.cues.find(cue => cue.kind === 'five-k')?.atMs;
    const asset = celebrationAsset(media.value, next.effect, videoAssets.value);
    if (next.effect !== 'none' && effectStart !== undefined && timeline.value.effect === 'none' && asset) {
      mediaStatus.value = { generation: next.generation, effect: next.effect, status: 'pending' };
    }
    if (next.effect !== 'none' && !asset && effectStart !== undefined && now >= effectStart) {
      mediaStatus.value = { generation: next.generation, effect: next.effect, status: 'missing' };
      next = finishEffect(next, next.generation, now, settings.value.timing);
      next = advanceTimeline(next, duel.value, now, false, settings.value.timing);
    }
    // NodeCG proxies have a single Replicant owner. Detach observations (pins)
    // and prior timeline objects before publishing across that boundary.
    timeline.value = JSON.parse(JSON.stringify(next)) as Timeline;
    const wake = nextTimelineWakeAtMs(next, duel.value, now);
    const skipAt = next.effect !== 'none' && !asset && effectStart !== undefined && effectStart > now ? effectStart : null;
    const at = wake === null ? skipAt : skipAt === null ? wake : Math.min(wake, skipAt);
    if (at !== null) cancelWake = deps.schedule(() => tick(), at - now);
  }
  function reset(): void { rawDuel = null; ruleWarnings = []; duel.value = null; views.value = null; mediaStatus.value = { generation: null, effect: 'none', status: 'idle' }; tick(true); }
  nodecg.listenFor('presenter:effect-ended', (request: unknown, ack) => {
    let accepted = false;
    try {
      const value = record(request); const current = timeline.value; const now = deps.now();
      const cue = current.cues.find(item => item.kind === 'five-k' && item.id === value.cueId);
      const owner = clients.value.clients.find(client => client.clientId === value.clientId);
      if (Object.keys(value).every(key => ['clientId', 'generation', 'effect', 'cueId', 'failed'].includes(key))
        && (value.failed === undefined || typeof value.failed === 'boolean')
        && typeof value.clientId === 'string' && owner?.role === 'program'
        && eligibleCompletion(clients.value.program, value.clientId, now)
        && value.generation === current.generation && ['results-transition', 'results-reveal', 'between-rounds', 'waiting-host', 'finished'].includes(current.phase)
        && current.effect !== 'none' && value.effect === current.effect
        && cue && cue.atMs <= now && now < cue.untilMs) {
        mediaStatus.value = { generation: current.generation, effect: current.effect, status: value.failed ? 'failed' : 'complete' };
        timeline.value = JSON.parse(JSON.stringify(finishEffect(current, current.generation, now, settings.value.timing))) as Timeline;
        tick(); accepted = true;
      }
    } catch { /* Malformed/stale callbacks have no effect. */ }
    if (ack && !ack.handled) ack(null, accepted);
  });
  function ingest(message: unknown, at: number, bootstrap: boolean, offset = 0): void {
    const adjusted = offset === 0 ? message : shiftMessageClock(message, -offset);
    // The source owns protocol versioning and rollback even after our game finishes.
    const previous = bootstrap && input === 'replay' ? null : rawDuel ?? ruleContexts.value[input]?.source ?? null;
    const accepted = applySnapshot(previous, adjusted);
    function present(state: DuelState, restore: boolean): void {
      const configured = settings.value.tieRange.enabled ? settings.value.tieRange.mode : 'off';
      const context = updateRuleContext(ruleContexts.value[input], state, configured, rollbackRound(previous, state, adjusted));
      // Publication recursively proxies nested objects. Keep our calculation input detached.
      ruleContexts.value = JSON.parse(JSON.stringify({ ...ruleContexts.value, [input]: context })) as RuleContexts;
      rawDuel = state;
      try {
        const derived = deriveTieRange(context.source, context.mode);
        const nextViews = restore || !views.value || views.value.gameId !== derived.gameId || views.value.round !== derived.round
          ? seedViews(derived) : views.value;
        // NodeCG values can have only one Replicant owner.
        duel.value = JSON.parse(JSON.stringify(derived)) as DuelState;
        views.value = nextViews;
        ruleWarnings = [];
        tick(restore);
      } catch {
        ruleWarnings = ['Tie-range calculation unavailable: check multiplier settings and complete round history.'];
        duel.value = null; views.value = null; tick(true);
      }
    }
    if (accepted.accepted && accepted.state) {
      present(accepted.state, bootstrap);
    } else if (bootstrap && accepted.state && accepted.warnings.length === 0) {
      // Reconnect can return the same version. Restore its current presentation
      // without replaying an in-flight historical result or retaining old POV.
      present(accepted.state, true);
    } else if (rawDuel && duel.value && views.value && duel.value.status !== 'Finished') {
      const previous = views.value;
      const next = applyTelemetry(previous, rawDuel, adjusted);
      views.value = next;
      const pins = Object.fromEntries(Object.entries(next.players).filter(([id, view]) => !samePin(previous.players[id]?.pin, view.pin)).map(([id, view]) => [id, view.pin]));
      if (Object.keys(pins).length) timeline.value = JSON.parse(JSON.stringify(applyPinCues(timeline.value, pins, deps.now(), settings.value.timing))) as Timeline;
    }
    connection.value = { ...connection.value, lastUpdateMs: at,
      gameId: rawDuel?.gameId ?? connection.value.gameId, warnings: [...accepted.warnings, ...ruleWarnings] };
  }
  function startReplay(name: unknown, restore = false): void {
    // Validate and read before canceling an active replay.
    let rows = loadReplay(name);
    const saved = restore && ruleContexts.value.replayFixture === name ? ruleContexts.value.replay : null;
    const position = saved ? rows.reduce((found, row, index) => {
      const state = (row.message as { duel?: { state?: { gameId?: string; version?: number } } }).duel?.state;
      return state?.gameId === saved.source.gameId && state?.version === saved.source.version ? index : found;
    }, -1) : -1;
    const resuming = position >= 0;
    if (resuming) rows = rows.slice(position);
    source?.stop(); reset(); fixture = name; input = 'replay';
    ruleContexts.value = { ...ruleContexts.value, replay: resuming ? saved : null, replayFixture: String(name) };
    connection.value = { ...connection.value, state: 'live', input, error: null, replayFixture: String(name), serverOffsetMs: 0,
      partyId: null, gameId: null, lastUpdateMs: null, warnings: [] };
    let bootstrap = resuming;
    source = createReplay(rows, (message, at) => { ingest(message, at, bootstrap); bootstrap = false; }, deps);
    source.start();
  }
  function reconnect(body: unknown, restoreReplay = false): void {
    const value = body === undefined ? {} : record(body);
    if (Object.keys(value).some(key => !['input', 'fixture', 'partyId'].includes(key))) throw new Error('Invalid reconnect');
    const nextInput = 'input' in value ? value.input : input;
    if (nextInput !== 'live' && nextInput !== 'replay') throw new Error('Invalid input mode');
    if (nextInput === 'replay') {
      if ('partyId' in value) throw new Error('Party selection is disabled in replay mode');
      startReplay(value.fixture ?? fixture, restoreReplay); return;
    }
    if ('fixture' in value) throw new Error('Replay is disabled in live mode');
    const nextPartyId = 'partyId' in value ? parsePartySelection(value.partyId) : selectedPartyId;
    source?.stop(); reset();
    input = 'live'; selectedPartyId = nextPartyId;
    connection.value = { ...connection.value, input, selectedPartyId, replayFixture: null,
      state: 'disconnected', partyId: null, gameId: null, lastUpdateMs: null, error: null, serverOffsetMs: 0, warnings: [] };
    try {
      const credentials = loadConnectionConfig({
        ...config,
        partyId: selectedPartyId,
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
  function current() { return { settings: settings.value, series: series.value, connection: connection.value, timeline: timeline.value, clients: clients.value, media: media.value }; }
  function control(action: PresenterAction, body: unknown): unknown {
    if (action === 'series') {
      if (nodecg.Replicant(REPLICANTS.matchState, {defaultValue: null}).value) throw new Error('Edit the series in Current Match');
      series.value = parseSeries(body);
    }
    else if (action === 'settings') { settings.value = parseSettings(body); publishClients(copyClients()); tick(); }
    else if (action === 'media') { media.value = parseMedia(body); tick(); }
    else if (action === 'reconnect') reconnect(body);
    else if (action === 'program/transfer') {
      const value = record(body); const now = deps.now(); const next = copyClients();
      const target = next.clients.find(client => client.clientId === value.clientId && client.role === 'program' && client.lastSeenMs + 6000 > now);
      if (Object.keys(value).length !== 1 || !target) throw new Error('Invalid program target');
      next.program = { clientId: target.clientId, expiresAtMs: target.lastSeenMs + 6000 };
      publishClients(next);
    }
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
    reconnect(undefined, true);
  } catch { connection.value = { ...connection.value, state: 'disconnected', error: 'Invalid presenter input or replay fixture' }; }
}
