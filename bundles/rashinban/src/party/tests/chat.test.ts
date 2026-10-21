import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createPartyChat, type PartyChatSource } from '../../extension/party/chat.ts';
import type { SocketPort } from '../../extension/presenter/connection.ts';
import type { PartyChat } from '../chat.ts';

const sample = JSON.parse(readFileSync(new URL('../../../../../docs/geoguessr/samples/site-ws-chat.json', import.meta.url), 'utf8'));
const partyId = '715272a1-2304-4c7f-9948-ad1da55fae57';
const source: PartyChatSource = { partyId, accessToken: 'PRIVATE-TOKEN', level: 'TextMessages',
  accountId: '65701c932c6e4a0a9881791e', sender: 'Player Blue', sendDisabledReason: null, allowedEmotes: [':gg:', ':wave:'],
  members: [{ userId: '65701c932c6e4a0a9881791e', nick: 'Player Blue' }] };
function harness() {
  let state!: PartyChat;
  let now = 100000;
  const timers: { callback(): void; delay: number; active: boolean }[] = [];
  const sockets: ReturnType<typeof socket>[] = [];
  function socket() {
    let open = () => {}, message = (_text: string) => {}, close = (_code: number) => {};
    const sent: any[] = [];
    let closed = false;
    const port: SocketPort = { send: text => { sent.push(JSON.parse(text)); }, close: () => { closed = true; },
      onOpen: cb => { open = cb; }, onMessage: cb => { message = cb; }, onClose: cb => { close = cb; } };
    return { port, sent, get closed() { return closed; }, open: () => open(),
      receive: (data: unknown) => message(typeof data === 'string' ? data : JSON.stringify(data)), close: () => close(1006) };
  }
  const chat = createPartyChat({ cookie: 'PRIVATE-COOKIE', clientVersion: 'fixture', partyId: null }, value => { state = value; }, {
    now: () => now,
    openSocket(url, cookie) {
      assert.equal(new URL(url).origin, 'wss://api.geoguessr.com');
      assert.equal(cookie, 'PRIVATE-COOKIE');
      const s = socket(); sockets.push(s); return s.port;
    },
    schedule(callback, delay) { const t = { callback, delay, active: true }; timers.push(t); return () => { t.active = false; }; },
  });
  return { chat, sockets, get state() { return state; },
    advance: (ms: number) => { now += ms; },
    request: (kind = 'Text', text = 'test chat', id = 'send-1') => ({ id, partyId, sessionId: state.sessionId, kind, text }),
    fire(delay: number) { const t = timers.find(t => t.active && t.delay === delay); assert.ok(t, `timer ${delay}`); t.active = false; t.callback(); },
    get timers() { return timers.filter(t => t.active); },
    connect() { chat.setSource(source); sockets.at(-1)!.open(); sockets.at(-1)!.receive(sample.subscribed); return sockets.at(-1)!; } };
}

test('party chat reads captured text and in-game emotes without publishing credentials', () => {
  const h = harness(), s = h.connect();
  assert.deepEqual(s.sent, [{ code: 'Subscribe', topic: sample.subscribed.topic, accessToken: 'PRIVATE-TOKEN', client: 'web' }]);
  assert.equal(h.state.state, 'live');
  s.receive(sample.chatText); s.receive(sample.chatEmote); s.receive(sample.chatText);
  assert.deepEqual(h.state.messages.map(m => [m.name, m.kind, m.text]), [['Player Blue', 'Text', 'test chat'], ['Player Blue', 'Emote', ':wave:']]);
  assert.equal(h.state.messages[0].sentAtMs, Date.parse('2026-09-10T14:29:55.017Z'));
  assert.equal(JSON.stringify(h.state).includes('PRIVATE'), false);
  h.fire(15000); assert.deepEqual(s.sent.at(-1), { code: 'HeartBeat', client: 'web' });
  assert.equal(s.sent.some(m => m.code === 'ChatMessage' || m.code === 'ChatEmote'), false);
});

