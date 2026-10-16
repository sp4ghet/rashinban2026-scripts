import assert from 'node:assert/strict';
import test from 'node:test';
import { createRelaySession } from '../../graphics/presenter/relay-session.ts';
import type { RelayRequest, RelayResponse, RelaySnapshot } from '../relay-protocol.ts';
const snapshot: RelaySnapshot = { ok: true, session: 'secret', peer: 'owner', publisher: 'owner', viewers: [], ttlMs: 6000, messages: [] };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function setup(request: (r: RelayRequest) => Promise<RelayResponse>) {
  let now = 0; const timers: { at: number; run(): void; active: boolean }[] = []; const states: (RelaySnapshot | null)[] = [];
  const session = createRelaySession({ room: 'main', role: 'publisher', request, state(value) { states.push(value); }, receive() {}, now: () => now,
    schedule(run, ms) { const task = { at: now + ms, run, active: true }; timers.push(task); return () => { task.active = false; }; } });
  return { session, states, async advance(ms: number) {
    const end = now + ms;
    for (;;) { const task = timers.filter(t => t.active && t.at <= end).sort((a,b) => a.at-b.at)[0]; if (!task) break; now = task.at; task.active = false; task.run(); await flush(); }
    now = end; await flush();
  } };
}
test('signaling silence drops capture before the server lease expires', async () => {
  const b = setup(r => r.action === 'join' ? Promise.resolve(snapshot) : new Promise(() => {}));
  b.session.setActive(true); await flush(); assert.equal(b.states.at(-1)?.peer, 'owner');
  await b.advance(5499); assert.equal(b.states.at(-1)?.peer, 'owner');
  await b.advance(1); assert.equal(b.states.at(-1), null);
  b.session.dispose();
});
test('stop before join acknowledgement never activates capture and relinquishes the late session', async () => {
  let resolve!: (value: RelayResponse) => void; const requests: RelayRequest[] = [];
  const b = setup(r => { requests.push(r); return r.action === 'join' ? new Promise(done => { resolve = done; }) : Promise.resolve(snapshot); });
  b.session.setActive(true); b.session.setActive(false); resolve(snapshot); await flush();
  assert.equal(b.states.some(Boolean), false);
  assert.equal(requests.some(r => r.action === 'leave'), true);
  b.session.dispose();
});
test('lease lifetime is measured from request start, not acknowledgement arrival', async () => {
  let resolve!: (value: RelayResponse) => void;
  const b = setup(r => r.action === 'join' ? new Promise(done => { resolve = done; }) : new Promise(() => {}));
  b.session.setActive(true); await b.advance(2500); resolve(snapshot); await flush();
  assert.equal(b.states.at(-1)?.peer, 'owner');
  await b.advance(3000); assert.equal(b.states.at(-1), null);
  b.session.dispose();
});
