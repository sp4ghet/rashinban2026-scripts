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
  assert.equal(s.led.program.bracket.visible, false);
});

test("LED bracket visibility stays in preview until TAKE and can be reverted", () => {
  const initial = createInitialState();
  const previewed = setPreview(initial, "led", { bracket: { visible: true } });
  assert.equal(previewed.led.preview.bracket.visible, true);
  assert.equal(previewed.led.program.bracket.visible, false);
  assert.equal(revertPreview(previewed, "led").led.preview.bracket.visible, false);
  const taken = take(previewed, "led");
  assert.equal(taken.led.program.bracket.visible, true);
  assert.deepEqual(taken.stream, initial.stream);
});

test("stream bracket is staged, reverted, and taken independently of LED", () => {
  const initial = createInitialState();
  const staged = setPreview(initial, "stream", { bracket: { visible: true } });
  assert.equal(staged.stream.preview.bracket.visible, true);
  assert.equal(staged.stream.program.bracket.visible, false);
  assert.equal(revertPreview(staged, "stream").stream.preview.bracket.visible, false);
  assert.equal(take(staged, "stream").stream.program.bracket.visible, true);
  assert.deepEqual(take(staged, "stream").led, initial.led);
});

test("older stream buses acquire a hidden bracket without losing interval state", () => {
  const old = { stream: { program: { interval: { visible: true } }, preview: { playerCards: { visible: true } } } };
  const restored = withDefaults(old);
  assert.equal(restored.stream.program.bracket.visible, false);
  assert.equal(restored.stream.preview.bracket.visible, false);
  assert.equal(restored.stream.program.interval.visible, true);
  assert.equal(restored.stream.preview.playerCards.visible, true);
});

test("persisted LED buses without a bracket layer keep their other settings and default it hidden", () => {
  const state = withDefaults({ led: {
    program: { playerCards: { visible: true, page: "compact" }, presenter: { visible: true } },
    preview: { banpick: { visible: true } },
  } });
  assert.equal(state.led.program.bracket.visible, false);
  assert.equal(state.led.preview.bracket.visible, false);
  assert.equal(state.led.program.playerCards.visible, true);
  assert.equal(state.led.program.playerCards.page, "compact");
  assert.equal(state.led.program.presenter.visible, true);
  assert.equal(state.led.preview.banpick.visible, true);
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
  assert.deepEqual(withDefaults({ stream: { program: { playerCards: { visible: true } } } }).stream.program.playerCards, { visible: true, page: "profile", player: "left", position: "left" });
  assert.deepEqual(withDefaults({ led: 5 }).led, createInitialState().led);
  assert.deepEqual(withDefaults({ stream: { preview: { lowerThird: { title: 42 } } } }).stream.preview.lowerThird.title, "");
});

test("layersEqual compares structurally", () => {
  const s = createInitialState();
  assert.equal(layersEqual(s.stream.program, s.stream.preview), true);
  assert.equal(layersEqual(s.stream.program, setPreview(s, "stream", { banpick: { visible: true } }).stream.preview), false);
});

test("caster names and the centered card stay in preview until TAKE and revert together", () => {
  const initial = createInitialState();
  const preview = setPreview(initial, "stream", { casters: {
    names: { left: "Stephen", right: "Kai", center: "SD" }, center: true, slots: [true, true],
  } });
  assert.deepEqual(initial.stream.program.casters.names, { left: "", right: "", center: "" });
  assert.deepEqual(preview.stream.program, initial.stream.program);
  assert.deepEqual(revertPreview(preview, "stream").stream.preview, initial.stream.program);
  const live = take(preview, "stream");
  assert.equal(live.stream.program.casters.names.center, "SD");
  assert.equal(live.stream.program.casters.center, true);
  assert.deepEqual(live.led, initial.led);
  const edited = setPreview(live, "stream", { casters: { names: { left: "SD" } } });
  assert.equal(edited.stream.program.casters.names.left, "Stephen");
  assert.equal(edited.stream.preview.casters.names.right, "Kai");
  assert.throws(() => setPreview(initial, "stream", { casters: { names: { left: 4 } } } as any), BroadcastError);
});

test("legacy caster selections migrate once on both buses without changing visibility", () => {
  const legacy = { slots: [{ name: "Stephen" }, { name: "Kai" }] };
  const raw = { stream: { program: { casters: { slots: [true, false] } }, preview: { casters: { slots: [false, true] } } } };
  const migrated = withDefaults(raw, legacy);
  assert.deepEqual(migrated.stream.program.casters.names, { left: "Stephen", right: "Kai", center: "" });
  assert.deepEqual(migrated.stream.preview.casters.names, migrated.stream.program.casters.names);
  assert.deepEqual(migrated.stream.program.casters.slots, [true, false]);
  assert.deepEqual(migrated.stream.preview.casters.slots, [false, true]);
  assert.equal(migrated.stream.program.casters.center, false);
  const cleared = setPreview(migrated, "stream", { casters: { names: { left: "" } } });
  assert.equal(withDefaults(cleared, legacy).stream.preview.casters.names.left, "");
});

