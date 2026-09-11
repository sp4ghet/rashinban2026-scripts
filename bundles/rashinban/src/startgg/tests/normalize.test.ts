import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { groupSets, liveSets, normalizeEvent, normalizePhaseGroup, sideOf } from "../normalize.ts";
import { normalizeEventSlug, tournamentSlugFromEvent } from "../queries.ts";
import type { RawEvent, RawPhaseGroup, RawStreamQueueEntry } from "../types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const samples = path.resolve(here, "../../../../../docs/startgg/samples");
const load = <T>(name: string): T => JSON.parse(readFileSync(path.join(samples, name), "utf8")).data as T;

const top8 = load<{ phaseGroup: RawPhaseGroup }>("evo-japan-2026-sf6-finals-top8.json").phaseGroup;
const top24 = load<{ phaseGroup: RawPhaseGroup }>("evo-japan-2026-sf6-semifinals-top24.json").phaseGroup;
const pool = load<{ phaseGroup: RawPhaseGroup }>("evo-japan-2026-sf6-round4-pool-SFM201.json").phaseGroup;
const unstarted = load<{ phaseGroup: RawPhaseGroup }>("rashinban-2026-day1-pool1-unstarted.json").phaseGroup;
const rashinbanEvent = load<{ event: RawEvent }>("rashinban-2026-event.json").event;
const emptyQueue = load<{ tournament: { streamQueue: RawStreamQueueEntry[] | null } }>("rashinban-2026-stream-queue.json").tournament.streamQueue;

test("top 8: rounds, sides, and round depth", () => {
  const { group, sets } = normalizePhaseGroup(top8);
  assert.equal(sets.length, 10);
  assert.equal(group.winnersRounds, 3); // WSF, WF, GF
  assert.equal(group.losersRounds, 6);
  assert.deepEqual(
    sets.filter((s) => s.side === "grand").map((s) => s.roundText),
    ["Grand Final"],
  );
  assert.equal(sets.filter((s) => s.side === "winners").length, 3);
  assert.equal(sets.filter((s) => s.side === "losers").length, 6);
  assert.ok(sets.every((s) => s.state === "completed"));
});

test("top 8: losers round 1 slots point at sets from the previous phase", () => {
  const { sets } = normalizePhaseGroup(top8);
  const lr1 = sets.filter((s) => s.roundText === "Losers Round 1");
  assert.equal(lr1.length, 2);
  for (const s of lr1) for (const slot of s.slots) assert.deepEqual([slot.prereq?.type, slot.prereq?.external], ["set", true]);
  const wf = sets.find((s) => s.roundText === "Winners Final")!;
  for (const slot of wf.slots) assert.deepEqual([slot.prereq?.type, slot.prereq?.external, slot.prereq?.placement], ["set", false, 1]);
  const wsf = sets.filter((s) => s.roundText === "Winners Semi-Final");
  for (const s of wsf) for (const slot of s.slots) assert.equal(slot.prereq?.type, "seed");
});

test("top 8: winner, loser, scores, and entrant names", () => {
  const { sets, entrants } = normalizePhaseGroup(top8);
  const gf = sets.find((s) => s.side === "grand")!;
  const byId = Object.fromEntries(entrants.map((e) => [e.id, e]));
  assert.equal(byId[gf.winnerEntrantId!]!.name, "ZETA | Yamaguchi");
  assert.equal(byId[gf.loserEntrantId!]!.name, "FLY | Punk");
  assert.deepEqual(gf.slots.map((s) => s.score), [3, 1]);
  assert.deepEqual([gf.wPlacement, gf.lPlacement], [1, 2]);
  const punk = entrants.find((e) => e.name === "FLY | Punk")!;
  assert.deepEqual([punk.tag, punk.prefix], ["Punk", "FLY"]);
  assert.equal(entrants.length, 8);
});

test("top 8: seeds carry their progression source", () => {
  const { group } = normalizePhaseGroup(top8);
  assert.equal(group.seeds.length, 8);
  assert.ok(group.seeds.every((s) => s.source?.phaseGroupIdentifier === "SFS205"));
  assert.deepEqual(group.progressionsOut, []);
});

test("pool: progressions out and mixed seed/set prerequisites in losers round 1", () => {
  const { group, sets } = normalizePhaseGroup(pool);
  assert.deepEqual(group.progressionsOut, [2, 3, 3]);
  assert.equal(group.seeds.length, 12);
  const lr1 = sets.filter((s) => s.roundText === "Losers Round 1");
  assert.equal(lr1.length, 4);
  for (const s of lr1) {
    assert.deepEqual(s.slots.map((x) => x.prereq?.type), ["seed", "set"]);
    assert.equal(s.slots[1]!.prereq?.external, true);
  }
});

test("top 24 group orders sets winners, grand, losers", () => {
  const b = normalizeEvent(null, [top24], null, 0);
  const ordered = groupSets(b, top24.id).map((s) => s.roundText);
  assert.equal(ordered[0], "Winners Quarter-Final");
  assert.equal(ordered.at(-1), "Losers Round 3");
  assert.equal(ordered.length, 20);
});

test("unstarted RASHINBAN pool and empty stream queue normalize to empty collections", () => {
  const b = normalizeEvent(rashinbanEvent, [unstarted], emptyQueue, 123);
  assert.equal(b.fetchedAt, 123);
  assert.equal(b.event?.name, "RASHINBAN 2026");
  assert.deepEqual(b.phases.map((p) => [p.name, p.groupIds.length]), [["DAY1（TOP64）", 4], ["DAY2（TOP8）", 1]]);
  assert.deepEqual(b.groups[unstarted.id]!.progressionsOut, [2, 2]);
  assert.deepEqual(b.groups[unstarted.id]!.setIds, []);
  assert.deepEqual(Object.keys(b.sets), []);
  assert.deepEqual(b.streamQueue, []);
  assert.deepEqual(liveSets(b), []);
});

test("stream queue sets not in any fetched group are still added", () => {
  const rawSet = { ...top8.sets!.nodes[0]!, id: 999, state: 2, phaseGroup: { id: 42, displayIdentifier: "X" } };
  const queue: RawStreamQueueEntry[] = [{ stream: { id: 1, streamName: "rashinban", streamSource: "TWITCH" }, sets: [rawSet] }];
  const b = normalizeEvent(null, [], queue, 0);
  assert.deepEqual(b.streamQueue, [{ streamName: "rashinban", streamSource: "TWITCH", setIds: [999] }]);
  assert.equal(b.sets[999]!.state, "active");
  assert.deepEqual(liveSets(b).map((s) => s.id), [999]);
});

test("side detection and slug helpers", () => {
  assert.equal(sideOf({ round: 3, fullRoundText: "Grand Final Reset" }), "grand");
  assert.equal(sideOf({ round: -2, fullRoundText: "Losers Round 2" }), "losers");
  assert.equal(sideOf({ round: 1, fullRoundText: "Winners Round 1" }), "winners");
  assert.equal(normalizeEventSlug("https://www.start.gg/tournament/rashinban-2026/event/rashinban-2026/brackets/1/2"), "tournament/rashinban-2026/event/rashinban-2026");
  assert.equal(normalizeEventSlug("tournament/a/events/b"), "tournament/a/event/b");
  assert.equal(tournamentSlugFromEvent("tournament/rashinban-2026/event/rashinban-2026"), "rashinban-2026");
});
