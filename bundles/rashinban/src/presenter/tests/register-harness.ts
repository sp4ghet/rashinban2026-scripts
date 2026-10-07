import assert from 'node:assert/strict';
import express from 'express';
import type NodeCG from '@nodecg/types';
import { registerPresenter } from '../../extension/presenter/register.ts';
import { DEFAULT_SETTINGS, type PresenterSettings } from '../settings.ts';
import { sample } from './fixtures.ts';

export const MANUAL_ROUNDS_FIXTURE = 'gs2-ws-full-duel-sequence-manual-rounds.json';

/** Duel-state messages of a recorded websocket capture, in order. */
export function rows(fixture = MANUAL_ROUNDS_FIXTURE): any[] {
  return (sample(fixture) as any[]).map(row => row.message).filter(message => message.duel?.state);
}

/** Register the presenter against an injected live spectator transport. */
export async function live(snapshot: any, saved = new Map<string, any>(), proxyReplicants = false) {
  const reps = new Map<string, any>(); const listeners = new Map<string, Function>();
  let now = 1900000000000; let deliver: (text: string) => void = () => assert.fail('No socket');
  const tasks: { fn: () => void; at: number; active: boolean }[] = [];
  const responses = [{ user: { id: 'spectator' } },
    { partyId: 'party', lobbyId: snapshot.gameId, gameState: 'Ongoing', gameType: 'Duels' },
    { gameId: snapshot.gameId, gameServerNodeId: 'node', status: 'Active' }, snapshot.duel.state];
  const before = process.env.GEOGUESSR_NCFA; process.env.GEOGUESSR_NCFA = 'test-only';
  try {
    registerPresenter({
      bundleConfig: { presenter: { input: 'live', partyId: 'party', clientVersion: 'fixture' } },
      Replicant(name: string, options: any) {
        const value = options.persistent && saved.has(name) ? structuredClone(saved.get(name)) : options.defaultValue;
        // NodeCG mutates assigned objects recursively, replacing children with proxies.
        function wrap(input: any): any {
          if (!proxyReplicants || input === null || typeof input !== 'object') return input;
          for (const key of Object.keys(input)) input[key] = wrap(input[key]);
          return new Proxy(input, {});
        }
        let stored = wrap(value);
        const rep = { get value() { return stored; }, set value(next) { stored = wrap(next); }, persistent: options.persistent };
        reps.set(name, rep); return rep;
      },
      Router: express.Router, mount() {}, listenFor(name: string, fn: Function) { listeners.set(name, fn); },
      log: { info() {}, warn() {} },
    } as unknown as NodeCG.ServerAPI, {
      now: () => now,
      schedule(fn, ms) { const task = { fn, at: now + ms, active: true }; tasks.push(task); return () => { task.active = false; }; },
      connection: { fetch: async () => new Response(JSON.stringify(responses.shift()), { status: 200 }),
        now: () => now, schedule: () => () => {},
        openSocket: () => ({ send() {}, close() {}, onOpen() {}, onMessage(fn) { deliver = fn; }, onClose() {} }),
      },
    });
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
  } finally {
    if (before === undefined) delete process.env.GEOGUESSR_NCFA; else process.env.GEOGUESSR_NCFA = before;
  }
  return {
    read: (name: string) => reps.get(name)?.value,
    send: (message: any) => deliver(JSON.stringify(message)),
    settings(patch: Partial<PresenterSettings>) {
      let error: unknown;
      listeners.get('presenter:control')!({ action: 'settings', body: { ...DEFAULT_SETTINGS, ...patch } }, (err: unknown) => { error = err; });
      assert.equal(error, null);
    },
    replay(fixture = MANUAL_ROUNDS_FIXTURE) {
      let error: unknown;
      listeners.get('presenter:control')!({ action: 'reconnect', body: { input: 'replay', fixture } }, (err: unknown) => { error = err; });
      assert.equal(error, null);
    },
    save: () => new Map([...reps].filter(([, rep]) => rep.persistent).map(([name, rep]) => [name, structuredClone(rep.value)])),
    settle() {
      const target = now + 60000;
      for (let i = 0; i < 1000; i++) {
        const task = tasks.filter(value => value.active && value.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!task) { now = target; return; }
        now = Math.max(now, task.at);
        task.active = false; task.fn();
      }
      assert.fail('Timeline did not settle');
    },
  };
}
