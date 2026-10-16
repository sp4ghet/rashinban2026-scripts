import { RELAY_FEEDS, type RelayEnvelope, type RelayFeed, type RelaySnapshot, type RelayMids } from '../../presenter/relay-protocol.ts';
import { createRelaySession, type RelayRequestFn } from './relay-session.ts';

const sides = RELAY_FEEDS;
type Streams = Record<RelayFeed, MediaStream | null>;
const empty = (): Streams => ({ left: null, right: null, 'camera-left': null, 'camera-right': null });

async function description(pc: RTCPeerConnection, value: RTCSessionDescriptionInit): Promise<string> {
  await pc.setLocalDescription(value);
  if (pc.iceGatheringState !== 'complete') await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => finish(Error('Local WebRTC connection setup timed out')), 5000);
    function finish(error?: Error) { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', check); pc.removeEventListener('connectionstatechange', check); error ? reject(error) : resolve(); }
    function check() { if (pc.connectionState === 'closed') finish(Error('Peer closed')); else if (pc.iceGatheringState === 'complete') finish(); }
    pc.addEventListener('icegatheringstatechange', check); pc.addEventListener('connectionstatechange', check); check();
  });
  return pc.localDescription!.sdp;
}
function stop(stream: MediaStream) {
  for (const track of stream.getTracks()) {
    if (track.readyState !== 'ended') { track.stop(); track.dispatchEvent(new Event('ended')); }
  }
}

/** Owns peer connections only; the capture UI owns physical streams. */
export function createRelayPublisher(options: { room: string; request: RelayRequestFn; active(value: boolean): void; status(message: string): void }) {
  let streams = empty(); let current: RelaySnapshot | null = null;
  const peers = new Map<string, { pc: RTCPeerConnection; connection: string; startedAt: number }>();
  function close(id: string) { const peer = peers.get(id); peers.delete(id); peer?.pc.close(); }
  function closeAll() { for (const id of peers.keys()) close(id); }
  async function offer(id: string) {
    if (!current || peers.has(id) || !sides.some(side => streams[side]?.getVideoTracks()[0]?.readyState === 'live')) return;
    const pc = new RTCPeerConnection({ iceServers: [] });
    const peer = { pc, connection: crypto.randomUUID(), startedAt: performance.now() }; peers.set(id, peer);
    const transceivers = sides.map(side => {
      const track = streams[side]?.getVideoTracks()[0];
      return pc.addTransceiver(track?.readyState === 'live' ? track : 'video', { direction: 'sendonly', streams: track ? [new MediaStream([track])] : [] });
    });
    pc.onconnectionstatechange = () => {
      if (peers.get(id) === peer && ['failed', 'disconnected', 'closed'].includes(pc.connectionState)) close(id);
    };
    try {
      const sdp = await description(pc, await pc.createOffer());
      if (peers.get(id) !== peer || !current) return;
      await session.send(id, { type: 'offer', connection: peer.connection, sdp, mids: Object.fromEntries(sides.map((side, index) => [side, transceivers[index].mid!])) as RelayMids });
    } catch (error) {
      if (peers.get(id) === peer) { close(id); options.status(error instanceof Error ? error.message : 'Video connection failed'); }
    }
  }
  async function receive(envelope: RelayEnvelope) {
    const peer = peers.get(envelope.from); const signal = envelope.signal;
    if (!peer || signal.type !== 'answer' || peer.connection !== signal.connection) return;
    try { await peer.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp }); }
    catch { if (peers.get(envelope.from) === peer) close(envelope.from); }
  }
  const session = createRelaySession({ room: options.room, role: 'publisher', request: options.request,
    state(value, message) {
      if (current?.peer !== value?.peer) closeAll();
      current = value;
      options.active(!!value);
      for (const [id, peer] of peers) {
        // Poll responses can be lost after the broker drains its inbox. An
        // unanswered offer stays in "new" forever unless we explicitly retry.
        if (!value?.viewers.includes(id) || (peer.pc.connectionState !== 'connected' && performance.now() - peer.startedAt >= 12000)) close(id);
      }
      if (value) for (const id of value.viewers) void offer(id);
      options.status(value ? 'Capture owner active · ' + value.viewers.length + ' viewer(s)' : message);
    }, receive: envelope => { void receive(envelope); } });
  return {
    setActive: session.setActive,
    setStream(side: RelayFeed, stream: MediaStream | null) {
      if (streams[side] === stream) return;
      streams = { ...streams, [side]: stream };
      closeAll();
      if (current) for (const id of current.viewers) void offer(id);
    },
    dispose() { session.dispose(); closeAll(); },
  };
}

