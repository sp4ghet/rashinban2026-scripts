import assert from 'node:assert/strict';
import test from 'node:test';
import { clientRole, createPresenterClient } from '../../graphics/presenter/client.ts';
import { advanceTimeline } from '../timeline.ts';
import { DEFAULT_SETTINGS } from '../settings.ts';
import type { Timeline } from '../../types/presenter.ts';

function client(role: 'preview' | 'program' = 'program') {
  let elapsed = 0; let wall = 1000; let pings = 0;
  const sent: { name: string; body: any }[] = [];
  const tasks: { fn: () => void; at: number; active: boolean }[] = [];
  const value = createPresenterClient({ clientId: 'one', role, wallNow: () => wall, monotonicNow: () => elapsed,
    async send(name, body) { sent.push({ name, body }); if (name === 'presenter:clock') { pings++; const midpoint = 1000 + elapsed + 10; elapsed += 20; return midpoint + 100; } return true; },
    schedule(fn, ms) { const task = { fn, at: elapsed + ms, active: true }; tasks.push(task); return () => { task.active = false; }; },
  });
  return { value, sent, tasks, get pings() { return pings; }, advance(ms: number) { elapsed += ms; }, jumpWall() { wall += 90000; } };
}
function timeline(): Timeline { return { ...advanceTimeline(null, null, 0, false, DEFAULT_SETTINGS.timing), generation: 'g', phase: 'results-transition', effect: 'single-5k',
  cues: [{ id: 'old', kind: 'pin', atMs: 1000, untilMs: 1100, playerId: null },
    { id: 'active-on-bootstrap', kind: 'guess', atMs: 1100, untilMs: 1500, playerId: null },
    { id: 'five', kind: 'five-k', atMs: 1300, untilMs: 3000, playerId: null }] }; }
test('only an explicit program URL opts into program ownership', () => {
  for (const search of ['', '?role=preview', '?role=audio', '?role=Program', '?program=1']) assert.equal(clientRole(search), 'preview');
  assert.equal(clientRole('?role=program'), 'program');
});
test('browser uses five midpoint samples and monotonic elapsed time, renews at 2s and refreshes at 10s', async () => {
  const c = client(); await c.value.start();
  assert.equal(c.pings, 5); assert.equal(c.value.now(), 1200);
  c.jumpWall(); c.advance(500); assert.equal(c.value.now(), 1700);
  assert.ok(c.tasks.some(t => t.active && t.at === 2000));
  assert.ok(c.tasks.some(t => t.active && t.at === 10100));
  const renew = c.tasks.find(t => t.active && t.at === 2000)!;
  c.advance(1400); renew.active = false; renew.fn();
  assert.equal(c.sent.filter(s => s.name === 'presenter:client').length, 2);
  c.value.dispose(); assert.ok(c.tasks.every(t => !t.active));
});
test('preview has no effective callbacks and bootstrap/transfer does not replay one-shot cues', async () => {
  const c = client(); await c.value.start();
  const t = timeline(); const lease = { clients: [], program: { clientId: 'one', expiresAtMs: 6000 } };
  c.value.updateClients(lease); c.value.updateTimeline(t);
  assert.equal(c.value.ownsProgram(), true); assert.deepEqual(c.value.pollCues(), []);
  c.advance(100); assert.deepEqual(c.value.pollCues().map(cue => cue.id), ['five']);
  assert.deepEqual(c.value.pollCues(), []);
  const done = c.value.effectCompletion(t);
  c.value.updateClients({ clients: [], program: { clientId: 'two', expiresAtMs: 6000 } });
  assert.equal(await done(), false);
  c.value.updateClients(lease); assert.deepEqual(c.value.pollCues(), []);
  assert.equal(await done(), false, 'old ownership callback stays invalid after reacquiring');
  const fresh = c.value.effectCompletion(t); assert.equal(await fresh(), true);
  c.value.updateTimeline({ ...t, generation: 'new' }); assert.equal(await fresh(), false);
  const p = client('preview'); await p.value.start(); p.value.updateClients(lease); p.value.updateTimeline(t); p.advance(100);
  assert.equal(p.value.ownsProgram(), false); assert.deepEqual(p.value.pollCues(), []);
  assert.equal(await p.value.effectCompletion(t)(), false);
  c.advance(6000); assert.equal(c.value.ownsProgram(), false);
});

test('initial synchronization corrects a fast wall clock before adopting future cues', async () => {
  let elapsed = 0;
  const c = createPresenterClient({ clientId: 'one', role: 'program', wallNow: () => 2000, monotonicNow: () => elapsed,
    send: async name => name === 'presenter:clock' ? 1000 : true, schedule: () => () => {} });
  c.updateClients({ clients: [], program: { clientId: 'one', expiresAtMs: 6000 } }); c.updateTimeline(timeline());
  assert.equal(c.now(), 2000); assert.deepEqual(c.pollCues(), []);
  await c.start(); assert.equal(c.now(), 1000);
  c.pollCues(); elapsed = 300;
  assert.deepEqual(c.pollCues().map(cue => cue.id), ['active-on-bootstrap', 'five']);
});
