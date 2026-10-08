import assert from "node:assert/strict";
import test from "node:test";
import { lowerThirdText } from "../lower-third.ts";

const match = { label: "Winners Final", left: { name: "Alice", handle: "alice" }, right: { name: "Bob", handle: "" } };

test("match mode names both players and uses the match label", () => {
  assert.deepEqual(lowerThirdText({ visible: true, mode: "match", title: "x", subtitle: "y" }, match), {
    title: "Alice vs Bob",
    subtitle: "Winners Final",
  });
});

test("match mode without a match falls back to placeholders", () => {
  assert.deepEqual(lowerThirdText({ visible: true, mode: "match", title: "", subtitle: "" }, null), {
    title: "TBD vs TBD",
    subtitle: "",
  });
});

test("text mode passes operator text through", () => {
  assert.deepEqual(lowerThirdText({ visible: true, mode: "text", title: "Break", subtitle: "Back in 10" }, match), {
    title: "Break",
    subtitle: "Back in 10",
  });
});
