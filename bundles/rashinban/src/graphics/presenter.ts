import { REPLICANTS, type RendererStatus } from '../types/replicants.ts';
import type { DuelState, SeriesState, Timeline, Views } from '../types/presenter.ts';
import { DEFAULT_SETTINGS, type PresenterSettings } from '../presenter/settings.ts';
import { project } from '../presenter/projection.ts';
import { layoutKind } from './presenter/layout.ts';
import { createGoogleRenderer } from './presenter/google.ts';
import type { GameRenderer, RenderFrame } from './presenter/renderer.ts';

const duel = nodecg.Replicant<DuelState | null>(REPLICANTS.presenterDuel);
const series = nodecg.Replicant<SeriesState>(REPLICANTS.presenterSeries);
const settings = nodecg.Replicant<PresenterSettings>(REPLICANTS.presenterSettings);
const timeline = nodecg.Replicant<Timeline>(REPLICANTS.presenterTimeline);
const views = nodecg.Replicant<Views | null>(REPLICANTS.presenterViews);
const element = (id: string) => document.getElementById(id)!;
const write = (id: string, value: string) => { const el = element(id); if (el.textContent !== value) el.textContent = value; };
let renderer: GameRenderer | null = null;
let previousFrame: RenderFrame | null = null;
let rendererStatus: RendererStatus = 'loading';
function publishRenderer(status: RendererStatus) {
  rendererStatus = status; document.body.dataset.renderer = status;
  void nodecg.sendMessage('presenter:renderer', status).catch(() => {});
}
function rendererError(message: string) {
  publishRenderer(message === 'Google Maps browser key missing' ? 'missing-key' : message === 'Exact Street View panorama unavailable' ? 'pano-error'
    : message === 'Google Maps view unavailable' ? 'view-error' : 'api-error');
  const placeholder = element('results-map').querySelector('span');
  if (placeholder) placeholder.textContent = 'Map unavailable';
}
const publicConfig = nodecg.bundleConfig as { presenter?: { googleMapsApiKey?: unknown } };
const apiKey = publicConfig.presenter?.googleMapsApiKey;
publishRenderer('loading');
void createGoogleRenderer(document.body, typeof apiKey === 'string' ? apiKey : '', rendererError)
  .then(value => { renderer = value; publishRenderer('api-ready'); }).catch(() => {});
setInterval(() => publishRenderer(rendererStatus), 10000);
window.addEventListener('pagehide', () => renderer?.dispose());
let offsetMs = 0;
async function syncClock() {
  const start = Date.now();
  try {
    const server: unknown = await nodecg.sendMessage('presenter:clock');
    if (typeof server === 'number') offsetMs = server - (start + Date.now()) / 2;
  } catch { /* The retained projection remains usable during a brief disconnect. */ }
}
void syncClock(); setInterval(() => void syncClock(), 10000);

function frame() {
  const state = duel.value;
  const timing = timeline.value;
  const match = series.value;
  const options = settings.value ?? DEFAULT_SETTINGS;
  document.documentElement.style.setProperty('--key-color', options.keyColor);
  document.body.dataset.source = options.viewSource;
  document.body.dataset.layout = layoutKind(state?.mode ?? 'NMPZ', options.viewSource);
  if (timing && match) {
    const visible = project(state ?? null, timing, Date.now() + offsetMs);
    document.body.dataset.phase = visible.phase;
    const results = visible.answer !== null;
    element('results-area').hidden = !results;
    element('live-area').hidden = results || visible.phase === 'results-transition';
    element('transition').hidden = visible.phase !== 'results-transition';
    write('round-number', timing.round === null ? '—' : String(timing.round));
    write('mode', state?.mode ?? '—');
    write('multiplier', `×${state?.rounds.find(round => round.number === timing.round)?.multiplier ?? 1}`);
    for (const side of ['left', 'right'] as const) {
      const competitor = match[side];
      const player = visible.players.find(item => item.id === competitor.playerId);
      write(`${side}-name`, competitor.name);
      write(`${side}-handle`, competitor.handle);
      write(`${side}-wins`, String(competitor.wins));
      write(`${side}-health`, player ? String(player.health) : '—');
      const health = Math.max(0, Math.min(1, (player?.health ?? 0) / (state?.initialHealth || 6000)));
      element(`${side}-health-fill`).style.transform = `scaleX(${health})`;
      element(`${side}-health-fill`).style.background = health < 0.25 ? '#e04f66' : health < 0.5 ? '#dbae40' : '#8abb43';
      element(`${side}-lock`).hidden = visible.phase !== 'live' || !player?.locked;
      write(`${side}-score`, player?.score == null ? '—' : String(player.score));
      const distance = player?.distanceM;
      write(`${side}-distance`, distance == null ? '—' : distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} km`);
    }
    element('timer').hidden = visible.remainingMs === null;
    element('timer').classList.toggle('urgent', timing.music === 'urgent');
    const seconds = Math.ceil((visible.remainingMs ?? 0) / 1000);
    write('timer', `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`);
    const labels = { 'waiting-game': 'WAITING FOR GAME', 'waiting-host': 'WAITING FOR NEXT ROUND', 'pre-round': 'ROUND STARTING', live: '', 'results-transition': 'ROUND COMPLETE', 'results-reveal': 'ROUND RESULTS', 'between-rounds': 'NEXT ROUND', finished: 'GAME FINISHED', aborted: 'GAME ABORTED' };
    let label = labels[visible.phase];
    if (visible.phase === 'finished' && state) {
      if (state.isDraw) label = 'DRAW';
      else {
        const winner = state.players.find(player => player.teamId === state.winnerTeamId);
        const competitor = [match.left, match.right].find(item => item.playerId === winner?.id);
        if (competitor) label = `${competitor.name} WINS`;
      }
    }
    write('phase-label', label);
    if (state && views.value) {
      previousFrame = { state, views: views.value, projection: visible, source: options.viewSource,
        playerIds: { left: match.left.playerId, right: match.right.playerId } };
      renderer?.render(previousFrame);
    }
  }
  if ((!state || !views.value || !timing || !match) && previousFrame) {
    renderer?.render({ ...previousFrame, source: options.viewSource, projection: { phase: 'waiting-game', answer: null, players: [], remainingMs: null } });
    previousFrame = null;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
