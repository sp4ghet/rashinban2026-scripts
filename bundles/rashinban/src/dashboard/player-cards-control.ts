// Operator panel: sheet source, current-match selection, and card state.
import { resolveCurrentMatch, type CurrentMatchSelection } from "../match/current";
import { findProfile, type PlayerProfile } from "../sheet/players";
import type { PlayerCardsState, SheetConfig, SheetStatus } from "../sheet/types";
import { groupSets } from "../startgg/normalize";
import type { StartggBracket } from "../startgg/types";
import { MATCH_MESSAGES, PLAYERCARDS_MESSAGES, REPLICANTS, SHEET_MESSAGES } from "../types/replicants";

const sheetConfig = nodecg.Replicant<SheetConfig>(REPLICANTS.sheetConfig);
const sheetStatus = nodecg.Replicant<SheetStatus>(REPLICANTS.sheetStatus);
const playersRep = nodecg.Replicant<PlayerProfile[]>(REPLICANTS.players);
const bracketRep = nodecg.Replicant<StartggBracket | null>(REPLICANTS.startggBracket);
const selectionRep = nodecg.Replicant<CurrentMatchSelection>(REPLICANTS.currentMatch);
const cardsRep = nodecg.Replicant<PlayerCardsState>(REPLICANTS.playerCards);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sheetUrl = $<HTMLInputElement>("sheet-url");
const sheetInterval = $<HTMLInputElement>("sheet-interval");
const sheetEnabled = $<HTMLButtonElement>("sheet-enabled");
const sheetRefresh = $<HTMLButtonElement>("sheet-refresh");
const sheetStatusEl = $<HTMLElement>("sheet-status");
const modeInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="mode"]'));
const setSelect = $<HTMLSelectElement>("set-select");
const tag1 = $<HTMLInputElement>("tag-1");
const tag2 = $<HTMLInputElement>("tag-2");
const swapTags = $<HTMLButtonElement>("swap-tags");
const playersList = $<HTMLDataListElement>("players-list");
const preview = $<HTMLElement>("preview");
const visibleBtn = $<HTMLButtonElement>("cards-visible");
const pageBtn = $<HTMLButtonElement>("cards-page");
const errorEl = $<HTMLElement>("error");

let cfg: SheetConfig | undefined;
let players: PlayerProfile[] = [];
let bracket: StartggBracket | null = null;
let selection: CurrentMatchSelection | undefined;
let cards: PlayerCardsState | undefined;

const send = async (name: string, payload?: unknown) => {
  try {
    await nodecg.sendMessage(name, payload);
    errorEl.textContent = "";
  } catch (err) {
    errorEl.textContent = (err as Error).message;
  }
};

function renderSheet() {
  if (cfg) {
    if (document.activeElement !== sheetUrl) sheetUrl.value = cfg.sheetId ? `${cfg.sheetId} (gid ${cfg.playersGid})` : "";
    if (document.activeElement !== sheetInterval) sheetInterval.value = String(Math.round(cfg.pollIntervalMs / 1000));
    sheetEnabled.textContent = cfg.enabled ? "Polling ON" : "Polling OFF";
    sheetEnabled.classList.toggle("active", cfg.enabled);
  }
  const s = sheetStatus.value;
  if (!s) return;
  const parts = [
    `${s.playerCount} players`,
    s.polling ? "polling" : "idle",
    s.lastSuccessAt ? `last ok ${new Date(s.lastSuccessAt).toLocaleTimeString()}` : "never fetched",
    s.missingColumns.length ? `MISSING COLUMNS: ${s.missingColumns.join(", ")}` : "",
    s.skippedRows ? `${s.skippedRows} rows without startgg_tag` : "",
  ].filter(Boolean);
  sheetStatusEl.textContent = parts.join(" | ") + (s.lastError ? `\nERROR: ${s.lastError}` : "");
  sheetStatusEl.classList.toggle("error", Boolean(s.lastError) || s.missingColumns.length > 0);
}

function renderSets() {
  const current = selection?.setId ?? null;
  setSelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = bracket ? "choose a set" : "no start.gg data";
  setSelect.append(placeholder);
  if (!bracket) return;
  const name = (id: number | null) => (id === null ? "TBD" : (bracket!.entrants[id]?.tag ?? `#${id}`));
  for (const phase of bracket.phases) {
    for (const gid of phase.groupIds) {
      const g = bracket.groups[gid];
      if (!g) continue;
      const og = document.createElement("optgroup");
      og.label = `${phase.name} / pool ${g.identifier}`;
      for (const set of groupSets(bracket, gid)) {
        const opt = document.createElement("option");
        opt.value = String(set.id);
        opt.textContent = `${set.roundText || set.identifier}: ${set.slots.map((s) => name(s.entrantId)).join(" vs ")} [${set.state}]`;
        if (set.id === current) opt.selected = true;
        og.append(opt);
      }
      setSelect.append(og);
    }
  }
}

