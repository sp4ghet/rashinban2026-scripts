import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import type NodeCG from "@nodecg/types";
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
      Object.defineProperty(rep, "value", { get: () => stored, set(next) { stored = next; rep!.emit("change", next); } });
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

test("Companion routes cut the stream program directly and take/revert per output", async () => {
  const a = app();
  const server = a.http.listen(0);
  const port = (server.address() as AddressInfo).port;
  const post = async (path: string) => {
    const res = await fetch(`http://127.0.0.1:${port}/rashinban${path}`, { method: "POST" });
    return { status: res.status, body: await res.json() };
  };
  try {
    assert.equal((await post("/banpick/toggle")).body.banpick.visible, true);
    assert.equal(a.state().stream.program.banpick.visible, true);
    assert.equal(a.state().stream.preview.banpick.visible, false);
    assert.equal((await post("/playercards/show")).body.playerCards.visible, true);
    assert.equal((await post("/playercards/flip")).body.playerCards.page, "stats");
    assert.deepEqual((await post("/casters/2/show")).body.casters.slots, [false, true]);
    assert.deepEqual((await post("/casters/2/toggle")).body.casters.slots, [false, false]);
    a.message(BROADCAST_MESSAGES.setPreview, { output: "led", patch: { presenter: { visible: true } } });
    assert.equal((await post("/broadcast/led/take")).body.presenter.visible, true);
    assert.equal(a.state().led.program.presenter.visible, true);
    assert.equal((await post("/broadcast/led/revert")).status, 200);
    assert.equal((await post("/broadcast/radio/take")).status, 400);
  } finally {
    server.close();
  }
});
