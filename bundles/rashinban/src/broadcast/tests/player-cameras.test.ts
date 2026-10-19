import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, setPreview, take, revertPreview, withDefaults } from "../state.ts";
import { controlRows, patchAt, rowDirty, type Control } from "../switcher-model.ts";

test("existing broadcasts gain hidden cameras without changing their overlays", () => {
  const state = withDefaults({ stream: { program: { banpick: { visible: true } } } });
  assert.deepEqual(state.stream.program.playerCameras, { left: false, right: false, relay: "main" });
  assert.deepEqual(state.stream.preview.playerCameras, { left: false, right: false, relay: "main" });
  assert.equal(state.stream.program.banpick.visible, true);
  assert.equal("playerCameras" in state.led.program, false);
});

test("camera selection and source stay in preview until TAKE and revert together", () => {
  const initial = createInitialState();
  const queued = setPreview(initial, "stream", { playerCameras: { left: true, relay: "stage-2" } });
  assert.deepEqual(queued.stream.program.playerCameras, { left: false, right: false, relay: "main" });
  const live = take(queued, "stream");
  assert.deepEqual(live.stream.program.playerCameras, { left: true, right: false, relay: "stage-2" });
  assert.deepEqual(live.led, initial.led);
  const edited = setPreview(live, "stream", { playerCameras: { left: false, right: true, relay: "main" } });
  assert.deepEqual(revertPreview(edited, "stream").stream.preview.playerCameras,
    { left: true, right: false, relay: "stage-2" });
});

test("camera controls stage either camera independently and flag the row as dirty", () => {
  const initial = createInitialState();
  const row = controlRows("stream").find(row => row.id === "playerCameras");
  assert.ok(row);
  for (const [label, side] of [["Player Camera 1", "left"], ["Player Camera 2", "right"]]) {
    const control: Control | undefined = row.controls.find(control => control.label === label);
    assert.ok(control);
    const queued: ReturnType<typeof createInitialState> = setPreview(initial, "stream", patchAt(control.path, true, initial.stream.preview));
    assert.equal(queued.stream.preview.playerCameras[side as "left" | "right"], true);
    assert.equal(queued.stream.preview.playerCameras[side === "left" ? "right" : "left"], false);
    assert.equal(rowDirty(row, queued.stream.preview, queued.stream.program), true);
  }
});

test("camera source rejects invalid relay names and repairs invalid saved settings", () => {
  for (const relay of ["", "stage 2", "../main", "a".repeat(65)]) {
    assert.throws(() => setPreview(createInitialState(), "stream", { playerCameras: { relay } }), /invalid value/);
  }
  assert.throws(() => setPreview(createInitialState(), "stream", { playerCameras: { left: "yes" } } as never));
  const state = withDefaults({ stream: { preview: { playerCameras: { left: true, right: "yes", relay: "bad room" } } } });
  assert.deepEqual(state.stream.preview.playerCameras, { left: true, right: false, relay: "main" });
});


test("selecting a fullscreen camera replaces the other only in preview", () => {
  const live = take(setPreview(createInitialState(), "stream", { playerCameras: { left: true } }), "stream");
  const queued = setPreview(live, "stream", patchAt(["playerCameras", "right"], true, live.stream.preview));
  assert.deepEqual(queued.stream.preview.playerCameras, { left: false, right: true, relay: "main" });
  assert.deepEqual(queued.stream.program.playerCameras, { left: true, right: false, relay: "main" });
  const back = setPreview(queued, "stream", patchAt(["playerCameras", "left"], true, queued.stream.preview));
  assert.deepEqual(back.stream.preview.playerCameras, { left: true, right: false, relay: "main" });
  const hidden = setPreview(back, "stream", patchAt(["playerCameras", "left"], false, back.stream.preview));
  assert.deepEqual(hidden.stream.preview.playerCameras, { left: false, right: false, relay: "main" });
});
