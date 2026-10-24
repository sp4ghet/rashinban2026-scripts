import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import type NodeCG from "@nodecg/types";
import { createInitialState } from "../../banpick/rules.ts";
import { registerBanPick } from "../../extension/banpick.ts";
import { registerBroadcast } from "../../extension/broadcast.ts";
import { BROADCAST_MESSAGES, REPLICANTS } from "../../types/replicants.ts";

type Handler = (data: unknown, ack?: (error: unknown, value?: unknown) => void) => void;
function fakeNodecg() {
  const replicants = new Map<string, EventEmitter & { value: any }>();
  const listeners = new Map<string, Handler>();
  const http = express();
  const nodecg = {
    Replicant(name: string, options: any = {}) {
      let rep = replicants.get(name);
      if (rep) return rep;
      let stored = options.defaultValue;
      rep = Object.assign(new EventEmitter(), {}) as EventEmitter & { value: any };
      Object.defineProperty(rep, "value", { configurable: true, get: () => stored, set(next) { stored = next; rep!.emit("change", next); } });
      replicants.set(name, rep);
      return rep;
    },
    listenFor(name: string, handler: Handler) { listeners.set(name, handler); },
    Router: express.Router,
    mount(route: string, router: express.Router) { http.use(route, router); },
    log: { info() {}, warn() {}, error() {} },
  } as unknown as NodeCG.ServerAPI;
  function message(name: string, data?: unknown) {
    let response = { error: undefined as unknown, value: undefined as unknown };
    listeners.get(name)?.(data, (error, value) => { response = { error, value }; });
    return response;
  }
  return { nodecg, replicants, message, http };
}
function app() {
  const fake = fakeNodecg();
  const router = express.Router();
  registerBroadcast(fake.nodecg, router);
  fake.nodecg.mount("/rashinban", router);
  const state = () => fake.replicants.get(REPLICANTS.broadcast)!.value;
  return { ...fake, state };
}

test("setPreview, take and revert go through the reducer and ack the new state", () => {
  const a = app();
  const edited = a.message(BROADCAST_MESSAGES.setPreview, { output: "stream", patch: { banpick: { visible: true } } });
  assert.equal(edited.error, null);
  assert.equal(a.state().stream.preview.banpick.visible, true);
  assert.equal(a.state().stream.program.banpick.visible, false);
  assert.equal(a.message(BROADCAST_MESSAGES.take, { output: "stream" }).error, null);
  assert.equal(a.state().stream.program.banpick.visible, true);
  a.message(BROADCAST_MESSAGES.setPreview, { output: "stream", patch: { banpick: { visible: false } } });
  assert.equal(a.message(BROADCAST_MESSAGES.revertPreview, { output: "stream" }).error, null);
  assert.equal(a.state().stream.preview.banpick.visible, true);
});

test("invalid payloads are rejected via the ack and leave state unchanged", () => {
  const a = app();
  const before = JSON.stringify(a.state());
  assert.ok(a.message(BROADCAST_MESSAGES.setPreview, { output: "stream", patch: { nope: 1 } }).error instanceof Error);
  assert.ok(a.message(BROADCAST_MESSAGES.take, { output: "radio" }).error instanceof Error);
  assert.ok(a.message(BROADCAST_MESSAGES.setPreview, "junk").error instanceof Error);
  assert.equal(JSON.stringify(a.state()), before);
});

test("swap exchanges both buses in one update and can restore the previous program", () => {
  for (const output of ["stream", "led"]) {
    const a = app();
    a.message(BROADCAST_MESSAGES.setPreview, { output, patch: { playerCards: { visible: true, page: "stats" } } });
    a.message(BROADCAST_MESSAGES.take, { output });
    a.message(BROADCAST_MESSAGES.setPreview, { output, patch: { playerCards: { visible: false }, banpick: { visible: true } } });
    const original = a.state();
    const before = structuredClone(original);
    let updates = 0;
    a.replicants.get(REPLICANTS.broadcast)!.on("change", () => updates++);
    const response = a.message("broadcast:swap", { output });
    assert.equal(response.error, null);
    assert.equal(updates, 1);
    assert.deepEqual(response.value, a.state());
    assert.deepEqual(a.state()[output].program, before[output].preview);
    assert.deepEqual(a.state()[output].preview, before[output].program);
    const other = output === "stream" ? "led" : "stream";
    assert.deepEqual(a.state()[other], before[other]);
    assert.deepEqual(original, before);
    assert.notEqual(a.state()[output].program.playerCards, original[output].preview.playerCards);
    assert.equal(a.message("broadcast:swap", { output }).error, null);
    assert.deepEqual(a.state(), before);
  }
});

