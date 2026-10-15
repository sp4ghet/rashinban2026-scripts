import { type RelayEnvelope, type RelayRequest, type RelayResponse, type RelayRole, type RelaySignal, type RelaySnapshot } from '../../presenter/relay-protocol.ts';

export type RelayRequestFn = (request: RelayRequest) => Promise<RelayResponse>;
type Deps = { room: string; role: RelayRole; request: RelayRequestFn;
  state(value: RelaySnapshot | null, message: string): void; receive(value: RelayEnvelope): void;
  now?: () => number; schedule?: (fn: () => void, ms: number) => () => void };
/** A late acknowledgement cannot extend capture beyond the lease it actually renewed. */
export function createRelaySession(deps: Deps) {
  const now = deps.now ?? (() => performance.now());
  const schedule = deps.schedule ?? ((fn, ms) => { const timer = setTimeout(fn, ms); return () => clearTimeout(timer); });
  let enabled = false; let disposed = false; let epoch = 0; let session: RelaySnapshot | null = null;
  let deadline = 0; let nextTick: (() => void) | null = null; let guard: (() => void) | null = null;
  async function request(value: RelayRequest) {
    let cancel = () => {};
    try { return await Promise.race([deps.request(value), new Promise<never>((_, reject) => { cancel = schedule(() => reject(Error('Relay signaling timed out')), 3000); })]); }
    finally { cancel(); }
  }
  function leave(value: RelaySnapshot | null) { if (value) void request({ action: 'leave', session: value.session }).catch(() => {}); }
  function lose(message: string) {
    const old = session; session = null; deadline = 0;
    // Stop capture/remote tracks before relinquishing signaling ownership.
    deps.state(null, message); leave(old);
  }
  function watch(token: number) {
    if (!enabled || disposed || token !== epoch) return;
    if (session && now() >= deadline) lose('Relay connection lost. Waiting to reconnect.');
    guard = schedule(() => watch(token), 100);
  }
  async function tick(token: number) {
    if (!enabled || disposed || token !== epoch) return;
    const previous = session; const started = now();
    try {
      const value = await request(previous ? { action: 'poll', session: previous.session } : { action: 'join', room: deps.room, role: deps.role });
      if (!enabled || disposed || token !== epoch || previous !== session) {
        if (value?.ok) leave(value);
        return;
      }
      if (!value?.ok) { lose(value?.error ?? 'Relay signaling unavailable'); return; }
      const expires = started + value.ttlMs - 500;
      if (now() >= expires) { leave(value); lose('Relay acknowledgement arrived too late. Retrying.'); return; }
      session = value; deadline = expires;
      deps.state(value, value.publisher ? 'Relay connected' : 'Waiting for the capture page');
      for (const message of value.messages) deps.receive(message);
    } catch (error) {
      if (enabled && token === epoch) deps.state(session, error instanceof Error ? error.message : 'Relay signaling unavailable');
    } finally {
      if (enabled && !disposed && token === epoch) nextTick = schedule(() => { void tick(token); }, 1000);
    }
  }
  return {
    setActive(value: boolean) {
      if (disposed || enabled === value) return;
      enabled = value; epoch++; nextTick?.(); guard?.(); nextTick = guard = null;
      if (!value) { lose('Relay inactive'); return; }
      deps.state(null, 'Connecting to relay…'); watch(epoch); void tick(epoch);
    },
    async send(to: string, signal: RelaySignal) {
      const current = session;
      if (!current || now() >= deadline) throw Error('Relay session inactive');
      const result = await request({ action: 'signal', session: current.session, to, signal });
      if (!result?.ok) throw Error(result?.error ?? 'Relay signal failed');
    },
    dispose() {
      if (disposed) return;
      enabled = false; disposed = true; epoch++; nextTick?.(); guard?.(); lose('Relay stopped');
    },
  };
}
