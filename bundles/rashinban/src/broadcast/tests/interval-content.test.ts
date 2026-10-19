import assert from "node:assert/strict";
import test from "node:test";
import { defaultInterval, updateContent, timerCommand, countdownText, restoreInterval, nextJstTime, upcomingMatches } from "../../interval/state.ts";
import { emptyMatch } from "../../match/state.ts";
import { rowToProfile } from "../../sheet/players.ts";
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

test("time-only scheduling uses the next occurrence in JST and stores an absolute deadline", () => {
  const now = Date.parse("2026-10-24T14:05:00Z"); // 23:05 JST
  const deadline = nextJstTime("23:30", now);
  assert.equal(deadline, Date.parse("2026-10-24T14:30:00Z"));
  const state = timerCommand(defaultInterval(), { action: "startAtTime", time: "23:30" }, now);
  assert.equal(state.timer.endsAtMs, deadline);
  assert.equal(countdownText(state.timer, now), "25:00");
  assert.equal(countdownText(restoreInterval(state).timer, deadline + 86400000), "00:00", "expired timers do not repeat tomorrow");
  assert.throws(() => timerCommand(state, { action: "startAt", endsAtMs: deadline }, deadline + 1), "absolute scheduling still rejects past dates");
});

test("time-only scheduling handles midnight, past times and the JST date boundary", () => {
  const evening = Date.parse("2026-10-24T14:50:00Z"); // 23:50 JST
  assert.equal(nextJstTime("00:05", evening), Date.parse("2026-10-24T15:05:00Z"));
  assert.equal(nextJstTime("23:45", evening), Date.parse("2026-10-25T14:45:00Z"));
  assert.equal(nextJstTime("23:50", evening), evening + 86400000);
  const morning = Date.parse("2026-10-24T16:00:30Z"); // Oct 25 01:00 JST
  assert.equal(nextJstTime("01:15", morning), Date.parse("2026-10-24T16:15:00Z"));
  assert.equal(nextJstTime("00:00", Date.parse("2026-12-31T14:59:00Z")), Date.parse("2026-12-31T15:00:00Z"));
  for (const time of ["", "24:00", "12:60", "9:05", "12:30:20", "2026-10-25T12:00", null, 1230]) {
    assert.throws(() => timerCommand(defaultInterval(), { action: "startAtTime", time }, evening));
  }
});

test("content updates validate matches without resetting a running timer", () => {
  const state = timerCommand(defaultInterval(), { action: "start", durationSeconds: 600 }, 1000);
  const content = { title: " FINALS ", upcomingLabel: "COMING UP", countdownLabel: "再開まで", matches: [
    { label: "準決勝", playerOne: "しいな", playerTwo: "EURYA" },
  ] };
  const saved = updateContent(state, content);
  assert.equal(saved.content.title, "FINALS");
  assert.deepEqual(saved.content, { title: "FINALS", upcomingLabel: "COMING UP", matchSource: "manual", matches: [
    { playerOne: "しいな", playerTwo: "EURYA" },
  ] }, "discard legacy countdown and round labels");
  assert.deepEqual(restoreInterval({ ...state, content }).content, saved.content, "old saved labels must not return after reload");
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


test("Interval can follow Next Match without overwriting its manual list or countdown", () => {
  const manual = updateContent(defaultInterval(), { title: "BREAK", upcomingLabel: "UP NEXT", matches: [
    { playerOne: "Manual A", playerTwo: "Manual B" },
  ] });
  assert.equal(manual.content.matchSource, "manual", "legacy saved lists remain manual");
  const running = timerCommand(manual, { action: "start", durationSeconds: 600 }, 1000);
  const linked = updateContent(running, { ...manual.content, matchSource: "next" });
  const next = emptyMatch();
  next.left.tag = "Alpha";
  next.right.tag = "Beta";
  const profiles = [rowToProfile({ name: "ALPHA DISPLAY", startgg_tag: "Alpha" })];
  assert.deepEqual(upcomingMatches(linked.content, next, profiles), [{ playerOne: "ALPHA DISPLAY", playerTwo: "Beta" }]);
  assert.deepEqual(linked.timer, running.timer);
  assert.deepEqual(linked.content.matches, manual.content.matches, "retain manual list while linked");
  assert.deepEqual(upcomingMatches(manual.content, next, profiles), manual.content.matches);
  next.left.tag = "Gamma";
  next.left.name = "G".repeat(160);
  assert.equal(upcomingMatches(linked.content, next, profiles)[0]?.playerOne, "G".repeat(160), "use full match names without the manual input limit");
  assert.equal(restoreInterval(JSON.parse(JSON.stringify(linked))).content.matchSource, "next");
  assert.throws(() => updateContent(linked, { ...linked.content, matchSource: "other" }));
});

test("linked Interval hides empty or incomplete Next Match, including after promotion", () => {
  const content = { ...defaultInterval().content, matchSource: "next" as const };
  assert.deepEqual(upcomingMatches(content, null, []), []);
  const next = emptyMatch();
  assert.deepEqual(upcomingMatches(content, next, []), []);
  next.left.name = "TBD";
  assert.deepEqual(upcomingMatches(content, next, []), []);
  next.right.tag = "Beta";
  assert.deepEqual(upcomingMatches(content, next, []), [{ playerOne: "TBD", playerTwo: "Beta" }], "a real player named TBD is still valid");
  assert.deepEqual(upcomingMatches(content, emptyMatch(), []), [], "promotion clears the staging slot");
});
