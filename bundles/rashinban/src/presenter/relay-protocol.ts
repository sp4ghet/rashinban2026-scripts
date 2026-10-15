export type RelayRole = 'publisher' | 'viewer';
export type RelaySide = 'left' | 'right';
export type RelaySignal =
  | { type: 'offer'; connection: string; sdp: string; mids: Record<RelaySide, string> }
  | { type: 'answer'; connection: string; sdp: string };
export type RelayEnvelope = { from: string; signal: RelaySignal };
export type RelaySnapshot = { ok: true; session: string; peer: string; publisher: string | null; viewers: string[]; ttlMs: number; messages: RelayEnvelope[] };
export type RelayResponse = RelaySnapshot | { ok: false; error: string };
export type RelayRequest =
  | { action: 'join'; room: string; role: RelayRole }
  | { action: 'poll' | 'leave'; session: string }
  | { action: 'signal'; session: string; to: string; signal: RelaySignal };
export const RELAY_MESSAGE = 'presenter:video-relay';
export const RELAY_LEASE_MS = 6000;
export function relayName(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw Error('Relay name must contain 1–64 letters, numbers, underscores or hyphens.');
  return value;
}