test("clear preview hides every layer while preserving selections and program", () => {
  const a = app();
  a.message(BROADCAST_MESSAGES.setPreview, { output: "stream", patch: {
    slides: { visible: true, mode: "day2-opening", index: 2 },
    playerCameras: { left: true, right: true, relay: "other" },
    playerCards: { visible: true, page: "stats", player: "right", position: "right" },
    lowerThird: { visible: true, mode: "text", title: "Title", subtitle: "Subtitle", comingUp: true },
    casters: { slots: [true, true], center: true, names: { left: "Stephen", right: "Kai", center: "SD" } },
    interval: { visible: true }, bracket: { visible: true }, banpick: { visible: true },
  } });
  a.message(BROADCAST_MESSAGES.take, { output: "stream" });
  const original = a.state();
  const before = structuredClone(original);
  const response = a.message("broadcast:clearPreview", { output: "stream" });
  assert.equal(response.error, null);
  assert.deepEqual(response.value, a.state());
  assert.deepEqual(a.state().stream.preview, {
    slides: { visible: false, mode: "day2-opening", index: 2 },
    playerCameras: { left: false, right: false, relay: "other" },
    playerCards: { visible: false, page: "stats", player: "right", position: "right" },
    lowerThird: { visible: false, mode: "text", title: "Title", subtitle: "Subtitle", comingUp: true },
    casters: {
      slots: [false, false], center: false, names: { left: "Stephen", right: "Kai", center: "SD" },
      custom: { left: false, right: false, center: false },
      customNames: { left: "", right: "", center: "" },
      positions: { left: { x: 0, y: 0 }, right: { x: 0, y: 0 }, center: { x: 0, y: 0 } },
    },
    interval: { visible: false }, bracket: { visible: false }, banpick: { visible: false },
  });
  assert.deepEqual(a.state().stream.program, before.stream.program);
  assert.deepEqual(a.state().led, before.led);
  assert.deepEqual(original, before);
  const cleared = structuredClone(a.state());
  a.message("broadcast:clearPreview", { output: "stream" });
  assert.deepEqual(a.state(), cleared);
  a.message(BROADCAST_MESSAGES.revertPreview, { output: "stream" });
  assert.deepEqual(a.state(), before);
});

test("clear LED preview preserves card settings and leaves stream untouched", () => {
  const a = app();
  a.message(BROADCAST_MESSAGES.setPreview, { output: "led", patch: {
    playerCards: { visible: true, page: "compact" }, presenter: { visible: true },
    banpick: { visible: true }, bracket: { visible: true },
  } });
  a.message(BROADCAST_MESSAGES.take, { output: "led" });
  const before = structuredClone(a.state());
  assert.equal(a.message("broadcast:clearPreview", { output: "led" }).error, null);
  assert.deepEqual(a.state().led.preview, {
    playerCards: { visible: false, page: "compact", player: "left", position: "left" },
    presenter: { visible: false }, banpick: { visible: false }, bracket: { visible: false },
  });
  assert.deepEqual(a.state().led.program, before.led.program);
  assert.deepEqual(a.state().stream, before.stream);
});

test("swap and clear reject invalid outputs and payloads without changing either bus", () => {
  const a = app();
  const before = structuredClone(a.state());
  for (const name of ["broadcast:swap", "broadcast:clearPreview"]) {
    for (const payload of [null, "junk", {}, { output: "radio" }]) {
      assert.ok(a.message(name, payload).error instanceof Error);
      assert.deepEqual(a.state(), before);
    }
  }
});

