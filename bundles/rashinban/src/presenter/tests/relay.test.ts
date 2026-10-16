import assert from 'node:assert/strict';
import test from 'node:test';
import { createRelayBroker } from '../../extension/presenter/video-relay.ts';

function setup() {
  let now = 0; let id = 0;
  const broker = createRelayBroker({ now: () => now, token: () => 'token-' + ++id });
  return { request: broker.request, advance(ms: number) { now += ms; } };
}
test('one publisher per relay; release and expiry invalidate the old session', () => {
  const b = setup();
  const owner = b.request({ action: 'join', room: 'main', role: 'publisher' });
  assert.equal(owner.ok, true);
  if (!owner.ok) return;
  assert.equal(b.request({ action: 'join', room: 'main', role: 'publisher' }).ok, false);
  b.advance(6000);
  const next = b.request({ action: 'join', room: 'main', role: 'publisher' });
  assert.equal(next.ok, true);
  assert.equal(b.request({ action: 'poll', session: owner.session }).ok, false);
  if (!next.ok) return;
  b.request({ action: 'leave', session: next.session });
  assert.equal(b.request({ action: 'join', room: 'main', role: 'publisher' }).ok, true);
});
test('publisher and viewers exchange bounded SDP only within their relay and roles', () => {
  const b = setup();
  const join = (room: string, role: 'publisher' | 'viewer') => {
    const value = b.request({ action: 'join', room, role });
    assert.equal(value.ok, true); if (!value.ok) throw Error(); return value;
  };
  const owner = join('main', 'publisher'); const a = join('main', 'viewer');
  const other = join('other', 'viewer'); const peer = join('main', 'viewer');
  const signal = { type: 'offer', connection: 'connection-1', sdp: 'v=0', mids: { left: '0', right: '1' } };
  assert.equal(b.request({ action: 'signal', session: owner.session, to: other.peer, signal }).ok, false);
  assert.equal(b.request({ action: 'signal', session: a.session, to: peer.peer, signal }).ok, false);
  assert.equal(b.request({ action: 'signal', session: a.session, to: owner.peer, signal }).ok, false);
  assert.equal(b.request({ action: 'signal', session: owner.session, to: a.peer, signal }).ok, true);
  const inbox = b.request({ action: 'poll', session: a.session }); assert.equal(inbox.ok, true);
  if (!inbox.ok) return;
  assert.deepEqual(inbox.messages, [{ from: owner.peer, signal }]);
  assert.equal(JSON.stringify(inbox).includes(owner.session), false, 'owner credentials never reach viewers');
  const again = b.request({ action: 'poll', session: a.session });
  if (!again.ok) throw Error(); assert.deepEqual(again.messages, []);
  assert.equal(b.request({ action: 'signal', session: owner.session, to: a.peer, signal: { ...signal, sdp: 'x'.repeat(65537) } }).ok, false);
});
test('departed publisher messages cannot leak into its replacement session', () => {
  const b = setup();
  const owner = b.request({ action: 'join', room: 'main', role: 'publisher' });
  const viewer = b.request({ action: 'join', room: 'main', role: 'viewer' });
  if (!owner.ok || !viewer.ok) throw Error();
  b.request({ action: 'signal', session: owner.session, to: viewer.peer, signal: { type: 'offer', connection: 'old', sdp: 'v=0', mids: { left: '0', right: '1' } } });
  b.request({ action: 'leave', session: owner.session });
  const next = b.request({ action: 'join', room: 'main', role: 'publisher' });
  const result = b.request({ action: 'poll', session: viewer.session });
  if (!next.ok || !result.ok) throw Error();
  assert.equal(result.publisher, next.peer); assert.deepEqual(result.messages, []);
});
test('malformed requests and queue overflow fail without unbounded allocation', () => {
  const b = setup();
  for (const request of [null, [], { action: 'join', room: '../bad', role: 'publisher' }, { action: 'join', room: 'a', role: 'invalid' }, { action: 'poll', session: 'unknown' }]) assert.equal(b.request(request).ok, false);
  const owner = b.request({ action: 'join', room: 'a', role: 'publisher' });
  const viewer = b.request({ action: 'join', room: 'a', role: 'viewer' });
  if (!owner.ok || !viewer.ok) throw Error();
  for (let i = 0; i < 64; i++) assert.equal(b.request({ action: 'signal', session: owner.session, to: viewer.peer, signal: { type: 'offer', connection: 'c' + i, sdp: 'v=0', mids: { left: '0', right: '1' } } }).ok, true);
  assert.equal(b.request({ action: 'signal', session: owner.session, to: viewer.peer, signal: { type: 'offer', connection: 'overflow', sdp: 'v=0', mids: { left: '0', right: '1' } } }).ok, false);
});
test('inactive viewers are removed and the viewer limit is enforced', () => {
  const b = setup(); const owner = b.request({ action: 'join', room: 'main', role: 'publisher' });
  if (!owner.ok) throw Error();
  for (let i = 0; i < 8; i++) assert.equal(b.request({ action: 'join', room: 'main', role: 'viewer' }).ok, true);
  assert.equal(b.request({ action: 'join', room: 'main', role: 'viewer' }).ok, false);
  b.advance(5000); b.request({ action: 'poll', session: owner.session }); b.advance(1001);
  const result = b.request({ action: 'poll', session: owner.session });
  if (!result.ok) throw Error(); assert.deepEqual(result.viewers, []);
});

test('relay offers preserve distinct gameplay and player camera track identities', () => {
  const b = setup();
  const owner = b.request({ action: 'join', room: 'main', role: 'publisher' });
  const viewer = b.request({ action: 'join', room: 'main', role: 'viewer' });
  if (!owner.ok || !viewer.ok) throw Error();
  const signal = { type: 'offer', connection: 'four-feeds', sdp: 'v=0',
    mids: { left: '0', right: '1', 'camera-left': '2', 'camera-right': '3' } };
  assert.equal(b.request({ action: 'signal', session: owner.session, to: viewer.peer, signal }).ok, true);
  const inbox = b.request({ action: 'poll', session: viewer.session });
  if (!inbox.ok) throw Error();
  assert.deepEqual(inbox.messages, [{ from: owner.peer, signal }]);
});

test('relay rejects a camera mapped onto a gameplay transceiver', () => {
  const b = setup();
  const owner = b.request({ action: 'join', room: 'main', role: 'publisher' });
  const viewer = b.request({ action: 'join', room: 'main', role: 'viewer' });
  if (!owner.ok || !viewer.ok) throw Error();
  assert.equal(b.request({ action: 'signal', session: owner.session, to: viewer.peer,
    signal: { type: 'offer', connection: 'overlap', sdp: 'v=0',
      mids: { left: '0', right: '1', 'camera-left': '0', 'camera-right': '3' } } }).ok, false);
});
