import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlayers, rowToProfile } from "../players.ts";
import { geoUid, matchProfile, playerLabel } from "../../match/identity.ts";

const uid = "65fc3453702bba73b4c0a398";
test("GeoGuessr identity accepts a UID or profile URL and rejects unrelated URLs", () => {
  assert.equal(geoUid(`https://www.geoguessr.com/user/${uid}`), uid);
  assert.equal(geoUid(uid.toUpperCase()), uid);
  assert.throws(() => geoUid(`https://example.com/user/${uid}`));
  assert.throws(() => geoUid("not-an-id"));
  assert.equal(geoUid(""), null);
});
test("UID-only spreadsheet rows work without a start.gg registration", () => {
  const parsed = parsePlayers([{ geoguessr_player_uid: uid, name: "Eurya" }]);
  assert.equal(parsed.players.length, 1);
  assert.deepEqual(parsed.missingColumns, []);
  assert.equal(parsed.players[0].geoguessrPlayerUid, uid);
  assert.equal(playerLabel("Eurya", uid), `Eurya (${uid})`);
});
test("UID joins survive renamed tags and ambiguous profiles never select the first row", () => {
  const profile = rowToProfile({
    name: "Eurya",
    startgg_tag: "old name",
    geoguessr_player_uid: uid,
  });
  assert.equal(
    matchProfile([profile], { uid, tag: "new name" }).profile?.name,
    "Eurya",
  );
  assert.equal(
    matchProfile([profile, { ...profile, name: "Duplicate" }], { uid }).status,
    "ambiguous",
  );
  assert.equal(
    matchProfile([profile], {
      uid: "65fc3453702bba73b4c0a399",
      tag: "old name",
    }).profile,
    null,
  );
});