/** Datalist of every sheet player, so P1/P2 can be picked from a dropdown or typed. */
function renderPlayersList() {
  playersList.replaceChildren();
  for (const p of [...players].sort((a, b) => a.name.localeCompare(b.name, "ja"))) {
    const opt = document.createElement("option");
    opt.value = p.startggTag;
    opt.label = p.name !== p.startggTag ? `${p.name} (${p.startggTag})` : p.name;
    playersList.append(opt);
  }
}

function renderSelection() {
  const sel = selection;
  if (!sel) return;
  for (const input of modeInputs) input.checked = input.value === sel.mode;
  if (document.activeElement !== tag1) tag1.value = sel.tags[0];
  if (document.activeElement !== tag2) tag2.value = sel.tags[1];
  renderSets();
  const match = resolveCurrentMatch(bracket, sel);
  const side = (i: 0 | 1) => {
    const mp = match.players[i];
    const profile = findProfile(players, mp.entrant ?? (mp.tag ? { id: -1, tag: mp.tag, name: mp.tag } : null));
    const who = mp.entrant?.name || mp.tag || "TBD";
    return `${who} -> ${profile ? `profile "${profile.name}"` : "NO PROFILE"}`;
  };
  preview.textContent = `source: ${match.source}${match.roundText ? ` (${match.phaseName} / ${match.roundText})` : ""}\nP1: ${side(0)}\nP2: ${side(1)}`;
}

function renderCards() {
  if (!cards) return;
  visibleBtn.textContent = cards.visible ? "Cards visible" : "Cards hidden";
  visibleBtn.classList.toggle("active", cards.visible);
  pageBtn.textContent = cards.page === "stats" ? "Page: STATS" : "Page: PROFILE";
}

sheetUrl.addEventListener("change", () => {
  const v = sheetUrl.value.trim();
  if (v.includes("(gid")) return; // unchanged display value
  if (v.includes("docs.google.com")) void send(SHEET_MESSAGES.setConfig, { sheetUrl: v });
  else void send(SHEET_MESSAGES.setConfig, { sheetId: v }); // bare id or a full CSV URL
});
sheetInterval.addEventListener("change", () => send(SHEET_MESSAGES.setConfig, { pollIntervalMs: Number(sheetInterval.value) * 1000 }));
sheetEnabled.addEventListener("click", () => send(SHEET_MESSAGES.setConfig, { enabled: !cfg?.enabled }));
sheetRefresh.addEventListener("click", async () => {
  sheetRefresh.disabled = true;
  await send(SHEET_MESSAGES.refresh);
  sheetRefresh.disabled = false;
});
for (const input of modeInputs) input.addEventListener("change", () => send(MATCH_MESSAGES.setSelection, { mode: input.value }));
setSelect.addEventListener("change", () => {
  const id = setSelect.value ? Number(setSelect.value) : null;
  void send(MATCH_MESSAGES.setSelection, { mode: "set", setId: id });
});
const commitTags = () => send(MATCH_MESSAGES.setSelection, { mode: "tags", tags: [tag1.value, tag2.value] });
tag1.addEventListener("change", commitTags);
tag2.addEventListener("change", commitTags);
swapTags.addEventListener("click", () => {
  const cur = selection?.tags ?? [tag1.value, tag2.value];
  void send(MATCH_MESSAGES.setSelection, { mode: "tags", tags: [cur[1], cur[0]] });
});
visibleBtn.addEventListener("click", () => send(PLAYERCARDS_MESSAGES.set, { visible: !cards?.visible }));
pageBtn.addEventListener("click", () => send(PLAYERCARDS_MESSAGES.set, { page: cards?.page === "stats" ? "profile" : "stats" }));

sheetConfig.on("change", (v) => {
  cfg = v;
  renderSheet();
});
sheetStatus.on("change", () => renderSheet());
playersRep.on("change", (v) => {
  players = v ?? [];
  renderPlayersList();
  renderSelection();
});
bracketRep.on("change", (v) => {
  bracket = v ?? null;
  renderSelection();
});
selectionRep.on("change", (v) => {
  selection = v;
  renderSelection();
});
cardsRep.on("change", (v) => {
  cards = v;
  renderCards();
});
