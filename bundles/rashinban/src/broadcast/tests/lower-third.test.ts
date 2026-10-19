import assert from "node:assert/strict";
import test from "node:test";
import { lowerThirdText } from "../lower-third.ts";
import { createInitialState, setPreview, take, revertPreview, withDefaults } from "../state.ts";

const match = { label: "Winners Final", left: { name: "Alice", handle: "alice" }, right: { name: "Bob", handle: "" } };

test("match mode names both players and uses the match label", () => {
  assert.deepEqual(lowerThirdText({ visible: true, mode: "match", title: "x", subtitle: "y", comingUp: false }, match), {
    title: "Winners Final",
    subtitle: "Alice VS Bob",
  });
});

test("match mode without a match falls back to placeholders", () => {
  assert.deepEqual(lowerThirdText({ visible: true, mode: "match", title: "", subtitle: "", comingUp: false }, null), {
    title: "",
    subtitle: "TBD VS TBD",
  });
});

test("score mode and coming-up visibility stay in preview until TAKE, and revert together", () => {
  const initial = createInitialState();
  const queued = setPreview(initial, "stream", { lowerThird: { visible: true, mode: "scores", comingUp: true } });
  assert.equal(queued.stream.program.lowerThird.visible, false);
  assert.equal(queued.stream.program.lowerThird.comingUp, false);
  const live = take(queued, "stream");
  assert.equal(live.stream.program.lowerThird.mode, "scores");
  assert.equal(live.stream.program.lowerThird.comingUp, true);
  assert.deepEqual(live.led, initial.led);
  const changed = setPreview(live, "stream", { lowerThird: { mode: "match", comingUp: false } });
  assert.deepEqual(revertPreview(changed, "stream").stream.preview.lowerThird, live.stream.program.lowerThird);
});

test("saved lower thirds gain a hidden coming-up block without losing operator text", () => {
  const old = { visible: true, mode: "text", title: "Break", subtitle: "Back soon" };
  const state = withDefaults({ stream: { program: { lowerThird: old } } });
  assert.deepEqual(state.stream.program.lowerThird, { ...old, comingUp: false });
});

test("text mode passes operator text through", () => {
  assert.deepEqual(lowerThirdText({ visible: true, mode: "text", title: "Break", subtitle: "Back in 10", comingUp: false }, match), {
    title: "Break",
    subtitle: "Back in 10",
  });
});
