import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { registerMatch } from "../../extension/match.ts";
import { createInitialState } from "../../banpick/rules.ts";
import { rowToProfile } from "../players.ts";
import { emptyMatch } from "../../match/state.ts";
const uid = "65fc3453702bba73b4c0a398";
function harness() {
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
  assert.equal(reps.get("presenterSeries").value.left.playerId, "venue-blue");
  reps.get("presenterDuel").value = {
    players: [
      { id: "new-blue", teamColor: "blue" },
      { id: "venue-red", teamColor: "red" },
    ],
  };
  assert.equal(reps.get("presenterSeries").value.left.playerId, "new-blue");
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
