import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyMatch,
  importSet,
  resolveMatch,
  swapMatch,
  parseMatch,
} from "../../match/state.ts";
import { rowToProfile } from "../players.ts";
import { normalizeEvent } from "../../startgg/normalize.ts";

const uid = "65fc3453702bba73b4c0a398";
test("manual UID resolves a profile and explicit name overrides survive refresh", () => {
  const match = emptyMatch();
  match.left.uid = uid;
  const profile = rowToProfile({ geoguessr_player_uid: uid, name: "Eurya" });
  assert.equal(resolveMatch(match, [profile]).left.name, "Eurya");
  match.left.nameOverride = "On-air name";
  assert.equal(
    resolveMatch(match, [{ ...profile, name: "Renamed" }]).left.name,
    "On-air name",
  );
});
test("swap moves the complete competitor including identity and wins", () => {
  const match = emptyMatch();
  match.left.uid = uid;
  match.left.wins = 2;
  const swapped = swapMatch(match);
  assert.equal(swapped.right.uid, uid);
  assert.equal(swapped.right.wins, 2);
  assert.equal(match.left.uid, uid);
});
test("validation rejects duplicate UIDs and invalid wins", () => {
  const match = emptyMatch();
  match.left.uid = uid;
  match.right.uid = uid;
  assert.throws(() => parseMatch(match));
  match.right.uid = null;
  match.left.wins = -1;
  assert.throws(() => parseMatch(match));
});
test("start.gg import copies data and ignores later bracket changes", () => {
  const bracket = normalizeEvent(null, [], null, 0);
  bracket.entrants[1] = {
    id: 1,
    name: "Eurya",
    tag: "Eurya",
    prefix: null,
    initialSeedNum: null,
  };
  bracket.entrants[2] = {
    id: 2,
    name: "Other",
    tag: "Other",
    prefix: null,
    initialSeedNum: null,
  };
  bracket.sets[7] = {
    id: 7,
    groupId: 1,
    phaseId: null,
    roundText: "Final",
    state: "ready",
    slots: [
      { entrantId: 1, score: 1 },
      { entrantId: 2, score: 0 },
    ],
  } as any;
  const match = importSet(bracket, 7, []);
  bracket.entrants[1].tag = "Changed";
  bracket.sets[7].slots[0].score = 2;
  assert.equal(match.left.tag, "Eurya");
  assert.equal(match.left.wins, 1);
  assert.equal(match.label, "Final");
});
