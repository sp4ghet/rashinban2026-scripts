import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, setPreview, take, withDefaults } from "../state.ts";
import { controlRows } from "../switcher-model.ts";

test("interval visibility is independent for each output and changes only on TAKE", () => {
  const initial = createInitialState();
  for (const output of ["stream", "led"] as const) {
    assert.equal(initial[output].program.interval?.visible, false);
    const preview = setPreview(initial, output, { interval: { visible: true } });
    assert.equal(preview[output].program.interval.visible, false);
    assert.equal(preview[output].preview.interval.visible, true);
    const live = take(preview, output);
    assert.equal(live[output].program.interval.visible, true);
    assert.equal(live[output === "stream" ? "led" : "stream"].program.interval.visible, false);
    assert.ok(controlRows(output).some(row => row.id === "interval"));
  }
});

test("old saved buses gain a hidden interval without losing existing visibility", () => {
  const state = withDefaults({ stream: { program: { banpick: { visible: true } } } });
  assert.equal(state.stream.program.banpick.visible, true);
  assert.equal(state.stream.program.interval?.visible, false);
  assert.equal(state.led.program.interval?.visible, false);
});
