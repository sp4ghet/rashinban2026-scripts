export type ClockSample = { sentMs: number; receivedMs: number; serverMs: number };
export type Lease = { clientId: string; expiresAtMs: number };
export type ClientRole = 'program' | 'preview' | 'audio';
export type ClientReady = { clientId: string; role: ClientRole; ready: boolean };
export function clockOffset(samples: readonly ClockSample[]): number {
  const valid = samples.filter(s => [s.sentMs, s.receivedMs, s.serverMs].every(Number.isFinite) && s.receivedMs >= s.sentMs);
  const newest = Math.max(...valid.map(s => s.receivedMs));
  const best = valid.filter(s => newest - s.receivedMs <= 30000)
    .sort((a, b) => (a.receivedMs - a.sentMs) - (b.receivedMs - b.sentMs))[0];
  return best ? best.serverMs - (best.sentMs + best.receivedMs) / 2 : 0;
}
export function eligibleCompletion(lease: Lease | null, clientId: string, nowMs: number): boolean {
  return lease !== null && lease.clientId === clientId && Number.isFinite(nowMs) && nowMs < lease.expiresAtMs;
}
