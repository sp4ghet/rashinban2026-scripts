import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { csvToObjects, parseCsv } from "../csv.ts";
import { findProfile, normalizeTag, parsePlayers } from "../players.ts";
import { DEFAULT_SELECTION, resolveCurrentMatch } from "../../match/current.ts";
import { normalizeEvent } from "../../startgg/normalize.ts";
import type { RawPhaseGroup } from "../../startgg/types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const csv = readFileSync(path.join(root, "docs/sheet/samples/players-sample.csv"), "utf8");
const top8 = JSON.parse(readFileSync(path.join(root, "docs/startgg/samples/evo-japan-2026-sf6-finals-top8.json"), "utf8")).data
  .phaseGroup as RawPhaseGroup;

test("parseCsv handles quotes, escaped quotes, embedded newlines, and CRLF", () => {
  assert.deepEqual(parseCsv('a,"b, c","d ""e""",f\r\n1,"two\nlines",,\n'), [
    ["a", "b, c", 'd "e"', "f"],
    ["1", "two\nlines", "", ""],
  ]);
  assert.deepEqual(parseCsv(""), []);
});

test("csvToObjects keys by lower-cased header and drops empty rows", () => {
  const rows = csvToObjects("Name,,Score\nA,x,1\n,,\nB,y,2\n");
  assert.deepEqual(rows, [
    { name: "A", score: "1" },
    { name: "B", score: "2" },
  ]);
});

test("players sheet maps columns, keeps extras, skips rows without a tag", () => {
  const { players, missingColumns, skippedRows } = parsePlayers(csvToObjects(csv));
  assert.deepEqual(missingColumns, []);
  assert.equal(skippedRows, 1);
  assert.equal(players.length, 3);
  const shiina = players[0]!;
  assert.equal(shiina.twitter, "si417_");
  assert.equal(shiina.winRate.nm, "83.3%");
  assert.equal(shiina.placement.nmpz, "10th");
  assert.deepEqual([shiina.bestCountry, shiina.worstCountry], ["ru", "ph"]);
  assert.deepEqual(shiina.extra, { note: "internal only" });
  const sp = players[1]!;
  assert.equal(sp.strengths, 'Roads, "bollards"');
  assert.equal(sp.message, "よろしく\nお願いします");
  assert.equal(sp.startggEntrantId, null);
  assert.equal(players[2]!.name, "Zash");
});

test("missing required column is reported", () => {
  const { missingColumns, players } = parsePlayers(csvToObjects("name,age\nA,1\n"));
  assert.deepEqual(missingColumns, ["startgg_tag"]);
  assert.equal(players.length, 0);
});

test("findProfile matches by entrant id, then tag ignoring case/spaces, then full name", () => {
  const { players } = parsePlayers(csvToObjects(csv));
  players[0]!.startggEntrantId = 42;
  assert.equal(findProfile(players, { id: 42, tag: "someone else", name: "x" })?.name, "Shiina");
  assert.equal(findProfile(players, { id: 1, tag: "ZASHNESS", name: "TEAM | ZASHNESS" })?.name, "Zash");
  assert.equal(findProfile(players, { id: 1, tag: "", name: "SP4GHET" })?.name, "sp4ghet");
  assert.equal(findProfile(players, { id: 1, tag: "nobody", name: "nobody" }), null);
  assert.equal(normalizeTag(" Ｓhiina "), "shiina");
});

test("resolveCurrentMatch: tags mode needs no bracket, auto picks a live set, set mode picks by id", () => {
  const tags = resolveCurrentMatch(null, { mode: "tags", setId: null, tags: [" Shiina ", "sp4ghet"] });
  assert.equal(tags.source, "tags");
  assert.deepEqual(tags.players.map((p) => p.tag), ["Shiina", "sp4ghet"]);

  const raw = structuredClone(top8);
  const gf = raw.sets!.nodes.find((s) => s.fullRoundText === "Grand Final")!;
  gf.state = 2; // pretend it is being played
  const bracket = normalizeEvent(null, [raw], null, 0);

  const auto = resolveCurrentMatch(bracket, DEFAULT_SELECTION);
  assert.equal(auto.source, "live");
  assert.equal(auto.set?.id, gf.id);
  assert.deepEqual(auto.players.map((p) => p.entrant?.name), ["ZETA | Yamaguchi", "FLY | Punk"]);
  assert.deepEqual(auto.players.map((p) => p.score), [3, 1]);

  const wf = raw.sets!.nodes.find((s) => s.fullRoundText === "Winners Final")!;
  const chosen = resolveCurrentMatch(bracket, { mode: "set", setId: wf.id, tags: ["", ""] });
  assert.equal(chosen.source, "set");
  assert.equal(chosen.roundText, "Winners Final");
  assert.equal(chosen.groupIdentifier, "SFZ1");

  assert.equal(resolveCurrentMatch(bracket, { mode: "set", setId: 1, tags: ["", ""] }).source, "none");
  assert.equal(resolveCurrentMatch(normalizeEvent(null, [top8], null, 0), DEFAULT_SELECTION).source, "none");
});

test("resolveCurrentMatch prefers the stream queue over live sets", () => {
  const raw = structuredClone(top8);
  const wsf = raw.sets!.nodes.find((s) => s.fullRoundText === "Winners Semi-Final")!;
  const bracket = normalizeEvent(null, [raw], [{ stream: { id: 1, streamName: "rashinban", streamSource: "TWITCH" }, sets: [wsf] }], 0);
  const m = resolveCurrentMatch(bracket, DEFAULT_SELECTION);
  assert.equal(m.source, "queue");
  assert.equal(m.set?.id, wsf.id);
});
