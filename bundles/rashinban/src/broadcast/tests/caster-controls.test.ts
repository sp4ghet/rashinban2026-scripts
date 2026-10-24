import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, setPreview, take, revertPreview, withDefaults, type Patch, type StreamLayers } from "../state.ts";
import { patchAt, rowDirty, controlRows } from "../switcher-model.ts";

test("caster positions and custom names stay in the selected output's preview until TAKE", () => {
  const initial = createInitialState();
  const patch: Patch<StreamLayers> = { casters: {
    positions: { left: { x: -230, y: 440 }, center: { y: -600 } },
    custom: { left: true }, customNames: { left: "Guest" }, slots: [true, false],
  } };
  const staged = setPreview(initial, "stream", patch);
  assert.deepEqual(staged.stream.program, initial.stream.program);
  assert.deepEqual(staged.en, initial.en);
  assert.deepEqual(staged.led, initial.led);
  assert.deepEqual(staged.stream.preview.casters.positions.left, { x: -230, y: 440 });
  assert.deepEqual(staged.stream.preview.casters.positions.center, { x: 0, y: -600 });
  assert.equal(rowDirty(controlRows("stream").find(row => row.id === "casters")!, staged.stream.preview, initial.stream.program), true);
  assert.deepEqual(revertPreview(staged, "stream").stream.preview, initial.stream.program);
  const live = take(staged, "stream");
  assert.equal(live.stream.program.casters.customNames.left, "Guest");
  assert.deepEqual(withDefaults(live), live);
});

test("old caster settings retain their selection and acquire neutral positions and sheet mode", () => {
  const state = withDefaults({ stream: { program: { casters: { slots: [true, false], names: { left: "Caster" } } } } });
  const caster = state.stream.program.casters;
  assert.equal(caster.names.left, "Caster");
  assert.deepEqual(caster.positions, { left: { x: 0, y: 0 }, right: { x: 0, y: 0 }, center: { x: 0, y: 0 } });
  assert.deepEqual(caster.custom, { left: false, right: false, center: false });
});

test("invalid positions are rejected and corrupted persisted coordinates recover independently", () => {
  for (const [axis, value] of [["x", NaN], ["x", Infinity], ["x", 1921], ["x", -1921], ["y", 1081], ["y", -1081], ["y", "20"]]) {
    assert.throws(() => setPreview(createInitialState(), "stream", { casters: { positions: { left: { [axis as string]: value } } } } as any));
  }
  const state = withDefaults({ en: { preview: { casters: { positions: { left: { x: 100, y: "bad" } } } } } });
  assert.deepEqual(state.en.preview.casters.positions.left, { x: 100, y: 0 });
});

test("custom selection retains the sheet name and switching back restores sheet mode", () => {
  let state = setPreview(createInitialState(), "stream", { casters: { names: { left: "Caster" } } });
  state = setPreview(state, "stream", patchAt(["casters", "names", "left"], "\u0000custom", state.stream.preview));
  assert.equal(state.stream.preview.casters.custom.left, true);
  assert.equal(state.stream.preview.casters.names.left, "Caster");
  state = setPreview(state, "stream", patchAt(["casters", "names", "left"], "Caster", state.stream.preview));
  assert.equal(state.stream.preview.casters.custom.left, false);
});

test("the caster row marks position-only and source-only changes as staged", () => {
  const state = createInitialState();
  const row = controlRows("stream").find(row => row.id === "casters")!;
  for (const casters of [{ positions: { left: { x: 80 } } }, { custom: { center: true } }]) {
    const staged = setPreview(state, "stream", { casters });
    assert.equal(rowDirty(row, staged.stream.preview, staged.stream.program), true);
    const live = take(staged, "stream");
    assert.equal(rowDirty(row, live.stream.preview, live.stream.program), false);
  }
});
