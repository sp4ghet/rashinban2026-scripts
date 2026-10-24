import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { registerMatch } from "../../extension/match.ts";
import { createInitialState } from "../../banpick/rules.ts";
import { rowToProfile } from "../players.ts";
import { emptyMatch } from "../../match/state.ts";
import { normalizeEvent } from "../../startgg/normalize.ts";
const uid = "65fc3453702bba73b4c0a398";
function harness(saved: Record<string, unknown> = {}) {
  const owners = new WeakMap<object, string>();
  function own(value: unknown, name: string): void {
    if (!value || typeof value !== "object") return;
    const previous = owners.get(value);
    if (previous && previous !== name)
      throw new Error(`Cross-Replicant object: ${previous} -> ${name}`);
    owners.set(value, name);
    Object.values(value).forEach((child) => own(child, name));
  }
  const reps = new Map<string, any>(),
    listeners = new Map<string, Function>();
  function Replicant(name: string, opts?: any) {
    if (!reps.has(name)) {
      const rep = new EventEmitter();
      let value = opts?.defaultValue;
      Object.defineProperty(rep, "value", {
        get: () => value,
        set: (next) => {
          own(next, name);
          const old = value;
          value = next;
          rep.emit("change", next, old);
        },
      });
      reps.set(name, rep);
    }
    return reps.get(name);
  }
  Replicant("banPick").value = createInitialState();
  Replicant("players").value = [];
  for (const [name, value] of Object.entries(saved)) Replicant(name).value = value;
  registerMatch({
    Replicant,
    listenFor: (name: string, fn: Function) => listeners.set(name, fn),
  } as any);
  function send(name: string, value: unknown) {
    let error: unknown;
    listeners.get(name)!(value, (e: unknown) => {
      error = e;
    });
    if (error) throw error;
  }
  return { reps, send };
}
test("match service publishes shared names, UID mapping and profile refreshes", () => {
  const { reps, send } = harness();
  const match = emptyMatch();
  match.left.uid = uid;
  match.left.nameOverride = "On air";
  send("match:apply", match);
  reps.get("presenterDuel").value = {
    players: [
      { id: "venue-blue", teamColor: "blue" },
      { id: "venue-red", teamColor: "red" },
    ],
  };
  reps.get("players").value = [
    rowToProfile({
      geoguessr_player_uid: uid,
      name: "Eurya",
      twitter: "eurya",
    }),
  ];
  assert.equal(reps.get("presenterSeries").value.left.name, "On air");
  assert.equal(reps.get("presenterSeries").value.left.playerId, "venue-red");
  reps.get("presenterDuel").value = {
    players: [
      { id: "venue-blue", teamColor: "blue" },
      { id: "new-red", teamColor: "red" },
    ],
  };
  assert.equal(reps.get("presenterSeries").value.left.playerId, "new-red");
  assert.equal(reps.get("banPick").value.players.A, "On air");
  assert.equal(reps.get("matchResolved").value.left.profile.name, "Eurya");
});
test("stale edits and swaps during an active ban/pick are rejected", () => {
  const { reps, send } = harness();
  send("match:apply", emptyMatch());
  assert.throws(() => send("match:apply", emptyMatch()), /changed elsewhere/);
  reps.get("banPick").value = {
    ...reps.get("banPick").value,
    actions: [{ player: "A", kind: "ban", optionId: 1 }],
  };
  assert.throws(() => send("match:swap", { revision: 1 }), /Reset Ban/);
  assert.equal(reps.get("matchState").value.revision, 1);
});
test("legacy direct presenter writes cannot replace authoritative identities", () => {
  const { reps, send } = harness();
  const match = emptyMatch();
  match.left.name = "Eurya";
  send("match:apply", match);
  reps.get("presenterSeries").value = {
    ...reps.get("presenterSeries").value,
    left: { name: "Other" },
  };
  assert.equal(reps.get("presenterSeries").value.left.name, "Eurya");
});

function selectedMatch() {
  const match = emptyMatch();
  match.left = { ...match.left, id: "player-a", name: "Next A" };
  match.right = { ...match.right, id: "player-b", name: "Next B" };
  return match;
}