test("patches cannot reach the spec through Object.prototype names", () => {
  const s = createInitialState();
  assert.throws(() => setPreview(s, "stream", JSON.parse('{"constructor": {}}')), BroadcastError);
  assert.throws(() => setPreview(s, "stream", JSON.parse('{"playerCards": {"constructor": {}}}')), BroadcastError);
  assert.throws(() => setPreview(s, "stream", JSON.parse('{"playerCards": {"toString": true}}')), BroadcastError);
  assert.throws(() => setPreview(s, "stream", JSON.parse('{"__proto__": {}}')), BroadcastError);
  assert.throws(() => cutProgram(s, "led", JSON.parse('{"hasOwnProperty": {}}')), BroadcastError);
});

test("setPreview accepts every enum value and text up to the limit", () => {
  const s = setPreview(createInitialState(), "stream", { playerCards: { page: "stats" }, lowerThird: { title: "x".repeat(120) } });
  assert.equal(s.stream.preview.playerCards.page, "stats");
  assert.equal(s.stream.preview.lowerThird.title.length, 120);
});

test("setPreview and take never mutate the input state", () => {
  const before = createInitialState();
  const snapshot = JSON.stringify(before);
  const previewed = setPreview(before, "stream", { banpick: { visible: true }, casters: { slots: [true, true] } });
  take(previewed, "stream");
  assert.equal(JSON.stringify(before), snapshot);
  assert.equal(previewed.stream.program.banpick.visible, false);
});

test("withDefaults treats null and arrays as empty state", () => {
  assert.deepEqual(withDefaults(null), createInitialState());
  assert.deepEqual(withDefaults([]), createInitialState());
});

test("BroadcastError is identifiable by name", () => {
  const error = new BroadcastError("boom");
  assert.equal(error.name, "BroadcastError");
  assert.ok(error instanceof Error);
});

test("card mode and player stay in preview until TAKE", () => {
  const s = setPreview(createInitialState(), "stream", { playerCards: { page: "compact", player: "right" } });
  assert.equal(s.stream.program.playerCards.page, "profile");
  assert.equal(s.stream.program.playerCards.player, "left");
  assert.equal(take(s, "stream").stream.program.playerCards.player, "right");
  assert.equal(take(s, "stream").stream.program.playerCards.page, "compact");
  assert.equal(s.led.program.playerCards.page, "profile");
});

test("persisted cards discard obsolete date and pagination while retaining the selected mode", () => {
  const state = withDefaults({ stream: { program: { playerCards: { visible: true, page: "stats", player: "right", resultsDate: "2026-05-02", resultsPage: 9 } } } });
  assert.deepEqual(state.stream.program.playerCards, { visible: true, page: "stats", player: "right", position: "right" });
  assert.deepEqual(take(revertPreview(state, "stream"), "stream").stream.program.playerCards, state.stream.program.playerCards);
});

test("card position is independent of the player and changes on TAKE", () => {
  const initial = createInitialState();
  let state = setPreview(initial, "stream", { playerCards: { position: "right" } });
  assert.equal(state.stream.preview.playerCards.player, "left");
  assert.equal(state.stream.program.playerCards.position, "left");
  assert.equal(state.stream.preview.playerCards.position, "right");
  state = take(state, "stream");
  assert.equal(state.stream.program.playerCards.position, "right");
  state = setPreview(state, "stream", { playerCards: { player: "right", position: "left" } });
  assert.equal(state.stream.program.playerCards.player, "left");
  state = take(state, "stream");
  assert.equal(state.stream.program.playerCards.player, "right");
  assert.equal(state.stream.program.playerCards.position, "left");
  const pending = setPreview(state, "stream", { playerCards: { position: "right" } });
  assert.equal(revertPreview(pending, "stream").stream.preview.playerCards.position, "left");
  assert.deepEqual(state.led, initial.led);
  assert.throws(() => setPreview(state, "stream", { playerCards: { position: "center" } } as any), BroadcastError);
});

test("legacy card positions follow the saved player once, then preserve the independent setting", () => {
  const legacy = { stream: {
    program: { playerCards: { player: "right" } },
    preview: { playerCards: { player: "left" } },
  } };
  const state = withDefaults(legacy);
  assert.equal(state.stream.program.playerCards.position, "right");
  assert.equal(state.stream.preview.playerCards.position, "left");
  const independent = cutProgram(state, "stream", { playerCards: { position: "left" } });
  assert.equal(withDefaults(independent).stream.program.playerCards.position, "left");
  assert.equal(withDefaults(independent).stream.program.playerCards.player, "right");
  assert.equal(Object.hasOwn(legacy.stream.program.playerCards, "position"), false);
});
