# Presenter WebRTC relay

## Intent and authorized scope
The user requested implementation of the previously proposed local WebRTC relay in a separate worktree because another agent is editing the main checkout. One dedicated capture page owns both physical inputs; separate stream and LED presenters subscribe to two original video tracks. No hardware purchases, cloud services, or changes to the other checkout.

## Behavior
- New graphic presenter-capture.html owns left/right browser video devices. Operator explicitly starts/stops its named relay, configures inputs in the existing setup UI, and sees connection/ownership status and viewer count.
- Receivers opt in with ?videoRelay=main (a named relay, default name main on the capture page). Without it existing direct capture continues unchanged.
- Receivers never call getUserMedia, including through setup permission/reconnect buttons. They retain existing video-mode gating, frame freezing, locked maps and missing-signal placeholders. Physical signal-loss/mute behavior through WebRTC still needs hardware rehearsal.
- Relay input assignments live only in the capture browser, under a dedicated local storage key. Receiver reconnect/setup controls explain relay use. Neither output owns the capture lifecycle. Receiver setup displays current connection status.
- The publisher sends both tracks on one WebRTC peer connection per receiver, identified by side using explicit transceiver mids. Assignment changes/disconnects replace sessions rather than mixing old/new sides.
- Start/stop, reload, receiver join/leave, publisher departure/restart and temporary signaling failures recover without page reload or opening duplicate physical devices. Stop releases tracks before relinquishing ownership.
- A server lease permits one publisher per relay name. A second publisher stays inactive and reports busy. Lease expires after 6 seconds; the owner stops locally conservatively before expiry when signaling fails. Receiver tracks clear on owner/session change. No fallback to physical devices.
- Hardware tracks retain their lifecycle in the capture owner; closing a receiver only closes its remote tracks and connection.
- Publisher capture is independent of game state and presenter program leases, so a stream refresh cannot interrupt LED capture.
- Both outputs process the same raw feeds locally; audio remains disabled in capture. Relay transport can introduce latency; no zero-latency or hardware compatibility claim.

## Implementation choices made by the assistant
- Native browser WebRTC, no added npm dependencies, no STUN/TURN by default. Intended for one PC or a reachable venue LAN, not arbitrary NAT traversal.
- NodeCG request/ack messages provide bounded in-memory signaling queues and publisher leases. Media never goes through Replicants or NodeCG. Server-issued random session tokens authorize each queue; SDP offers/answers remain scoped to the relay and current publisher. ICE gathering completes before sending each description; no separate candidate queue is used.
- Poll/heartbeat every 1 second, timeout 3 seconds, local publisher safety deadline at request-start plus returned remaining lease minus 500ms. Check expiry independently every 100ms. Lost lease requires a new session and teardown before reacquisition.
- Limit relay names to [A-Za-z0-9_-], length 1..64; cap sessions (64), viewers per relay (8), signal messages per queue (64), SDP length (65536). Reject malformed/out-of-role or cross-relay signaling.
- Reuse capture controller and setup UI through an injected input opener and input configuration. Keep signaling transport, server broker, and browser peer lifecycle in separate modules.
- Retry unfinished peer negotiation after 12 seconds, including lost SDP-bearing poll acknowledgements. Successful connections remain open.
- Publisher exclusivity is per room, not a global hardware lock. A hung browser/OS cannot enforce the local deadline; the operator must close a stuck owner before replacement. Use one room for the same physical pair.
- Publish a manual local capture page via NodeCG's graphics registration, with no game or Google Maps dependency.
- Use the existing build entry discovery and presenter test glob. Do not merge or push.

## Limits and acceptance
Physical DeckLink access requires the driver to expose usable browser video devices. A native DeckLink SDK/WebRTC bridge is outside this implementation; document this clearly.
Tests must prove exclusive publisher ownership, leases and stale sessions, signaling isolation/limits, no hardware acquisition by subscribers, simultaneous two-track delivery to stream and LED, input swaps, publisher restart, subscriber restart, frozen frames and cleanup.
Use real built pages, Chromium fake cameras and the actual signaling broker for isolated browser validation. Run npm test, typecheck, build and diff check in this worktree. Physical card throughput, OBS CEF compatibility, venue connectivity and latency remain rehearsal checks.
