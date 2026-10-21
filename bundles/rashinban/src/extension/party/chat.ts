import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import { CHAT_TEXT_LIMIT, EMPTY_PARTY_CHAT, type PartyChat, type PartyChatMessage } from '../../party/chat.ts';
import { PARTY_EMOTES } from '../../party/emotes.ts';
import type { ConnectionConfig, SocketPort } from '../presenter/connection.ts';

// The source contains a credential and must never be assigned to a Replicant.
export type PartyChatSource = {
  partyId: string; accessToken: string | null; level: string;
  members: { userId: string; nick: string }[];
  accountId: string; sender: string; sendDisabledReason: string | null; allowedEmotes: string[];
};
type ChatDeps = {
  now?(): number;
  openSocket(url: string, cookie: string): SocketPort;
  schedule(callback: () => void, delayMs: number): () => void;
};
const defaults: ChatDeps = {
  openSocket(url, cookie) {
    const socket = new WebSocket(url, { headers: { Cookie: `_ncfa=${cookie}`, Origin: 'https://www.geoguessr.com' }, maxPayload: 256 * 1024 });
    let onClose = (_code: number) => {}, finished = false;
    function finish(code: number) { if (!finished) { finished = true; onClose(code); } }
    socket.on('error', () => { socket.terminate(); finish(1006); });
    socket.on('close', finish);
    return { send: text => socket.send(text), close: () => socket.terminate(),
      onOpen: cb => { socket.on('open', cb); }, onMessage: cb => { socket.on('message', data => cb(String(data))); },
      onClose: cb => { onClose = cb; } };
  },
  schedule(callback, delayMs) { const timer = setTimeout(callback, delayMs); timer.unref(); return () => clearTimeout(timer); },
};
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function decodeMessage(value: unknown, source: PartyChatSource): PartyChatMessage | null {
  const m = object(value);
  if (!m || m.roomId !== source.partyId || !['Party', 'InGame'].includes(String(m.context))
    || m.sourceType !== 'User' || typeof m.id !== 'string' || !m.id || m.id.length > 200
    || typeof m.sourceId !== 'string' || !m.sourceId || m.sourceId.length > 200
    || (m.payloadType !== 'Text' && m.payloadType !== 'Emote')
    || typeof m.textPayload !== 'string' || !m.textPayload || m.textPayload.length > 10000
    || typeof m.sentAt !== 'string') return null;
  const sentAtMs = Date.parse(m.sentAt);
  if (!Number.isFinite(sentAtMs)) return null;
  return { id: m.id, userId: m.sourceId, name: source.members.find(member => member.userId === m.sourceId)?.nick || m.sourceId,
    kind: m.payloadType, text: m.textPayload, sentAtMs, channel: typeof m.channel === 'string' ? m.channel.slice(0, 100) : null };
}

