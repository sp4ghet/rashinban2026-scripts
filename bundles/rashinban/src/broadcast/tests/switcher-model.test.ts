import assert from "node:assert/strict";
import test from "node:test";
import { controlRows, monitorUrls, patchAt, rowDirty, valueAt } from "../switcher-model.ts";
import { BROADCAST_OUTPUTS, createInitialState, defaultLayers, mergeLayers, setPreview } from "../state.ts";

test("patchAt builds a nested patch and valueAt reads one", () => {
  assert.deepEqual(patchAt(["lowerThird", "title"], "Hi", createInitialState().stream.preview), { lowerThird: { title: "Hi" } });
  assert.equal(valueAt({ a: { b: 2 } }, ["a", "b"]), 2);
  assert.equal(valueAt({ a: { b: 2 } }, ["a", "zzz"]), undefined);
  assert.equal(valueAt({ a: {} }, ["a", "constructor"]), undefined);
});

test("caster slot toggles patch the whole pair read from the current layers", () => {
  const layers = createInitialState().stream.preview;
  assert.deepEqual(patchAt(["casters", "slots", "1"], true, layers), { casters: { slots: [false, true] } });
  assert.deepEqual(layers.casters.slots, [false, false], "current layers are not mutated");
});

test("patchAt throws on an empty path", () => {
  assert.throws(() => patchAt([], true, createInitialState().stream.preview), /path/);
});

test("patchAt throws when an index segment does not point at an array", () => {
  assert.throws(() => patchAt(["casters", "titleBar", "0"], true, createInitialState().stream.preview), /array/);
  assert.throws(() => patchAt(["casters", "slots", "0"], true, {}), /array/);
});

test("rowDirty is true when any control in the row differs between preview and program", () => {
  const s = setPreview(createInitialState(), "stream", { playerCards: { page: "stats" } });
  const rows = controlRows("stream");
  const cards = rows.find((r) => r.id === "playerCards")!;
  const banpick = rows.find((r) => r.id === "banpick")!;
  assert.equal(rowDirty(cards, s.stream.preview, s.stream.program), true);
  assert.equal(rowDirty(banpick, s.stream.preview, s.stream.program), false);
});

test("led rows expose presenter visibility and no lower third", () => {
  const ids = controlRows("led").map((r) => r.id);
  assert.deepEqual(ids, ["presenter", "playerCards", "banpick"]);
});

test("every control path resolves to a defined value in the real layer shape", () => {
  const state = createInitialState();
  for (const output of BROADCAST_OUTPUTS) {
    for (const row of controlRows(output)) {
      for (const control of row.controls) {
        const value = valueAt(state[output].program, control.path);
        assert.notEqual(value, undefined, `${output}: ${row.id} -> ${control.path.join(".")}`);
      }
    }
  }
});

test("every control value round-trips through the state validator", () => {
  for (const output of BROADCAST_OUTPUTS) {
    const base = defaultLayers(output);
    for (const row of controlRows(output)) {
      for (const control of row.controls) {
        const candidates: unknown[] =
          control.kind === "select" ? control.options.map(([value]) => value) : control.kind === "text" ? ["x"] : [true, false];
        for (const value of candidates) {
          assert.doesNotThrow(
            () => mergeLayers(output, base, patchAt(control.path, value, base) as never),
            `${output}: ${row.id} -> ${control.path.join(".")} = ${String(value)}`,
          );
        }
      }
    }
  }
});

test("monitorUrls opens the info page on the channel and a presenter that never takes program", () => {
  for (const channel of ["preview", "program"] as const) {
    const stream = monitorUrls("stream", channel);
    assert.equal(stream.info, `/bundles/rashinban/graphics/info-stream.html?channel=${channel}`);
    assert.equal(stream.presenter, `/bundles/rashinban/graphics/presenter.html?role=preview&channel=${channel}`);
    const led = monitorUrls("led", channel);
    assert.equal(led.info, `/bundles/rashinban/graphics/info-led.html?channel=${channel}`);
    assert.equal(led.presenter, `/bundles/rashinban/graphics/presenter-led.html?channel=${channel}`);
    assert.ok(!led.presenter.includes("role="), "presenter-led.html implies the led role; no role param");
  }
});