test("next match preparation stays separate from current players and active ban/pick", () => {
  const { reps, send } = harness();
  const before = JSON.stringify(reps.get("presenterSeries").value);
  reps.get("banPick").value = { ...reps.get("banPick").value, actions: [{ player: "A", kind: "ban", optionId: 1 }] };
  const bansBefore = JSON.stringify(reps.get("banPick").value);
  const next = selectedMatch(); next.left.uid = uid;
  send("match:next:apply", next);
  assert.equal(reps.get("nextMatchState").value.revision, 1);
  assert.equal(reps.get("nextMatchResolved").value.left.name, "Next A");
  assert.equal(reps.get("matchState").value.revision, 0);
  assert.equal(JSON.stringify(reps.get("presenterSeries").value), before);
  assert.equal(JSON.stringify(reps.get("banPick").value), bansBefore);
  reps.get("players").value = [rowToProfile({ geoguessr_player_uid: uid, name: "Updated Next A" })];
  assert.equal(reps.get("nextMatchResolved").value.left.name, "Updated Next A");
  assert.equal(JSON.stringify(reps.get("presenterSeries").value), before);
});

test("start.gg loads independently into next or current and retains imported snapshots", () => {
  const { reps, send } = harness();
  const bracket = normalizeEvent(null, [], null, 0);
  bracket.entrants[1] = { id: 1, name: "Alpha", tag: "Alpha", prefix: null, initialSeedNum: null };
  bracket.entrants[2] = { id: 2, name: "Beta", tag: "Beta", prefix: null, initialSeedNum: null };
  bracket.sets[7] = { id: 7, groupId: 1, phaseId: null, roundText: "Final", state: "ready", slots: [{ entrantId: 1, score: 1 }, { entrantId: 2, score: 0 }] } as any;
  reps.get("startggBracket").value = bracket;
  send("match:next:load", { setId: 7, revision: 0 });
  assert.equal(reps.get("nextMatchState").value.setId, 7);
  assert.deepEqual(reps.get("nextMatchState").value.gameMapping, { left: "red", right: "blue" });
  assert.equal(reps.get("nextMatchState").value.left.wins, 1);
  assert.equal(reps.get("matchState").value.setId, null);
  send("match:load", { setId: 7, revision: 0 });
  assert.equal(reps.get("matchState").value.setId, 7);
  assert.deepEqual(reps.get("matchState").value.gameMapping, { left: "red", right: "blue" });
  assert.equal(reps.get("nextMatchState").value.revision, 1);
  reps.get("startggBracket").value = normalizeEvent(null, [], null, 1);
  assert.equal(reps.get("nextMatchState").value.left.name, "Alpha");
  assert.equal(reps.get("matchState").value.left.name, "Alpha");
});

test("next match rejects stale drafts and duplicate players without changing saved state", () => {
  const { reps, send } = harness();
  send("match:next:apply", selectedMatch());
  assert.throws(() => send("match:next:apply", selectedMatch()), /Next match changed elsewhere/);
  const duplicate = selectedMatch(); duplicate.revision = 1; duplicate.right = { ...duplicate.left };
  assert.throws(() => send("match:next:apply", duplicate), /different players/);
  assert.equal(reps.get("nextMatchState").value.revision, 1);
  send("match:next:swap", { revision: 1 });
  assert.equal(reps.get("nextMatchState").value.left.name, "Next B");
  assert.deepEqual(reps.get("nextMatchState").value.gameMapping, { left: "red", right: "blue" });
});

test("making next current checks both revisions and clears next only after success", () => {
  const { reps, send } = harness();
  const next = selectedMatch(); next.left.wins = 1;
  send("match:next:apply", next);
  assert.throws(() => send("match:next:promote", { revision: 0, nextRevision: 0 }), /Next match changed elsewhere/);
  assert.throws(() => send("match:next:promote", { revision: 1, nextRevision: 1 }), /Current match changed elsewhere/);
  assert.equal(reps.get("nextMatchState").value.left.name, "Next A");
  send("match:next:promote", { revision: 0, nextRevision: 1 });
  assert.equal(reps.get("matchState").value.left.name, "Next A");
  assert.equal(reps.get("presenterSeries").value.left.wins, 1);
  assert.equal(reps.get("matchState").value.revision, 1);
  assert.equal(reps.get("nextMatchState").value.revision, 2);
  assert.equal(reps.get("nextMatchState").value.left.name, "");
  assert.equal(reps.get("nextMatchResolved").value.left.name, "TBD");
  assert.throws(() => send("match:next:apply", { ...next, revision: 1 }), /Next match changed elsewhere/);
});

