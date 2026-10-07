import assert from "node:assert/strict";
import test from "node:test";
import { withDefaults, withSheetDefaults } from "../casters.ts";

test("withDefaults keeps names and drops the old enabled flag", () => {
  const state = withDefaults({ slots: [{ name: "A", enabled: true } as any, undefined as any] });
  assert.deepEqual(state, { slots: [{ name: "A" }, { name: "" }] });
});

test("withSheetDefaults fills empty slots from sheet order", () => {
  const state = withSheetDefaults({ slots: [{ name: "" }, { name: "Z" }] }, [{ role: "r", name: "A", twitter: "" }, { role: "r", name: "B", twitter: "" }]);
  assert.deepEqual(state, { slots: [{ name: "A" }, { name: "Z" }] });
});

test("withDefaults repairs missing or malformed slots to two empty slots", () => {
  const empty = { slots: [{ name: "" }, { name: "" }] };
  assert.deepEqual(withDefaults(undefined), empty);
  assert.deepEqual(withDefaults({ slots: "x" } as any), empty);
  assert.deepEqual(withDefaults({ slots: [{ name: 42 } as any, { name: "B" }] }), { slots: [{ name: "" }, { name: "B" }] });
});

test("withSheetDefaults leaves slots empty when the sheet runs out of casters", () => {
  const state = withSheetDefaults({ slots: [{ name: "" }, { name: "" }] }, [{ role: "r", name: "A", twitter: "" }]);
  assert.deepEqual(state, { slots: [{ name: "A" }, { name: "" }] });
});
