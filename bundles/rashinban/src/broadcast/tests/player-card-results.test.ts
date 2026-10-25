import assert from "node:assert/strict";
import test from "node:test";
import { playerCardResults, playerCardDay1Results } from "../player-card-results.ts";
import type { BracketSet, StartggBracket } from "../../startgg/types.ts";
import { emptyMatch, resolveMatch } from "../../match/state.ts";
import { rowToProfile } from "../../sheet/players.ts";

const now = Date.parse("2026-10-12T05:00:00Z");
const player = resolveMatch({ ...emptyMatch(), left: { ...emptyMatch().left, entrantId: 10, name: "Player" } }, []).left;
function set(id: number, time: string, patch: Partial<BracketSet> = {}): BracketSet {
  return { id, groupId: 1, phaseId: 1, identifier: String(id), round: id, side: "winners", roundText: `Top ${128 / 2 ** id}`,
    state: "completed", stateCode: 3, winnerEntrantId: 10, loserEntrantId: 20, displayScore: null, totalGames: 2,
    wPlacement: null, lPlacement: null, startedAt: null, completedAt: Date.parse(time) / 1000, streamName: null,
    slots: [{ index: 0, entrantId: 10, score: 2, seedNum: null, prereq: null, placement: null },
      { index: 1, entrantId: 20, score: 0, seedNum: null, prereq: null, placement: null }], ...patch };
}
function bracket(sets: BracketSet[]): StartggBracket {
  return { fetchedAt: now, event: null, phases: [], groups: {}, streamQueue: [],
    entrants: { 10: { id: 10, name: "Player", tag: "Player", prefix: null, initialSeedNum: null }, 20: { id: 20, name: "Sponsor | Opponent", tag: "Opponent", prefix: "Sponsor", initialSeedNum: null } },
    sets: Object.fromEntries(sets.map(s => [s.id, s])) };
}

test("both card sizes select the newest games across dates, even for an old tournament", () => {
  const other = set(9, "2026-05-09T02:00:00Z"); other.slots[0]!.entrantId = 30;
  const bye = set(10, "2026-05-10T02:00:00Z"); bye.slots[1]!.entrantId = null;
  const b = bracket([set(3, "2026-05-03T02:00:00Z"), set(1, "2026-05-01T02:00:00Z"),
    set(6, "2026-05-06T02:00:00Z"), set(2, "2026-05-02T02:00:00Z"),
    set(5, "2026-05-05T02:00:00Z"), set(4, "2026-05-04T02:00:00Z"), other, bye]);
  assert.deepEqual(playerCardResults(b, player, [], null, 5, now).rows.map(r => r.id), [6, 5, 4, 3, 2]);
  assert.deepEqual(playerCardResults(b, player, [], null, 3, now).rows.map(r => r.id), [6, 5, 4]);
});

test("equally timed games have stable newest-first ordering", () => {
  const b = bracket([set(1, "2026-05-01T02:00:00Z"), set(3, "2026-05-01T02:00:00Z"), set(2, "2026-05-01T02:00:00Z")]);
  assert.deepEqual(playerCardResults(b, player, [], null, 5, now).rows.map(r => r.id), [3, 2, 1]);
});

test("scores follow the selected player and opponent names use the directory", () => {
  const b = bracket([set(1, "2026-10-11T02:00:00Z", { winnerEntrantId: 20, loserEntrantId: 10,
    slots: [{ index: 0, entrantId: 20, score: 2, seedNum: null, prereq: null, placement: null },
      { index: 1, entrantId: 10, score: 1, seedNum: null, prereq: null, placement: null }] })]);
  const opponent = rowToProfile({ startgg_entrant_id: "20", startgg_tag: "Opponent", name: "対戦相手" });
  assert.deepEqual(playerCardResults(b, player, [opponent], null, 5, now).rows[0],
    { id: 1, round: "Top 64", opponent: "対戦相手", score: "1–2", outcome: "loss" });
});

