import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, setPreview, take, revertPreview, type BroadcastState } from "../state.ts";
import { patchAt } from "../switcher-model.ts";

const edit = (state: BroadcastState, path: readonly string[], value: unknown) =>
  setPreview(state, "stream", patchAt(path, value, state.stream.preview));

for (const side of ["left", "right"] as const) {
  test(`enabling the ${side} camera stages its matching card atomically until TAKE`, () => {
    const initial = setPreview(createInitialState(), "stream", { playerCards: { position: "right", page: "compact" } });
    const snapshot = structuredClone(initial);
    const queued = edit(initial, ["playerCameras", side], true);
    assert.deepEqual(queued.stream.preview.playerCards, { visible: true, player: side, position: side === "left" ? "right" : "left", page: "compact" });
    assert.deepEqual(queued.stream.preview.playerCameras,
      side === "left" ? { left: true, right: false, relay: "main" } : { left: false, right: true, relay: "main" });
    assert.deepEqual(queued.stream.program, initial.stream.program);
    assert.deepEqual(queued.led, initial.led);
    assert.deepEqual(initial, snapshot, "editing never mutates the input state");
    assert.deepEqual(revertPreview(queued, "stream").stream.preview, initial.stream.program);
    assert.deepEqual(take(queued, "stream").stream.program, queued.stream.preview);
  });

  test(`disabling the ${side} camera also hides its card without resetting its settings`, () => {
    const initial = setPreview(createInitialState(), "stream", {
      playerCameras: { [side]: true },
      playerCards: { visible: true, player: side, position: "right", page: "stats" },
    });
    const next = edit(initial, ["playerCameras", side], false).stream.preview;
    assert.deepEqual(next.playerCameras, { left: false, right: false, relay: "main" });
    assert.deepEqual(next.playerCards, { visible: false, player: side, position: "right", page: "stats" });
  });

  test(`the ${side} card visibility control toggles the matching camera too`, () => {
    const initial = setPreview(createInitialState(), "stream", { playerCards: { player: side } });
    const shown = edit(initial, ["playerCards", "visible"], true);
    assert.deepEqual(shown.stream.preview.playerCameras,
      side === "left" ? { left: true, right: false, relay: "main" } : { left: false, right: true, relay: "main" });
    assert.equal(shown.stream.preview.playerCards.visible, true);
    const hidden = edit(shown, ["playerCards", "visible"], false);
    assert.deepEqual(hidden.stream.preview.playerCameras, { left: false, right: false, relay: "main" });
    assert.equal(hidden.stream.preview.playerCards.visible, false);
  });
}

for (const visible of [true, false]) {
  test(`changing the card player keeps camera selection synchronized while visible=${visible}`, () => {
    const initial = setPreview(createInitialState(), "stream", {
      playerCards: { visible, player: "right", position: "right", page: "stats" },
      playerCameras: { right: visible, relay: "stage-2" },
    });
    const next = edit(initial, ["playerCards", "player"], "left").stream.preview;
    assert.deepEqual(next.playerCameras, { left: visible, right: false, relay: "stage-2" });
    assert.deepEqual(next.playerCards, { visible, player: "left", position: "right", page: "stats" });
  });
}

for (const via of ["camera", "card"] as const) {
  for (const [page, expectedPage] of [["stats", "profile"], ["compact", "compact"]] as const) {
    test(`${via} selection changes P1/Right/${page} to P2/Left/${expectedPage}`, () => {
      const initial = setPreview(createInitialState(), "stream", {
        playerCards: { visible: true, player: "left", position: "right", page },
        playerCameras: { left: true },
      });
      const next = via === "camera" ? edit(initial, ["playerCameras", "right"], true)
        : edit(initial, ["playerCards", "player"], "right");
      assert.deepEqual(next.stream.preview.playerCards, { visible: true, player: "right", position: "left", page: expectedPage });
      assert.deepEqual(next.stream.preview.playerCameras, { left: false, right: true, relay: "main" });
    });
  }

  test(`${via} selection defaults to P1 right/P2 left on swaps and retains same-player overrides`, () => {
    const transitions = [
      // Previous player, previous position, selected player, expected position.
      ["left", "left", "right", "left"],
      ["left", "right", "right", "left"],
      ["right", "left", "left", "right"],
      ["right", "right", "left", "right"],
      ["left", "left", "left", "left"],
      ["left", "right", "left", "right"],
      ["right", "left", "right", "left"],
      ["right", "right", "right", "right"],
    ] as const;
    for (const [player, position, selected, expectedPosition] of transitions) {
      for (const page of ["profile", "stats", "compact"] as const) {
        // The existing Page 2 -> Page 1 exception has its own test above.
        if (`${player}/${position}/${page}/${selected}` === "left/right/stats/right") continue;
        const initial = setPreview(createInitialState(), "stream", { playerCards: { visible: true, player, position, page } });
        const next = via === "camera" ? edit(initial, ["playerCameras", selected], true)
          : edit(initial, ["playerCards", "player"], selected);
        assert.deepEqual(next.stream.preview.playerCards, { visible: true, player: selected, position: expectedPosition, page },
          `${player}/${position}/${page} -> ${selected}`);
      }
    }
  });
}

test("changing card layout or relay does not change the linked visibility or player", () => {
  const initial = setPreview(createInitialState(), "stream", { playerCards: { visible: true, player: "right" }, playerCameras: { right: true } });
  const positioned = edit(initial, ["playerCards", "position"], "left");
  const paged = edit(positioned, ["playerCards", "page"], "compact");
  const sourced = edit(paged, ["playerCameras", "relay"], "stage-2");
  assert.deepEqual(sourced.stream.preview.playerCards, { visible: true, player: "right", position: "left", page: "compact" });
  assert.deepEqual(sourced.stream.preview.playerCameras, { left: false, right: true, relay: "stage-2" });
});

test("LED card controls do not gain camera settings or stream player defaults", () => {
  const initial = createInitialState();
  const shown = setPreview(initial, "led", patchAt(["playerCards", "visible"], true, initial.led.preview));
  assert.equal(shown.led.preview.playerCards.visible, true);
  assert.equal("playerCameras" in shown.led.preview, false);
  assert.deepEqual(shown.stream, initial.stream);
});
