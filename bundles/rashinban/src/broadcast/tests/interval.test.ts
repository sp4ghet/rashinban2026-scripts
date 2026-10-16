import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, setPreview, take, withDefaults } from "../state.ts";
import { controlRows } from "../switcher-model.ts";

test("Stream interval changes only on TAKE and leaves the legacy LED bus untouched", () => {
  const initial = createInitialState();
  assert.equal(initial.stream.program.interval?.visible, false);
  const preview = setPreview(initial, "stream", { interval: { visible: true } });
  assert.equal(preview.stream.program.interval.visible, false);
  assert.equal(preview.stream.preview.interval.visible, true);
  const live = take(preview, "stream");
  assert.equal(live.stream.program.interval.visible, true);
  assert.deepEqual(live.led, initial.led);
  assert.ok(controlRows("stream").some(row => row.id === "interval"));
  assert.ok(!controlRows("led").some(row => row.id === "interval"));
});

test("old saved buses gain a hidden interval without losing existing visibility", () => {
  const state = withDefaults({ stream: { program: { banpick: { visible: true } } } });
  assert.equal(state.stream.program.banpick.visible, true);
  assert.equal(state.stream.program.interval?.visible, false);
  assert.equal("interval" in state.led.program, false);
});
