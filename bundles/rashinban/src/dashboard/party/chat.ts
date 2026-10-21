import { REPLICANTS, type PresenterConnection } from '../../types/replicants.ts';
import { EMPTY_PARTY_CHAT, type PartyChat } from '../../party/chat.ts';
import type { PartyStatus } from '../../party/types.ts';

export function bindPartyChat() {
  const chat = nodecg.Replicant<PartyChat>(REPLICANTS.partyChat);
  const party = nodecg.Replicant<PartyStatus>(REPLICANTS.partyStatus);
  const connection = nodecg.Replicant<PresenterConnection>(REPLICANTS.presenterConnection);
  const log = document.getElementById('chat-messages')!;
  const status = document.getElementById('chat-status')!;
  const detail = document.getElementById('chat-detail')!;
  const empty = document.getElementById('chat-empty')!;
  const rows = new Map<string, HTMLElement>();
  let renderedParty: string | null = null;
  const labels = { idle: 'Waiting', connecting: 'Connecting…', live: 'Live', reconnecting: 'Reconnecting…', unavailable: 'Unavailable' };
  function render() {
    const replay = connection.value?.input === 'replay' || party.value?.state === 'replay';
    const value = chat.value ?? EMPTY_PARTY_CHAT;
    const matches = !replay && value.partyId === party.value?.party?.partyId
      && (!connection.value?.selectedPartyId || connection.value.selectedPartyId === value.partyId);
    const visible = matches ? value : EMPTY_PARTY_CHAT;
    status.textContent = replay ? 'Replay' : labels[visible.state];
    status.dataset.state = visible.state;
    detail.textContent = replay ? 'Party chat is unavailable in replay mode.' : visible.detail;
    const changedParty = renderedParty !== visible.partyId;
    const follow = changedParty || rows.size === 0 || log.scrollHeight - log.scrollTop - log.clientHeight < 32;
    const top = log.getBoundingClientRect().top;
    const anchor = [...rows.values()].find(row => row.getBoundingClientRect().bottom > top);
    const offset = anchor ? anchor.getBoundingClientRect().top - top : 0;
    if (changedParty) { log.replaceChildren(); rows.clear(); renderedParty = visible.partyId; }
    const ids = new Set(visible.messages.map(m => m.id));
    for (const [id, row] of rows) if (!ids.has(id)) { row.remove(); rows.delete(id); }
    let previous: HTMLElement | null = null;
    for (const message of visible.messages) {
      let row = rows.get(message.id);
      if (!row) {
        row = document.createElement('div'); row.className = 'chat-message';
        const meta = document.createElement('div'); meta.className = 'chat-meta';
        const name = document.createElement('strong');
        const time = document.createElement('time'); time.dateTime = new Date(message.sentAtMs).toISOString();
        time.textContent = new Date(message.sentAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        time.title = new Date(message.sentAtMs).toLocaleString();
        meta.append(name, time);
        const text = document.createElement('div'); text.className = 'chat-text'; text.textContent = message.text;
        if (message.kind === 'Emote') { text.classList.add('chat-emote'); text.setAttribute('aria-label', `Emote ${message.text}`); }
        row.append(meta, text); rows.set(message.id, row);
      }
      const name = row.querySelector('strong')!;
      const label = message.channel ? `${message.name} · ${message.channel}` : message.name;
      if (name.textContent !== label) name.textContent = label;
      if (row.previousElementSibling !== previous || row.parentElement !== log) log.insertBefore(row, previous ? previous.nextSibling : log.firstChild);
      previous = row;
    }
    empty.hidden = visible.messages.length > 0;
    if (follow) log.scrollTop = log.scrollHeight;
    else if (anchor?.isConnected) log.scrollTop += anchor.getBoundingClientRect().top - top - offset;
  }
  chat.on('change', render); party.on('change', render); connection.on('change', render); render();
}