test('chat sends the native envelope once and confirms only the account echo', async () => {
  const h = harness(), s = h.connect();
  const request = h.request(); const work = h.chat.sendMessage(request);
  const duplicate = h.chat.sendMessage(request);
  assert.deepEqual(s.sent.at(-1), { code: 'ChatMessage', topic: sample.subscribed.topic, payload: 'test chat', accessToken: 'PRIVATE-TOKEN', client: 'web' });
  assert.equal(s.sent.filter(m => m.code === 'ChatMessage').length, 1);
  assert.equal(h.state.sending, true); assert.equal(h.state.messages.length, 0);
  s.receive({ ...sample.chatText, payload: JSON.stringify({ ...JSON.parse(sample.chatText.payload), id: 'other', sourceId: 'another-user' }) });
  assert.equal(h.state.sending, true);
  s.receive(sample.chatText); await Promise.all([work, duplicate]);
  assert.equal(h.state.sending, false);
  assert.equal(JSON.stringify(h.state).includes('PRIVATE'), false);
});

test('native emotes can be sent in emotes-only chat while text is blocked', async () => {
  const h = harness(); h.chat.setSource({ ...source, level: 'EmotesOnly' });
  const s = h.sockets[0], topic = `chat:Party:EmotesOnly:${partyId}`; s.open(); s.receive({ code: 'Subscribed', topic, level: 'EmotesOnly' });
  assert.equal(h.state.canSendText, false);
  await assert.rejects(h.chat.sendMessage(h.request()), /text|emotes only/i);
  const work = h.chat.sendMessage(h.request('Emote', ':wave:'));
  assert.deepEqual(s.sent.at(-1), { code: 'ChatEmote', topic, payload: ':wave:', accessToken: 'PRIVATE-TOKEN', client: 'web' });
  s.receive({ ...sample.chatEmote, topic }); await work;
});

test('chat rejects malformed, stale, muted and unowned emote sends without writing', async () => {
  const h = harness(), s = h.connect();
  for (const request of [h.request('Text', ' '), h.request('Text', 'x'.repeat(101)), h.request('Emote', ':cool:'),
    h.request('Text', ':cool:'), { ...h.request(), partyId: 'other' }, { ...h.request(), sessionId: 'stale' },
    { ...h.request(), extra: true }]) await assert.rejects(h.chat.sendMessage(request));
  h.chat.setSource({ ...source, sendDisabledReason: 'Account muted in this party.' });
  await assert.rejects(h.chat.sendMessage(h.request()), /muted/i);
  h.chat.reset(); await assert.rejects(h.chat.sendMessage(h.request()), /connected|connection/i);
  assert.equal(s.sent.filter(m => m.code === 'ChatMessage' || m.code === 'ChatEmote').length, 0);
});

test('unconfirmed sends are not retried after timeout or disconnect', async () => {
  const h = harness(), s = h.connect(); const request = h.request();
  const work = h.chat.sendMessage(request); const failed = assert.rejects(work, /not confirmed|unconfirmed/i);
  h.fire(8000); await failed;
  await assert.rejects(h.chat.sendMessage(request));
  assert.equal(s.sent.filter(m => m.code === 'ChatMessage').length, 1);
  h.advance(3000);
  const next = h.chat.sendMessage(h.request('Text', 'next', 'send-2'));
  const disconnected = assert.rejects(next, /not confirmed|unconfirmed/i); s.close(); await disconnected;
  h.fire(1000); const replacement = h.sockets.at(-1)!; replacement.open(); replacement.receive(sample.subscribed);
  assert.equal(replacement.sent.filter(m => m.code === 'ChatMessage').length, 0);
});

