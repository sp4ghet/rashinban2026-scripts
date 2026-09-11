import { REPLICANTS, type RendererStatus, type PresenterClients } from '../types/replicants.ts';
import type { DuelState, SeriesState, Timeline, Views } from '../types/presenter.ts';
import { DEFAULT_SETTINGS, type PresenterSettings } from '../presenter/settings.ts';
import { projectScene, paintScene, type PresenterScene } from './presenter/scene.ts';
import { layoutKind, multiplierLabel, distanceLabel, lockLayout } from './presenter/layout.ts';
import { paintScoring } from './presenter/scoring.ts';
import { createCelebrationUnderlay } from './presenter/celebration.ts';
import { createGoogleRenderer } from './presenter/google.ts';
import { resultMapFrame, type GameRenderer, type RenderFrame } from './presenter/renderer.ts';
import { clientRole, createPresenterClient } from './presenter/client.ts';
import { celebrationAsset, EMPTY_MEDIA, parseMedia, type AssetInventory, type MediaManifest } from '../presenter/media.ts';
import { createVideoPlayer } from './presenter/video.ts';
import { createAudioOutput } from './presenter/audio-output.ts';

const duel = nodecg.Replicant<DuelState | null>(REPLICANTS.presenterDuel);
const series = nodecg.Replicant<SeriesState>(REPLICANTS.presenterSeries);
const settings = nodecg.Replicant<PresenterSettings>(REPLICANTS.presenterSettings);
const timeline = nodecg.Replicant<Timeline>(REPLICANTS.presenterTimeline);
const views = nodecg.Replicant<Views | null>(REPLICANTS.presenterViews);
const clients = nodecg.Replicant<PresenterClients>(REPLICANTS.presenterClients);
const media = nodecg.Replicant<MediaManifest>(REPLICANTS.presenterMedia);
const videoAssets = nodecg.Replicant<AssetInventory>('assets:video');
let selectedMedia = EMPTY_MEDIA;
const videoPlayer = createVideoPlayer(() => {
  const video = document.createElement('video'); video.className = 'celebration-video'; document.body.append(video); return video;
}, (fn, ms) => { const id = setTimeout(fn, ms); return () => clearTimeout(id); });
media.on('change', value => {
  try { selectedMedia = parseMedia(value); } catch { selectedMedia = EMPTY_MEDIA; }
  videoPlayer.preload(selectedMedia);
  void audioOutput.load(selectedMedia);
});
const role = clientRole(location.search);
const clientId = crypto.randomUUID();
const client = createPresenterClient({ clientId, role, wallNow: () => Date.now(), monotonicNow: () => performance.now(),
  send: (name, body) => nodecg.sendMessage(name, body), schedule(fn, ms) { const id = setTimeout(fn, ms); return () => clearTimeout(id); } });
