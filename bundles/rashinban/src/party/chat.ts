export type PartyChatMessage = {
  id: string; userId: string; name: string; kind: 'Text' | 'Emote'; text: string;
  sentAtMs: number; channel: string | null;
};
export type PartyChat = {
  partyId: string | null;
  state: 'idle' | 'connecting' | 'live' | 'reconnecting' | 'unavailable';
  detail: string;
  messages: PartyChatMessage[];
};
export const EMPTY_PARTY_CHAT: PartyChat = {
  partyId: null, state: 'idle', detail: 'Waiting for a live party.', messages: [],
};
