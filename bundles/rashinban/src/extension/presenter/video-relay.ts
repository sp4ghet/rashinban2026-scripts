import type NodeCG from '@nodecg/types';
import { randomUUID } from 'node:crypto';
import { RELAY_LEASE_MS, RELAY_MESSAGE, relayName, type RelayEnvelope, type RelayResponse, type RelayRole, type RelaySignal } from '../../presenter/relay-protocol.ts';

type Session = { token: string; peer: string; room: string; role: RelayRole; expires: number; queue: RelayEnvelope[] };
function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid relay request');
  return input as Record<string, unknown>;
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[\w-]{1,128}$/.test(value)) throw Error('Invalid relay identifier');
  return value;
}
function parseSignal(value: unknown): RelaySignal {
  const s = object(value);
  const connection = identifier(s.connection);
  if (typeof s.sdp !== 'string' || !s.sdp.length || s.sdp.length > 65536) throw Error('Invalid session description');
  if (s.type === 'answer') return { type: 'answer', connection, sdp: s.sdp };
  if (s.type !== 'offer') throw Error('Invalid signal type');
  const mids = object(s.mids);
  const left = identifier(mids.left); const right = identifier(mids.right);
  if (left === right) throw Error('Video sides must have distinct transceivers');
  return { type: 'offer', connection, sdp: s.sdp, mids: { left, right } };
}

/** Signaling only: media and physical device IDs never reach this broker. */
export function createRelayBroker(deps: { now(): number; token(): string } = { now: () => Date.now(), token: () => randomUUID() }) {
  const sessions = new Map<string, Session>();
  function remove(session: Session) {
    sessions.delete(session.token);
    for (const other of sessions.values()) other.queue = other.queue.filter(item => item.from !== session.peer);
  }
  function sweep() { for (const s of sessions.values()) if (s.expires <= deps.now()) remove(s); }
  function publisher(room: string) { return [...sessions.values()].find(s => s.room === room && s.role === 'publisher'); }
  function snapshot(s: Session, drain = false): RelayResponse {
    const messages = drain ? s.queue.splice(0) : [];
    return { ok: true, session: s.token, peer: s.peer, ttlMs: Math.max(0, s.expires - deps.now()),
      publisher: publisher(s.room)?.peer ?? null,
      viewers: s.role === 'publisher' ? [...sessions.values()].filter(p => p.room === s.room && p.role === 'viewer').map(p => p.peer) : [], messages };
  }
  return { request(input: unknown): RelayResponse {
    sweep();
    try {
      const r = object(input);
      if (r.action === 'join') {
        const room = relayName(typeof r.room === 'string' ? r.room : '');
        if (r.role !== 'publisher' && r.role !== 'viewer') throw Error('Invalid relay role');
        if (sessions.size >= 64) throw Error('Relay session limit reached');
        if (r.role === 'publisher' && publisher(room)) throw Error('This relay already has a capture owner. Stop it before starting another.');
        if (r.role === 'viewer' && [...sessions.values()].filter(s => s.room === room && s.role === 'viewer').length >= 8) throw Error('Relay viewer limit reached');
        const s: Session = { token: deps.token(), peer: deps.token(), role: r.role, room, expires: deps.now() + RELAY_LEASE_MS, queue: [] };
        sessions.set(s.token, s);
        return snapshot(s);
      }
      const s = sessions.get(identifier(r.session));
      if (!s) throw Error('Relay session expired');
      if (r.action === 'leave') { remove(s); return snapshot(s); }
      if (r.action === 'poll') { s.expires = deps.now() + RELAY_LEASE_MS; return snapshot(s, true); }
      if (r.action !== 'signal') throw Error('Unknown relay action');
      const to = identifier(r.to);
      const target = [...sessions.values()].find(p => p.peer === to);
      if (!target || target.room !== s.room || target.role === s.role) throw Error('Relay peer unavailable');
      const signal = parseSignal(r.signal);
      if ((s.role === 'publisher') !== (signal.type === 'offer')) throw Error('Invalid signal direction');
      if (target.queue.length >= 64) throw Error('Relay signal queue full');
      target.queue.push({ from: s.peer, signal });
      return snapshot(s);
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Relay request failed' }; }
  } };
}
export function registerVideoRelay(nodecg: NodeCG.ServerAPI) {
  const broker = createRelayBroker();
  nodecg.listenFor(RELAY_MESSAGE, (request: unknown, ack) => {
    if (ack && !ack.handled) ack(null, broker.request(request));
  });
}