test('sending has a shared cooldown and does not reuse an old connection session', async () => {
  const h = harness(), s = h.connect(), stale = h.request('Text', 'later', 'old-session');
  const work = h.chat.sendMessage(h.request()); s.receive(sample.chatText); await work;
  await assert.rejects(h.chat.sendMessage(h.request('Text', 'next', 'send-2')), /wait/i);
  s.close(); h.fire(1000); const next = h.sockets.at(-1)!; next.open(); next.receive(sample.subscribed);
  h.advance(3000); await assert.rejects(h.chat.sendMessage(stale), /changed|connection/i);
});

test('chat ignores malformed payloads, other topics and other rooms', () => {
  const h = harness(), s = h.connect();
  for (const value of ['bad json', null, [], { ...sample.chatText, payload: 'oops' },
    { ...sample.chatText, topic: 'chat:Party:TextMessages:other' },
    ...[{ roomId: 'other' }, { payloadType: 'Invite' }, { textPayload: 42 }, { sentAt: 'bad' }].map(patch =>
      ({ ...sample.chatText, payload: JSON.stringify({ ...JSON.parse(sample.chatText.payload), ...patch }) }))]) s.receive(value);
  assert.deepEqual(h.state.messages, []);
});

test('reconnect preserves history, deduplicates redelivery and updates sender names', () => {
  const h = harness(), s = h.connect(); s.receive(sample.chatText); s.close();
  assert.equal(h.state.state, 'reconnecting'); h.fire(1000);
  const next = h.sockets.at(-1)!; next.open(); next.receive(sample.subscribed); next.receive(sample.chatText);
  h.chat.setSource({ ...source, members: [{ ...source.members[0], nick: 'Updated name' }] });
  assert.equal(h.state.messages.length, 1); assert.equal(h.state.messages[0].name, 'Updated name');
  assert.equal(h.sockets.length, 2);
});

test('switching party or replay clears messages and ignores callbacks from the old socket', () => {
  const h = harness(), s = h.connect(); s.receive(sample.chatText);
  h.chat.setSource({ ...source, partyId: 'other' });
  assert.equal(s.closed, true); assert.deepEqual(h.state.messages, []);
  s.receive(sample.chatText); s.close(); assert.deepEqual(h.state.messages, []);
  h.chat.reset('Party chat is unavailable in replay mode.');
  assert.equal(h.state.partyId, null); assert.equal(h.state.state, 'idle');
  assert.deepEqual(h.timers, []); assert.ok(h.sockets.every(s => s.closed));
});

test('denied or disabled chat is explicit and waits for a changed source', () => {
  const h = harness(); h.chat.setSource({ ...source, level: 'None' });
  assert.equal(h.sockets.length, 0); assert.equal(h.state.state, 'unavailable');
  h.chat.setSource({ ...source, accessToken: null }); assert.equal(h.sockets.length, 0);
  const s = h.connect(); s.receive({ code: 'SubscribeDenied', topic: sample.subscribed.topic });
  assert.equal(h.state.state, 'unavailable'); assert.equal(s.closed, true);
  h.chat.setSource(source); assert.equal(h.sockets.length, 1); assert.deepEqual(h.timers, []);
  h.chat.setSource({ ...source, accessToken: 'NEW-TOKEN' }); assert.equal(h.sockets.length, 2);
});

test('connection timeout retries and history stays bounded in chronological order', () => {
  const h = harness(); h.chat.setSource(source); h.fire(10000);
  assert.equal(h.state.state, 'reconnecting'); assert.equal(h.sockets[0].closed, true); h.fire(1000);
  const s = h.sockets.at(-1)!; s.open(); s.receive(sample.subscribed);
  for (let i = 0; i < 230; i++) s.receive({ ...sample.chatText, payload: JSON.stringify({ ...JSON.parse(sample.chatText.payload),
    id: `message-${i}`, textPayload: `message ${i}`, sentAt: new Date(100000 + i * 1000).toISOString() }) });
  assert.equal(h.state.messages.length, 200); assert.equal(h.state.messages[0].text, 'message 30');
  assert.equal(h.state.messages.at(-1)!.text, 'message 229');
});
