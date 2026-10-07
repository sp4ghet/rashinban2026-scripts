import assert from "node:assert/strict";
import test from "node:test";
import {
  BroadcastError,
  createInitialState,
  cutProgram,
  layersEqual,
  revertPreview,
  setPreview,
  take,
  withDefaults,
} from "../state.ts";

test("initial state hides every layer on both buses and keeps the caster title bar on", () => {
  const s = createInitialState();
  assert.deepEqual(s.stream.program, s.stream.preview);
  assert.deepEqual(s.led.program, s.led.preview);
  assert.equal(s.stream.program.playerCards.visible, false);
  assert.equal(s.stream.program.playerCards.page, "profile");
  assert.equal(s.stream.program.lowerThird.mode, "match");
  assert.equal(s.stream.program.casters.titleBar, true);
  assert.deepEqual(s.stream.program.casters.slots, [false, false]);
  assert.equal(s.led.program.presenter.visible, false);
  assert.equal(s.led.program.banpick.visible, false);
});

test("setPreview deep-merges a partial into preview only", () => {
  const s = setPreview(createInitialState(), "stream", { playerCards: { visible: true }, lowerThird: { title: "Hello" } });
  assert.equal(s.stream.preview.playerCards.visible, true);
  assert.equal(s.stream.preview.playerCards.page, "profile");
  assert.equal(s.stream.preview.lowerThird.title, "Hello");
  assert.equal(s.stream.preview.lowerThird.mode, "match");
  assert.equal(s.stream.program.playerCards.visible, false);
  assert.equal(s.led.preview.playerCards.visible, false);
});

test("setPreview rejects unknown keys, wrong types, bad enums, and overlong text", () => {
  const s = createInitialState();
  assert.throws(() => setPreview(s, "stream", { bogus: {} } as any), BroadcastError);
  assert.throws(() => setPreview(s, "stream", { playerCards: { visible: "yes" } } as any), BroadcastError);
  assert.throws(() => setPreview(s, "stream", { playerCards: { page: "bio" } } as any), BroadcastError);
  assert.throws(() => setPreview(s, "stream", { casters: { slots: [true] } } as any), BroadcastError);
  assert.throws(() => setPreview(s, "stream", { lowerThird: { title: "x".repeat(121) } }), BroadcastError);
  assert.throws(() => setPreview(s, "led", { lowerThird: { visible: true } } as any), BroadcastError);
  assert.throws(() => setPreview(s, "tv" as any, {}), BroadcastError);
  assert.throws(() => setPreview(s, "stream", null as any), BroadcastError);
});

test("take copies preview onto program for one output and leaves the other untouched", () => {
  let s = setPreview(createInitialState(), "led", { banpick: { visible: true }, presenter: { visible: true } });
  s = setPreview(s, "stream", { banpick: { visible: true } });
  s = take(s, "led");
  assert.equal(s.led.program.banpick.visible, true);
  assert.equal(s.led.program.presenter.visible, true);
  assert.equal(s.stream.program.banpick.visible, false);
  assert.notEqual(s.led.program, s.led.preview, "take must copy, not alias");
});

test("revertPreview copies program back onto preview", () => {
  let s = setPreview(createInitialState(), "stream", { playerCards: { visible: true } });
  s = take(s, "stream");
  s = setPreview(s, "stream", { playerCards: { visible: false }, lowerThird: { visible: true } });
  s = revertPreview(s, "stream");
  assert.equal(s.stream.preview.playerCards.visible, true);
  assert.equal(s.stream.preview.lowerThird.visible, false);
});

test("cutProgram merges straight into program and validates like setPreview", () => {
  const s = cutProgram(createInitialState(), "stream", { casters: { slots: [true, false] } });
  assert.deepEqual(s.stream.program.casters.slots, [true, false]);
  assert.deepEqual(s.stream.preview.casters.slots, [false, false]);
  assert.throws(() => cutProgram(s, "stream", { casters: { slots: "on" } } as any), BroadcastError);
});

test("withDefaults repairs missing or malformed persisted state without throwing", () => {
  assert.deepEqual(withDefaults(undefined), createInitialState());
  assert.deepEqual(withDefaults({ stream: { program: { playerCards: { visible: true } } } }).stream.program.playerCards, { visible: true, page: "profile" });
  assert.deepEqual(withDefaults({ led: 5 }).led, createInitialState().led);
  assert.deepEqual(withDefaults({ stream: { preview: { lowerThird: { title: 42 } } } }).stream.preview.lowerThird.title, "");
});

test("layersEqual compares structurally", () => {
  const s = createInitialState();
  assert.equal(layersEqual(s.stream.program, s.stream.preview), true);
  assert.equal(layersEqual(s.stream.program, setPreview(s, "stream", { banpick: { visible: true } }).stream.preview), false);
});
