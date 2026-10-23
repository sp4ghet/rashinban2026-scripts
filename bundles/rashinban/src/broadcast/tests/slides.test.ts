import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, setPreview, take, revertPreview, swap, clearPreview, withDefaults } from "../state.ts";
import { controlRows, patchAt, rowDirty } from "../switcher-model.ts";

test("old stream state gains hidden slides without changing other outputs", () => {
  const state = withDefaults({ stream: { program: { interval: { visible: true } } } });
  assert.deepEqual((state.stream.program as any).slides, { visible: false, mode: "day1-opening", index: 0 });
  assert.equal(state.stream.program.interval.visible, true);
  assert.ok(!controlRows("en").some(row => row.id === "slides"));
  assert.ok(!controlRows("led").some(row => row.id === "slides"));
});

test("Day 1 ending stages the bracket and the following sponsor slide hides it only on TAKE", () => {
  const initial = createInitialState();
  const staged = setPreview(initial, "stream", patchAt(["slides", "mode"], "day1-ending", initial.stream.preview));
  assert.equal(staged.stream.preview.bracket.visible, true);
  assert.equal(staged.stream.program.bracket.visible, false);
  const live = take(staged, "stream");
  const next = setPreview(live, "stream", patchAt(["slides", "index"], 1, live.stream.preview));
  assert.equal(next.stream.preview.bracket.visible, false);
  assert.equal(next.stream.program.bracket.visible, true);
  assert.equal((next.stream.preview as any).slides.visible, true);
  assert.equal(take(next, "stream").stream.program.bracket.visible, false);
  assert.deepEqual(next.led, initial.led);
  assert.deepEqual(next.en, initial.en);
  assert.deepEqual(revertPreview(next, "stream").stream.preview, live.stream.program);
  assert.deepEqual(swap(next, "stream").stream.program, next.stream.preview);
});

test("fullscreen selection and Clear hide slides but retain the selected cue", () => {
  let state = createInitialState();
  state = setPreview(state, "stream", patchAt(["slides", "index"], 2, state.stream.preview));
  assert.equal((state.stream.preview as any).slides.visible, true);
  const cleared = clearPreview(state, "stream");
  assert.equal((cleared.stream.preview as any).slides.visible, false);
  assert.equal((cleared.stream.preview as any).slides.index, 2);
  for (const scene of ["interval", "bracket"]) {
    const selected = setPreview(state, "stream", patchAt([scene, "visible"], true, state.stream.preview));
    assert.equal((selected.stream.preview as any).slides.visible, false);
  }
});

test("slide validation rejects invalid modes and indices and repairs stale persisted cues", () => {
  for (const patch of [{ mode: "bad" }, { index: -1 }, { index: 0.5 }, { index: "1" }, { index: 9999 }]) {
    assert.throws(() => setPreview(createInitialState(), "stream", { slides: patch } as any));
  }
  const state = withDefaults({ stream: { preview: { slides: { visible: true, mode: "day1-ending", index: 100 } } } });
  assert.deepEqual((state.stream.preview as any).slides, { visible: false, mode: "day1-ending", index: 0 });
});

test("Slides row exposes all six modes and marks a new cue dirty", () => {
  const row = controlRows("stream").find(row => row.id === "slides");
  assert.ok(row);
  const mode = row.controls.find(control => control.path[1] === "mode");
  assert.ok(mode?.kind === "select");
  assert.deepEqual(mode.options.map(option => option[1]), [
    "DAY 1 OPENING", "DAY 2 OPENING", "DAY 1 ENDING", "DAY 2 ENDING", "2 SPONSORS", "1 SPONSOR",
  ]);
  const state = createInitialState();
  const next = setPreview(state, "stream", patchAt(["slides", "index"], 1, state.stream.preview));
  assert.equal(rowDirty(row, next.stream.preview, state.stream.preview), true);
});
