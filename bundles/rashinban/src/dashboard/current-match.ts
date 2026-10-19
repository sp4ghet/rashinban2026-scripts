import { matchProfile, playerLabel } from "../match/identity.ts";
import { emptyMatch, type MatchSide, type MatchState, type ResolvedMatch } from "../match/state.ts";
import type { PlayerProfile } from "../sheet/players.ts";
import type { StartggBracket, StartggStatus } from "../startgg/types.ts";
import { MATCH_MESSAGES, REPLICANTS, STARTGG_MESSAGES } from "../types/replicants.ts";

const players = nodecg.Replicant<PlayerProfile[]>(REPLICANTS.players);
const bracket = nodecg.Replicant<StartggBracket | null>(REPLICANTS.startggBracket);
const startStatus = nodecg.Replicant<StartggStatus>(REPLICANTS.startggStatus);
const el = (id: string) => document.getElementById(id)!;
const menu = (id: string) => el(id) as HTMLSelectElement;
const button = (id: string) => el(id) as HTMLButtonElement;
const sides = ["left", "right"] as const;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const slots = {
  current: {
    state: nodecg.Replicant<MatchState>(REPLICANTS.matchState),
    resolved: nodecg.Replicant<ResolvedMatch>(REPLICANTS.matchResolved),
    apply: MATCH_MESSAGES.apply, load: MATCH_MESSAGES.load, swap: MATCH_MESSAGES.swap,
    draft: emptyMatch(), dirty: false, ready: false,
  },
  next: {
    state: nodecg.Replicant<MatchState>(REPLICANTS.nextMatchState),
    resolved: nodecg.Replicant<ResolvedMatch>(REPLICANTS.nextMatchResolved),
    apply: MATCH_MESSAGES.nextApply, load: MATCH_MESSAGES.nextLoad, swap: MATCH_MESSAGES.nextSwap,
    draft: emptyMatch(), dirty: false, ready: false,
  },
};
type Slot = keyof typeof slots;
const slotNames = ["current", "next"] as const;
let candidates: { key: string; label: string; side: MatchSide }[] = [];
let busy = false;
const selected = (side: MatchSide) => !!(side.name || side.tag || side.uid || side.entrantId);