test("compact includes earlier days but excludes current, later, active, undated and bye sets", () => {
  const current = set(3, "2026-10-12T03:00:00Z", { startedAt: Date.parse("2026-10-12T02:00:00Z") / 1000 });
  const bye = set(6, "2026-10-11T02:00:00Z"); bye.slots[1]!.entrantId = null;
  const b = bracket([set(1, "2026-10-10T02:00:00Z"), set(2, "2026-10-11T02:00:00Z"), current,
    set(4, "2026-10-12T04:00:00Z"), set(5, "2026-10-11T02:00:00Z", { state: "active" }), bye,
    set(7, "2026-10-11T02:00:00Z", { completedAt: null }), set(8, "2026-10-13T02:00:00Z")]);
  assert.deepEqual(playerCardResults(b, player, [], 3, 3, now).rows.map(r => r.id), [2, 1]);
});

test("a sheet profile supplies the entrant ID for manually selected players", () => {
  const profile = rowToProfile({ startgg_entrant_id: "10", startgg_tag: "Player" });
  const side = { ...player, entrantId: null, profile };
  assert.equal(playerCardResults(bracket([set(1, "2026-10-11T02:00:00Z")]), side, [], null, 5, now).rows.length, 1);
});

test("manual tag-linked profiles resolve a unique bracket entrant without a numeric ID", () => {
  const profile = rowToProfile({ startgg_tag: " Ｐｌａｙｅｒ ", name: "表示名" });
  const side = { ...player, entrantId: null, profile };
  const b = bracket([set(1, "2026-10-11T02:00:00Z")]);
  b.entrants[10] = { id: 10, tag: "Player", name: "Team | Player", prefix: "Team", initialSeedNum: null };
  assert.equal(playerCardResults(b, side, [profile], null, 5, now).rows.length, 1);
  b.entrants[30] = { ...b.entrants[10], id: 30 };
  assert.equal(playerCardResults(b, side, [profile], null, 5, now).status, "unlinked");
});

test("exact entrant IDs take precedence over tag fallback", () => {
  const profile = rowToProfile({ startgg_tag: "Opponent", startgg_entrant_id: "10" });
  const side = { ...player, entrantId: null, profile };
  const b = bracket([set(1, "2026-10-11T02:00:00Z")]);
  assert.equal(playerCardResults(b, side, [profile], null, 5, now).rows[0]!.score, "2–0");
});

test("missing bracket and unlinked players have explicit availability states", () => {
  assert.equal(playerCardResults(null, player, [], null, 5, now).status, "unavailable");
  assert.equal(playerCardResults(bracket([]), { ...player, entrantId: null }, [], null, 5, now).status, "unlinked");
  assert.equal(playerCardResults(bracket([]), player, [], null, 5, now).status, "empty");
});

test("DQ results are labeled without negative scores and unknown scores stay unknown", () => {
  const dq = set(1, "2026-10-11T02:00:00Z"); dq.slots[1]!.score = -1;
  const unknown = set(2, "2026-10-11T03:00:00Z"); unknown.slots[0]!.score = null;
  assert.deepEqual(playerCardResults(bracket([dq, unknown]), player, [], null, 5, now).rows.map(r => r.score), ["—", "W–DQ"]);
});

test("a corrected sheet entrant ID replaces an obsolete saved selection for recent games", () => {
  const profile = rowToProfile({ geoguessr_player_uid: "64179ee2585e69f92ec514fc", startgg_entrant_id: "10", startgg_tag: "Player", name: "cocos" });
  const side = { ...player, uid: profile.geoguessrPlayerUid, entrantId: 22820766, profile };
  const b = bracket([set(1, "2026-10-11T02:00:00Z")]);
  assert.deepEqual(playerCardResults(b, side, [profile], null, 5, now).rows.map(row => row.id), [1]);
  assert.equal(side.entrantId, 22820766, "results lookup does not rewrite the selected match");
});