test("making next current respects the active ban/pick lock and rejects an empty slot", () => {
  const { reps, send } = harness();
  assert.throws(() => send("match:next:promote", { revision: 0, nextRevision: 0 }), /Select both players/);
  send("match:next:apply", selectedMatch());
  reps.get("banPick").value = { ...reps.get("banPick").value, actions: [{ player: "A", kind: "ban", optionId: 1 }] };
  assert.throws(() => send("match:next:promote", { revision: 0, nextRevision: 1 }), /Reset Ban/);
  assert.equal(reps.get("matchState").value.revision, 0);
  assert.equal(reps.get("nextMatchState").value.revision, 1);
});


test("score updates remain available during ban/pick when a sheet refresh discovers a personal UID", () => {
  const { reps, send } = harness();
  const match = selectedMatch(); match.left.tag = "Next A";
  send("match:apply", match);
  reps.get("banPick").value = { ...reps.get("banPick").value, actions: [{ player: "A", kind: "ban", optionId: 1 }] };
  reps.get("players").value = [rowToProfile({ name: "Next A", startgg_tag: "Next A", geoguessr_player_uid: uid })];
  const update = JSON.parse(JSON.stringify(reps.get("matchState").value));
  update.left.wins = 1;
  send("match:apply", update);
  assert.equal(reps.get("matchState").value.left.uid, uid);
  assert.equal(reps.get("presenterSeries").value.left.wins, 1);
});


test("startup corrects saved current and next match team defaults before publishing", () => {
  const legacy = { ...selectedMatch(), schemaVersion: 1, gameMapping: { left: "blue", right: "red" } };
  legacy.left.wins = 1; legacy.right.wins = 2;
  const { reps } = harness({ matchState: structuredClone(legacy), nextMatchState: structuredClone(legacy),
    presenterDuel: { players: [{ id: "venue-blue", teamColor: "blue" }, { id: "venue-red", teamColor: "red" }] } });
  const series = reps.get("presenterSeries").value;
  assert.deepEqual([series.left.name, series.left.playerId, series.left.wins], ["Next A", "venue-red", 1]);
  assert.deepEqual([series.right.name, series.right.playerId, series.right.wins], ["Next B", "venue-blue", 2]);
  assert.deepEqual(reps.get("nextMatchState").value.gameMapping, { left: "red", right: "blue" });
  assert.equal(reps.get("nextMatchResolved").value.left.name, "Next A");
});


test("startup repairs reversed version-2 team bindings in both match slots", () => {
  const saved = { ...selectedMatch(), schemaVersion: 2, gameMapping: { left: "blue", right: "red" } };
  const { reps } = harness({ matchState: structuredClone(saved), nextMatchState: structuredClone(saved),
    presenterDuel: { players: [{ id: "venue-blue", teamColor: "blue" }, { id: "venue-red", teamColor: "red" }] } });
  assert.equal(reps.get("presenterSeries").value.left.playerId, "venue-red");
  assert.equal(reps.get("presenterSeries").value.right.playerId, "venue-blue");
  assert.deepEqual(reps.get("nextMatchState").value.gameMapping, { left: "red", right: "blue" });
});

test("current and next swaps, save and promotion keep red-left/blue-right bindings", () => {
  const { reps, send } = harness({ presenterDuel: {
    players: [{ id: "venue-blue", teamColor: "blue" }, { id: "venue-red", teamColor: "red" }] } });
  const expectMapping = () => {
    const series = reps.get("presenterSeries").value;
    assert.equal(series.left.playerId, "venue-red");
    assert.equal(series.right.playerId, "venue-blue");
  };
  send("match:apply", selectedMatch());
  send("match:swap", { revision: 1 });
  assert.equal(reps.get("presenterSeries").value.left.name, "Next B");
  expectMapping();
  send("match:next:apply", selectedMatch());
  send("match:next:swap", { revision: 1 });
  const draft = structuredClone(reps.get("nextMatchState").value);
  // A previously open panel can submit an old hidden mapping.
  draft.gameMapping = { left: "blue", right: "red" };
  send("match:next:apply", draft);
  assert.deepEqual(reps.get("nextMatchState").value.gameMapping, { left: "red", right: "blue" });
  send("match:next:promote", { revision: 2, nextRevision: 3 });
  assert.equal(reps.get("presenterSeries").value.left.name, "Next B");
  expectMapping();
  const current = structuredClone(reps.get("matchState").value);
  current.gameMapping = { left: "blue", right: "red" };
  send("match:apply", current);
  expectMapping();
});
