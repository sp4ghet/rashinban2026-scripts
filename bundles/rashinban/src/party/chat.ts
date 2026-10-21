export type PartyChatMessage = {
  id: string; userId: string; name: string; kind: 'Text' | 'Emote'; text: string;
  sentAtMs: number; channel: string | null;
};
export type PartyChat = {
  partyId: string | null;
  state: 'idle' | 'connecting' | 'live' | 'reconnecting' | 'unavailable';
  detail: string;
  messages: PartyChatMessage[];
  sessionId: string | null; sender: string | null; canSendText: boolean; availableEmotes: string[];
  sendDisabledReason: string | null; sending: boolean; cooldownUntilMs: number;
};
export const EMPTY_PARTY_CHAT: PartyChat = {
  partyId: null, state: 'idle', detail: 'Waiting for a live party.', messages: [],
  sessionId: null, sender: null, canSendText: false, availableEmotes: [],
  sendDisabledReason: 'Connect to live party chat to send.', sending: false, cooldownUntilMs: 0,
};
export const CHAT_SEND_MESSAGE = 'party:chat:send';
export const CHAT_TEXT_LIMIT = 100;