export function createPartyChat(config: ConnectionConfig, publish: (value: PartyChat) => void, deps: ChatDeps = defaults) {
  let source: PartyChatSource | null = null, state = structuredClone(EMPTY_PARTY_CHAT);
  let socket: SocketPort | null = null, attempt = 0;
  let cancelHeartbeat: (() => void) | undefined, cancelTimeout: (() => void) | undefined, cancelRetry: (() => void) | undefined;
  const tabId = randomUUID();
  const now = deps.now ?? Date.now;
  let pending: { userId: string; kind: string; text: string; resolve(): void; reject(error: Error): void; cancel(): void } | null = null;
  const sent = new Map<string, { signature: string; work: Promise<void> }>();
  const emit = () => {
    const ready = state.state === 'live' && source && !source.sendDisabledReason;
    state.sender = source?.sender ?? null;
    state.canSendText = !!ready && ['TextMessages', 'TeamTextMessages'].includes(source!.level);
    state.availableEmotes = ready ? [...source!.allowedEmotes] : [];
    state.sendDisabledReason = source?.sendDisabledReason ?? (state.state !== 'live' ? 'Connect to live party chat to send.' : null);
    state.sending = pending !== null;
    publish(structuredClone(state));
  };
  function finishSend(error?: string) {
    const previous = pending; pending = null;
    if (!previous) return;
    previous.cancel();
    if (error) previous.reject(new Error(error)); else previous.resolve();
    emit();
  }
  function disconnect() {
    finishSend('Delivery was not confirmed. Check the chat feed before resending.');
    state.sessionId = null;
    cancelHeartbeat?.(); cancelTimeout?.(); cancelRetry?.();
    cancelHeartbeat = cancelTimeout = cancelRetry = undefined;
    const previous = socket; socket = null; previous?.close();
  }
  function reset(detail = EMPTY_PARTY_CHAT.detail) {
    disconnect(); source = null; attempt = 0;
    state = { ...structuredClone(EMPTY_PARTY_CHAT), detail }; emit();
  }
  function retry() {
    disconnect();
    state.state = 'reconnecting'; state.detail = 'Chat disconnected. Reconnecting… Messages sent while disconnected may be missed.'; emit();
    cancelRetry = deps.schedule(connect, Math.min(30000, 1000 * 2 ** Math.min(5, Math.max(0, attempt - 1))));
  }
  function unavailable(detail: string) {
    disconnect(); state.state = 'unavailable'; state.detail = detail; emit();
  }
  function connect() {
    cancelRetry = undefined;
    if (!source) return;
    const target = source, topic = `chat:Party:${target.level}:${target.partyId}`;
    attempt++;
    const query = new URLSearchParams({ c: `web-${config.clientVersion}`, tabId, attempt: String(attempt), visibility: 'visible' });
    let opened: SocketPort;
    try { opened = deps.openSocket(`wss://api.geoguessr.com/ws?${query}`, config.cookie); }
    catch { retry(); return; }
    socket = opened;
    const current = () => socket === opened;
    function send(message: unknown) {
      if (!current()) return;
      try { opened.send(JSON.stringify(message)); } catch { retry(); }
    }
    function heartbeat() {
      send({ code: 'HeartBeat', client: 'web' });
      if (current()) cancelHeartbeat = deps.schedule(heartbeat, 15000);
    }
    cancelTimeout = deps.schedule(() => { if (current()) retry(); }, 10000);
    opened.onOpen(() => {
      send({ code: 'Subscribe', topic, accessToken: target.accessToken, client: 'web' });
    });
    opened.onMessage(text => {
      if (!current() || !source || text.length > 256 * 1024) return;
      let envelope: Record<string, unknown> | null;
      try { envelope = object(JSON.parse(text)); } catch { return; }
      if (!envelope || envelope.topic !== topic) return;
      if (envelope.code === 'Subscribed') {
        cancelTimeout?.(); cancelHeartbeat?.(); attempt = 0;
        state.sessionId ??= randomUUID();
        state.state = 'live'; state.detail = 'Live messages from this connection · latest 200 retained.'; emit();
        cancelHeartbeat = deps.schedule(heartbeat, 15000);
      } else if (envelope.code === 'SubscribeDenied') {
        unavailable('GeoGuessr denied access to party chat. Check the party’s chat settings and account access.');
      } else if (envelope.code === 'ChatDisconnect') {
        retry();
      } else if (envelope.code === 'ChatMessage' && state.state === 'live') {
        let payload: unknown;
        try { payload = typeof envelope.payload === 'string' ? JSON.parse(envelope.payload) : envelope.payload; } catch { return; }
        const message = decodeMessage(payload, source);
        if (!message || state.messages.some(m => m.id === message.id)) return;
        state.messages = [...state.messages, message].sort((a, b) => a.sentAtMs - b.sentAtMs).slice(-200); emit();
        if (pending && message.userId === pending.userId && message.kind === pending.kind && message.text === pending.text) finishSend();
      }
    });
    opened.onClose(() => { if (current()) retry(); });
  }
  function setSource(next: PartyChatSource | null) {
    if (!next) { reset(); return; }
    const sameParty = source?.partyId === next.partyId;
    const sameSubscription = sameParty && source?.accessToken === next.accessToken && source?.level === next.level;
    source = next;
    if (sameSubscription) {
      const messages = state.messages.map(m => ({ ...m, name: next.members.find(member => member.userId === m.userId)?.nick || m.name }));
      state.messages = messages; emit();
      return;
    }
    disconnect(); attempt = 0;
    state = { ...structuredClone(EMPTY_PARTY_CHAT), partyId: next.partyId, state: 'connecting', detail: 'Connecting to party chat…',
      cooldownUntilMs: state.cooldownUntilMs, messages: sameParty ? state.messages : [] };
    if (next.level === 'None') { unavailable('Chat is turned off for this party.'); return; }
    if (!['EmotesOnly', 'TextMessages', 'TeamTextMessages'].includes(next.level) || !next.accessToken) {
      unavailable('Party chat access is unavailable. Refresh the party connection.'); return;
    }
    emit(); connect();
  }
  async function sendMessage(raw: unknown): Promise<void> {
    const request = object(raw);
    if (!request || Object.keys(request).some(key => !['id', 'partyId', 'sessionId', 'kind', 'text'].includes(key))
      || typeof request.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(request.id)
      || (request.kind !== 'Text' && request.kind !== 'Emote') || typeof request.text !== 'string') throw new Error('Invalid chat message.');
    if (!source || !socket || state.state !== 'live' || !state.sessionId) throw new Error('Chat is not connected.');
    if (request.partyId !== source.partyId || request.sessionId !== state.sessionId) throw new Error('Party chat connection changed. Review the current party before sending.');
    if (source.sendDisabledReason) throw new Error(source.sendDisabledReason);
    const text = request.text.trim();
    if (!text || text.length > CHAT_TEXT_LIMIT) throw new Error(`Enter 1–${CHAT_TEXT_LIMIT} characters.`);
    if (request.kind === 'Text' && !state.canSendText) throw new Error('This party allows emotes only, not text messages.');
    if (request.kind === 'Emote' && !source.allowedEmotes.includes(text)
      || PARTY_EMOTES.some(emote => text.includes(emote.tag) && !source!.allowedEmotes.includes(emote.tag))) throw new Error('This emote is not available for the configured account.');
    const signature = JSON.stringify([request.partyId, request.sessionId, request.kind, text]);
    const previous = sent.get(request.id);
    if (previous) { if (previous.signature !== signature) throw new Error('Chat request ID was already used.'); return previous.work; }
    if (pending) throw new Error('Wait for the current message to be confirmed.');
    if (now() < state.cooldownUntilMs) throw new Error('Please wait a moment before sending another message.');
    const work = new Promise<void>((resolve, reject) => {
      pending = { userId: source!.accountId, kind: request.kind as string, text, resolve, reject,
        cancel: deps.schedule(() => finishSend('Delivery was not confirmed. Check the chat feed before resending.'), 8000) };
    });
    sent.set(request.id, { signature, work });
    if (sent.size > 200) sent.delete(sent.keys().next().value!);
    state.cooldownUntilMs = now() + 1000; emit();
    try { socket.send(JSON.stringify({ code: request.kind === 'Text' ? 'ChatMessage' : 'ChatEmote',
      topic: `chat:Party:${source.level}:${source.partyId}`, payload: text, accessToken: source.accessToken, client: 'web' })); }
    catch { retry(); }
    return work;
  }
  return { setSource, reset, sendMessage };
}
