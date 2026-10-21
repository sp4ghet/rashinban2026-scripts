import type NodeCG from '@nodecg/types';
import type { ConfigStore } from '../../config/types.ts';
import { REPLICANTS, type PresenterConnection } from '../../types/replicants.ts';
import { EMPTY_PARTY_STATUS, PARTY_MESSAGES, type PartyStatus } from '../../party/types.ts';
import { loadConnectionConfig } from '../presenter/secrets.ts';
import { createPartyManager } from './manager.ts';
import { createPartyChat } from './chat.ts';
import { CHAT_SEND_MESSAGE, EMPTY_PARTY_CHAT, type PartyChat } from '../../party/chat.ts';

export function registerParty(nodecg: NodeCG.ServerAPI, store: ConfigStore): void {
  const connection = nodecg.Replicant<PresenterConnection>(REPLICANTS.presenterConnection);
  const status = nodecg.Replicant<PartyStatus>(REPLICANTS.partyStatus, { persistent: false, defaultValue: structuredClone(EMPTY_PARTY_STATUS) });
  const chatStatus = nodecg.Replicant<PartyChat>(REPLICANTS.partyChat, { persistent: false, defaultValue: structuredClone(EMPTY_PARTY_CHAT) });
  let chat: ReturnType<typeof createPartyChat> | null = null;
  let manager: ReturnType<typeof createPartyManager> | null = null;
  let ticking = false;
  const selection = () => ({ input: connection.value?.input ?? store.get().presenter.input,
    partyId: connection.value ? connection.value.selectedPartyId ?? null : store.get().presenter.partyId,
    generation: connection.value?.controlGeneration ?? 'initial' });
  function getManager() {
    if (manager) return manager;
    const config = store.get().presenter;
    const credentials = loadConnectionConfig({ partyId: null, clientVersion: config.clientVersion });
    chat = createPartyChat(credentials, value => { chatStatus.value = value; });
    manager = createPartyManager(credentials, {
      fetch: globalThis.fetch, now: Date.now, selection, publish(value) { status.value = value; },
      chatSource: source => { chat!.setSource(source); },
      chatSend: request => chat!.sendMessage(request),
      presentation: { get: () => ({ settings: store.get().presenter.settings, revision: store.status().revision }),
        save: (settings, revision) => store.save('presenterSettings', settings, revision) },
    });
    return manager;
  }
  async function refresh() {
    if (ticking) return;
    ticking = true;
    try {
      if (!manager && selection().input === 'replay') {
        status.value = { ...structuredClone(EMPTY_PARTY_STATUS), state: 'replay', disabledReason: 'Replay mode — remote controls disabled' };
      } else await getManager().refresh();
    } catch {
      chat?.reset('Party chat is unavailable. Check the party connection.');
      status.value = { ...status.value, state: 'error', canManage: false, disabledReason: 'GeoGuessr credentials unavailable.',
        error: 'Check GEOGUESSR_NCFA in the shared installation .env and restart NodeCG.' };
    } finally { ticking = false; }
  }
  nodecg.listenFor(PARTY_MESSAGES.refresh, (_request, ack) => {
    void refresh().then(() => { if (ack && !ack.handled) ack(null); });
  });
  nodecg.listenFor(CHAT_SEND_MESSAGE, (request: unknown, ack) => {
    void (async () => {
      if (selection().input === 'replay') throw new Error('Replay mode — chat sending disabled.');
      await getManager().sendChat(request);
    })().then(() => { if (ack && !ack.handled) ack(null); }, error => {
      if (ack && !ack.handled) ack(error instanceof Error ? error : new Error('Chat message failed'));
    });
  });
  nodecg.listenFor(PARTY_MESSAGES.command, (request: unknown, ack) => {
    void (async () => {
      if (selection().input === 'replay') throw new Error('Replay mode — remote controls disabled.');
      await getManager().command(request);
    })().then(() => { if (ack && !ack.handled) ack(null); }, error => {
      if (ack && !ack.handled) ack(error instanceof Error ? error : new Error('Party command failed'));
    });
  });
  nodecg.listenFor(PARTY_MESSAGES.acknowledge, (id: unknown, ack) => {
    void (async () => { await getManager().acknowledge(id); })().then(() => { if (ack && !ack.handled) ack(null); }, error => {
      if (ack && !ack.handled) ack(error instanceof Error ? error : new Error('Unable to acknowledge command'));
    });
  });
  connection.on('change', (value, old) => {
    if (value?.input !== old?.input || value?.selectedPartyId !== old?.selectedPartyId || value?.controlGeneration !== old?.controlGeneration) {
      chat?.reset();
      status.value = { ...status.value, canManage: false, state: 'loading', disabledReason: 'Refreshing selected party…' };
      void refresh();
    }
  });
  const timer = setInterval(() => { void refresh(); }, 2500);
  timer.unref();
  void refresh();
}