test("current sheet linkage repairs an obsolete ID copied into a localized profile", () => {
  const profile = rowToProfile({ geoguessr_player_uid: "64179ee2585e69f92ec514fc", startgg_entrant_id: "10", startgg_tag: "Player", name: "cocos" });
  const side = { ...player, uid: profile.geoguessrPlayerUid, entrantId: 22820766, profile: { ...profile, startggEntrantId: 22820766 } };
  assert.equal(playerCardResults(bracket([set(1, "2026-10-11T02:00:00Z")]), side, [profile], null, 5, now).status, "ready");
});

test("an entrant present in the bracket remains authoritative over a different sheet ID", () => {
  const profile = rowToProfile({ startgg_entrant_id: "20", startgg_tag: "Opponent" });
  const b = bracket([set(1, "2026-10-11T02:00:00Z")]);
  assert.equal(playerCardResults(b, { ...player, profile }, [], null, 5, now).rows[0]!.score, "2\u20130");
  b.sets[1]!.slots[0]!.entrantId = 30;
  assert.equal(playerCardResults(b, { ...player, profile }, [], null, 5, now).status, "empty", "having no results does not switch to another valid entrant");
});

test("an obsolete sheet ID can fall back to a unique current tag but not an ambiguous one", () => {
  const profile = rowToProfile({ startgg_entrant_id: "22820766", startgg_tag: "Player" });
  const side = { ...player, entrantId: null, profile };
  const b = bracket([set(1, "2026-10-11T02:00:00Z")]);
  assert.equal(playerCardResults(b, side, [profile], null, 5, now).status, "ready");
  b.entrants[30] = { ...b.entrants[10]!, id: 30 };
  assert.equal(playerCardResults(b, side, [profile], null, 5, now).status, "unlinked");
});
function day1Bracket(sets: BracketSet[]): StartggBracket {
  return { ...bracket(sets), phases: [
    { id: 1, name: "DAY 1", order: 1, groupIds: [1], bracketType: null, groupCount: 1, numSeeds: null, state: null },
    { id: 2, name: "DAY 2", order: 2, groupIds: [2], bracketType: null, groupCount: 1, numSeeds: null, state: null },
  ] };
}

test("Day 1 records include every eligible match, independent of the five recent matches", () => {
  const sets = Array.from({ length: 8 }, (_, i) => set(i + 1, "2026-10-11T02:00:00Z"));
  sets[7]!.winnerEntrantId = 20;
  sets[7]!.slots[0]!.score = 0; sets[7]!.slots[1]!.score = 2;
  const day2 = set(20, "2026-10-12T02:00:00Z", { groupId: 2, phaseId: 2 });
  const result = playerCardDay1Results(day1Bracket([...sets, day2]), player, [], null, now);
  assert.deepEqual(result.setRecord, { wins: 7, losses: 1, percent: "87.5%" });
  assert.deepEqual(result.gameRecord, { wins: 14, losses: 2, percent: "87.5%" });
});

test("Day 1 records use the corrected sheet identity and exclude current and future matches", () => {
  const profile = rowToProfile({ startgg_entrant_id: "10", startgg_tag: "Player", geoguessr_player_uid: "64179ee2585e69f92ec514fc" });
  const side = { ...player, uid: profile.geoguessrPlayerUid, entrantId: 999, profile: { ...profile, startggEntrantId: 999 } };
  const b = day1Bracket([set(1, "2026-10-10T02:00:00Z"), set(2, "2026-10-11T02:00:00Z"), set(3, "2026-10-12T02:00:00Z")]);
  assert.deepEqual(playerCardDay1Results(b, side, [profile], 2, now).setRecord, { wins: 1, losses: 0, percent: "100.0%" });
  assert.equal(playerCardDay1Results(null, side, [profile], null, now).status, "unavailable");
  assert.equal(playerCardDay1Results(b, { ...player, entrantId: null }, [], null, now).status, "unlinked");
});
