import { geoUid, matchProfile, playerLabel } from "../match/identity.ts";
import {
  emptyMatch,
  toSeries,
  type MatchSide,
  type MatchState,
  type ResolvedMatch,
} from "../match/state.ts";
import type { PlayerProfile } from "../sheet/players.ts";
import type { DuelState } from "../types/presenter.ts";
import type { StartggBracket, StartggStatus } from "../startgg/types.ts";
import {
  MATCH_MESSAGES,
  REPLICANTS,
  STARTGG_MESSAGES,
} from "../types/replicants.ts";

const state = nodecg.Replicant<MatchState>(REPLICANTS.matchState);
const resolved = nodecg.Replicant<ResolvedMatch>(REPLICANTS.matchResolved);
const duel = nodecg.Replicant<DuelState | null>(REPLICANTS.presenterDuel);
const players = nodecg.Replicant<PlayerProfile[]>(REPLICANTS.players);
const bracket = nodecg.Replicant<StartggBracket | null>(
  REPLICANTS.startggBracket,
);
const startStatus = nodecg.Replicant<StartggStatus>(REPLICANTS.startggStatus);
const el = (id: string) => document.getElementById(id)!;
const input = (id: string) => el(id) as HTMLInputElement;
const menu = (id: string) => el(id) as HTMLSelectElement;
const sides = ["left", "right"] as const;
let draft = emptyMatch(),
  dirty = false;
let candidates: { key: string; label: string; side: MatchSide }[] = [];
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
async function send(name: string, value?: unknown) {
  try {
    await nodecg.sendMessage(name, value);
    el("error").textContent = "";
    return true;
  } catch (error) {
    el("error").textContent = (error as Error).message;
    return false;
  }
}
async function commit(name: string, value: unknown) {
  try {
    const result = (await nodecg.sendMessage(name, value)) as MatchState;
    draft = copy(result);
    dirty = false;
    showDraft();
    el("error").textContent = "";
  } catch (error) {
    el("error").textContent = (error as Error).message;
  }
}
function showDraft() {
  input("match-label").value = draft.label;
  for (const side of sides) {
    const p = draft[side];
    input(`${side}-name`).value = p.name || p.tag;
    input(`${side}-uid`).value = p.uid ?? "";
    input(`${side}-override`).value = p.nameOverride;
    input(`${side}-handle`).value = p.handleOverride ?? "";
    input(`${side}-wins`).value = String(p.wins);
  }
  showOptions();
  showAccounts(true);
}
function showAccounts(initialize = false) {
  for (const side of sides) {
    const list = menu(`${side}-account`);
    const selected = initialize
      ? (draft.gameMapping?.[side] ?? (side === "left" ? "blue" : "red"))
      : list.value;
    list.replaceChildren();
    for (const color of ["blue", "red"]) {
      const account = duel.value?.players.find((p) => p.teamColor === color);
      list.add(
        new Option(
          `Auto — ${color} team${account ? ` (${account.id})` : " (waiting for duel)"}`,
          color,
        ),
      );
    }
    for (const p of duel.value?.players ?? [])
      list.add(new Option(`${p.teamColor} account (${p.id})`, p.id));
    if (selected && ![...list.options].some((o) => o.value === selected))
      list.add(new Option(`Unavailable account (${selected})`, selected));
    list.value = selected || (side === "left" ? "blue" : "red");
  }
  const active = resolved.value
    ? toSeries(resolved.value, duel.value ?? null)
    : null;
  for (const side of sides)
    el(`${side}-account-status`).textContent = active?.[side].playerId
      ? `Using game account ${active[side].playerId}`
      : "Waiting for a unique matching game account. Check for duplicate mappings.";
}
function readDraft(): MatchState {
  const next = copy(draft);
  next.label = input("match-label").value;
  next.gameMapping = {
    left: menu("left-account").value,
    right: menu("right-account").value,
  };
  for (const side of sides) {
    next[side] = {
      ...next[side],
      name: input(`${side}-name`).value,
      uid: geoUid(input(`${side}-uid`).value),
      nameOverride: input(`${side}-override`).value,
      handleOverride: input(`${side}-handle`).value.trim() || null,
      wins: Number(input(`${side}-wins`).value),
    };
    if (next[side].uid !== draft[side].uid) {
      next[side].id = next[side].uid
        ? `geo:${next[side].uid}`
        : `manual:${side}:${Date.now()}`;
      next[side].entrantId = null;
      next[side].tag = "";
      next.source = "manual";
      next.setId = null;
    }
  }
  return next;
}
function showOptions() {
  for (const side of sides) {
    const selected = draft[side];
    const list = menu(`${side}-select`);
    list.replaceChildren(new Option("Manual entry", ""));
    for (const c of candidates) list.add(new Option(c.label, c.key));
    const found = candidates.find((c) =>
      selected.uid
        ? c.side.uid === selected.uid
        : selected.entrantId
          ? c.side.entrantId === selected.entrantId
          : selected.tag && c.side.tag === selected.tag,
    );
    if (found) list.value = found.key;
    else if (selected.name || selected.uid || selected.tag) {
      list.add(
        new Option(
          playerLabel(selected.name || selected.tag, selected.uid),
          "current",
        ),
      );
      list.value = "current";
    }
  }
}
function rebuildCandidates() {
  candidates = [];
  for (const [i, p] of (players.value ?? []).entries()) {
    candidates.push({
      key: `profile:${i}`,
      label: playerLabel(p.name || p.startggTag, p.geoguessrPlayerUid),
      side: {
        ...emptyMatch().left,
        id: p.geoguessrPlayerUid
          ? `geo:${p.geoguessrPlayerUid}`
          : `profile:${p.startggTag}`,
        uid: p.geoguessrPlayerUid ?? null,
        entrantId: p.startggEntrantId,
        tag: p.startggTag,
        name: p.name,
      },
    });
  }
  for (const e of Object.values(bracket.value?.entrants ?? {})) {
    const profile = matchProfile(players.value ?? [], {
      entrantId: e.id,
      tag: e.tag,
      name: e.name,
    });
    if (profile.profile) continue;
    candidates.push({
      key: `entrant:${e.id}`,
      label: playerLabel(e.tag || e.name, null),
      side: {
        ...emptyMatch().left,
        id: `startgg:${e.id}`,
        entrantId: e.id,
        tag: e.tag,
        name: e.tag || e.name,
      },
    });
  }
  candidates.sort((a, b) => a.label.localeCompare(b.label, "ja"));
  showOptions();
}
function showUpcoming() {
  const body = el("upcoming");
  body.replaceChildren();
  const b = bracket.value;
  const rank: Record<string, number> = {
    active: 0,
    called: 1,
    queued: 2,
    ready: 3,
    created: 4,
    unknown: 5,
  };
  const queued = new Set(b?.streamQueue.flatMap((q) => q.setIds) ?? []);
  const sets = Object.values(b?.sets ?? {})
    .filter((s) => s.state !== "completed" && s.state !== "invalid")
    .sort(
      (a, b) =>
        Number(queued.has(b.id)) - Number(queued.has(a.id)) ||
        rank[a.state] - rank[b.state] ||
        a.round - b.round ||
        a.id - b.id,
    );
  if (!sets.length) {
    const row = document.createElement("tr"),
      cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent =
      "No upcoming matches available. Refresh start.gg or enter players manually.";
    row.append(cell);
    body.append(row);
  }
  for (const set of sets) {
    const names = set.slots.map((s) =>
      s.entrantId == null ? "TBD" : b?.entrants[s.entrantId]?.tag || "TBD",
    );
    const row = document.createElement("tr");
    for (const text of [
      [
        b?.phases.find((p) => p.id === set.phaseId)?.name,
        set.roundText,
        b?.groups[set.groupId]?.identifier,
      ]
        .filter(Boolean)
        .join(" / "),
      names.join(" vs "),
      set.slots.map((s) => s.score ?? "–").join(" – "),
      set.state,
    ]) {
      const cell = document.createElement("td");
      cell.textContent = text;
      row.append(cell);
    }
    const cell = document.createElement("td"),
      button = document.createElement("button");
    button.textContent = "Load";
    button.disabled = names.length !== 2 || names.includes("TBD");
    button.onclick = async () => {
      if (dirty) {
        el("error").textContent =
          "Apply or discard your edits before loading another match.";
        return;
      }
      await commit(MATCH_MESSAGES.load, {
        setId: set.id,
        revision: draft.revision,
      });
    };
    cell.append(button);
    row.append(cell);
    body.append(row);
  }
}
el("match-form").addEventListener("input", () => {
  dirty = true;
});
el("match-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await commit(MATCH_MESSAGES.apply, readDraft());
  } catch (error) {
    el("error").textContent = (error as Error).message;
  }
});
for (const side of sides)
  menu(`${side}-select`).onchange = () => {
    try {
      draft = readDraft();
    } catch {
      /* Choosing another player replaces an invalid draft. */
    }
    const found = candidates.find(
      (c) => c.key === menu(`${side}-select`).value,
    );
    if (menu(`${side}-select`).value === "current") return;
    draft[side] = found
      ? copy(found.side)
      : { ...emptyMatch()[side], id: `manual:${side}:${Date.now()}` };
    draft.source = "manual";
    draft.setId = null;
    dirty = true;
    showDraft();
  };
