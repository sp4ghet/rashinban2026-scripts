import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FINALS_MATCH_COUNT, finalsGroupId, fromPhaseGroupSample, fromStartgg, withDefaults } from "../finals.ts";
import { normalizeEvent } from "../../startgg/normalize.ts";
import type { RawEvent, RawPhaseGroup } from "../../startgg/types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const samples = path.resolve(here, "../../../../../docs/startgg/samples");
const raw = (name: string): unknown => JSON.parse(readFileSync(path.join(samples, name), "utf8"));
const load = <T>(name: string): T => (raw(name) as { data: T }).data;

const top8 = load<{ phaseGroup: RawPhaseGroup }>("evo-japan-2026-sf6-finals-top8.json").phaseGroup;
const unstarted = load<{ phaseGroup: RawPhaseGroup }>("rashinban-2026-day1-pool1-unstarted.json").phaseGroup;
const rashinbanEvent = load<{ event: RawEvent }>("rashinban-2026-event.json").event;

const bracketOf = (group: RawPhaseGroup) => normalizeEvent(null, [structuredClone(group)], null, 0);
const pick = (row: { top: string; bottom: string; topScore: string; bottomScore: string; winner: string | null }) =>
  [row.top.split(" | ").at(-1), row.topScore, row.bottomScore, row.bottom.split(" | ").at(-1), row.winner];

test("start.gg top 8 fills match numbers 1-11 in the finals layout's order", () => {
  const rows = fromStartgg(bracketOf(top8), top8.id);
  assert.equal(rows.length, FINALS_MATCH_COUNT);
  assert.deepEqual(pick(rows[0]!), ["Hope", "2", "3", "Yamaguchi", "bottom"]); // A
  assert.deepEqual(pick(rows[1]!), ["naooonn", "1", "3", "Higuchi", "bottom"]); // B
  assert.deepEqual(pick(rows[2]!), ["Yamaguchi", "3", "1", "Higuchi", "top"]); // C
  assert.deepEqual(pick(rows[3]!), ["Punk", "3", "1", "SR NuckleDu", "top"]); // F
  assert.deepEqual(pick(rows[5]!), ["naooonn", "2", "3", "Punk", "bottom"]); // H: loser B / winner F
  assert.deepEqual(pick(rows[6]!), ["Hope", "3", "1", "Shuto", "top"]); // I: loser A / winner G
  assert.deepEqual(pick(rows[8]!), ["Higuchi", "0", "3", "Punk", "bottom"]); // K: loser C / winner J
  assert.deepEqual(pick(rows[9]!), ["Yamaguchi", "3", "1", "Punk", "top"]); // D
  assert.deepEqual(pick(rows[10]!), ["", "", "", "", null]); // no reset played
  assert.ok(rows.every((r) => !r.active));
});

test("losers quarterfinals follow their feeder, not the identifier order", () => {
  const swapped = structuredClone(top8);
  for (const set of swapped.sets!.nodes) {
    if (set.identifier === "H") set.identifier = "I";
    else if (set.identifier === "I") set.identifier = "H";
  }
  const rows = fromStartgg(bracketOf(swapped), swapped.id);
  assert.equal(pick(rows[5]!)[3], "Punk");
  assert.equal(pick(rows[6]!)[3], "Shuto");
});

test("a recorded sample file maps the same as live data", () => {
  const sample = fromPhaseGroupSample(raw("evo-japan-2026-sf6-finals-top8.json"));
  assert.equal(sample.groupId, top8.id);
  assert.deepEqual(sample.rows, fromStartgg(bracketOf(top8), top8.id));
  assert.throws(() => fromPhaseGroupSample(raw("rashinban-2026-event.json")), /phase group sample/);
});

test("an unseeded group gives 11 empty rows", () => {
  const rows = fromStartgg(bracketOf(unstarted), unstarted.id);
  assert.equal(rows.length, FINALS_MATCH_COUNT);
  assert.ok(rows.every((r) => r.top === "" && r.bottom === "" && r.winner === null));
});

test("finalsGroupId picks the DAY2 TOP8 group of the real event", () => {
  assert.equal(finalsGroupId(normalizeEvent(rashinbanEvent, [], null, 0)), 3410975);
});

test("an old stored config with source csv falls back to live start.gg", () => {
  const cfg = withDefaults({ source: "csv" as never, csvPath: "x.csv" } as never);
  assert.equal(cfg.source, "startgg");
  assert.match(cfg.samplePath, /top8\.json$/);
  assert.deepEqual(Object.keys(cfg).sort(), ["groupId", "samplePath", "source"]);
});
