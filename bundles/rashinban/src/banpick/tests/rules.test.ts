import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BanPickError,
  STEPS,
  applyAction,
  createInitialState,
  currentStep,
  deriveView,
  reset,
  undo,
  type BanPickState,
} from "../rules.ts";

/** Runs the procedure with a fixed option order. */
function play(order: number[]): BanPickState {
  return order.reduce((s, id) => applyAction(s, id), createInitialState());
}

test("step table matches rulebook 4.4.1", () => {
  assert.deepEqual(
    STEPS.map((s) => `${s.player}:${s.kind}${s.game ?? ""}`),
    ["A:ban", "B:ban", "A:pick1", "B:pick2", "B:ban", "A:ban", "A:ban", "B:ban"],
  );
});

test("nine default options in rulebook order", () => {
  const { options } = createInitialState();
  assert.equal(options.length, 9);
  assert.deepEqual(options.map((o) => o.id), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(options[8]!.map, "A Rural World");
});

test("actions record the acting player and kind from the step table", () => {
  const s = play([4, 7, 1]);
  assert.deepEqual(s.actions, [
    { player: "A", kind: "ban", optionId: 4 },
    { player: "B", kind: "ban", optionId: 7 },
    { player: "A", kind: "pick", optionId: 1 },
  ]);
  assert.deepEqual(currentStep(s), { player: "B", kind: "pick", game: 2 });
});

test("rejects reusing a banned or picked option", () => {
  const s = play([5]);
  assert.throws(() => applyAction(s, 5), BanPickError);
});

test("rejects unknown options and out-of-turn players", () => {
  const s = createInitialState();
  assert.throws(() => applyAction(s, 42), BanPickError);
  assert.throws(() => applyAction(s, 1, "B"), BanPickError);
  assert.doesNotThrow(() => applyAction(s, 1, "A"));
});

test("rejects actions after the procedure is complete", () => {
  const s = play([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(currentStep(s), null);
  assert.throws(() => applyAction(s, 9), BanPickError);
});

test("undo removes the last action; reset clears everything", () => {
  const s = play([1, 2, 3]);
  assert.equal(undo(s).actions.length, 2);
  assert.equal(undo(createInitialState()).actions.length, 0);
  assert.equal(reset(s).actions.length, 0);
});

test("derived view labels bans, picks, and the remaining game 3", () => {
  const view = deriveView(play([9, 8, 1, 4, 7, 6, 5, 3]));
  assert.equal(view.complete, true);
  assert.equal(view.step, null);
  const byId = (id: number) => view.options.find((v) => v.option.id === id)!;
  assert.deepEqual(byId(9), { option: byId(9).option, status: "banned", by: "A", stepIndex: 1 });
  assert.deepEqual(byId(1), { option: byId(1).option, status: "picked", by: "A", stepIndex: 3, game: 1 });
  assert.deepEqual(byId(4), { option: byId(4).option, status: "picked", by: "B", stepIndex: 4, game: 2 });
  assert.deepEqual(byId(2), { option: byId(2).option, status: "remaining", game: 3 });
  assert.deepEqual(view.games.map((g) => g?.option.id), [1, 4, 2]);
});

test("remaining option is not labelled until the procedure completes", () => {
  const view = deriveView(play([1, 2, 3, 4, 5, 6, 7]));
  assert.equal(view.complete, false);
  assert.equal(view.options.filter((v) => v.status === "open").length, 2);
  assert.deepEqual(view.games.map((g) => g?.option.id ?? null), [3, 4, null]);
});
