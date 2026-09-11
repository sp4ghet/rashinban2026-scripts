// Operator panel for the start.gg poller: configuration, status, and a
// compact list of every fetched set with live sets first.
import { groupSets } from "../startgg/normalize";
import type { BracketSet, StartggBracket, StartggConfig, StartggStatus } from "../startgg/types";
import { REPLICANTS, STARTGG_MESSAGES } from "../types/replicants";

const config = nodecg.Replicant<StartggConfig>(REPLICANTS.startggConfig);
const bracket = nodecg.Replicant<StartggBracket | null>(REPLICANTS.startggBracket);
const status = nodecg.Replicant<StartggStatus>(REPLICANTS.startggStatus);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const slugInput = $<HTMLInputElement>("slug");
const intervalInput = $<HTMLInputElement>("interval");
const enabledBtn = $<HTMLButtonElement>("enabled");
const refreshBtn = $<HTMLButtonElement>("refresh");
const statusEl = $<HTMLElement>("status");
const summaryEl = $<HTMLElement>("summary");
const setsEl = $<HTMLTableSectionElement>("sets");

let cfg: StartggConfig | undefined;
let data: StartggBracket | null = null;

const fmtTime = (t: number | null) => (t ? new Date(t).toLocaleTimeString() : "never");

function renderConfig() {
  if (!cfg) return;
  if (document.activeElement !== slugInput) slugInput.value = cfg.eventSlug;
  if (document.activeElement !== intervalInput) intervalInput.value = String(Math.round(cfg.pollIntervalMs / 1000));
  enabledBtn.textContent = cfg.enabled ? "Polling ON" : "Polling OFF";
  enabledBtn.classList.toggle("active", cfg.enabled);
}

function renderStatus(s: StartggStatus | undefined) {
  if (!s) return;
  const parts = [
    s.tokenPresent ? "token OK" : "NO TOKEN",
    s.polling ? "polling" : "idle",
    `last ok ${fmtTime(s.lastSuccessAt)}`,
    `${s.requestsLastMinute} req/min`,
    s.lastComplexity !== null ? `complexity ${s.lastComplexity}` : "",
  ].filter(Boolean);
  statusEl.textContent = parts.join(" | ") + (s.lastError ? `\nERROR: ${s.lastError}` : "");
  statusEl.classList.toggle("error", Boolean(s.lastError) || !s.tokenPresent);
}

function entrantName(id: number | null) {
  if (id === null) return "";
  return data?.entrants[id]?.name ?? `#${id}`;
}

function renderBracket() {
  setsEl.replaceChildren();
  if (!data) {
    summaryEl.textContent = "No data fetched yet.";
    return;
  }
  const groupCount = Object.keys(data.groups).length;
  const setCount = Object.keys(data.sets).length;
  summaryEl.textContent =
    `${data.event?.tournamentName ?? ""} / ${data.event?.name ?? ""} (${data.event?.state ?? "?"}) ` +
    `phases ${data.phases.length}, groups ${groupCount}, sets ${setCount}, entrants ${Object.keys(data.entrants).length}, ` +
    `queue ${data.streamQueue.reduce((n, q) => n + q.setIds.length, 0)}, fetched ${fmtTime(data.fetchedAt)}`;

  const rows: { phase: string; group: string; set: BracketSet }[] = [];
  for (const phase of data.phases) {
    for (const gid of phase.groupIds) {
      const g = data.groups[gid];
      if (!g) continue;
      for (const set of groupSets(data, gid)) rows.push({ phase: phase.name, group: g.identifier, set });
    }
  }
  const liveRank: Record<string, number> = { active: 0, called: 1, ready: 2, queued: 3 };
  rows.sort((a, b) => (liveRank[a.set.state] ?? 9) - (liveRank[b.set.state] ?? 9));
  for (const { phase, group, set } of rows) {
    const tr = document.createElement("tr");
    tr.dataset.state = set.state;
    const cells = [
      phase,
      group,
      set.roundText || set.identifier,
      set.slots.map((s) => entrantName(s.entrantId) || "TBD").join(" vs "),
      set.slots.map((s) => (s.score ?? "-")).join(" - "),
      set.state,
    ];
    for (const c of cells) {
      const td = document.createElement("td");
      td.textContent = c;
      tr.append(td);
    }
    setsEl.append(tr);
  }
}

const send = async (name: string, payload?: unknown) => {
  try {
    await nodecg.sendMessage(name, payload);
  } catch (err) {
    statusEl.textContent = `ERROR: ${(err as Error).message}`;
    statusEl.classList.add("error");
  }
};

slugInput.addEventListener("change", () => send(STARTGG_MESSAGES.setConfig, { eventSlug: slugInput.value }));
intervalInput.addEventListener("change", () =>
  send(STARTGG_MESSAGES.setConfig, { pollIntervalMs: Number(intervalInput.value) * 1000 }),
);
enabledBtn.addEventListener("click", () => send(STARTGG_MESSAGES.setConfig, { enabled: !cfg?.enabled }));
refreshBtn.addEventListener("click", async () => {
  refreshBtn.disabled = true;
  await send(STARTGG_MESSAGES.refresh);
  refreshBtn.disabled = false;
});

config.on("change", (v) => {
  cfg = v;
  renderConfig();
});
status.on("change", (v) => renderStatus(v));
bracket.on("change", (v) => {
  data = v ?? null;
  renderBracket();
});
