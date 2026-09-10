import { REPLICANTS, type PresenterClients } from '../types/replicants.ts';
import type { Timeline } from '../types/presenter.ts';
import { DEFAULT_SETTINGS, type PresenterSettings } from '../presenter/settings.ts';
import { EMPTY_MEDIA, parseMedia, type MediaManifest } from '../presenter/media.ts';
import { createPresenterClient } from './presenter/client.ts';
import { createAudioOutput } from './presenter/audio-output.ts';

const role = new URLSearchParams(location.search).get('role') === 'audio' ? 'audio' : 'preview';
const clientId = crypto.randomUUID();
const client = createPresenterClient({ clientId, role, wallNow: () => Date.now(), monotonicNow: () => performance.now(),
  send: (name, body) => nodecg.sendMessage(name, body), schedule(fn, ms) { const id = setTimeout(fn, ms); return () => clearTimeout(id); } });
document.body.dataset.clientId = clientId; document.body.dataset.role = role;
document.getElementById('audio-preview')!.hidden = role === 'audio';
const output = createAudioOutput(client);
const clients = nodecg.Replicant<PresenterClients>(REPLICANTS.presenterClients);
const timeline = nodecg.Replicant<Timeline>(REPLICANTS.presenterTimeline);
const settings = nodecg.Replicant<PresenterSettings>(REPLICANTS.presenterSettings);
const media = nodecg.Replicant<MediaManifest>(REPLICANTS.presenterMedia);
function sync() { output.sync(timeline.value, settings.value ?? DEFAULT_SETTINGS); }
clients.on('change', value => { if (value) client.updateClients(value); sync(); });
timeline.on('change', value => { if (value) client.updateTimeline(value); sync(); });
settings.on('change', sync);
media.on('change', value => { let parsed = EMPTY_MEDIA; try { parsed = parseMedia(value); } catch {} void output.load(parsed); });
const guard = setInterval(sync, 100);
void client.start();
window.addEventListener('pagehide', () => { clearInterval(guard); output.dispose(); client.dispose(); });
