import assert from "node:assert/strict";
import test from "node:test";
import * as matchModule from "../../match/state.ts";
import { defaultInterval, upcomingMatches } from "../../interval/state.ts";
import { playerCardResults } from "../player-card-results.ts";
import { rowToProfile } from "../../sheet/players.ts";
import { createInitialState, setPreview, take, swap, clearPreview, revertPreview, withDefaults } from "../state.ts";
import { controlRows, monitorUrls, patchAt } from "../switcher-model.ts";
import { registerInterval } from "../../extension/interval.ts";
import { parseSheetConfig, DEFAULT_SHEET_CONFIG } from "../../config/schema.ts";

test("English stages and takes every stream layer independently, including migration", () => {
  const initial = withDefaults({ stream: { program: { banpick: { visible: true } } } });
  assert.ok(initial.en, "old state gains an English bus");
  let state = setPreview(initial, "en", { playerCards: { visible: true }, lowerThird: { visible: true, mode: "scores" }, banpick: { visible: true }, interval: { visible: true }, bracket: { visible: true } });
  assert.equal(state.en.program.playerCards.visible, false);
  state = take(state, "en");
  assert.equal(state.en.program.lowerThird.mode, "scores");
  assert.deepEqual(state.stream, initial.stream);
  assert.deepEqual(state.led, initial.led);
  const cleared = clearPreview(state, "en");
  assert.equal(cleared.en.preview.interval.visible, false);
  assert.deepEqual(revertPreview(cleared, "en").en.preview, state.en.program);
  assert.deepEqual(swap(cleared, "en").en.preview, state.en.program);
});

test("English monitor uses its own bus and cheap camera placeholders", () => {
  assert.equal(monitorUrls("en", "preview").info, "/bundles/rashinban/graphics/player-cards-en.html?channel=preview&cameraMode=placeholder");
  assert.deepEqual(controlRows("en").map(r => r.id), ["playerInfo", "playerCameras", "playerCards", "casters", "interval"]);
  assert.ok(controlRows("en").flatMap(r => r.controls).some(c => c.path.join(".") === "playerCards.player"));
});

test("English timer start/pause/resume/clear cannot change the main timer", () => {
  const reps = new Map<string, { value: any }>();
  const handlers = new Map<string, Function>();
  const fake = {
    Replicant(name: string, options: any) { if (!reps.has(name)) reps.set(name, { value: options.defaultValue }); return reps.get(name)!; },
    listenFor(name: string, fn: Function) { handlers.set(name, fn); },
  };
  registerInterval(fake as any);
  const command = (name: string, data: unknown) => {
    assert.ok(handlers.has(name), name + " registered");
    let error: unknown;
    handlers.get(name)!(data, (e: unknown) => { error = e; });
    return error;
  };
  command("interval:timer", { action: "start", durationSeconds: 600 });
  const main = structuredClone(reps.get("interval")!.value);
  assert.equal(command("interval:timer:en", { action: "start", durationSeconds: 120 }), null);
  assert.notEqual(reps.get("intervalEn")!.value.timer.endsAtMs, main.timer.endsAtMs);
  for (const action of ["pause", "resume", "clear"]) {
    assert.equal(command("interval:timer:en", { action }), null);
    assert.deepEqual(reps.get("interval")!.value, main);
  }
  assert.ok(command("interval:timer:en", { action: "start", durationSeconds: -1 }) instanceof Error);
  const en = structuredClone(reps.get("intervalEn")!.value);
  command("interval:timer", { action: "clear" });
  assert.deepEqual(reps.get("intervalEn")!.value, en);
});

test("old sheet configs acquire English tab defaults and accept explicit disabled tabs", () => {
  const legacy = { enabled: true, sheetId: "id", playersGid: "0", castersGid: "1", pollIntervalMs: 15000 };
  const config = parseSheetConfig(legacy);
  assert.equal(config.playersEnGid, "1767411728");
  assert.equal(config.castersEnGid, "2083370771");
  assert.equal(parseSheetConfig({ ...DEFAULT_SHEET_CONFIG, playersEnGid: "", castersEnGid: "" }).playersEnGid, "");
  assert.throws(() => parseSheetConfig({ ...DEFAULT_SHEET_CONFIG, playersEnGid: 5 }));
});