export function createRelayReceiver(options: { room: string; cameras?: boolean; request: RelayRequestFn; status?(message: string): void }) {
  const accepted = sides.filter(side => options.cameras || !side.startsWith('camera-'));
  let enabled = false;
  let publisher: string | null = null;
  let current: { pc: RTCPeerConnection; connection: string } | null = null;
  let streams = empty(); const borrowed = new Set<MediaStream>();
  const available = new Set<(side: RelayFeed) => void>();
  const pending: { side: RelayFeed; resolve(stream: MediaStream): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }[] = [];
  function borrow(stream: MediaStream) {
    for (const old of borrowed) if (old.getVideoTracks().every(t => t.readyState === 'ended')) borrowed.delete(old);
    const value = new MediaStream(stream.getVideoTracks().map(track => track.clone()));
    borrowed.add(value); return value;
  }
  function clear(rejectWaiting = false) {
    const old = current; current = null; old?.pc.close();
    for (const value of borrowed) stop(value); borrowed.clear();
    for (const side of sides) if (streams[side]) stop(streams[side]!);
    streams = empty();
    if (rejectWaiting) for (const waiting of pending.splice(0)) { clearTimeout(waiting.timer); waiting.reject(new DOMException('Relay feed disconnected', 'AbortError')); }
  }
  function deliver(side: RelayFeed, stream: MediaStream) {
    streams[side] = stream;
    for (const listener of available) listener(side);
    for (const waiting of [...pending]) if (waiting.side === side) {
      pending.splice(pending.indexOf(waiting), 1); clearTimeout(waiting.timer); waiting.resolve(borrow(stream));
    }
  }
  async function receive(envelope: RelayEnvelope) {
    const signal = envelope.signal;
    if (signal.type !== 'offer' || envelope.from !== publisher || signal.connection === current?.connection) return;
    clear();
    const pc = new RTCPeerConnection({ iceServers: [] });
    const peer = { pc, connection: signal.connection }; current = peer;
    pc.ontrack = event => {
      if (current !== peer) return;
      const side = accepted.find(side => signal.mids[side] === event.transceiver.mid);
      if (!side || event.track.kind !== 'video') return;
      event.track.onended = () => { if (current === peer) clear(); };
      deliver(side, new MediaStream([event.track]));
    };
    pc.onconnectionstatechange = () => {
      if (current === peer && ['failed', 'disconnected', 'closed'].includes(pc.connectionState)) clear();
      else if (current === peer && pc.connectionState === 'connected') options.status?.('Receiving relay ' + options.room);
    };
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
      // LED and gameplay-only viewers decline camera tracks, avoiding unused
      // camera encoding and transport while sharing the same physical capture.
      for (const transceiver of pc.getTransceivers()) {
        if (!accepted.some(side => signal.mids[side] === transceiver.mid)) transceiver.direction = 'inactive';
      }
      const sdp = await description(pc, await pc.createAnswer());
      if (current !== peer) return;
      await session.send(envelope.from, { type: 'answer', connection: signal.connection, sdp });
    } catch (error) {
      if (current === peer) { clear(); options.status?.(error instanceof Error ? error.message : 'Relay connection failed'); }
    }
  }
  const session = createRelaySession({ room: options.room, role: 'viewer', request: options.request,
    state(value, message) {
      const next = value?.publisher ?? null;
      if (publisher !== next || !value) { clear(); publisher = next; }
      options.status?.(message === 'Relay connected'
        ? current?.pc.connectionState === 'connected' ? 'Receiving relay ' + options.room : 'Connecting player video'
        : message);
    }, receive: envelope => { void receive(envelope); } });
  return {
    name: options.room,
    setActive(value: boolean) { enabled = value; session.setActive(value); if (!value) clear(true); },
    onAvailable(listener: (side: RelayFeed) => void) { available.add(listener); return () => { available.delete(listener); }; },
    open(side: RelayFeed): Promise<MediaStream> {
      const stream = streams[side];
      if (stream?.getVideoTracks()[0]?.readyState === 'live') return Promise.resolve(borrow(stream));
      return new Promise((resolve, reject) => {
        const waiting = { side, resolve, reject, timer: setTimeout(() => {
          const index = pending.indexOf(waiting); if (index >= 0) pending.splice(index, 1);
          reject(new DOMException('Waiting for the relay capture page', 'NotReadableError'));
        }, 12000) };
        pending.push(waiting);
      });
    },
    reconnect() { if (enabled) { session.setActive(false); clear(true); session.setActive(true); } },
    dispose() { session.dispose(); clear(true); available.clear(); },
  };
}
