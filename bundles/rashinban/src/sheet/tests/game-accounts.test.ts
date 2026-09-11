import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyMatch,
  resolveMatch,
  toSeries,
  swapMatch,
  parseMatch,
} from "../../match/state.ts";
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
  assert.equal(series.left.playerId, blue);
  assert.equal(series.right.playerId, red);
  assert.equal(match.left.uid, "65fc3453702bba73b4c0a390");
});
test("automatic mappings follow replacement accounts and clear without a duel", () => {
  const match = resolveMatch(emptyMatch(), []);
  assert.equal(
    toSeries(match, {
      players: [{ id: "replacement", teamColor: "blue" }],
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
test("swap moves mapping with competitor and migration supplies blue/red defaults", () => {
  const match = emptyMatch();
  assert.deepEqual(swapMatch(match).gameMapping, {
    left: "red",
    right: "blue",
  });
  const old: any = { ...match };
  delete old.gameMapping;
  assert.deepEqual(parseMatch(old).gameMapping, { left: "blue", right: "red" });
});
test("duplicate effective accounts leave both sides unmapped", () => {
  const match = emptyMatch();
  match.gameMapping = { left: "blue", right: blue };
  const series = toSeries(resolveMatch(match, []), duel);
  assert.equal(series.left.playerId, null);
  assert.equal(series.right.playerId, null);
});
