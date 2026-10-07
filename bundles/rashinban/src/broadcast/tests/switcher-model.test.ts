import assert from "node:assert/strict";
import test from "node:test";
import { controlRows, patchAt, rowDirty, valueAt } from "../switcher-model.ts";
import { BROADCAST_OUTPUTS, createInitialState, setPreview } from "../state.ts";

test("patchAt builds a nested patch and valueAt reads one", () => {
  assert.deepEqual(patchAt(["lowerThird", "title"], "Hi"), { lowerThird: { title: "Hi" } });
  assert.equal(valueAt({ a: { b: 2 } }, ["a", "b"]), 2);
  assert.equal(valueAt({ a: { b: 2 } }, ["a", "zzz"]), undefined);
  assert.equal(valueAt({ a: {} }, ["a", "constructor"]), undefined);
});

test("caster slot toggles patch the whole pair", () => {
  assert.deepEqual(patchAt(["casters", "slots", "1"], true, [false, false]), { casters: { slots: [false, true] } });
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