const audioOutput = createAudioOutput(client);
document.body.dataset.clientId = clientId; document.body.dataset.role = role;
function reconcileVideo() {
  const options = settings.value ?? DEFAULT_SETTINGS;
  videoPlayer.update(timeline.value?.generation ?? null, client.ownsProgram(), timeline.value?.effect ?? 'none', options.muted, options.effectsGain);
  audioOutput.sync(timeline.value, options);
}
clients.on('change', value => { if (value) client.updateClients(value); reconcileVideo(); });
timeline.on('change', value => { if (value) client.updateTimeline(value); reconcileVideo(); });
settings.on('change', reconcileVideo);
// Replicant events stop stale playback even when RAF is suspended. The timer
// also enforces local lease/clock expiry if the network drops while hidden.
const mediaGuard = setInterval(reconcileVideo, 250);
void client.start();
const element = (id: string) => document.getElementById(id)!;
const write = (id: string, value: string) => { const el = element(id); if (el.textContent !== value) el.textContent = value; };
let renderer: GameRenderer | null = null;
let previousFrame: RenderFrame | null = null;
const celebrationUnderlay = createCelebrationUnderlay();
let previousScene: PresenterScene | null = null;
function publishRenderer(status: RendererStatus) {
  document.body.dataset.renderer = status;
  client.setRendererStatus(status); client.setReady(status === 'api-ready');
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
void createGoogleRenderer(document.body, typeof apiKey === 'string' ? apiKey : '', rendererError, () => publishRenderer('api-ready'))
  .then(value => { renderer = value; publishRenderer('api-ready'); }).catch(() => {});
window.addEventListener('pagehide', () => { clearInterval(mediaGuard); videoPlayer.dispose(); audioOutput.dispose(); client.dispose(); renderer?.dispose(); });

function frame() {
  document.body.dataset.program = String(client.ownsProgram());
  const state = duel.value;
  const timing = timeline.value;
  const match = series.value;
  const options = settings.value ?? DEFAULT_SETTINGS;
  // Sole graphic cue consumer; sound scheduling belongs to the audio lease engine.
  for (const cue of client.pollCues()) if (cue.kind === 'five-k' && timing) {
    const complete = client.effectCompletion(timing);
    const asset = celebrationAsset(selectedMedia, timing.effect, videoAssets.value ?? []);
    if (asset) videoPlayer.play(asset, timing.generation, (_generation, failed) => { void complete(failed); }, options.muted, options.effectsGain);
    else void complete(true);
  }
  reconcileVideo();
  document.documentElement.style.setProperty('--key-color', options.keyColor);
  document.body.dataset.source = options.viewSource;
  document.body.dataset.layout = layoutKind(state?.mode ?? 'NMPZ', options.viewSource);
  document.body.dataset.celebrationUnderlay = 'false';
  if (!state || !views.value || !timing || !match) { celebrationUnderlay.reset(); previousScene = null; }
  if (timing && match) {
    const scene = projectScene(state ?? null, timing, client.now(), previousScene);
    previousScene = scene;
    const visible = scene.projection;
    paintScene(document.body, scene, match);
    const preparedResults = state?.gameId === timing.gameId && scene.kind === 'transition'
      ? resultMapFrame(state, timing.round, { left: match.left.playerId, right: match.right.playerId }) ?? undefined : undefined;
    const gameFrame = state && views.value ? celebrationUnderlay.render({ state, views: views.value,
      projection: visible, source: options.viewSource, displayedRound: timing.round,
      preparedResults,
      previewRound: scene.previewRound, prewarmRound: scene.prewarmRound,
      playerIds: { left: match.left.playerId, right: match.right.playerId } }, timing.effect !== 'none') : null;
    const underlay = gameFrame?.frozen === true;
    document.body.dataset.celebrationUnderlay = String(underlay);
    document.body.dataset.phase = visible.phase;
    const results = scene.kind === 'results';
    element('results-area').hidden = !results && !preparedResults;
    element('results-area').style.visibility = results ? 'visible' : 'hidden';
    element('results-area').style.opacity = results ? '1' : '0';
    element('live-area').hidden = scene.kind !== 'live' && !underlay;
    element('transition').hidden = scene.kind !== 'transition' || underlay || timing.effect !== 'none';
    write('round-number', scene.previewRound === null ? timing.round === null ? '—' : String(timing.round) : String(scene.previewRound));
    write('mode', state?.mode ?? '—');
    const multiplier = scene.kind === 'preview' ? state?.roundTimeMs ? `${state.roundTimeMs / 1000}s` : '—'
      : multiplierLabel(state ?? null, timing, { left: match.left.playerId, right: match.right.playerId });
    write('multiplier-label', scene.kind === 'preview' ? 'ROUND TIME' : 'DAMAGE');
    write('multiplier', multiplier.replace(' · ', '\n'));
    element('multiplier').classList.toggle('split', multiplier.startsWith('L '));
    for (const side of ['left', 'right'] as const) {
      const competitor = match[side];
      const player = visible.players.find(item => item.id === competitor.playerId);
      write(`${side}-name`, competitor.name);
      write(`${side}-handle`, competitor.handle);
      write(`${side}-wins`, String(competitor.wins));
      write(`${side}-health`, player ? String(player.health) : '—');
      const health = Math.max(0, Math.min(1, (player?.healthBar ?? player?.health ?? 0) / (state?.initialHealth || 6000)));
      element(`${side}-health-fill`).style.transform = `scaleX(${health})`;
      element(`${side}-health-fill`).style.background = health < 0.25 ? '#e04f66' : health < 0.5 ? '#dbae40' : '#8abb43';
      const lockPlayer = underlay ? gameFrame.projection.players.find(item => item.id === competitor.playerId) : player;
      element(`${side}-lock`).hidden = (visible.phase !== 'live' && !underlay) || !lockPlayer?.locked;
      write(`${side}-score`, player?.score == null ? '—' : String(player.score));
      const distance = player?.distanceM;
      write(`${side}-distance`, distanceLabel(distance, player?.score));
    }
    paintScoring(document.body, visible, match);
    element('timer').hidden = visible.remainingMs === null || scene.kind !== 'live';
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
    if (scene.kind === 'preview') write('phase-label', scene.paused ? 'GAME IS UNDER REVIEW' : visible.phase === 'pre-round' ? 'ROUND STARTING' : 'WAITING FOR GAME MASTER');
    if (scene.kind === 'summary') write('phase-label', 'GAME FINISHED');
    if (scene.kind === 'aborted') write('phase-label', 'GAME CANCELLED');
    if (gameFrame) {
      previousFrame = gameFrame;
      document.body.dataset.lock = lockLayout(previousFrame);
      renderer?.render(previousFrame);
    }
  }
  if (!timing || !match) {
    for (const id of ['preview-area', 'summary-area', 'results-area', 'live-area', 'transition', 'timer', 'scoring-layer', 'review-banner']) element(id).hidden = true;
    element('waiting-area').hidden = false;
  }
  if ((!state || !views.value || !timing || !match) && previousFrame) {
    document.body.dataset.lock = 'none';
    renderer?.render({ ...previousFrame, source: options.viewSource, projection: { phase: 'waiting-game', answer: null, players: [], remainingMs: null } });
    previousFrame = null;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