test("Companion routes cut the stream program directly and take/revert per output", async () => {
  const a = app();
  const server = a.http.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const post = async (path: string) => {
    const res = await fetch(`http://127.0.0.1:${port}/rashinban${path}`, { method: "POST" });
    return { status: res.status, body: await res.json() };
  };
  try {
    assert.equal((await post("/banpick/toggle")).body.banpick.visible, true);
    assert.equal(a.state().stream.program.banpick.visible, true);
    assert.equal(a.state().stream.preview.banpick.visible, false);
    assert.equal(a.state().led.program.banpick.visible, false);
    assert.equal((await post("/playercards/show")).body.playerCards.visible, true);
    assert.equal((await post("/playercards/flip")).body.playerCards.page, "stats");
    assert.equal((await post("/playercards/compact")).body.playerCards.page, "compact");
    assert.equal((await post("/playercards/right")).body.playerCards.player, "right");
    assert.equal((await post("/playercards/left")).body.playerCards.player, "left");
    assert.equal((await post("/playercards/results")).body.playerCards.page, "stats");
    assert.deepEqual((await post("/casters/2/show")).body.casters.slots, [false, true]);
    assert.deepEqual((await post("/casters/2/toggle")).body.casters.slots, [false, false]);
    assert.equal((await post("/casters/3/show")).body.casters.center, true);
    assert.equal(a.state().stream.preview.casters.center, false);
    assert.equal((await post("/casters/3/toggle")).body.casters.center, false);
    assert.equal((await post("/casters/3/hide")).body.casters.center, false);
    a.message(BROADCAST_MESSAGES.setPreview, { output: "led", patch: { presenter: { visible: true } } });
    assert.equal((await post("/broadcast/led/take")).body.presenter.visible, true);
    assert.equal(a.state().led.program.presenter.visible, true);
    assert.equal((await post("/broadcast/led/revert")).status, 200);
    assert.equal((await post("/broadcast/radio/take")).status, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("an unexpected error inside a handler is acked as an internal error instead of thrown", () => {
  const a = app();
  const rep = a.replicants.get(REPLICANTS.broadcast)!;
  const stored = rep.value;
  Object.defineProperty(rep, "value", { configurable: true, get: () => stored, set() { throw new Error("boom"); } });
  let response: { error: unknown; value: unknown } | undefined;
  assert.doesNotThrow(() => { response = a.message(BROADCAST_MESSAGES.take, { output: "stream" }); });
  assert.ok(response!.error instanceof Error);
  assert.equal((response!.error as Error).message, "broadcast: internal error");
});

test("registerBanPick scrubs a persisted on-air flag and keeps the rest of the state", () => {
  const fake = fakeNodecg();
  const seeded = { ...createInitialState(), visible: true };
  const rep = fake.nodecg.Replicant(REPLICANTS.banPick, { defaultValue: seeded });
  registerBanPick(fake.nodecg, express.Router());
  assert.equal("visible" in (rep.value as object), false);
  const { visible: _visible, ...rest } = seeded;
  assert.deepEqual(rep.value, rest);
});

test("Ban & Pick pauses server-side and only an operator advance unlocks the next game", () => {
  const fake = fakeNodecg();
  registerBanPick(fake.nodecg, express.Router());
  for (const optionId of [1, 2, 3]) assert.equal(fake.message("banpick:act", { optionId }).error, null);
  assert.ok(fake.message("banpick:act", { optionId: 4 }).error instanceof Error);
  const advanced = fake.message("banpick:nextGame");
  assert.equal(advanced.error, null);
  assert.equal((advanced.value as any).game, 2);
  assert.equal(fake.message("banpick:act", { optionId: 4, player: "B" }).error, null);
  assert.ok(fake.message("banpick:act", { optionId: 5 }).error instanceof Error);
  assert.equal((fake.message("banpick:nextGame").value as any).game, 3);
  for (const optionId of [5, 6, 7, 8]) assert.equal(fake.message("banpick:act", { optionId }).error, null);
  assert.ok(fake.message("banpick:nextGame").error instanceof Error);
  const reset = fake.message("banpick:reset").value as any;
  assert.equal(reset.game, 1);
  assert.deepEqual(reset.actions, []);
});

test("Ban & Pick restores legacy stage progress on startup", () => {
  const fake = fakeNodecg();
  const { game: _, ...legacy } = createInitialState();
  legacy.actions = [
    { optionId: 1, player: "A", kind: "ban" },
    { optionId: 2, player: "B", kind: "ban" },
    { optionId: 3, player: "A", kind: "pick" },
    { optionId: 4, player: "B", kind: "pick" },
  ];
  const rep = fake.nodecg.Replicant(REPLICANTS.banPick, { defaultValue: legacy });
  registerBanPick(fake.nodecg, express.Router());
  assert.deepEqual(rep.value, { ...legacy, game: 2 });
  assert.ok(fake.message("banpick:act", { optionId: 5 }).error instanceof Error);
});

test("Companion Next game rejects premature advances and reports the new stage", async () => {
  const a = fakeNodecg();
  const router = express.Router();
  registerBanPick(a.nodecg, router);
  a.nodecg.mount("/rashinban", router);
  const server = a.http.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rashinban/banpick/next-game`;
  try {
    assert.equal((await fetch(url, { method: "POST" })).status, 409);
    for (const optionId of [1, 2, 3]) a.message("banpick:act", { optionId });
    const response = await fetch(url, { method: "POST" });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { step: 3, complete: false, game: 2, ready: false });
    assert.equal((await fetch(url, { method: "POST" })).status, 409);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
