import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyMatch,
  resolveMatch,
  toSeries,
  swapMatch,
  parseMatch,
} from "../../match/state.ts";
import { applySnapshot } from "../../presenter/normalize.ts";
import { sample } from "../../presenter/tests/fixtures.ts";
import { advanceTimeline, DEFAULT_TIMING } from "../../presenter/timeline.ts";
import { project } from "../../presenter/projection.ts";
import { resultMapFrame } from "../../graphics/presenter/renderer.ts";
const blue = "65fc3453702bba73b4c0a398",
  red = "65fc3453702bba73b4c0a399";
const duel = {
  players: [
    { id: red, teamColor: "red" },
    { id: blue, teamColor: "blue" },
  ],
} as any;
test("venue defaults use team colors instead of personal profile UIDs or array order", () => {
  const match = emptyMatch();
  match.left.uid = "65fc3453702bba73b4c0a390";
  const series = toSeries(resolveMatch(match, []), duel);
  assert.equal(series.left.playerId, red);
  assert.equal(series.right.playerId, blue);
  assert.equal(match.left.uid, "65fc3453702bba73b4c0a390");
});
test("automatic mappings follow replacement accounts and clear without a duel", () => {
  const match = resolveMatch(emptyMatch(), []);
  assert.equal(
    toSeries(match, {
      players: [{ id: "replacement", teamColor: "red" }],
    } as any).left.playerId,
    "replacement",
  );
  assert.equal(toSeries(match, null).left.playerId, null);
});
test("explicit mapping stays selected but does not map a missing account", () => {
  const match = emptyMatch();
  match.gameMapping = { left: red, right: blue };
  assert.equal(toSeries(resolveMatch(match, []), duel).left.playerId, red);
  assert.equal(
    toSeries(resolveMatch(match, []), { players: [] } as any).left.playerId,
    null,
  );
  assert.equal(match.gameMapping.left, red);
});
test("swap keeps team bindings fixed and migration supplies red-left/blue-right defaults", () => {
  const match = emptyMatch();
  assert.deepEqual(swapMatch(match).gameMapping, {
    left: "red",
    right: "blue",
  });
  const old: any = { ...match };
  delete old.gameMapping;
  assert.deepEqual(parseMatch(old).gameMapping, { left: "red", right: "blue" });
});
test("duplicate effective accounts leave both sides unmapped", () => {
  const match = emptyMatch();
  match.gameMapping = { left: "blue", right: blue };
  const series = toSeries(resolveMatch(match, []), duel);
  assert.equal(series.left.playerId, null);
  assert.equal(series.right.playerId, null);
});


test("legacy automatic mapping is corrected without changing player info or wins", () => {
  const old = { ...emptyMatch(), schemaVersion: 1, gameMapping: { left: "blue", right: "red" } };
  old.left.name = "Red player"; old.left.wins = 1;
  old.right.name = "Blue player"; old.right.wins = 2;
  const snapshot = structuredClone(old);
  const migrated = parseMatch(old);
  const series = toSeries(resolveMatch(migrated, []), duel);
  assert.deepEqual([series.left.name, series.left.playerId, series.left.wins], ["Red player", red, 1]);
  assert.deepEqual([series.right.name, series.right.playerId, series.right.wins], ["Blue player", blue, 2]);
  assert.deepEqual(parseMatch(migrated), migrated);
  assert.deepEqual(old, snapshot);
  // Swapping competitors keeps each physical side bound to the same team.
  const swapped = parseMatch(swapMatch(migrated));
  assert.equal(toSeries(resolveMatch(swapped, []), duel).right.playerId, blue);
  assert.equal(swapped.right.name, "Red player");
});

test("migration preserves explicit venue accounts and already-correct team mappings", () => {
  for (const gameMapping of [{ left: red, right: blue }, { left: "red", right: "blue" }]) {
    assert.deepEqual(parseMatch({ ...emptyMatch(), schemaVersion: 1, gameMapping }).gameMapping, gameMapping);
  }
});


test("presenter names, wins, HP, round scores and result pins follow red-left/blue-right", () => {
  const state = applySnapshot(null, sample("gs2-ws-DuelStarted.json")).state!;
  for (const player of state.players) {
    const isRed = player.teamColor === "red";
    player.health = isRed ? 3200 : 5700;
    const score = isRed ? 4100 : 4800;
    const guess = { lat: isRed ? 10 : 20, lng: 30, round: state.round, score, distanceM: 100, createdAtMs: 1 };
    player.results = [{ round: state.round, score, bestGuess: guess, healthBefore: 6000,
      healthAfter: player.health, damageDealt: 0, multiplier: 1 }];
  }
  const match = emptyMatch();
  match.left.name = "Red player"; match.left.wins = 1;
  match.right.name = "Blue player"; match.right.wins = 2;
  for (const players of [state.players, [...state.players].reverse() as typeof state.players]) {
    const current = { ...state, players };
    const series = toSeries(resolveMatch(match, []), current);
    const timeline = advanceTimeline(null, current, 10000, true, DEFAULT_TIMING);
    const visible = project(current, timeline, 100000);
    const displayed = (["left", "right"] as const).map(side => {
      const competitor = series[side];
      const player = visible.players.find(p => p.id === competitor.playerId)!;
      return [competitor.name, competitor.wins, player.health, player.score];
    });
    assert.deepEqual(displayed, [["Red player", 1, 3200, 4100], ["Blue player", 2, 5700, 4800]]);
    const map = resultMapFrame(current, current.round, { left: series.left.playerId, right: series.right.playerId })!;
    assert.equal(map.pins.find(pin => pin.label === "left")!.point.lat, 10);
    assert.equal(map.pins.find(pin => pin.label === "right")!.point.lat, 20);
  }
});


test("schema-2 automatic bindings reversed by the old Swap sides action are repaired", () => {
  const match = emptyMatch();
  match.gameMapping = { left: "blue", right: "red" };
  const normalized = parseMatch(match);
  const series = toSeries(resolveMatch(normalized, []), duel);
  assert.equal(series.left.playerId, red);
  assert.equal(series.right.playerId, blue);
  assert.deepEqual(parseMatch(normalized), normalized);
});
