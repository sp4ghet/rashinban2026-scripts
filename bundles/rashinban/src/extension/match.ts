import type NodeCG from "@nodecg/types";
import type { PlayerProfile } from "../sheet/players.ts";
import type { StartggBracket } from "../startgg/types.ts";
import type { DuelState, SeriesState } from "../types/presenter.ts";
import type { BanPickState } from "../banpick/rules.ts";
import {
  resolveCurrentMatch,
  type CurrentMatchSelection,
} from "../match/current.ts";
import {
  emptyMatch,
  importSet,
  parseMatch,
  resolveMatch,
  swapMatch,
  toSeries,
  type MatchState,
  type ResolvedMatch,
} from "../match/state.ts";
import { MATCH_MESSAGES, REPLICANTS } from "../types/replicants.ts";

export function registerMatch(nodecg: NodeCG.ServerAPI) {
  const state = nodecg.Replicant<MatchState | null>(REPLICANTS.matchState, {
    defaultValue: null,
  });
  const resolved = nodecg.Replicant<ResolvedMatch | null>(
    REPLICANTS.matchResolved,
    { defaultValue: null, persistent: false },
  );
  const profiles = nodecg.Replicant<PlayerProfile[]>(REPLICANTS.players);
  const bracket = nodecg.Replicant<StartggBracket | null>(
    REPLICANTS.startggBracket,
  );
  const series = nodecg.Replicant<SeriesState>(REPLICANTS.presenterSeries);
  const duel = nodecg.Replicant<DuelState | null>(REPLICANTS.presenterDuel);
  const bans = nodecg.Replicant<BanPickState>(REPLICANTS.banPick);
  // Migration is one-time. Never follow the legacy automatic queue after startup.
  if (!state.value) {
    const next = emptyMatch(),
      old = series.value;
    if (old)
      for (const side of ["left", "right"] as const) {
        const p = old[side];
        next[side] = {
          ...next[side],
          id: p.id,
          uid: /^[a-f\d]{24}$/i.test(p.playerId ?? "") ? p.playerId : null,
          name: /^PLAYER [12]$/.test(p.name) ? "" : p.name,
          handleOverride: p.handle || null,
          wins: p.wins,
        };
      }
    if (
      !next.left.name &&
      !next.right.name &&
      !next.left.uid &&
      !next.right.uid
    ) {
      const legacy = nodecg.Replicant<CurrentMatchSelection>(
        REPLICANTS.currentMatch,
      ).value;
      const previous = resolveCurrentMatch(
        legacy ? (bracket.value ?? null) : null,
        legacy,
      );
      if (previous.set && bracket.value) {
        try {
          Object.assign(
            next,
            importSet(bracket.value, previous.set.id, profiles.value ?? []),
          );
        } catch {
          /* retain manual state */
        }
      } else
        for (const [i, side] of ["left", "right"].entries()) {
          next[side as "left" | "right"].tag = previous.players[i].tag;
          next[side as "left" | "right"].name =
            previous.players[i].tag ||
            (bans.value?.players[i === 0 ? "A" : "B"]?.replace(
              /^Player [AB]$/,
              "",
            ) ??
              "");
        }
    }
    state.value = parseMatch(next);
  }
  if (!state.value.gameMapping) state.value = parseMatch(state.value);
  const publish = () => {
    if (!state.value) return;
    const value = resolveMatch(state.value, profiles.value ?? []);
    // Replicant proxies cannot be shared across Replicants or structuredClone'd.
    resolved.value = JSON.parse(JSON.stringify(value)) as ResolvedMatch;
    const projected = toSeries(value, duel.value ?? null);
    if (JSON.stringify(series.value) !== JSON.stringify(projected))
      series.value = projected;
    if (
      bans.value &&
      (bans.value.players.A !== value.left.name ||
        bans.value.players.B !== value.right.name)
    )
      bans.value = {
        ...bans.value,
        players: { A: value.left.name, B: value.right.name },
      };
  };
  const commit = (next: MatchState, revision: number) => {
    const current = state.value!;
    if (revision !== current.revision)
      throw new Error(
        "Current match changed elsewhere. Reload the current match before applying.",
      );
    next = parseMatch(next);
    const identity = (m: MatchState) =>
      JSON.stringify([
        m.left.id,
        m.left.uid,
        m.left.entrantId,
        m.left.tag,
        m.right.id,
        m.right.uid,
        m.right.entrantId,
        m.right.tag,
      ]);
    if (bans.value?.actions.length && identity(next) !== identity(current))
      throw new Error(
        "Reset Ban & Pick before replacing players or swapping sides.",
      );
    const check = resolveMatch(next, profiles.value ?? []);
    if (
      check.left.profileStatus === "ambiguous" ||
      check.right.profileStatus === "ambiguous"
    )
      throw new Error("Ambiguous spreadsheet profile; use a unique UID.");
    if (check.left.uid && check.left.uid === check.right.uid)
      throw new Error("Select two different players");
    // Freeze discovered UIDs so a later tag rename cannot select a different account.
    next.left.uid = check.left.uid;
    next.right.uid = check.right.uid;
    state.value = { ...next, revision: current.revision + 1 };
    publish();
    return state.value;
  };
  const listen = (name: string, fn: (value: any) => unknown) =>
    nodecg.listenFor(name, (value, ack) => {
      try {
        const result = fn(value);
        if (ack && !ack.handled) ack(null, result);
      } catch (error) {
        if (ack && !ack.handled) ack(error as Error);
      }
    });
  listen(MATCH_MESSAGES.apply, (value: MatchState) =>
    commit(value, value.revision),
  );
  listen(MATCH_MESSAGES.load, (value: { setId: number; revision: number }) => {
    if (!bracket.value) throw new Error("Refresh start.gg first");
    return commit(
      importSet(bracket.value, value.setId, profiles.value ?? []),
      value.revision,
    );
  });
  listen(MATCH_MESSAGES.swap, (value: { revision: number }) =>
    commit(swapMatch(state.value!), value.revision),
  );
  // Re-publish if a legacy caller attempts to write the derived presenter names.
  state.on("change", publish);
  profiles.on("change", publish);
  duel.on("change", publish);
  series.on("change", publish);
  publish();
}