async function request(errorId: string, action: () => Promise<void>) {
  if (busy) return;
  busy = true; el(errorId).textContent = ""; refreshControls();
  try { await action(); }
  catch (error) {
    const message = typeof error === "string" ? error : error && typeof error === "object" && "message" in error ? error.message : null;
    el(errorId).textContent = typeof message === "string" ? message : "Change rejected. Check the NodeCG connection.";
  } finally { busy = false; refreshControls(); }
}
function showOptions(slot: Slot) {
  for (const side of sides) {
    const chosen = slots[slot].draft[side];
    const list = menu(`${slot}-${side}`);
    const placeholder = new Option("Select player", ""); placeholder.disabled = true;
    list.replaceChildren(placeholder, ...candidates.map(c => new Option(c.label, c.key)));
    const found = candidates.find(c => chosen.uid ? c.side.uid === chosen.uid
      : chosen.entrantId ? c.side.entrantId === chosen.entrantId
      : c.side.id === chosen.id || chosen.tag && c.side.tag === chosen.tag);
    if (found) list.value = found.key;
    else if (selected(chosen)) {
      list.add(new Option(playerLabel(chosen.name || chosen.tag, chosen.uid), "saved")); list.value = "saved";
    } else list.value = "";
  }
}
function showDraft(slot: Slot) {
  (el(`${slot}-label`) as HTMLInputElement).value = slots[slot].draft.label;
  showOptions(slot); refreshControls();
}
function refreshControls() {
  for (const slot of slotNames) {
    const model = slots[slot];
    const disabled = busy || !model.ready;
    for (const side of sides) menu(`${slot}-${side}`).disabled = disabled;
    (el(`${slot}-label`) as HTMLInputElement).disabled = disabled;
    button(`${slot}-apply`).disabled = disabled || !sides.every(side => selected(model.draft[side]));
    button(`${slot}-swap`).disabled = disabled || model.dirty;
    button(`${slot}-reload`).disabled = disabled;
    const conflict = model.dirty && model.state.value?.revision !== model.draft.revision;
    el(`${slot}-status`).textContent = !model.ready ? "Loading..." : conflict ? "Changed elsewhere. Discard edits to reload."
      : model.dirty ? "Unsaved changes" : slot === "next" && !sides.some(side => selected(model.draft[side])) ? "No next match staged" : "Saved";
  }
  const next = slots.next.state.value;
  button("promote-next").disabled = busy || !slots.current.ready || !slots.next.ready || slots.current.dirty || slots.next.dirty || !next || !sides.every(side => selected(next[side]));
  button("refresh-startgg").disabled = busy;
  document.querySelectorAll<HTMLButtonElement>("button[data-load-slot]").forEach(control => {
    const slot = control.dataset.loadSlot as Slot;
    control.disabled = busy || !slots[slot].ready || slots[slot].dirty || control.dataset.unavailable === "true";
  });
}
async function commit(slot: Slot, name: string, value: unknown) {
  await request(`${slot}-error`, async () => {
    const saved = await nodecg.sendMessage(name, value) as MatchState;
    const latest = slots[slot].state.value;
    slots[slot].draft = copy(latest && latest.revision > saved.revision ? latest : saved);
    slots[slot].dirty = false; showDraft(slot);
  });
}
function rebuildCandidates() {
  candidates = [];
  for (const [i, p] of (players.value ?? []).entries()) {
    candidates.push({ key: `profile:${i}`, label: playerLabel(p.name || p.startggTag, p.geoguessrPlayerUid),
      side: { ...emptyMatch().left, id: p.geoguessrPlayerUid ? `geo:${p.geoguessrPlayerUid}` : `profile:${p.startggTag}`,
        uid: p.geoguessrPlayerUid ?? null, entrantId: p.startggEntrantId, tag: p.startggTag, name: p.name } });
  }
  for (const e of Object.values(bracket.value?.entrants ?? {})) {
    if (matchProfile(players.value ?? [], { entrantId: e.id, tag: e.tag, name: e.name }).profile) continue;
    candidates.push({ key: `entrant:${e.id}`, label: playerLabel(e.tag || e.name, null),
      side: { ...emptyMatch().left, id: `startgg:${e.id}`, entrantId: e.id, tag: e.tag, name: e.tag || e.name } });
  }
  candidates.sort((a, b) => a.label.localeCompare(b.label, "ja"));
  for (const slot of slotNames) showOptions(slot);
}
function showUpcoming() {
  const body = el("upcoming"), b = bracket.value;
  body.replaceChildren();
  const rank: Record<string, number> = { active: 0, called: 1, queued: 2, ready: 3, created: 4, unknown: 5 };
  const queued = new Set(b?.streamQueue.flatMap(q => q.setIds) ?? []);
  const sets = Object.values(b?.sets ?? {}).filter(s => s.state !== "completed" && s.state !== "invalid")
    .sort((a, b) => Number(queued.has(b.id)) - Number(queued.has(a.id)) || rank[a.state] - rank[b.state] || a.round - b.round || a.id - b.id);
  if (!sets.length) {
    const row = document.createElement("tr"), cell = document.createElement("td"); cell.colSpan = 5;
    cell.textContent = "No upcoming matches available. Refresh start.gg or select players above."; row.append(cell); body.append(row);
  }
  for (const set of sets) {
    const names = set.slots.map(s => s.entrantId == null ? "TBD" : b?.entrants[s.entrantId]?.tag || b?.entrants[s.entrantId]?.name || "TBD");
    const row = document.createElement("tr");
    for (const text of [[b?.phases.find(p => p.id === set.phaseId)?.name, set.roundText, b?.groups[set.groupId]?.identifier].filter(Boolean).join(" / "),
      names.join(" vs "), set.slots.map(s => s.score ?? "–").join(" – "), set.state]) {
      const cell = document.createElement("td"); cell.textContent = text; row.append(cell);
    }
    const cell = document.createElement("td"), actions = document.createElement("div"); actions.className = "row";
    for (const slot of slotNames) {
      const load = document.createElement("button"); load.type = "button"; load.textContent = `Load ${slot}`;
      load.dataset.loadSlot = slot; load.dataset.setId = String(set.id); load.dataset.unavailable = String(names.length !== 2 || names.includes("TBD"));
      load.onclick = () => { if (!slots[slot].dirty) void commit(slot, slots[slot].load, { setId: set.id, revision: slots[slot].draft.revision }); };
      actions.append(load);
    }
    cell.append(actions); row.append(cell); body.append(row);
  }
  refreshControls();
}
for (const slot of slotNames) {
  const model = slots[slot];
  el(`${slot}-form`).addEventListener("input", () => { model.dirty = true; refreshControls(); });
  el(`${slot}-form`).addEventListener("submit", event => {
    event.preventDefault();
    const next = copy(model.draft); next.label = (el(`${slot}-label`) as HTMLInputElement).value;
    void commit(slot, model.apply, next);
  });
  for (const side of sides) menu(`${slot}-${side}`).addEventListener("change", () => {
    const found = candidates.find(c => c.key === menu(`${slot}-${side}`).value);
    if (!found) return;
    model.draft[side] = copy(found.side); model.draft.source = "manual"; model.draft.setId = null;
    model.dirty = true; showOptions(slot); refreshControls();
  });
  button(`${slot}-reload`).onclick = () => {
    model.draft = copy(model.state.value ?? emptyMatch()); model.dirty = false; el(`${slot}-error`).textContent = ""; showDraft(slot);
  };
  button(`${slot}-swap`).onclick = () => { if (!model.dirty) void commit(slot, model.swap, { revision: model.draft.revision }); };
  model.state.on("change", value => {
    if (value) {
      model.ready = true;
      if (!model.dirty && value.revision >= model.draft.revision) { model.draft = copy(value); showDraft(slot); }
    }
    refreshControls();
  });
  model.resolved.on("change", value => {
    if (!value) return;
    el(`${slot}-summary`).textContent = !sides.some(side => selected(value[side]) && value[side].name !== "TBD") ? "No match selected"
      : `${value.left.name} ${slot === "current" ? `${value.left.wins} – ${value.right.wins}` : "vs"} ${value.right.name}${value.label ? " · " + value.label : ""}`;
    for (const side of sides) el(`${slot}-${side}-profile`).textContent = value[side].profileStatus === "matched" ? "Spreadsheet profile linked"
      : value[side].profileStatus === "ambiguous" ? "Duplicate spreadsheet profiles" : "";
  });
}
button("promote-next").onclick = () => {
  if (slots.current.dirty || slots.next.dirty) return;
  void request("next-error", async () => {
    await nodecg.sendMessage(MATCH_MESSAGES.promoteNext, { revision: slots.current.draft.revision, nextRevision: slots.next.draft.revision });
  });
};
players.on("change", rebuildCandidates);
bracket.on("change", () => { rebuildCandidates(); showUpcoming(); });
button("refresh-startgg").onclick = () => { void request("error", async () => { await nodecg.sendMessage(STARTGG_MESSAGES.refresh); }); };
startStatus.on("change", value => {
  el("startgg-status").textContent = value?.lastError ? ` ${value.lastError}`
    : value?.lastSuccessAt ? ` Updated ${new Date(value.lastSuccessAt).toLocaleTimeString()}` : " Not fetched yet";
});
refreshControls();
