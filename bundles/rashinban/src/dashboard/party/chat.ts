import { REPLICANTS, type PresenterConnection } from '../../types/replicants.ts';
import { CHAT_SEND_MESSAGE, CHAT_TEXT_LIMIT, EMPTY_PARTY_CHAT, type PartyChat } from '../../party/chat.ts';
import { PARTY_EMOTES } from '../../party/emotes.ts';
import type { PartyStatus } from '../../party/types.ts';

export function bindPartyChat() {
  const chat = nodecg.Replicant<PartyChat>(REPLICANTS.partyChat);
  const party = nodecg.Replicant<PartyStatus>(REPLICANTS.partyStatus);
  const connection = nodecg.Replicant<PresenterConnection>(REPLICANTS.presenterConnection);
  const log = document.getElementById('chat-messages')!;
  const status = document.getElementById('chat-status')!;
  const detail = document.getElementById('chat-detail')!;
  const empty = document.getElementById('chat-empty')!;
  const form = document.getElementById('chat-form') as HTMLFormElement;
  const input = document.getElementById('chat-input') as HTMLInputElement;
  const send = document.getElementById('chat-send') as HTMLButtonElement;
  const sender = document.getElementById('chat-sender')!;
  const count = document.getElementById('chat-count')!;
  const sendStatus = document.getElementById('chat-send-status')!;
  const emotes = document.getElementById('chat-emotes')!;
  const rows = new Map<string, HTMLElement>();
  let renderedParty: string | null = null;
  let draftParty: string | null = null;
  let visible = EMPTY_PARTY_CHAT, submitting = false, draftVersion = 0;
  function picture(emote: typeof PARTY_EMOTES[number]) {
    const image = document.createElement('img'); image.src = `assets/emotes/${emote.slug}.webp`;
    image.alt = emote.name; image.title = `${emote.name} ${emote.tag}`; image.width = image.height = 40;
    image.addEventListener('error', () => { image.replaceWith(document.createTextNode(emote.tag)); }, { once: true });
    return image;
  }
  function renderMessage(text: HTMLElement, message: string) {
    const parts = message.split(/(:[a-z]+:)/g);
    for (const part of parts) {
      const emote = PARTY_EMOTES.find(emote => emote.tag === part);
      text.append(emote ? picture(emote) : document.createTextNode(part));
    }
  }
  function controls() {
    const connected = nodecg.socket?.connected !== false && visible.state === 'live' && !!visible.sessionId;
    const waiting = submitting || visible.sending || Date.now() < visible.cooldownUntilMs;
    input.disabled = !connected || !visible.canSendText;
    send.disabled = input.disabled || waiting || !input.value.trim();
    send.textContent = submitting || visible.sending ? 'Sending…' : 'Send';
    input.placeholder = connected && !visible.canSendText && !visible.sendDisabledReason ? 'Emotes only in this party' : 'Write a message…';
    sender.textContent = visible.sendDisabledReason || (visible.sender ? `Sending as ${visible.sender} · to everyone` : 'Connect to live party chat to send.');
    count.textContent = `${input.value.length} / ${CHAT_TEXT_LIMIT}`;
    for (const button of emotes.querySelectorAll<HTMLButtonElement>('button')) {
      button.disabled = !connected || waiting || !visible.availableEmotes?.includes(button.dataset.emote!);
    }
  }
  async function submit(kind: 'Text' | 'Emote', text: string) {
    if (nodecg.socket?.connected === false || submitting || visible.sending || visible.state !== 'live' || !visible.sessionId || Date.now() < visible.cooldownUntilMs) return;
    if (kind === 'Text' ? !visible.canSendText || !text.trim() : !visible.availableEmotes?.includes(text)) return;
    const submittedParty = visible.partyId, version = draftVersion;
    submitting = true; sendStatus.hidden = false; sendStatus.textContent = 'Waiting for message confirmation…'; sendStatus.classList.remove('chat-send-error'); controls();
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    try {
      await new Promise<void>((resolve, reject) => {
        const disconnected = () => finish(new Error('Delivery was not confirmed. Check the chat feed before resending.'));
        const timer = setTimeout(disconnected, 20000);
        function finish(error?: unknown) {
          clearTimeout(timer); nodecg.socket?.off('disconnect', disconnected);
          if (error) reject(error); else resolve();
        }
        nodecg.socket?.once('disconnect', disconnected);
        nodecg.sendMessage(CHAT_SEND_MESSAGE, { id, partyId: submittedParty, sessionId: visible.sessionId, kind, text }).then(() => finish(), finish);
      });
      if (draftParty !== submittedParty) return;
      if (kind === 'Text' && draftVersion === version) { input.value = ''; draftVersion++; }
      sendStatus.textContent = 'Sent.';
    } catch (error) {
      if (draftParty !== submittedParty) return;
      sendStatus.textContent = error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Unable to confirm delivery. Check the feed before resending.';
      sendStatus.classList.add('chat-send-error');
    } finally { submitting = false; controls(); }
  }
  for (const emote of PARTY_EMOTES.slice(0, 7)) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.emote = emote.tag;
    button.title = `Send ${emote.name}`; button.setAttribute('aria-label', `Send ${emote.name} emote`); button.disabled = true;
    button.append(picture(emote)); button.addEventListener('click', () => { void submit('Emote', emote.tag); }); emotes.append(button);
  }
  form.addEventListener('submit', event => { event.preventDefault(); void submit('Text', input.value); });
  input.addEventListener('input', () => { draftVersion++; controls(); });
  input.addEventListener('keydown', event => { if (event.key === 'Enter' && event.isComposing) event.preventDefault(); });
  const labels = { idle: 'Waiting', connecting: 'Connecting…', live: 'Live', reconnecting: 'Reconnecting…', unavailable: 'Unavailable' };
  function render() {
    const replay = connection.value?.input === 'replay' || party.value?.state === 'replay';
    const selectedParty = replay ? null : connection.value?.selectedPartyId ?? party.value?.party?.partyId ?? null;
    if (draftParty !== selectedParty) { draftParty = selectedParty; input.value = ''; draftVersion++; sendStatus.hidden = true; }
    const value = chat.value ?? EMPTY_PARTY_CHAT;
    const matches = !replay && value.partyId === party.value?.party?.partyId
      && (!connection.value?.selectedPartyId || connection.value.selectedPartyId === value.partyId);
    visible = matches ? value : EMPTY_PARTY_CHAT;
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
        const text = document.createElement('div'); text.className = 'chat-text'; renderMessage(text, message.text);
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
    controls();
  }
  chat.on('change', render); party.on('change', render); connection.on('change', render); render();
  nodecg.socket?.on('disconnect', controls); nodecg.socket?.on('connect', controls);
  setInterval(controls, 250);
}
