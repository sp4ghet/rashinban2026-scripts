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

test("stream caster dropdowns edit independent left, right, and center selections", () => {
  const row = controlRows("stream").find(row => row.id === "casters")!;
  const selectors = row.controls.filter(control => control.kind === "select");
  assert.deepEqual(selectors.map(control => control.path), [
    ["casters", "names", "left"], ["casters", "names", "right"], ["casters", "names", "center"],
  ]);
  for (const control of selectors) {
    const state = setPreview(createInitialState(), "stream", patchAt(control.path, "SD", createInitialState().stream.preview));
    assert.equal(rowDirty(row, state.stream.preview, state.stream.program), true);
    assert.equal(valueAt(state.stream.preview, control.path), "SD");
    assert.equal(valueAt(state.stream.program, control.path), "");
  }
  assert.ok(row.controls.some(control => control.kind === "toggle" && control.path[1] === "center"));
});

test("patchAt throws on an empty path", () => {
  assert.throws(() => patchAt([], true, createInitialState().stream.preview), /path/);
});

test("the caster pair control stages both side cards without changing center or names", () => {
  const row = controlRows("stream").find(row => row.id === "casters")!;
  const toggle = row.controls.find(control => control.kind === "toggle" && control.path[1] === "slots")!;
  let state = setPreview(createInitialState(), "stream", { casters: {
    slots: [true, false], center: true, names: { left: "Stephen", right: "Kai", center: "SD" },
  } });
  const before = structuredClone(state);
  state = setPreview(state, "stream", patchAt(toggle.path, false, state.stream.preview));
  assert.deepEqual(state.stream.preview.casters.slots, [false, false]);
  state = setPreview(state, "stream", patchAt(toggle.path, true, state.stream.preview));
  assert.deepEqual(state.stream.preview.casters.slots, [true, true]);
  assert.equal(state.stream.preview.casters.center, true);
  assert.deepEqual(state.stream.preview.casters.names, before.stream.preview.casters.names);
  assert.deepEqual(state.stream.program, before.stream.program);
  assert.equal(rowDirty(row, state.stream.preview, before.stream.preview), true);
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

test("led rows expose presenter and bracket visibility and no lower third", () => {
  const ids = controlRows("led").map((r) => r.id);
  assert.deepEqual(ids, ["presenter", "playerCards", "banpick", "bracket"]);
  assert.ok(controlRows("stream").some(r => r.id === "bracket"));
});

test("selecting a fullscreen stream scene replaces the other scene only in preview", () => {
  const initial = setPreview(createInitialState(), "stream", { interval: { visible: true } });
  const bracket = setPreview(initial, "stream", patchAt(["bracket", "visible"], true, initial.stream.preview));
  assert.equal(bracket.stream.preview.bracket.visible, true);
  assert.equal(bracket.stream.preview.interval.visible, false);
  assert.deepEqual(bracket.stream.program, initial.stream.program);
  const interval = setPreview(bracket, "stream", patchAt(["interval", "visible"], true, bracket.stream.preview));
  assert.equal(interval.stream.preview.interval.visible, true);
  assert.equal(interval.stream.preview.bracket.visible, false);
  assert.deepEqual(patchAt(["bracket", "visible"], false, bracket.stream.preview), { bracket: { visible: false } });
  assert.deepEqual(patchAt(["bracket", "visible"], true, initial.led.preview), { bracket: { visible: true } });
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

test("cards expose manual modes and separate stream-only player and position selectors", () => {
  const stream = controlRows("stream").find(r => r.id === "playerCards")!.controls;
  const led = controlRows("led").find(r => r.id === "playerCards")!.controls;
  const mode = stream.find(c => c.path[1] === "page");
  assert.ok(mode?.kind === "select");
  assert.deepEqual(mode.options.map(([value]) => value), ["profile", "stats", "compact"]);
  assert.ok(stream.some(c => c.path[1] === "player"));
  assert.ok(!led.some(c => c.path[1] === "player"));
  const position = stream.find(c => c.path[1] === "position");
  assert.ok(position?.kind === "select");
  assert.deepEqual(position.options, [["left", "Left"], ["right", "Right"]]);
  assert.ok(!led.some(c => c.path[1] === "position"));
  const state = setPreview(createInitialState(), "stream", { playerCards: { position: "left" } });
  assert.equal(rowDirty(controlRows("stream").find(r => r.id === "playerCards")!, state.stream.preview, state.stream.program), true);
  assert.ok(!stream.some(c => ["resultsDate", "resultsPage"].includes(c.path[1]!)));
});

test("monitorUrls opens the info page on the channel and a presenter that never takes program", () => {
  for (const channel of ["preview", "program"] as const) {
    const stream = monitorUrls("stream", channel);
    assert.equal(stream.info, `/bundles/rashinban/graphics/info-stream.html?channel=${channel}&cameraMode=placeholder`);
    assert.equal(stream.presenter, `/bundles/rashinban/graphics/presenter.html?role=preview&channel=${channel}`);
    const led = monitorUrls("led", channel);
    assert.equal(led.info, `/bundles/rashinban/graphics/info-led.html?channel=${channel}`);
    assert.equal(led.presenter, `/bundles/rashinban/graphics/presenter-led.html?channel=${channel}`);
    assert.ok(!led.presenter.includes("role="), "presenter-led.html implies the led role; no role param");
  }
});