el("reload-match").onclick = () => {
  dirty = false;
  draft = copy(state.value ?? emptyMatch());
  showDraft();
  el("error").textContent = "";
};
el("swap-match").onclick = async () => {
  if (dirty) {
    el("error").textContent =
      "Apply or discard your edits before swapping sides.";
    return;
  }
  await commit(MATCH_MESSAGES.swap, { revision: draft.revision });
};
state.on("change", (value) => {
  if (value && !dirty && value.revision >= draft.revision) {
    draft = copy(value);
    showDraft();
  }
});
resolved.on("change", (value) => {
  if (!value) return;
  showAccounts();
  el("match-summary").textContent =
    `${value.left.name} ${value.left.wins} – ${value.right.wins} ${value.right.name}${value.label ? " · " + value.label : ""}`;
  for (const side of sides)
    el(`${side}-profile`).textContent =
      `${value[side].profileStatus === "matched" ? "Spreadsheet profile linked" : value[side].profileStatus === "ambiguous" ? "Duplicate spreadsheet profiles" : "No spreadsheet profile"} · ${value[side].uid || "GeoGuessr UID missing"}`;
});
players.on("change", rebuildCandidates);
duel.on("change", () => showAccounts());
for (const side of sides)
  menu(`${side}-account`).addEventListener("change", () => {
    dirty = true;
  });
bracket.on("change", () => {
  rebuildCandidates();
  showUpcoming();
});
el("refresh-startgg").onclick = () => send(STARTGG_MESSAGES.refresh);
startStatus.on("change", (v) => {
  el("startgg-status").textContent = v?.lastError
    ? ` ${v.lastError}`
    : v?.lastSuccessAt
      ? ` Updated ${new Date(v.lastSuccessAt).toLocaleTimeString()}`
      : " Not fetched yet";
});