test("English selects its own player with the same staged camera/card linkage as Stream", () => {
  let state = createInitialState();
  state = setPreview(state, "stream", { playerCards: { player: "right", position: "right", visible: true }, playerCameras: { right: true } });
  state = take(state, "stream");
  const main = structuredClone(state.stream);
  state = setPreview(state, "en", patchAt(["playerCameras", "left"], true, state.en.preview));
  assert.equal(state.en.preview.playerCards.player, "left");
  assert.equal(state.en.preview.playerCards.position, "right");
  assert.equal(state.en.preview.playerCards.visible, true);
  assert.equal(state.en.program.playerCameras.left, false);
  state = take(state, "en");
  assert.equal(state.en.program.playerCameras.left, true);
  state = setPreview(state, "en", patchAt(["playerCards", "player"], "right", state.en.preview));
  assert.deepEqual(state.en.preview.playerCameras, { left: false, right: true, relay: "main" });
  assert.equal(state.en.preview.playerCards.position, "left");
  assert.equal(state.en.program.playerCards.player, "left");
  state = setPreview(state, "en", patchAt(["playerCards", "visible"], false, state.en.preview));
  assert.equal(state.en.preview.playerCameras.right, false);
  assert.deepEqual(state.stream, main);
});

test("English profiles replace display text by stable identity, preserving match scores and fallback", () => {
  assert.equal(typeof matchModule.localizeMatch, "function");
  const original = rowToProfile({ geoguessr_player_uid: "6375a42d001fcb9df8d226d9", startgg_tag: "original-tag", name: "Original", strengths: "Original strengths" });
  const translated = { ...original, name: "English name", strengths: "English strengths" };
  const match = matchModule.emptyMatch();
  match.left.uid = original.geoguessrPlayerUid;
  match.left.wins = 2;
  const source = matchModule.resolveMatch(match, [original]);
  const before = structuredClone(source);
  const localized = matchModule.localizeMatch(source, [translated])!;
  assert.equal(localized.left.name, "English name");
  assert.equal(localized.left.profile?.strengths, "English strengths");
  assert.equal(localized.left.wins, 2);
  assert.equal(localized.left.uid, original.geoguessrPlayerUid);
  assert.deepEqual(localized.right, source.right);
  assert.deepEqual(matchModule.localizeMatch(source, []), source);
  assert.deepEqual(matchModule.localizeMatch(source, [translated, translated]), source, "ambiguous profiles never pick a random row");
  assert.equal(matchModule.localizeMatch(null, [translated]), null);
  assert.deepEqual(source, before);
});

test("English upcoming matches retain shared profile names for missing translation rows", () => {
  const profile = rowToProfile({ geoguessr_player_uid: "6375a42d001fcb9df8d226d9", startgg_tag: "tag", name: "Shared name" });
  const next = matchModule.emptyMatch(); next.left.uid = profile.geoguessrPlayerUid; next.right.name = "Other player";
  assert.equal(upcomingMatches(defaultInterval().content, next, [profile], [{ ...profile, name: "Translated" }])[0]?.playerOne, "Translated");
  assert.deepEqual(upcomingMatches(defaultInterval().content, next, [profile], []), [{ playerOne: "Shared name", playerTwo: "Other player" }]);
});

test("English display-only profiles retain the shared entrant linkage for results", () => {
  const original = rowToProfile({ geoguessr_player_uid: "6375a42d001fcb9df8d226d9", startgg_tag: "tag", startgg_entrant_id: "42", name: "Original" });
  const translated = rowToProfile({ geoguessr_player_uid: original.geoguessrPlayerUid!, name: "English" });
  const match = matchModule.emptyMatch(); match.left.uid = original.geoguessrPlayerUid;
  const localized = matchModule.localizeMatch(matchModule.resolveMatch(match, [original]), [translated])!;
  assert.equal(localized.left.profile?.startggEntrantId, 42);
  assert.equal(localized.left.profile?.startggTag, "tag");
  assert.equal(playerCardResults({ entrants: {}, sets: {} } as any, localized.left, [], null, 3).status, "empty");
});
