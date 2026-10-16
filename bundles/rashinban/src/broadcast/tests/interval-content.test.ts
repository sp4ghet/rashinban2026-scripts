import assert from "node:assert/strict";
import test from "node:test";
import { defaultInterval, updateContent, timerCommand, countdownText, restoreInterval, parseJstDateTime } from "../../interval/state.ts";
import { registerInterval } from "../../extension/interval.ts";

test("countdown uses a deadline, survives reload, and stays at zero after expiry", () => {
  const start = timerCommand(defaultInterval(), { action: "start", durationSeconds: 90 }, 1000);
  assert.equal(countdownText(start.timer, 1000), "01:30");
  assert.equal(countdownText(restoreInterval(JSON.parse(JSON.stringify(start))).timer, 61500), "00:30");
  assert.equal(countdownText(start.timer, 999999999), "00:00");
  assert.equal(countdownText(defaultInterval().timer, 1000), "");
});

test("pause and resume preserve remaining time while clear hides the timer", () => {
  const start = timerCommand(defaultInterval(), { action: "start", durationSeconds: 90 }, 1000);
  const pause = timerCommand(start, { action: "pause" }, 11000);
  assert.equal(countdownText(pause.timer, 999999), "01:20");
  const resume = timerCommand(pause, { action: "resume" }, 200000);
  assert.equal(countdownText(resume.timer, 201000), "01:19");
  assert.equal(countdownText(timerCommand(resume, { action: "clear" }, 202000).timer, 202000), "");
  assert.deepEqual(timerCommand(pause, { action: "pause" }, 999999), pause);
});

test("scheduled times explicitly use JST, including midnight, and never roll forward", () => {
  const deadline = parseJstDateTime("2026-10-25T00:05");
  assert.equal(deadline, Date.parse("2026-10-24T15:05:00Z"));
  const state = timerCommand(defaultInterval(), { action: "startAt", endsAtMs: deadline }, deadline - 3600000);
  assert.equal(countdownText(state.timer, deadline - 3600000), "1:00:00");
  assert.equal(countdownText(state.timer, deadline + 86400000), "00:00");
  assert.throws(() => parseJstDateTime("2026-02-30T12:00"));
  assert.throws(() => parseJstDateTime("nonsense"));
  assert.throws(() => timerCommand(state, { action: "startAt", endsAtMs: deadline }, deadline + 1));
});

test("content updates validate matches without resetting a running timer", () => {
  const state = timerCommand(defaultInterval(), { action: "start", durationSeconds: 600 }, 1000);
  const content = { title: " FINALS ", upcomingLabel: "COMING UP", countdownLabel: "再開まで", matches: [
    { label: "準決勝", playerOne: "しいな", playerTwo: "EURYA" },
  ] };
  const saved = updateContent(state, content);
  assert.equal(saved.content.title, "FINALS");
  assert.deepEqual(saved.timer, state.timer);
  content.matches[0]!.playerOne = "changed";
  assert.equal(saved.content.matches[0]!.playerOne, "しいな");
  assert.throws(() => updateContent(state, { ...content, matches: Array(5).fill(content.matches[0]) }));
  assert.throws(() => updateContent(state, { ...content, title: "x".repeat(41) }));
  assert.throws(() => updateContent(state, { ...content, matches: [{ label: "", playerOne: "A", playerTwo: "" }] }));
});

test("invalid timer commands and corrupt saved state fail safely", () => {
  for (const durationSeconds of [0, -1, NaN, Infinity, "60", 86401]) {
    assert.throws(() => timerCommand(defaultInterval(), { action: "start", durationSeconds }, 1000));
  }
  assert.throws(() => timerCommand(defaultInterval(), { action: "wat" }, 1000));
  assert.throws(() => timerCommand(defaultInterval(), null, 1000));
  assert.deepEqual(restoreInterval({ content: {}, timer: { endsAtMs: "bad", remainingMs: -4 } }), defaultInterval());
});

test("dashboard messages publish persisted interval state and reject invalid writes atomically", () => {
  const handlers = new Map<string, Function>();
  const rep = { value: undefined as unknown };
  const nodecg = {
    Replicant: (_name: string, options: { defaultValue: unknown }) => { rep.value ??= options.defaultValue; return rep; },
    listenFor: (name: string, callback: Function) => handlers.set(name, callback),
  };
  registerInterval(nodecg as never);
  let error: unknown;
  const ack = (err: unknown) => { error = err; };
  const before = structuredClone(rep.value);
  handlers.get("interval:timer")!({ action: "start", durationSeconds: -1 }, ack);
  assert.ok(error instanceof Error);
  assert.deepEqual(rep.value, before);
  handlers.get("interval:timer")!({ action: "start", durationSeconds: 120 }, ack);
  assert.equal(error, null);
  assert.equal(countdownText((rep.value as ReturnType<typeof defaultInterval>).timer, Date.now()), "02:00");
  const persisted = structuredClone(rep.value);
  registerInterval(nodecg as never);
  assert.deepEqual(rep.value, persisted);
});
