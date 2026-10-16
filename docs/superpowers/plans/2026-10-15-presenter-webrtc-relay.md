# Presenter WebRTC Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Capture two devices once and deliver both feeds to independent stream and LED pages.
**Architecture:** Dedicated capture graphic, NodeCG signaling broker with one publisher lease, browser WebRTC publisher/receiver connections, existing presenter frame safety gates.
**Tech Stack:** TypeScript, NodeCG, native WebRTC, node:test, Chromium CDP.
**Spec:** docs/superpowers/specs/2026-10-15-presenter-webrtc-relay-design.md

## Global Constraints
- Work only in the managed relay worktree; carry forward only this thread's prior LED change.
- No hardware/cloud dependencies; browser input devices only; no native DeckLink bridge in scope.
- Direct input mode remains supported; relay subscribers never acquire hardware.
- Exactly one publisher per named relay; video only; no media in NodeCG state.
- Keep work isolated, unmerged and unpushed.

## Review Focus
- Lease expiry during slow acknowledgements and stale asynchronous getUserMedia results.
- New publisher/session rejecting old SDP/ICE and disposing old tracks.
- Two receivers joining, leaving and reconnecting independently.
- Input swaps or failure cannot exchange player identities or stop a healthy viewer's hardware.
- No permission probing or hardware fallback in relay receivers, including previews.

### Task 1: Exclusive signaling broker
Files: presenter/relay-protocol.ts, extension/presenter/video-relay.ts, presenter/tests/relay.test.ts; register in extension/index.ts.
Interface: createRelayBroker({now, token}).request(unknown) returns a typed join/poll/signal/leave response. registerVideoRelay(nodecg) binds presenter:video-relay.
- [x] Write/run failing ownership, expiry, malformed message and cross-relay tests.
- [x] Implement bounded queues, server-issued tokens and publisher/viewer state.
- [x] Run targeted tests; record result.

### Task 2: Browser relay and capture owner
Files: graphics/presenter/relay.ts, graphics/presenter-capture.ts, graphics/presenter-capture.html/css, graphics/presenter/capture-ui.ts, bundle package.json.
Interface: createRelayPublisher/Receiver with injected signaling request and stream callbacks; publisher setStream and receiver open(side).
- [x] Implement browser acceptance for a receiver without hardware access; reproduce lost-offer failure before the recovery fix.
- [x] Implement timeout-safe session heartbeat, exclusive capture eligibility, SDP/ICE routing, per-viewer cleanup and recovery.
- [x] Adapt shared input UI for publisher storage and injected receiver opener; keep direct capture default.
- [x] Add start/stop/status capture page and register it as a graphic.

### Task 3: Presenter integration and end-to-end validation
Files: graphics/presenter.ts, scripts/validate-presenter-relay.mjs, docs/presenter/video-inputs.md.
- [x] Extend isolated browser harness to use the actual broker and three pages.
- [x] Verify both sides to two receivers, frame progress/freeze, receiver churn, publisher restart, input swap, exclusive publisher and release.
- [x] Run npm test, npm run typecheck, npm run build, existing video validation and new relay validation.
- [x] Document exact URLs, origin requirements, owner lifecycle, no native DeckLink support, local network and hardware acceptance limitations.
- [x] Obtain fresh code review, resolve important findings, and leave a reviewable feature branch.


## Completion evidence

- Baseline at 83871cbb254797cd84db7fd8dad5edf349752236: 589/589 tests.
- Final: 597/597 unit tests, typecheck and build pass.
- Existing direct-video harness: 58 checks; new relay harness: 34 checks;
  both report zero uncaught exceptions using fake inputs.
- Independent review found an important missing negotiation deadline. Lost-offer
  regression failed before the fix; lost-offer and lost-answer recovery now
  pass with a 12-second retry deadline. Visible receiver status was also added.
- Code and tests remain in the separate feature worktree; original checkout
  was not edited. Physical DeckLink/OBS/LAN acceptance remains unverified.
- Operator and validation documentation record setup and remaining limits.
